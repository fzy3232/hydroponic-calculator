/**
 * 通过 CDP（Chrome DevTools Protocol）对页面截图。
 *
 * 背景：Edge / Chrome 154 起已移除 `--screenshot` 命令行参数（实测帮助里也查不到），
 * 因此必须走 DevTools 协议。本脚本只负责「连上已启动的调试端口并发截图命令」，
 * 浏览器进程由调用方（PowerShell）启动 —— 这样也避开了 Node 捕获子进程输出的沙箱限制。
 *
 * 用法：node test/screenshot.mjs <port> <output.png> [width] [height]
 */

import fs from 'node:fs';

const [, , portArgument, outputArgument, widthArgument, heightArgument] = process.argv;
const port = portArgument ?? '9222';
const outputPath = outputArgument ?? 'screenshot.png';
const width = Number(widthArgument ?? 1400);
const height = Number(heightArgument ?? 3400);
/** 截图前要执行的 JS（可选）：用于切换到指定视图之类的场景。 */
const preScreenshotScript = process.argv[6] ?? '';

/** 轮询等待调试端口就绪。 */
async function waitForTargets(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page !== undefined) {
        return page;
      }
    } catch {
      // 端口尚未就绪，继续等待
    }
    if (Date.now() > deadline) {
      throw new Error(`等待调试端口 ${port} 超时`);
    }
    await new Promise((resolve) => { setTimeout(resolve, 400); });
  }
}

const page = await waitForTargets();

const socket = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();

/** 发送一条 CDP 命令并等待结果。 */
function send(method, params = {}) {
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const entry = message.id === undefined ? undefined : pending.get(message.id);
  if (entry === undefined) {
    return;
  }
  pending.delete(message.id);
  if (message.error !== undefined) {
    entry.reject(new Error(`${message.error.message ?? 'CDP 错误'}`));
  } else {
    entry.resolve(message.result);
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
});

await send('Page.enable');
// 设定视口尺寸；captureBeyondViewport 可截取超出视口的完整页面
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});

// 可选：截图前执行一段 JS（例如切到「数据编辑」视图），让截图覆盖到各视图
if (preScreenshotScript !== '') {
  await send('Runtime.evaluate', { expression: preScreenshotScript, awaitPromise: true });
  await new Promise((resolve) => { setTimeout(resolve, 400); });
}

const screenshot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
});

fs.writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'));
socket.close();

console.log(`已保存截图：${outputPath}`);

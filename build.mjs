/**
 * 构建脚本：ESM 源码 → 单个自包含 HTML。
 *
 * 为什么必须打包成 IIFE：
 *   浏览器在 `file://` 协议下禁止加载 ES module（同源策略），
 *   而源码用 ESM 编写更利于测试与维护。因此构建产物是**内联的普通脚本**。
 *
 * 本脚本直接复用 `src/core/data.js` 的解析函数（DRY），
 * 这正是「core 层零 DOM 依赖」带来的收益：同一套逻辑在 Node 与浏览器中通用。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parseCSV, fertilizersFromRows, cropsFromRows, glossaryFromRows } from './src/core/data.js';

const projectDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * 输出目标。
 *
 * 用法：`node build.mjs [输出目录] [文件名]`
 *   - `node build.mjs`                              → `dist/index.html`（Tauri 加载的前端产物，默认）
 *   - `node build.mjs ../水培计算器 水培营养液计算器.html` → 独立单文件版（仍可双击运行）
 *
 * 两个产物**来自同一份源码与同一份数据**，所以不存在双份代码漂移的问题。
 */
const outputDirArgument = process.argv[2];
const outputDir = outputDirArgument === undefined
  ? path.join(projectDir, 'dist')
  : path.resolve(projectDir, outputDirArgument);
const outputFileName = process.argv[3] ?? 'index.html';

/**
 * 读取并解析 CSV 文件。
 * @param {string} filePath CSV 路径
 * @returns {Array<Record<string, string>>}
 */
function readCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`缺少数据文件：${filePath}`);
    return [];
  }
  const text = fs.readFileSync(filePath, 'utf8');
  return parseCSV(text).records;
}

/**
 * 把数据序列化为可安全内联进 `<script>` 的 JSON。
 * @param {unknown} data
 * @returns {string}
 */
function toInlineJSON(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * 读取文件内容。
 * @param {string} relativePath 相对项目根的路径
 * @returns {string}
 */
const readText = (relativePath) => fs.readFileSync(path.join(projectDir, relativePath), 'utf8');

/** 源模板中仅在开发期可见的提示块标记，构建时剔除。 */
const DEVELOPMENT_NOTICE = /<!-- BUILD:STRIP:START[\s\S]*?BUILD:STRIP:END -->/g;

// —— 1. 打包应用代码（ESM → IIFE）——
const bundle = await build({
  entryPoints: [path.join(projectDir, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  platform: 'browser',
  write: false,
  legalComments: 'none',
  charset: 'utf8',
});

const appCode = bundle.outputFiles[0].text;

// —— 2. 读取并解析数据 ——
const fertilizers = fertilizersFromRows(readCSV(path.join(projectDir, 'data', 'fertilizers.csv')));
const crops = cropsFromRows(readCSV(path.join(projectDir, 'data', 'crops.csv')));
const glossary = glossaryFromRows(readCSV(path.join(projectDir, 'data', 'glossary.csv')));

if (fertilizers.length === 0) {
  throw new Error('肥料库为空：请检查 data/fertilizers.csv，或运行 npm run data:build 重新生成');
}
if (crops.length === 0) {
  throw new Error('作物库为空：请检查 data/crops.csv，或运行 npm run data:build 重新生成');
}

// —— 3. 组装单文件 HTML ——
const html = readText('src/template.html')
  .replace(DEVELOPMENT_NOTICE, '')
  .replace('/*__STYLE__*/', () => readText('src/style.css'))
  .replace('/*__APP__*/', () => appCode)
  .replace('/*__FERTILIZERS__*/', () => toInlineJSON(fertilizers))
  .replace('/*__CROPS__*/', () => toInlineJSON(crops))
  .replace('/*__GLOSSARY__*/', () => toInlineJSON(glossary));

fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, outputFileName);
fs.writeFileSync(outputPath, html, 'utf8');

// —— 4. 同时输出可编辑的数据副本 ——
const dataDir = path.join(outputDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.copyFileSync(path.join(projectDir, 'data', 'fertilizers.csv'), path.join(dataDir, 'fertilizers.csv'));
fs.copyFileSync(path.join(projectDir, 'data', 'crops.csv'), path.join(dataDir, 'crops.csv'));
fs.copyFileSync(path.join(projectDir, 'data', 'glossary.csv'), path.join(dataDir, 'glossary.csv'));

const sizeKB = (Buffer.byteLength(html) / 1024).toFixed(1);
const form = outputFileName === 'index.html' ? 'Tauri 前端产物' : '独立单文件版（可双击）';
console.log(`输出：${outputPath}`);
console.log(`  形态 ${form} | 体积 ${sizeKB} KB | 肥料 ${fertilizers.length} 种 `
  + `| 作物生育期 ${crops.length} 条 | 术语 ${glossary.length} 条`);

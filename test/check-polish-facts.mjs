/**
 * 英文 README 润色后的事实保全核验。
 *
 * 润色应只改措辞，不改事实。人工看 diff 容易漏，这里做机械化比对：
 * 把"事实性 token"从两版里抽出来（数字、反引号标识符、URL、代码块内容），
 * 逐类比对。任何一类出现差异都说明润色越界了。
 *
 * 用法：node test/check-polish-facts.mjs <旧版本文件> <新版本文件>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(here);

const oldPath = process.argv[2];
const newPath = process.argv[3] ?? path.join(projectDir, 'README.en.md');

if (oldPath === undefined) {
  console.error('用法：node test/check-polish-facts.mjs <旧版本> [新版本]');
  process.exit(2);
}

const oldText = fs.readFileSync(oldPath, 'utf8');
const newText = fs.readFileSync(newPath, 'utf8');

/** 从文本中抽取可机械比对的事实性 token。 */
const facts = (text) => {
  const numbers = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).sort();
  // 反引号里的内容：标识符、命令、路径、DOM 片段等，都属事实
  const code = (text.match(/`[^`\n]+`/g) ?? [])
    .map((s) => s.slice(1, -1))
    .filter((s) => !/[\u4e00-\u9fa5]/.test(s))   // 纯中文反引号属可改写文案，另算
    .sort();
  const urls = (text.match(/https?:\/\/[^\s)>"`]+/g) ?? []).sort();
  // 代码块整块内容
  const fences = (text.match(/^```[\s\S]*?^```$/gm) ?? [])
    .map((s) => s.replace(/^```\w*\n?/, '').replace(/```$/, '').trim())
    .sort();
  // 箭头公式与数学符号串
  const math = (text.match(/[A-Za-zᵀ⁺()\s]*=[^.,;\n]{2,40}/g) ?? [])
    .map((s) => s.trim())
    .sort();
  return { numbers, code, urls, fences, math };
};

const oldFacts = facts(oldText);
const newFacts = facts(newText);

let problems = 0;
const report = (label, a, b) => {
  const setA = new Set(a);
  const setB = new Set(b);
  const removed = [...setA].filter((x) => !setB.has(x));
  const added = [...setB].filter((x) => !setA.has(x));
  const multisetSame = a.length === b.length && a.every((x, i) => x === b[i]);
  if (removed.length === 0 && added.length === 0 && multisetSame) {
    console.log(`  ✓ ${label}：${a.length} 项完全一致`);
    return;
  }
  problems += 1;
  console.log(`  ✗ ${label}：旧 ${a.length} 项 / 新 ${b.length} 项`);
  for (const x of removed.slice(0, 20)) {
    console.log(`      仅旧版有: ${x}`);
  }
  for (const x of added.slice(0, 20)) {
    console.log(`      仅新版有: ${x}`);
  }
};

console.log(`旧版本：${path.basename(oldPath)}`);
console.log(`新版本：${path.basename(newPath)}`);
console.log('');
console.log('=== 事实性 token 比对 ===');
report('数字', oldFacts.numbers, newFacts.numbers);
report('反引号标识符/命令/路径', oldFacts.code, newFacts.code);
report('URL', oldFacts.urls, newFacts.urls);
report('代码块内容', oldFacts.fences, newFacts.fences);
report('公式片段', oldFacts.math, newFacts.math);

console.log('');
console.log('=== 结构比对 ===');
const shape = (text) => ({
  lines: text.split('\n').length,
  h2: (text.match(/^## /gm) ?? []).length,
  h3: (text.match(/^### /gm) ?? []).length,
  tableRows: (text.match(/^\|/gm) ?? []).length,
  fences: (text.match(/^```/gm) ?? []).length,
  images: (text.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length,
  anchors: (text.match(/\]\(#[^)]+\)/g) ?? []).length,
});
const oldShape = shape(oldText);
const newShape = shape(newText);
for (const key of Object.keys(oldShape)) {
  const same = oldShape[key] === newShape[key];
  if (!same) {
    problems += 1;
  }
  console.log(`  ${same ? '✓' : '✗'} ${key.padEnd(10)} 旧 ${String(oldShape[key]).padStart(3)} / 新 ${String(newShape[key]).padStart(3)}`);
}

console.log('');
console.log('=== 必须保留的中文串 ===');
const MUST_KEEP = [
  '[中文](README.md)',
  '水培营养液配方计算器-便携版.exe',
  '水培营养液计算器.html',
  '大量', '微量',
  '配方信息', '原料用量', '目标达成', '形态核对',
  '另存为', '打印', '导出 CSV', '导入 CSV', '主要贡献',
  '请在 CSV 中把化学式改为 X 后重新导入',
  '请把化学式改为 X',
];
for (const item of MUST_KEEP) {
  const inOld = oldText.includes(item);
  const inNew = newText.includes(item);
  if (inOld && !inNew) {
    problems += 1;
    console.log(`  ✗ 丢失：${item}`);
  } else if (inOld === inNew) {
    console.log(`  ✓ ${item}`);
  } else {
    console.log(`  ? ${item}（旧版无、新版有）`);
  }
}

console.log('');
console.log('=== 结论 ===');
if (problems === 0) {
  console.log('  ✓ 润色未改动任何事实性内容');
} else {
  console.log(`  ✗ 发现 ${problems} 处事实或结构差异，需人工裁决`);
  process.exitCode = 1;
}

/**
 * 双语 README 一致性核验。
 *
 * 目的：翻译是最容易"看起来对、实际漏内容"的工作。
 * 这里不检查文笔，只核对**结构与可机检的事实**：
 * 标题层级是否一一对应、图片/徽章/代码围栏是否原样保留、残留中文出现在哪些类别。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const zh = fs.readFileSync(path.join(projectDir, 'README.md'), 'utf8');
const en = fs.readFileSync(path.join(projectDir, 'README.en.md'), 'utf8');

const FENCE = /^```/gm;

/** 统计可比的结构指标。 */
const stats = (text) => ({
  lines: text.split('\n').length,
  h1: (text.match(/^# /gm) ?? []).length,
  h2: (text.match(/^## /gm) ?? []).length,
  h3: (text.match(/^### /gm) ?? []).length,
  tables: (text.match(/^\|/gm) ?? []).length,
  fences: (text.match(FENCE) ?? []).length,
  images: (text.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length,
  links: (text.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length,
});

const zhStats = stats(zh);
const enStats = stats(en);

console.log('=== 1. 结构指标对比 ===');
console.log(`  ${'指标'.padEnd(12)}${'中文'.padStart(6)}${'英文'.padStart(7)}  判定`);
for (const key of Object.keys(zhStats)) {
  const same = zhStats[key] === enStats[key];
  // 行数与链接数允许合理差异（英文更长、切换行不同），其余必须一致
  const mustMatch = ['h1', 'h2', 'h3', 'images'].includes(key);
  const verdict = mustMatch ? (same ? '✓' : '✗ 不一致') : (same ? '✓' : '— 允许差异');
  console.log(`  ${key.padEnd(12)}${String(zhStats[key]).padStart(6)}${String(enStats[key]).padStart(7)}  ${verdict}`);
}

console.log('\n=== 2. 标题层级逐项对照 ===');
const headings = (text) => [...text.matchAll(/^(#{2,3}) (.+)$/gm)].map((m) => ({ level: m[1], text: m[2] }));
const zhHeads = headings(zh);
const enHeads = headings(en);
console.log(`  中文 ${zhHeads.length} 个 / 英文 ${enHeads.length} 个`);
let levelMismatch = 0;
const pairs = [];
for (let i = 0; i < Math.max(zhHeads.length, enHeads.length); i += 1) {
  const a = zhHeads[i];
  const b = enHeads[i];
  if (a === undefined || b === undefined) {
    console.log(`  ✗ 第 ${i + 1} 个标题缺失（中：${a?.text ?? '无'} / 英：${b?.text ?? '无'}）`);
    levelMismatch += 1;
    continue;
  }
  if (a.level !== b.level) {
    levelMismatch += 1;
    console.log(`  ✗ 层级不符：${a.level} ${a.text}  vs  ${b.level} ${b.text}`);
  }
  pairs.push([a, b]);
}
console.log(`  层级不一致：${levelMismatch}`);
console.log('\n  中英标题对照：');
for (const [a, b] of pairs) {
  console.log(`    ${a.level} ${a.text}`);
  console.log(`       → ${b.text}`);
}

console.log('\n=== 3. 图片路径必须原样保留 ===');
const images = (text) => [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
const zhImages = images(zh);
const enImages = images(en);
console.log(`  中文：${JSON.stringify(zhImages)}`);
console.log(`  英文：${JSON.stringify(enImages)}`);
console.log(`  一致：${JSON.stringify(zhImages) === JSON.stringify(enImages) ? '✓' : '✗'}`);

console.log('\n=== 4. 徽章 URL 必须原样保留 ===');
const badges = (text) => [...text.matchAll(/\[!\[[^\]]*\]\(([^)]+)\)\]\(([^)]+)\)/g)].map((m) => ({ img: m[1], link: m[2] }));
const zhBadges = badges(zh);
const enBadges = badges(en);
console.log(`  中文 ${zhBadges.length} 个 / 英文 ${enBadges.length} 个`);
for (let i = 0; i < Math.max(zhBadges.length, enBadges.length); i += 1) {
  const a = zhBadges[i];
  const b = enBadges[i];
  const imgSame = a?.img === b?.img;
  console.log(`  ${imgSame ? '✓' : '✗'} 第 ${i + 1} 个：${b?.link ?? '（缺）'}`);
}

console.log('\n=== 5. 代码围栏数量与语言标签 ===');
const fenceTags = (text) => [...text.matchAll(/^```(\w*)$/gm)].map((m) => m[1] || '(none)');
console.log(`  中文：${JSON.stringify(fenceTags(zh))}`);
console.log(`  英文：${JSON.stringify(fenceTags(en))}`);

console.log('\n=== 6. 残留中文分类（应只有：切换行 / 引号内界面文案 / 数据样例）===');
const chineseLines = [];
en.split('\n').forEach((line, index) => {
  if (/[\u4e00-\u9fa5]/.test(line)) {
    chineseLines.push({ number: index + 1, line: line.trim() });
  }
});
const buckets = { switcher: [], quoted: [], sample: [], other: [] };
for (const item of chineseLines) {
  if (item.line.includes('[中文](README.md)')) {
    buckets.switcher.push(item);
  } else if (/`[^`]*[\u4e00-\u9fa5][^`]*`/.test(item.line)) {
    buckets.quoted.push(item);
  } else if (/^\|/.test(item.line) || /,/.test(item.line)) {
    buckets.sample.push(item);
  } else {
    buckets.other.push(item);
  }
}
console.log(`  含中文的行共 ${chineseLines.length} 行`);
console.log(`    语言切换行      ${buckets.switcher.length}`);
console.log(`    引号内界面文案  ${buckets.quoted.length}`);
console.log(`    表格 / 数据样例 ${buckets.sample.length}`);
console.log(`    其它（需人工看）${buckets.other.length}`);
for (const item of buckets.other.slice(0, 20)) {
  console.log(`      行${item.number}: ${item.line.slice(0, 110)}`);
}

console.log('\n=== 7. 内部锚点必须指向真实存在的标题 ===');
/**
 * 复刻 GitHub / Gitee 的标题 → 锚点规则：
 * 转小写、去标点、空格转连字符。中文标题保留原字（GitHub 对 CJK 就是这么处理的）。
 * @param {string} heading 标题原文（不含 #）
 * @returns {string}
 */
const slugify = (heading) => heading
  .trim()
  .toLowerCase()
  .replace(/[^\w\u4e00-\u9fa5\- ]/g, '')
  .replace(/ /g, '-');

const anchors = (text) => [...text.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
const slugs = (text) => [...text.matchAll(/^#{1,3} (.+)$/gm)].map((m) => slugify(m[1]));

let anchorProblems = 0;
for (const [label, text] of [['README.md', zh], ['README.en.md', en]]) {
  const available = new Set(slugs(text));
  const used = [...new Set(anchors(text))];
  console.log(`  [${label}] 锚点 ${used.length} 个`);
  for (const anchor of used) {
    const ok = available.has(anchor);
    if (!ok) {
      anchorProblems += 1;
    }
    console.log(`    ${ok ? '✓' : '✗ 死链'} #${anchor}`);
  }
}
console.log(`  失效锚点：${anchorProblems}${anchorProblems === 0 ? ' ✓' : ' ✗'}`);

console.log('\n=== 8. 关键数字是否出现在英文版 ===');
const numbers = ['64', '320', '62', '0.5 ms', '150 KB', '10.3 MB', '2.3', '35', '40', '34', '148'];
let numberMismatch = 0;
for (const n of numbers) {
  const inZh = zh.includes(n);
  const inEn = en.includes(n);
  const same = inZh === inEn;
  if (!same) {
    numberMismatch += 1;
  }
  console.log(`  ${n.padEnd(12)} 中文 ${inZh ? '有' : '无'} / 英文 ${inEn ? '有' : '无'}  ${same ? '✓' : '✗ 不匹配'}`);
}
console.log(`  数字不匹配：${numberMismatch}${numberMismatch === 0 ? ' ✓' : ' ✗'}`);

console.log('\n=== 9. 过时数字体检（防回归）===');
// 这些是曾经写错、已实测更正的旧值，出现即视为回退
const STALE = ['约 250 行', '58 个单元测试', '约 147 KB', '1.5–2 倍',
  'about 250 lines', '58 unit tests', '~147 KB', '1.5–2×'];
let staleHits = 0;
for (const pattern of STALE) {
  for (const [label, text] of [['README.md', zh], ['README.en.md', en]]) {
    if (text.includes(pattern)) {
      staleHits += 1;
      console.log(`  ✗ [${label}] 出现过时数字：${pattern}`);
    }
  }
}
console.log(`  过时数字：${staleHits}${staleHits === 0 ? ' ✓' : ' ✗'}`);

console.log('\n=== 结论 ===');
const failures = anchorProblems + numberMismatch + staleHits + levelMismatch;
if (failures === 0) {
  console.log('  ✓ 双语 README 结构与锚点全部一致');
} else {
  console.log(`  ✗ 存在 ${failures} 处问题（见上）`);
  process.exitCode = 1;
}

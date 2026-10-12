/**
 * 润色后事实保全的精确核验（判定上一轮粗正则的两处误报）。
 *
 * 上一版 check-polish-facts.mjs 把「代码块整体文本」当作不可变，
 * 但代码块里混着**散文注释**（目录树的英文说明），那些是可以润色的；
 * 真正不可变的是：
 *   - 目录树的**条目名**（路径）
 *   - 代码块里的**可执行命令**
 *   - ASCII 化学式示例里的化学式与百分数
 *   - 数学公式本身
 *
 * 用法：node test/check-polish-precise.mjs <旧版本> [新版本]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(here);

const oldPath = process.argv[2];
const newPath = process.argv[3] ?? path.join(projectDir, 'README.en.md');
if (oldPath === undefined) {
  console.error('用法：node test/check-polish-precise.mjs <旧版本> [新版本]');
  process.exit(2);
}

/**
 * 统一换行符。
 *
 * 必须归一化：从 git/管道取回的旧版本可能是 CRLF，而工作区文件是 LF。
 * 不归一化的话 `^```$` 这类行首行尾锚点会匹配失败
 * —— 第一次跑就踩了这个坑：旧版被算成「0 个代码块」，于是全部报差异。
 *
 * @param {string} text 原文
 * @returns {string}
 */
const normalize = (text) => text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');

const oldText = normalize(fs.readFileSync(oldPath, 'utf8'));
const newText = normalize(fs.readFileSync(newPath, 'utf8'));

/** 取出所有代码块。 */
const blocks = (text) => [...text.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)]
  .map((m) => ({ lang: m[1], body: m[2] }));

const oldBlocks = blocks(oldText);
const newBlocks = blocks(newText);

let problems = 0;
const compare = (label, a, b) => {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) {
    problems += 1;
  }
  console.log(`  ${same ? '✓' : '✗'} ${label}：旧 ${a.length} 项 / 新 ${b.length} 项`);
  if (!same) {
    const setB = new Set(b);
    const setA = new Set(a);
    for (const x of a) {
      if (!setB.has(x)) {
        console.log(`      仅旧版: ${x}`);
      }
    }
    for (const x of b) {
      if (!setA.has(x)) {
        console.log(`      仅新版: ${x}`);
      }
    }
  }
};

console.log(`旧版本：${path.basename(oldPath)}`);
console.log(`新版本：${path.basename(newPath)}`);
console.log(`代码块数：旧 ${oldBlocks.length} / 新 ${newBlocks.length}`);

// —— 1. 代码块的语言标签序列 ——
console.log('\n=== 1. 代码块语言标签 ===');
compare('语言标签', oldBlocks.map((b) => b.lang), newBlocks.map((b) => b.lang));

// —— 2. 目录树条目名（第一列，忽略同行英文注释）——
const treeEntries = (text) => {
  const block = blocks(text).find((b) => /^hydroponic-calculator\//m.test(b.body));
  if (block === undefined) {
    return [];
  }
  return block.body.split('\n').map((line) => {
    // 条目名 = 树形符号 + 名称（遇到 2 个以上空格视为英文注释起始）
    // 只有 `│` 的续行没有名称，跳过
    const head = line.split(/\s{2,}/)[0].trim();
    const name = head.replace(/^[│├└─\s]+/, '');
    return name;
  }).filter((name) => name !== '');
};
console.log('\n=== 2. 目录树条目名（路径，不含注释）===');
compare('目录树条目', treeEntries(oldText), treeEntries(newText));

// —— 3. 目录树条目数（防增删文件）——
console.log('\n=== 3. 目录树条目总数 ===');
const t1 = treeEntries(oldText).length;
const t2 = treeEntries(newText).length;
console.log(`  ${t1 === t2 ? '✓' : '✗'} 旧 ${t1} / 新 ${t2}`);
if (t1 !== t2) {
  problems += 1;
}

// —— 4. 可执行命令 ——
const commands = (text) => {
  const out = [];
  for (const block of blocks(text)) {
    for (const line of block.body.split('\n')) {
      const cmd = line.split('#')[0].trim();
      if (/^(npm|node|python|python3|pwsh|git|npx|build-windows\.bat)\b/.test(cmd)) {
        out.push(cmd);
      }
    }
  }
  return out.sort();
};
console.log('\n=== 4. 可执行命令 ===');
compare('命令', commands(oldText), commands(newText));

// —— 5. 化学式示例（化学式 + 元素 + 百分数）——
const chemLines = (text) => {
  const out = [];
  for (const block of blocks(text)) {
    for (const line of block.body.split('\n')) {
      if (/[A-Z][a-z]?\d*\(?.*→/.test(line)) {
        // 去掉对齐空格，保留化学式与数值
        out.push(line.replace(/\s+/g, ' ').trim());
      }
    }
  }
  return out.sort();
};
console.log('\n=== 5. ASCII 化学式示例 ===');
compare('化学式行', chemLines(oldText), chemLines(newText));

// —— 6. 数学公式（反引号内、含 = 的表达式）——
const formulas = (text) => [...text.matchAll(/`([^`\n]*=[^`\n]*)`/g)]
  .map((m) => m[1].trim())
  .sort();
console.log('\n=== 6. 反引号内的数学表达式 ===');
compare('公式', formulas(oldText), formulas(newText));

// —— 7. 行内代码里的「命令式」内容（npm run xxx 等）——
const inlineCommands = (text) => [...text.matchAll(/`((?:npm|node|python|pwsh|git|npx)[^`\n]*)`/g)]
  .map((m) => m[1])
  .sort();
console.log('\n=== 7. 行内代码中的命令 ===');
compare('行内命令', inlineCommands(oldText), inlineCommands(newText));

console.log('\n=== 结论 ===');
if (problems === 0) {
  console.log('  ✓ 润色未改动任何不可变内容（路径 / 命令 / 化学式 / 公式）');
} else {
  console.log(`  ✗ 发现 ${problems} 处不可变内容差异，需人工裁决`);
  process.exitCode = 1;
}

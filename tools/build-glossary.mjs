/**
 * 生成 `data/glossary.csv`：术语词典。
 *
 * **为什么是 .mjs**：本文件以前是 Python。术语内容是纯知识数据、不含计算，
 * 迁移的意义是让构建期工具链统一到 Node，不再需要 Python。
 *
 * 设计意图：本工具里出现大量专业词汇（元素形态、浓度单位、肥料形态、农学概念），
 * 只给数字而不解释「这对种植意味着什么」，对使用者没有实际价值。
 * 因此每条术语都包含两栏：**含义**与**对种植的影响**。
 *
 * 术语内容以通识农学 / 植物营养学为准，不确定处不写具体数字。
 *
 * @module tools/build-glossary
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GLOSSARY_COLUMNS } from '../src/core/constants.js';
import { toCSV } from '../src/core/data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(here);
const dataDir = path.join(projectDir, 'data');

/** 知识数据：(分类, 术语, 含义, 对种植的影响)。 */
const entries = JSON.parse(fs.readFileSync(path.join(here, 'sources', 'glossary.json'), 'utf8'));

const rows = entries.map((entry) => ({
  '分类': entry.category,
  '术语': entry.term,
  '含义': entry.meaning,
  '对种植的影响': entry.impact,
}));

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'glossary.csv'), toCSV(GLOSSARY_COLUMNS, rows), 'utf8');

const counts = new Map();
for (const row of rows) {
  counts.set(row['分类'], (counts.get(row['分类']) ?? 0) + 1);
}

console.log(`生成 data/glossary.csv：${rows.length} 条术语`);
for (const [category, count] of counts) {
  console.log(`  ${category}：${count} 条`);
}

// 每条术语都必须同时有「含义」与「对种植的影响」——否则就退化成词典而非工具
const incomplete = rows.filter((row) => !row['含义'] || !row['对种植的影响']);
if (incomplete.length > 0) {
  console.log(`\n✗ 有 ${incomplete.length} 条术语缺少「含义」或「对种植的影响」：`
    + incomplete.map((row) => row['术语']).join('、'));
} else {
  console.log('\n自检：所有术语均含「含义」与「对种植的影响」');
}

export { rows };

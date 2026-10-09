/**
 * 生成 `data/crops.csv`：作物 × 生育期 → 目标元素浓度（mg/L）。
 *
 * **为什么是 .mjs**：与 `build-fertilizers.mjs` 一样，本文件以前是 Python，
 * 现在统一到 Node —— 构建期只需要一种工具链，`core/` 的计算能力直接复用。
 *
 * 数据来源（全部为公开文献，逐行标注在「来源」列；未找到可靠来源的作物一律不编造）：
 *   [A] Hoagland & Arnon (1938/1950) —— 由公开配方的肥料用量反算，已与教科书经典值核对
 *   [B] 日本园试配方（園芸試験場標準処方, 1960）—— 由公开肥料用量反算
 *   [C] 山崎配方（1976）—— 原文 me/L 换算（N14.0 P10.3 K39.1 Ca20.0 Mg12.2 S16.0）
 *   [D] 雅典农业大学（AUA）《ΕΙΔΙΚΗ ΥΔΡΟΠΟΝΙΑ》配方表 7.1–7.12 —— mmol/L / µmol/L 原值换算
 *   [E] SARE(USDA) 养分液课程 —— 生菜 4 配方
 *   [F] IARI（印度农业研究所）水培技术公报 —— 标准液
 *
 * 注意：不同体系（如山崎 vs AUA）的绝对值差异很大，不可混用；同一配方内保持一致。
 *
 * 数值已在 `tools/sources/crops.json` 中**固化为文献值**：
 * 营养目标不应随肥料库的增删而漂移，反算过程只需在来源文献更新时重跑。
 *
 * @module tools/build-crops
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELEMENTS, CROP_COLUMNS } from '../src/core/constants.js';
import { toCSV } from '../src/core/data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(here);
const dataDir = path.join(projectDir, 'data');

const source = JSON.parse(fs.readFileSync(path.join(here, 'sources', 'crops.json'), 'utf8'));

/** 组装为 CSV 行：作物 / 生育期 / 16 元素 / EC / pH / 备注 / 来源。 */
const rows = source.map((record) => {
  /** @type {Record<string, unknown>} */
  const row = {
    '作物': record['作物'],
    '生育期': record['生育期'],
    'EC目标': record['EC目标'] ?? '',
    'pH下限': record['pH下限'] ?? '',
    'pH上限': record['pH上限'] ?? '',
    '备注': record['备注'] ?? '',
    '来源': record['来源'] ?? '',
  };
  ELEMENTS.forEach((element) => {
    row[element] = record[element] ?? 0;
  });
  return row;
});

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'crops.csv'), toCSV(CROP_COLUMNS, rows), 'utf8');

const cropGroups = [...new Set(rows.map((row) => row['作物']))].sort();
console.log(`生成 data/crops.csv：${rows.length} 条`);
console.log(`  作物/配方组 ${cropGroups.length} 个：${cropGroups.join(', ')}`);

// 抽样核对：与经典文献对照，防止数据在迁移中被改坏
const CLASSIC = {
  '通用配方': { stage: 'Hoagland 全浓度', N: 210, P: 31, K: 234, Ca: 200, Mg: 48, S: 64, tol: 3 },
};
console.log('\n=== 抽样核对（对照 Hoagland 经典值 N210 / P31 / K234 / Ca200 / Mg48 / S64）===');
let allOk = true;
for (const row of rows) {
  const expected = CLASSIC[row['作物']];
  if (expected === undefined || row['生育期'] !== expected.stage) {
    continue;
  }
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'stage' || key === 'tol') {
      continue;
    }
    const element = key === 'N' ? 'NO3-N' : key;
    const got = Number(row[element]);
    const ok = Math.abs(got - value) <= expected.tol;
    allOk = allOk && ok;
    console.log(`  ${element.padEnd(6)} 库中 ${got.toFixed(2).padStart(7)}  经典 ${String(value).padStart(5)}  ${ok ? 'OK' : '✗ 偏差'}`);
  }
}
console.log(`\n抽样核对：${allOk ? '通过' : '存在偏差，需检查数据'}`);

export { rows };

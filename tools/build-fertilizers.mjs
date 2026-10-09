/**
 * 生成 `data/fertilizers.csv`：由化学式精确计算每种肥料的元素含量。
 *
 * **为什么是 .mjs 而不是原来的 Python**：本文件以前与 `src/core/chem.js`
 * 各维护一份化学解析、摩尔质量、结晶水与形态提示的实现，同一功能两种说法。
 * 实测已经漂移过：CSV 里写「请在 CSV 中把化学式改为 X 后重新导入」，
 * 而界面实时重算时写「请把化学式改为 X」。现在统一复用 `core/chem.js`，
 * **计算与文案只剩一份**，Python 依赖也随之消失。
 *
 * 数据来源 = 化学式 + IUPAC 原子量（事实性数据，完全独立可复算）。
 * 螯合物等无法按化学式表达者，直接给定元素标称含量（`overrides`）。
 *
 * 知识数据（肥料清单、备注）在 `tools/sources/fertilizers.json`，
 * 由原 Python 脚本一次性导出，避免手工转录出错。
 *
 * @module tools/build-fertilizers
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELEMENTS } from '../src/core/constants.js';
import { calculateComposition, molarMass, parseFormula } from '../src/core/chem.js';
import { toCSV } from '../src/core/data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(here);
const sourcesDir = path.join(here, 'sources');
const dataDir = path.join(projectDir, 'data');

/**
 * 行业通用的标准水培原料组合：智能推荐优先从中选取，
 * 避免选出「用微量元素肥料（如钼酸铵）去补大量元素（铵态氮）」这类会严重超标的组合。
 * @type {Set<string>}
 */
const STANDARD_SET = new Set([
  '硝酸钙(四水)', '硝酸钾', '磷酸二氢钾', '硫酸镁(七水)', '硫酸钾',
  '螯合铁 Fe-EDTA', '硼酸', '硫酸锰(一水)', '硫酸锌(七水)', '硫酸铜(五水)', '钼酸钠(二水)',
]);

/** 氧化物当量换算系数（商品标签惯例）：P → P₂O₅、K → K₂O。 */
const P2O5_FACTOR = 141.944 / 61.948;
const K2O_FACTOR = 94.196 / 78.196;

const sources = JSON.parse(fs.readFileSync(path.join(sourcesDir, 'fertilizers.json'), 'utf8'));

/**
 * 计算一种肥料的全部字段。
 * @param {{ name: string, formula: string, category: string, purity: number,
 *           overrides: Record<string, number> | null, note: string }} source 知识数据
 * @returns {Record<string, unknown>} CSV 行
 */
function buildRow(source) {
  // 螯合物没有化学式，走标称含量分支（chem.js 内部会标注「按标称含量」）
  const formula = source.overrides === null ? source.formula : '-';
  const calculated = calculateComposition(formula, source.purity, source.overrides);
  const displayFormula = source.overrides === null ? source.formula : '(螯合物，按标称含量)';

  /** @type {Record<string, unknown>} */
  const row = {
    '名称': source.name,
    '化学式': displayFormula,
    '类别': source.category,
    '纯度': source.purity,
    '形态': calculated.form,
    '标准': STANDARD_SET.has(source.name) ? 1 : 0,
    '备注': source.note,
    '形态提示': calculated.formHint,
  };

  ELEMENTS.forEach((element, index) => {
    row[element] = calculated.composition[index];
  });

  // 商品标签常用的氧化物当量，便于对照标识
  if (calculated.composition[ELEMENTS.indexOf('P')] > 0) {
    row['P2O5当量'] = Number((calculated.composition[ELEMENTS.indexOf('P')] * P2O5_FACTOR).toFixed(3));
  }
  if (calculated.composition[ELEMENTS.indexOf('K')] > 0) {
    row['K2O当量'] = Number((calculated.composition[ELEMENTS.indexOf('K')] * K2O_FACTOR).toFixed(3));
  }

  return row;
}

/** 与教科书 / 肥料标签公认值对照，防止解析器改动后静默算错。 */
const KNOWN_VALUES = {
  '硝酸钾': { K: 38.67, 'NO3-N': 13.85 },
  '磷酸二氢钾': { P: 22.76, K: 28.73 },
  '硝酸钙(四水)': { Ca: 16.97, 'NO3-N': 11.86 },
  '硫酸镁(七水)': { Mg: 9.86, S: 13.01 },
  '硫酸钾': { K: 44.87, S: 18.4 },
  '硼酸': { B: 17.48 },
};

const rows = sources.map(buildRow);

const FERTILIZER_COLUMNS = ['名称', '化学式', '类别', '纯度', '形态', '标准',
  ...ELEMENTS, 'P2O5当量', 'K2O当量', '备注', '形态提示'];

fs.mkdirSync(dataDir, { recursive: true });
const outputPath = path.join(dataDir, 'fertilizers.csv');
fs.writeFileSync(outputPath, toCSV(FERTILIZER_COLUMNS, rows), 'utf8');

console.log(`生成 data/fertilizers.csv：${rows.length} 种肥料`);

// —— 自检：与公认值对照 ——
console.log('\n=== 自检（与公认值对照）===');
let allOk = true;
for (const row of rows) {
  const expected = KNOWN_VALUES[row['名称']];
  if (expected === undefined) {
    continue;
  }
  for (const [element, value] of Object.entries(expected)) {
    const got = Number(row[element]);
    const ok = Math.abs(got - value) < 0.05;
    allOk = allOk && ok;
    console.log(`  ${String(row['名称']).padEnd(14)} ${element.padEnd(6)} `
      + `计算 ${got.toFixed(3).padStart(7)}%  公认 ${value.toFixed(2).padStart(7)}%  `
      + `${ok ? 'OK' : '✗ 偏差'}`);
  }
}
console.log(`\n自检结果：${allOk ? '全部通过' : '存在偏差，需检查解析器'}`);

// 顺带报告结晶水分布，便于人工复核形态数据
const hydrateCount = rows.filter((row) => row['形态'] !== '无水' && !String(row['形态']).includes('螯合')).length;
console.log(`结晶水形态：${hydrateCount} / ${rows.length} 种`);

export { rows, buildRow, parseFormula, molarMass };

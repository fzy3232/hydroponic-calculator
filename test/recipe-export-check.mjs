/**
 * 真实配方的端到端导出验证。
 *
 * 链路：真实 CSV → autoPick → compute → recipeSheets → buildXlsx → .xlsx
 * 然后由 Python 的 openpyxl 读回（见 verify-recipe.py），
 * 确认导出的数字与计算基线一致、且 Excel 能正常打开。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELEMENTS } from '../src/core/constants.js';
import { parseCSV, fertilizersFromRows, cropsFromRows } from '../src/core/data.js';
import { compute, autoPick } from '../src/core/calculator.js';
import { buildXlsx } from '../src/core/xlsx.js';
import { recipeSheets } from '../src/ui/sheets.js';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(projectDir, 'data');
const outputPath = path.join(projectDir, 'test', 'recipe-export.xlsx');

const readCsv = (name) => parseCSV(fs.readFileSync(path.join(dataDir, name), 'utf8')).records;
const fertilizers = fertilizersFromRows(readCsv('fertilizers.csv'));
const crops = cropsFromRows(readCsv('crops.csv'));

const crop = crops.find((item) => item.crop === '番茄' && item.stage.includes('盛果'));
if (crop === undefined) {
  throw new Error('未找到番茄盛果期数据');
}

const water = new Array(ELEMENTS.length).fill(0);
const picked = autoPick({ targets: crop.target, water, fertilizers, volume: 100 });
const result = compute({
  targets: crop.target,
  water,
  fertilizers,
  selected: picked.selected,
  volume: 100,
  concentrate: 1,
});

const sheets = recipeSheets(result, crop.target, water, {
  crop: crop.crop,
  stage: crop.stage,
  generatedAt: '2026-01-01 12:00:00',
});

fs.writeFileSync(outputPath, buildXlsx(sheets));

const total = result.usage
  .filter((item) => item.grams >= 0.005)
  .reduce((sum, item) => sum + item.grams, 0);

console.log(`已导出：${outputPath}`);
console.log(`  配方：${crop.crop} / ${crop.stage}`);
console.log(`  工作表：${sheets.map((sheet) => sheet.name).join('、')}`);
console.log(`  原料合计：${total.toFixed(3)} g（配制 100 L）`);
console.log(`  预期原料用量表首行数据：${sheets[1].rows[1][0].v} / ${sheets[1].rows[1][2].v} g`);

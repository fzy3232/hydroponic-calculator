/**
 * 把计算结果转成 xlsx 的工作表结构（**纯函数**，不接触 DOM 与文件系统）。
 *
 * 四张表对应界面上的信息：
 *   0. 配方信息 —— 哪套配方、多大体积、什么时候算的
 *   1. 原料用量 —— 每种肥料称多少克
 *   2. 目标达成 —— 每个元素的达成值与偏差
 *   3. 形态核对 —— 结晶水形态对元素含量的影响
 *
 * 一个刻意的设计：**数字一律以 number 写入**（不是字符串），
 * 这样在 Excel 里可以直接继续求和、换算、画图——
 * 用字符串导出的话 Excel 会当作文本，用户还得手动转一次。
 *
 * @module ui/sheets
 */

import { ELEMENTS, NEGLIGIBLE_GRAMS } from '../core/constants.js';
import { estimateColumnWidths } from '../core/xlsx.js';
import { toUnicodeSubscript } from './html.js';

/** 元素字段名 → 展示名（与界面保持一致）。 */
const ELEMENT_LABELS = Object.freeze({ 'NO3-N': '硝态氮', 'NH4-N': '铵态氮' });
const displayName = (element) => ELEMENT_LABELS[element] ?? element;

/**
 * 表头单元格（加粗）。
 * @param {string} text 文案
 * @returns {{ v: string, bold: boolean }}
 */
const head = (text) => ({ v: text, bold: true });

/**
 * 数值单元格；非有限值留空。
 * @param {number} value 数值
 * @param {number} [digits] 需要舍入时的小数位
 * @returns {{ v: number }}
 */
function num(value, digits) {
  const rounded = digits === undefined ? value : Number(value.toFixed(digits));
  return { v: Number.isFinite(rounded) ? rounded : 0 };
}

/**
 * 生成配方工作簿的全部工作表。
 *
 * @param {import('../core/calculator.js').ComputeResult} result 计算结果
 * @param {number[]} targets 目标浓度
 * @param {number[]} water 水源本底
 * @param {{ crop?: string, stage?: string, generatedAt?: string }} [meta] 配方元信息
 * @returns {Array<{ name: string, rows: Array<Array<object>>, widths: number[] }>}
 */
export function recipeSheets(result, targets, water, meta = {}) {
  const sheets = [];

  // —— 0. 配方信息 ——
  const volumeText = `${result.volume} L`;
  const concentrateText = result.concentrate > 1
    ? `${result.concentrate} 倍（母液体积 ${Number((result.volume / result.concentrate).toFixed(3))} L）`
    : '直接配制';

  sheets.push({
    name: '配方信息',
    rows: [
      [head('项目'), head('内容')],
      [{ v: '作物' }, { v: meta.crop ?? '—' }],
      [{ v: '生育期' }, { v: meta.stage ?? '—' }],
      [{ v: '配制体积' }, { v: volumeText }],
      [{ v: '母液浓缩倍数' }, { v: concentrateText }],
      [{ v: '生成时间' }, { v: meta.generatedAt ?? new Date().toLocaleString('zh-CN') }],
      [{ v: '说明' }, { v: '偏差列为按库中成分计算的理论偏差，不代表现场投加精度（结晶水、纯度、称量都会带来实际差异）' }],
    ],
  });

  // —— 1. 原料用量 ——
  const usageRows = [[
    head('原料'), head('化学式'), head('用量（g）'), head('g/L 工作液'), head('主要贡献'),
  ]];
  let totalGrams = 0;

  const usable = result.usage
    .filter((item) => item.grams >= NEGLIGIBLE_GRAMS)
    .sort((left, right) => right.grams - left.grams);

  for (const item of usable) {
    totalGrams += item.grams;
    const contribution = ELEMENTS
      .map((element, index) => {
        const content = item.fertilizer.comp[index] ?? 0;
        const grams = item.grams * content / 100;
        return grams >= NEGLIGIBLE_GRAMS
          ? `${displayName(element)} ${Number(grams.toFixed(3))}g`
          : '';
      })
      .filter((text) => text !== '')
      .slice(0, 6)
      .join('，');

    usageRows.push([
      { v: item.fertilizer.name },
      { v: toUnicodeSubscript(item.fertilizer.formula ?? '') },
      num(item.grams, 3),
      num(item.grams / result.volume, 4),
      { v: contribution === '' ? '—' : contribution },
    ]);
  }

  usageRows.push([
    head('合计'),
    { v: '' },
    { v: Number(totalGrams.toFixed(3)), bold: true },
    { v: Number((totalGrams / result.volume).toFixed(4)), bold: true },
    { v: '' },
  ]);
  sheets.push({ name: '原料用量', rows: usageRows });

  // —— 2. 目标达成 ——
  const hasWater = water.some((value) => value > 1e-9);
  const achieveHead = [head('元素'), head('目标（mg/L）')];
  if (hasWater) {
    achieveHead.push(head('水源本底'));
  }
  achieveHead.push(head('实际达成'), head('偏差'));

  const achieveRows = [achieveHead];
  ELEMENTS.forEach((element, index) => {
    const target = targets[index];
    const actual = result.actual[index];
    if (target <= 0 && actual <= 1e-6) {
      return;
    }

    const row = [{ v: element }, num(target, 3)];
    if (hasWater) {
      row.push(num(water[index], 3));
    }
    row.push(num(actual, 3));

    if (target > 0) {
      const deviation = (actual - target) / target * 100;
      // 与界面一致：微小负偏差归零，避免出现 -0.0%
      const rounded = Math.abs(deviation) < 0.05 ? 0 : Number(deviation.toFixed(2));
      row.push({ v: rounded / 100 });   // 以真正的小数写入，并设置百分比格式
    } else {
      row.push({ v: '—' });
    }
    achieveRows.push(row);
  });
  sheets.push({ name: '目标达成', rows: achieveRows });

  // —— 3. 形态核对 ——
  const hydrated = result.usage.filter(
    (item) => item.fertilizer.form && item.fertilizer.form !== '无水',
  );
  if (hydrated.length > 0) {
    const formRows = [[
      head('原料'), head('化学式'), head('形态'), head('当前元素含量'), head('若为无水形态的换算提示'),
    ]];
    for (const item of hydrated) {
      const fertilizer = item.fertilizer;
      const mainElements = ELEMENTS
        .map((element, index) => {
          const value = fertilizer.comp[index] ?? 0;
          return value >= 0.5 ? `${displayName(element)} ${Number(value.toFixed(2))}%` : '';
        })
        .filter((text) => text !== '')
        .slice(0, 5)
        .join('，');

      formRows.push([
        { v: fertilizer.name },
        { v: toUnicodeSubscript(fertilizer.formula ?? '') },
        { v: fertilizer.form },
        { v: mainElements === '' ? '—' : mainElements },
        { v: fertilizer.formHint ?? '' },
      ]);
    }
    sheets.push({ name: '形态核对', rows: formRows });
  }

  // 第三张表不存在时也补一条提示，避免用户以为导出漏了内容
  if (!sheets.some((sheet) => sheet.name === '形态核对')) {
    sheets.push({
      name: '形态核对',
      rows: [
        [head('说明')],
        [{ v: '本次配方中没有使用水合形态的原料，无需核对结晶水。' }],
      ],
    });
  }

  return sheets.map((sheet) => ({
    ...sheet,
    widths: estimateColumnWidths(sheet.rows),
  }));
}

/**
 * 共享常量：营养指标、元素分组与 CSV 列契约。
 * @module core/constants
 */

/** 16 个营养指标，顺序与肥料成分表、作物目标表的列一一对应。 */
export const ELEMENTS = Object.freeze([
  'NO3-N', 'NH4-N', 'P', 'K', 'Ca', 'Mg', 'S',
  'Fe', 'Mn', 'Zn', 'Cu', 'B', 'Mo', 'Si', 'Na', 'Cl',
]);

/** 大量元素：只能由「大量」类原料提供。 */
export const MACRO_ELEMENTS = Object.freeze([
  'NO3-N', 'NH4-N', 'P', 'K', 'Ca', 'Mg', 'S',
]);

/** 微量元素：只能由「微量」类原料提供。 */
export const MICRO_ELEMENTS = Object.freeze([
  'Fe', 'Mn', 'Zn', 'Cu', 'B', 'Mo',
]);

/** 营养指标数量。 */
export const ELEMENT_COUNT = ELEMENTS.length;

/** 肥料 CSV 的列契约。元素含量单位为「每 100 g 商品含该元素克数」。 */
export const FERTILIZER_COLUMNS = Object.freeze([
  '名称', '化学式', '类别', '纯度', '形态', '标准',
  ...ELEMENTS,
  '备注', '形态提示',
]);

/** 作物 CSV 的列契约。元素含量单位为 mg/L（ppm）。 */
export const CROP_COLUMNS = Object.freeze([
  '作物', '生育期',
  ...ELEMENTS,
  'EC目标', 'pH下限', 'pH上限', '备注', '来源',
]);

/** 术语词典 CSV 的列契约。每条术语都包含「含义」与「对种植的影响」两栏。 */
export const GLOSSARY_COLUMNS = Object.freeze(['分类', '术语', '含义', '对种植的影响']);

/**
 * 用量阈值（g）：低于此值的用量家庭无法称量，显示为 `0` 并视为未使用。
 * 显示层与过滤层必须共用这一个值，否则会出现「显示 0 却占一行」的噪声行。
 */
export const NEGLIGIBLE_GRAMS = 0.005;

/** 剂量相关配色阈值（用于结果表高亮）。 */
export const DEVIATION_THRESHOLD = Object.freeze({ warn: 3, bad: 10 });

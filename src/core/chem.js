/**
 * 化学式引擎：由化学式精确计算肥料的元素质量分数。
 * 与构建脚本 build_fertilizers.py 使用同一套算法与原子量，两者结果已逐项核对一致。
 *
 * 能力：
 *  - 解析化学式（含括号倍数、`·`/`.` 连接的结晶水）
 *  - 输出 16 个营养指标的质量分数（%）
 *  - 由化学式自动拆分硝态氮 / 铵态氮
 *  - 识别结晶水形态，并推算「若为无水形态」的含量变化
 *
 * @module core/chem
 */

import { ELEMENTS } from './constants.js';
import { matchAll, toNumber } from './utils.js';

/** IUPAC 常用原子量（g/mol）。 */
export const ATOMIC_MASS = Object.freeze({
  H: 1.008, B: 10.81, C: 12.011, N: 14.007, O: 15.999, Na: 22.990, Mg: 24.305,
  Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, K: 39.098, Ca: 40.078,
  Mn: 54.938, Fe: 55.845, Cu: 63.546, Zn: 65.38, Mo: 95.95,
});

/** 结晶水个数 → 中文形态名。 */
const HYDRATE_NAMES = new Map([
  [0, '无水'], [1, '一水合物'], [2, '二水合物'], [3, '三水合物'], [4, '四水合物'],
  [5, '五水合物'], [6, '六水合物'], [7, '七水合物'], [8, '八水合物'],
  [9, '九水合物'], [10, '十水合物'], [12, '十二水合物'],
]);

/** 元素符号 → ELEMENTS 中的字段名（氮由 splitNitrogen 单独处理）。 */
const SYMBOL_TO_FIELD = new Map([
  ['P', 'P'], ['K', 'K'], ['Ca', 'Ca'], ['Mg', 'Mg'], ['S', 'S'],
  ['Fe', 'Fe'], ['Mn', 'Mn'], ['Zn', 'Zn'], ['Cu', 'Cu'], ['B', 'B'],
  ['Mo', 'Mo'], ['Si', 'Si'], ['Na', 'Na'], ['Cl', 'Cl'],
]);

/** 形态提示中需要展示对比的字段（字段名, 元素符号）。 */
const HINT_FIELDS = Object.freeze([
  ['NO3-N', 'N'], ['NH4-N', 'N'], ['P', 'P'], ['K', 'K'], ['Ca', 'Ca'], ['Mg', 'Mg'],
  ['S', 'S'], ['Fe', 'Fe'], ['Zn', 'Zn'], ['Cu', 'Cu'], ['Mn', 'Mn'], ['B', 'B'],
  ['Mo', 'Mo'], ['Si', 'Si'], ['Na', 'Na'], ['Cl', 'Cl'],
]);

/** 结晶水分隔符。 */
const HYDRATE_SEPARATOR = /[·.*]/;

/**
 * 读取起始于 index 的数字（缺省为 1）。
 * @param {string} text 文本
 * @param {number} index 起始下标
 * @returns {{ value: number, nextIndex: number }}
 */
function readNumber(text, index) {
  let cursor = index;
  while (cursor < text.length) {
    const char = text[cursor];
    const isDigit = char >= '0' && char <= '9';
    if (!isDigit && char !== '.') {
      break;
    }
    cursor += 1;
  }
  if (cursor === index) {
    return { value: 1, nextIndex: index };
  }
  return { value: Number.parseFloat(text.slice(index, cursor)), nextIndex: cursor };
}

/**
 * 递归解析一个基团（可含括号），返回各元素原子个数。
 * @param {string} text 化学式片段
 * @param {number} start 起始下标
 * @returns {{ counts: Record<string, number>, nextIndex: number }}
 */
function parseGroup(text, start) {
  const counts = {};
  let index = start;

  while (index < text.length) {
    const char = text[index];

    if (char === '(') {
      const inner = parseGroup(text, index + 1);
      const multiplier = readNumber(text, inner.nextIndex);
      for (const [symbol, amount] of Object.entries(inner.counts)) {
        counts[symbol] = (counts[symbol] ?? 0) + amount * multiplier.value;
      }
      index = multiplier.nextIndex;
      continue;
    }

    if (char === ')') {
      return { counts, nextIndex: index + 1 };
    }

    const isUppercase = char >= 'A' && char <= 'Z';
    if (!isUppercase) {
      index += 1;
      continue;
    }

    let symbol = char;
    index += 1;
    while (index < text.length && text[index] >= 'a' && text[index] <= 'z') {
      symbol += text[index];
      index += 1;
    }
    const amount = readNumber(text, index);
    counts[symbol] = (counts[symbol] ?? 0) + amount.value;
    index = amount.nextIndex;
  }

  return { counts, nextIndex: index };
}

/**
 * 解析完整化学式（含结晶水），返回元素 → 原子个数。
 * 例如 `Ca(NO3)2·4H2O` → `{ Ca: 1, N: 2, O: 10, H: 8 }`
 * @param {string} formula 化学式
 * @returns {Record<string, number>}
 */
export function parseFormula(formula) {
  const totals = {};
  const parts = String(formula ?? '').split(HYDRATE_SEPARATOR);

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (part === '') {
      continue;
    }
    let multiplier = 1;
    let body = part;
    const leading = /^(\d+(?:\.\d+)?)(.*)$/.exec(part);
    if (leading !== null) {
      multiplier = Number.parseFloat(leading[1]);
      body = leading[2];
    }
    const { counts } = parseGroup(body, 0);
    for (const [symbol, amount] of Object.entries(counts)) {
      totals[symbol] = (totals[symbol] ?? 0) + amount * multiplier;
    }
  }

  return totals;
}

/**
 * 由原子个数计算摩尔质量。
 * @param {Record<string, number>} counts 元素 → 原子个数
 * @returns {number} g/mol；含未知元素时为 0
 */
export function molarMass(counts) {
  let total = 0;
  for (const [symbol, amount] of Object.entries(counts)) {
    const mass = ATOMIC_MASS[symbol];
    if (mass === undefined) {
      return 0;
    }
    total += mass * amount;
  }
  return total;
}

/**
 * 结晶水个数；0 表示无水。
 * @param {string} formula 化学式
 * @returns {number}
 */
export function hydrateCount(formula) {
  const text = String(formula ?? '');
  if (text === '' || text === '-') {
    return 0;
  }
  const matched = /[·.*](\d*)\s*H2O\b/.exec(text);
  if (matched === null) {
    return 0;
  }
  return matched[1] === '' ? 1 : Number.parseInt(matched[1], 10);
}

/**
 * 去掉结晶水后的化学式；本身无水时返回 null。
 * @param {string} formula 化学式
 * @returns {string | null}
 */
export function anhydrousFormula(formula) {
  const text = String(formula ?? '');
  if (text === '' || text === '-' || !HYDRATE_SEPARATOR.test(text)) {
    return null;
  }
  return text.split(HYDRATE_SEPARATOR)[0];
}

/**
 * 统计化学式中某基团（如 `NO3`、`NH4`）出现的次数，支持 `(NH4)2` 与 `NH4NO3` 两种写法。
 * @param {string} formula 化学式（应已去掉结晶水）
 * @param {string} group 基团名
 * @returns {number}
 */
export function countGroup(formula, group) {
  let total = 0;

  const parenthesized = new RegExp(`\\(\\s*${group}\\s*\\)(\\d*)`, 'g');
  for (const matched of matchAll(parenthesized, formula)) {
    total += matched[1] === '' ? 1 : Number.parseInt(matched[1], 10);
  }

  const withoutParentheses = formula.replace(new RegExp(`\\(\\s*${group}\\s*\\)`, 'g'), '');
  const plain = new RegExp(`${group}(\\d*)`, 'g');
  for (const matched of matchAll(plain, withoutParentheses)) {
    total += matched[1] === '' ? 1 : Number.parseInt(matched[1], 10);
  }

  return total;
}

/**
 * 由化学式自动拆分硝态氮 / 铵态氮。
 * @param {string} formula 化学式
 * @returns {{ nitrate: number, ammonium: number }} 两者之和为 1
 */
export function splitNitrogen(formula) {
  const main = String(formula ?? '').split(HYDRATE_SEPARATOR)[0];
  const nitrate = countGroup(main, 'NO3');
  const ammonium = countGroup(main, 'NH4');
  const total = nitrate + ammonium;
  if (total === 0) {
    return { nitrate: 1, ammonium: 0 };
  }
  return { nitrate: nitrate / total, ammonium: ammonium / total };
}

/**
 * 生成「若买成无水形态，含量会如何变化」的提示文本。
 * @param {string} formula 化学式
 * @param {number[]} composition 当前成分（%），顺序同 ELEMENTS
 * @param {number} purity 纯度
 * @returns {string} 无需提示时返回空串
 */
function buildFormHint(formula, composition, purity) {
  if (formula === '-') {
    return '';
  }
  const anhydrous = anhydrousFormula(formula);
  if (anhydrous === null) {
    return '';
  }
  const counts = parseFormula(anhydrous);
  const mass = molarMass(counts);
  if (mass === 0) {
    return '';
  }

  const changes = [];
  for (const [field, symbol] of HINT_FIELDS) {
    const current = composition[ELEMENTS.indexOf(field)] ?? 0;
    const atomCount = counts[symbol] ?? 0;
    const anhydrousValue = ((ATOMIC_MASS[symbol] ?? 0) * atomCount) / mass * 100 * purity;
    if (current >= 1 && anhydrousValue > current + 0.01) {
      changes.push(
        `${field} ${current.toFixed(3)}%→${anhydrousValue.toFixed(3)}%（${(anhydrousValue / current).toFixed(2)}×）`,
      );
    }
  }

  if (changes.length === 0) {
    return '';
  }
  return `若买到的是无水产品，各元素含量会变成：${changes.join('；')}。请把化学式改为 ${anhydrous}。`;
}

/**
 * 由化学式计算肥料成分。
 * @param {string} formula 化学式；`'-'` 表示螯合物（配合物，含量来自厂商标称值）
 * @param {number|string} [purity=1] 纯度（0–1）
 * @param {Record<string, number>|null} [overrides=null] 标称含量覆盖，如 `{ Fe: 13 }`
 * @returns {{ composition: number[], form: string, formHint: string, molarMass: number|null }}
 *          `composition` 顺序同 ELEMENTS，单位为质量分数（%）
 */
export function calculateComposition(formula, purity = 1, overrides = null) {
  const purityValue = toNumber(purity, 1);
  const empty = new Array(ELEMENTS.length).fill(0);

  if (overrides !== null && overrides !== undefined) {
    const composition = [...empty];
    for (const [field, value] of Object.entries(overrides)) {
      const index = ELEMENTS.indexOf(field);
      if (index >= 0) {
        composition[index] = toNumber(value, 0);
      }
    }
    return { composition, form: '螯合物（按标称含量）', formHint: '', molarMass: null };
  }

  const counts = parseFormula(formula);
  const mass = molarMass(counts);
  if (mass === 0) {
    return { composition: empty, form: '', formHint: '', molarMass: null };
  }

  const composition = [...empty];
  const nitrogenTotal = (ATOMIC_MASS.N * (counts.N ?? 0)) / mass * 100;
  const ratio = splitNitrogen(formula);
  composition[ELEMENTS.indexOf('NO3-N')] = nitrogenTotal * ratio.nitrate;
  composition[ELEMENTS.indexOf('NH4-N')] = nitrogenTotal * ratio.ammonium;

  for (const [symbol, field] of SYMBOL_TO_FIELD) {
    const atoms = counts[symbol] ?? 0;
    composition[ELEMENTS.indexOf(field)] = (ATOMIC_MASS[symbol] * atoms) / mass * 100;
  }

  for (let i = 0; i < composition.length; i += 1) {
    composition[i] = Number((composition[i] * purityValue).toFixed(4));
  }

  const hydrate = hydrateCount(formula);
  const form = HYDRATE_NAMES.get(hydrate) ?? `${hydrate}水合物`;

  return {
    composition,
    form,
    formHint: buildFormHint(formula, composition, purityValue),
    molarMass: Number(mass.toFixed(3)),
  };
}

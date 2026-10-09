/**
 * 数据模型：CSV 编解码与数据结构规范化。
 * @module core/data
 */

import { ELEMENTS, FERTILIZER_COLUMNS, CROP_COLUMNS, GLOSSARY_COLUMNS } from './constants.js';
import { toNumber } from './utils.js';
import { calculateComposition } from './chem.js';

/**
 * 解析 CSV 文本。支持 UTF-8 BOM、双引号转义与 CRLF 换行。
 * @param {string} text CSV 文本
 * @returns {{ header: string[], records: Array<Record<string, string>> }}
 */
export function parseCSV(text) {
  const source = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (insideQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          insideQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (rows.length === 0) {
    return { header: [], records: [] };
  }

  const header = rows[0].map((name) => name.trim());
  const records = rows
    .slice(1)
    .filter((values) => values.some((value) => String(value).trim() !== ''))
    .map((values) => {
      /** @type {Record<string, string>} */
      const record = {};
      header.forEach((name, index) => {
        record[name] = values[index] === undefined ? '' : String(values[index]).trim();
      });
      return record;
    });

  return { header, records };
}

/**
 * 把对象数组序列化为 CSV 文本。带 UTF-8 BOM，便于 Excel 正确识别中文。
 * @param {readonly string[]} header 列顺序
 * @param {Array<Record<string, unknown>>} rows 数据行
 * @returns {string}
 */
export function toCSV(header, rows) {
  /** @param {unknown} value */
  const escapeCell = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(header.map((name) => escapeCell(row[name])).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * 补齐肥料对象：`comp` 规范为定长数组，缺失形态字段时按化学式补算。
 * @param {Array<Record<string, any>>} list 肥料列表
 * @returns {Array<Record<string, any>>}
 */
export function normalizeFertilizers(list) {
  for (const fertilizer of list ?? []) {
    if (!Array.isArray(fertilizer.comp)) {
      fertilizer.comp = new Array(ELEMENTS.length).fill(0);
    }
    while (fertilizer.comp.length < ELEMENTS.length) {
      fertilizer.comp.push(0);
    }
    if (!fertilizer.form) {
      const rawFormula = fertilizer.formula === '(螯合物，按标称含量)' ? '-' : (fertilizer.formula ?? '');
      const calculated = calculateComposition(rawFormula, fertilizer.purity, fertilizer.overrides ?? null);
      fertilizer.form = calculated.form;
      fertilizer.formHint = calculated.formHint;
    }
  }
  return list ?? [];
}

/**
 * 补齐作物对象：`target` 规范为定长数组。
 * @param {Array<Record<string, any>>} list 作物列表
 * @returns {Array<Record<string, any>>}
 */
export function normalizeCrops(list) {
  for (const crop of list ?? []) {
    if (!Array.isArray(crop.target)) {
      crop.target = new Array(ELEMENTS.length).fill(0);
    }
    while (crop.target.length < ELEMENTS.length) {
      crop.target.push(0);
    }
  }
  return list ?? [];
}

/**
 * CSV 记录 → 肥料对象。
 * @param {Array<Record<string, string>>} records
 * @returns {Array<Record<string, any>>}
 */
export function fertilizersFromRows(records) {
  const parsed = (records ?? []).map((record) => ({
    name: record['名称'] ?? record.name ?? '未命名',
    formula: record['化学式'] ?? '',
    category: record['类别'] ?? '大量',
    purity: toNumber(record['纯度'], 1),
    std: toNumber(record['标准'], 0) > 0,
    comp: ELEMENTS.map((element) => toNumber(record[element], 0)),
    note: record['备注'] ?? '',
    form: record['形态'] ?? '',
    formHint: record['形态提示'] ?? '',
  }));
  return parsed.filter((fertilizer) => fertilizer.comp.some((value) => value > 0));
}

/**
 * CSV 记录 → 作物对象。
 * @param {Array<Record<string, string>>} records
 * @returns {Array<Record<string, any>>}
 */
export function cropsFromRows(records) {
  const parsed = (records ?? []).map((record) => ({
    crop: record['作物'] ?? '',
    stage: record['生育期'] ?? '全期',
    target: ELEMENTS.map((element) => toNumber(record[element], 0)),
    ec: record['EC目标'] ?? '',
    phMin: record['pH下限'] ?? '',
    phMax: record['pH上限'] ?? '',
    note: record['备注'] ?? '',
    source: record['来源'] ?? '',
  }));
  return parsed.filter((crop) => crop.crop !== '');
}

/**
 * 肥料对象 → CSV 行。
 * @param {Array<Record<string, any>>} fertilizers
 * @returns {Array<Record<string, unknown>>}
 */
export function fertilizersToRows(fertilizers) {
  return (fertilizers ?? []).map((fertilizer) => {
    /** @type {Record<string, unknown>} */
    const row = {
      '名称': fertilizer.name,
      '化学式': fertilizer.formula,
      '类别': fertilizer.category,
      '纯度': fertilizer.purity,
      '形态': fertilizer.form ?? '',
      '标准': fertilizer.std ? 1 : 0,
      '备注': fertilizer.note ?? '',
      '形态提示': fertilizer.formHint ?? '',
    };
    ELEMENTS.forEach((element, index) => {
      row[element] = fertilizer.comp[index];
    });
    return row;
  });
}

/**
 * 作物对象 → CSV 行。
 * @param {Array<Record<string, any>>} crops
 * @returns {Array<Record<string, unknown>>}
 */
export function cropsToRows(crops) {
  return (crops ?? []).map((crop) => {
    /** @type {Record<string, unknown>} */
    const row = {
      '作物': crop.crop,
      '生育期': crop.stage,
      'EC目标': crop.ec ?? '',
      'pH下限': crop.phMin ?? '',
      'pH上限': crop.phMax ?? '',
      '备注': crop.note ?? '',
      '来源': crop.source ?? '',
    };
    ELEMENTS.forEach((element, index) => {
      row[element] = crop.target[index];
    });
    return row;
  });
}

/**
 * CSV 记录 → 术语条目。
 * @param {Array<Record<string, string>>} records
 * @returns {Array<{ category: string, term: string, meaning: string, impact: string }>}
 */
export function glossaryFromRows(records) {
  return (records ?? [])
    .map((record) => ({
      category: record['分类'] ?? '其他',
      term: record['术语'] ?? '',
      meaning: record['含义'] ?? '',
      impact: record['对种植的影响'] ?? '',
    }))
    .filter((entry) => entry.term !== '');
}

/**
 * 术语对象 → CSV 行。
 * @param {Array<{ category: string, term: string, meaning: string, impact: string }>} glossary
 * @returns {Array<Record<string, unknown>>}
 */
export function glossaryToRows(glossary) {
  return (glossary ?? []).map((entry) => ({
    '分类': entry.category,
    '术语': entry.term,
    '含义': entry.meaning,
    '对种植的影响': entry.impact,
  }));
}

export { FERTILIZER_COLUMNS, CROP_COLUMNS, GLOSSARY_COLUMNS };

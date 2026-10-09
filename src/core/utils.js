/**
 * 通用工具：数值解析与文本格式化。
 * 设计原则：所有数值转换都显式声明「无法解析时怎么办」，不使用 `||` 兜底
 * （`0 || 1` 会得到 1，这是常见的隐式陷阱）。
 * @module core/utils
 */

/**
 * 解析为有限数字；无法解析时返回兜底值。`0` 是合法结果，不会被兜底。
 * @param {unknown} value 任意输入
 * @param {number} [fallback=0] 无法解析时的返回值
 * @returns {number}
 */
export function toNumber(value, fallback = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 解析为正数；非有限或 ≤ 0 时返回兜底值。
 * 用于「体积」「浓缩倍数」这类必须为正的参数。
 * @param {unknown} value 任意输入
 * @param {number} fallback 兜底值（应为正数）
 * @returns {number}
 */
export function positiveNumber(value, fallback) {
  const parsed = toNumber(value, Number.NaN);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

/**
 * 仅当值既不是 null 也不是 undefined 时使用它，否则用兜底值。
 * 与 `??` 同义，但命名更直白；注意它**不会**把 `0` 或空串当缺失。
 * @template T
 * @param {T | null | undefined} value
 * @param {T} fallback
 * @returns {T}
 */
export function withDefault(value, fallback) {
  return value ?? fallback;
}

/**
 * HTML 转义，用于把数据安全地插入模板字符串。
 * @param {unknown} text 任意文本
 * @returns {string}
 */
export function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(text ?? '').replace(/[&<>"]/g, (char) => map[char]);
}

/**
 * 按有效数字格式化，去掉无意义的尾随零。
 * @param {unknown} value 数值
 * @param {number} [digits=4] 最多保留的小数位
 * @returns {string} 无法解析时返回空串
 */
export function formatNumber(value, digits = 4) {
  const parsed = toNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) {
    return '';
  }
  if (Math.abs(parsed) < 1e-9) {
    return '0';
  }
  return String(Number(parsed.toFixed(digits)));
}

/**
 * 按量级选择小数位，用于用量/浓度这类跨度大的数值。
 * @param {unknown} value 数值
 * @returns {string}
 */
export function formatQuantity(value) {
  const parsed = toNumber(value, Number.NaN);
  if (!Number.isFinite(parsed) || Math.abs(parsed) < 0.005) {
    return '0';
  }
  const abs = Math.abs(parsed);
  if (abs >= 100) {
    return parsed.toFixed(1);
  }
  if (abs >= 1) {
    return parsed.toFixed(2);
  }
  return parsed.toFixed(3);
}

/**
 * 固定小数位格式化，用于表格中需要**末位对齐**的数值列。
 *
 * 与 `formatQuantity` 的区别：后者按量级切换精度（适合紧凑的用量展示），
 * 前者用于同一列内必须逐位对齐的场景——混用会导致同一列出现
 * `210.6 / 30.95 / 0.500` 三种位数，小数点无法对齐。
 *
 * @param {unknown} value 数值
 * @param {number} [decimals=2] 小数位
 * @returns {string} 无法解析时返回空串；零统一显示为 `0`（不显示 `0.00`）
 */
export function formatFixed(value, decimals = 2) {
  const parsed = toNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) {
    return '';
  }
  if (Math.abs(parsed) < 1e-9) {
    return '0';
  }
  return parsed.toFixed(decimals);
}

/**
 * 去掉多余小数位，用于「参考值」这类简短展示。
 * @param {unknown} value 数值
 * @returns {string}
 */
export function formatShort(value) {
  const parsed = toNumber(value, 0);
  return String(Math.round(parsed * 100) / 100);
}

/**
 * 深拷贝（仅用于本项目的纯数据对象/数组）。
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 带重复保护的正则全局扫描，替代 `while ((m = re.exec(s)))` 这类有歧义的写法。
 * @param {RegExp} pattern 必须带 g 标志
 * @param {string} text 待扫描文本
 * @yields {RegExpExecArray}
 */
export function* matchAll(pattern, text) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const scanner = new RegExp(pattern.source, flags);
  for (let match = scanner.exec(text); match !== null; match = scanner.exec(text)) {
    yield match;
  }
}

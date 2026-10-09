/**
 * 模板层：把数据渲染为 HTML 片段。
 *
 * 本模块为**纯函数**集合：输入数据、输出字符串。不含 DOM 操作，也不做业务计算，
 * 因此可在 Node 中直接单元测试。
 *
 * @module ui/html
 */

import { ELEMENTS, DEVIATION_THRESHOLD, NEGLIGIBLE_GRAMS } from '../core/constants.js';
import { anhydrousDose, anhydrousFormula } from '../core/chem.js';
import {
  escapeHtml, formatFixed, formatNumber, formatQuantity, formatShort, toNumber,
} from '../core/utils.js';

/**
 * 元素字段名 → 展示名。
 *
 * 注意：氮的两个指标必须保留「硝态 / 铵态」语义，**不能**简单去掉 `-N` 后缀——
 * 那会把「硝态氮含量 11.86%」误写成「硝酸根含量 11.86%」，
 * 而硝酸根离子实际占约 63%，懂一点化学的用户会以为数据算错了。
 */
const ELEMENT_LABELS = Object.freeze({ 'NO3-N': '硝态氮', 'NH4-N': '铵态氮' });
const displayName = (element) => ELEMENT_LABELS[element] ?? element;

/**
 * 把化学式渲染成「原子个数下标」形式。
 *
 * **只影响显示，不改数据**：数据层（`parseFormula`）需要纯 ASCII 的化学式，
 * 所以 CSV 里始终保存 `Ca(NO3)2·4H2O`，只有输出 HTML 时才把原子个数包成 `<sub>`。
 * 直接改用 Unicode 下标字符（₃ ₂）行不通——用户编辑时打不出来，
 * 搜索排序会被打乱，各字体对它们的支持也不一致。
 *
 * 规则：**跟在元素符号或右括号后面的**数字是原子个数，转下标；
 * 化学式开头的数字是系数（如结晶水里的 `4H2O`），保持原样。
 *
 * @param {string} formula 化学式（纯 ASCII）
 * @returns {string} 含 `<sub>` 的 HTML 片段（已转义）
 */
export function formatFormula(formula) {
  return escapeHtml(formula).replace(/([A-Za-z)])(\d+)/g, '$1<sub>$2</sub>');
}

/** 数字 → Unicode 下标字符。 */
const SUBSCRIPT_DIGITS = Object.freeze({
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
});

/**
 * 把化学式转成 Unicode 下标形式，供 **Excel 等纯文本场景**使用。
 *
 * 与 `formatFormula` 的区别：HTML 用 `<sub>` 标签，而 Excel 单元格不支持标签，
 * 只能用 Unicode 下标字符（₃ ₂）。两者都只做**显示转换**，
 * 数据层始终保持纯 ASCII。
 *
 * @param {string} formula 化学式（纯 ASCII）
 * @returns {string} 如 `Ca(NO₃)₂·4H₂O`
 */
export function toUnicodeSubscript(formula) {
  const escaped = String(formula);
  return escaped.replace(/([A-Za-z)])(\d+)/g, (whole, head, digits) => (
    head + [...digits].map((digit) => SUBSCRIPT_DIGITS[digit] ?? digit).join('')
  ));
}

/**
 * 把术语文本里的 `**重点**` 标记渲染为 `<strong>`。
 * 必须先转义再替换，否则会引入注入风险。
 * @param {string} text 原文
 * @returns {string}
 */
function renderEmphasis(text) {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * ② 营养目标输入网格。
 * @param {number[]} targets 目标浓度
 * @param {Record<string, string>} [tooltips] 元素名 → 悬浮解释（来自术语库）
 * @returns {string}
 */
export function targetGridTemplate(targets, tooltips = {}) {
  return ELEMENTS.map((element, index) => {
    const tip = tooltips[element];
    const tipAttribute = tip === undefined ? '' : ` title="${escapeHtml(tip)}"`;
    // 参考值单独占一行：与元素名挤在一行时，三位数的参考值会把格子撑高导致参差不齐
    return `
    <div class="elem">
      <div class="k"><span${tipAttribute}>${element}</span></div>
      <div class="rng" id="rng${index}"></div>
      <input type="number" step="0.01" min="0" id="t${index}" value="${formatFixed(targets[index], 2)}">
    </div>`;
  }).join('');
}

/**
 * ③ 水源本底输入网格。
 * @param {number[]} water 水源本底浓度
 * @returns {string}
 */
export function waterGridTemplate(water) {
  return ELEMENTS.map((element, index) => `
    <div class="elem">
      <div class="k"><span>${element}</span></div>
      <input type="number" step="0.01" min="0" id="w${index}" value="${water[index] ?? 0}">
    </div>`).join('');
}

/**
 * ④ 原料勾选列表（按大量/微量分组）。
 * @param {Array<Record<string, any>>} fertilizers 肥料库
 * @param {Set<number>} selected 已选下标
 * @returns {string}
 */
export function fertilizerListTemplate(fertilizers, selected) {
  const groups = [
    { title: '大量元素', items: [] },
    { title: '微量元素', items: [] },
  ];

  fertilizers.forEach((fertilizer, index) => {
    const bucket = fertilizer.category === '微量' ? groups[1] : groups[0];
    bucket.items.push({ fertilizer, index });
  });

  let html = '';
  for (const group of groups) {
    if (group.items.length === 0) {
      continue;
    }
    html += `<div style="grid-column:1/-1;font-weight:600;color:#4a5561;padding:4px 5px;background:#f6f8fb;`
      + `border-radius:4px;margin-top:2px">${group.title}（${group.items.length}）</div>`;

    for (const { fertilizer, index } of group.items) {
      const compositionText = ELEMENTS
        .map((element, elementIndex) => {
          const value = fertilizer.comp[elementIndex] ?? 0;
          return value > 0 ? `${displayName(element)}${formatShort(value)}%` : '';
        })
        .filter((text) => text !== '')
        .join(' ');

      const checked = selected.has(index) ? ' checked' : '';
      html += `<label class="fert-item">`
        + `<input type="checkbox" data-index="${index}"${checked}>`
        + `<span class="nm">${escapeHtml(fertilizer.name)}`
        + `<small>${formatFormula(fertilizer.formula ?? '')} | ${compositionText === '' ? '—' : compositionText}</small>`
        + `</span></label>`;
    }
  }
  return html;
}

/**
 * 作物/生育期的参考信息行。
 * @param {Record<string, any> | undefined} crop 当前作物生育期
 * @returns {string}
 */
export function cropInfoTemplate(crop) {
  if (crop === undefined || crop === null) {
    return '';
  }

  const parts = [];
  if (crop.ec) {
    parts.push(`目标 EC ≈ <strong>${escapeHtml(crop.ec)}</strong> mS/cm`);
  }
  if (crop.phMin || crop.phMax) {
    parts.push(`pH ${escapeHtml(crop.phMin || '?')}–${escapeHtml(crop.phMax || '?')}`);
  }
  if (crop.note) {
    parts.push(escapeHtml(crop.note));
  }
  if (crop.source) {
    parts.push(`<span class="tag">来源：${escapeHtml(crop.source)}</span>`);
  }
  return parts.join(' · ');
}

/**
 * 工作液浓度（g/L）格式化。
 *
 * 与用量不同，这里是**浓度**而不是称量值：微量元素盐的浓度会小到 0.001 g/L，
 * 若沿用 formatQuantity 的称量阈值（0.005）会整列显示为 0，看起来像「没加这一项」。
 *
 * @param {unknown} value 浓度
 * @returns {string}
 */
function formatConcentration(value) {
  const parsed = toNumber(value, Number.NaN);
  if (!Number.isFinite(parsed) || Math.abs(parsed) < 1e-9) {
    return '0';
  }
  const abs = Math.abs(parsed);
  if (abs >= 1) {
    return parsed.toFixed(2);
  }
  if (abs >= 0.01) {
    return parsed.toFixed(3);
  }
  return parsed.toFixed(4);
}

/** 母液配制的候选称量量（g 溶于 1 L），从大到小尝试，保证取用体积易量取。 */
const TRACE_MOTHER_WEIGHTS = Object.freeze([1, 0.5, 0.2, 0.1, 0.05]);

/**
 * 从术语库取某关键词的悬浮解释，输出可直接放进标签的 `title` 属性。
 *
 * 结果区出现的专业词（偏差、母液沉淀、已剔除…）正是用户最困惑的地方，
 * 模板层是纯函数拿不到术语库，因此由调用方把术语库传进来。
 *
 * @param {Array<{ term: string, meaning: string }>} glossary 术语库
 * @param {string} keyword 关键词
 * @returns {string} 无匹配时返回空串
 */
function glossaryTipAttribute(glossary, keyword) {
  const entry = glossary.find((item) => item.term.includes(keyword));
  if (entry === undefined) {
    return '';
  }
  return ` title="${escapeHtml(`${entry.term}：${entry.meaning}`)}"`;
}

/**
 * 微量原料的母液配制建议。
 *
 * 原理：**母液浓缩不改变称量总量，只改变取用体积**。
 * 与其称 0.008 g（家庭天平做不到），不如称 1 g 配成 1 L 母液，再取 8 mL。
 *
 * @param {Array<{ fertilizer: Record<string, any>, grams: number }>} rows 用量表行
 * @returns {string} 无需建议时返回空串
 */
function traceUsageTemplate(rows) {
  const traceRows = rows.filter((item) => item.grams < 0.1);
  if (traceRows.length === 0) {
    return '';
  }

  const items = traceRows
    .map((item) => {
      const advice = TRACE_MOTHER_WEIGHTS
        .map((weight) => ({ weight, volume: item.grams / weight * 1000 }))
        .find((candidate) => candidate.volume >= 1 && candidate.volume <= 500);
      if (advice === undefined) {
        return '';
      }
      return `<li><b>${escapeHtml(item.fertilizer.name)}</b>：称 <b>${formatFixed(advice.weight, 1)} g</b>`
        + ` 溶于 1 L 水配成母液，取 <b>${formatFixed(advice.volume, 1)} mL</b> 加入工作液</li>`;
    })
    .filter((text) => text !== '');

  if (items.length === 0) {
    return '';
  }

  return '<div class="trace-tip"><b>微量原料称量建议</b>'
    + '<div class="sub">家庭天平称不出 0.1 g 以下 —— 先配母液再按体积取用，配方不变、称量可行：</div>'
    + `<ul>${items.join('')}</ul></div>`;
}

/**
 * ⑤ 计算结果：用量表 + 达成度表 + 形态核对 + 提示。
 * @param {import('../core/calculator.js').ComputeResult} result 计算结果
 * @param {number[]} targets 目标浓度
 * @param {number[]} water 水源本底
 * @param {Array<{ term: string, meaning: string }>} [glossary=[]] 术语库（用于给结果区的专业词挂解释）
 * @returns {string}
 */
export function resultTemplate(result, targets, water, glossary = []) {
  if (result.error !== undefined) {
    return `<div class="neg">${escapeHtml(result.error)}</div>`;
  }

  let html = '';

  // —— 1. 用量表 ——
  const rows = result.usage
    .filter((item) => item.grams >= NEGLIGIBLE_GRAMS)
    .sort((left, right) => right.grams - left.grams);

  const motherLiquorVolume = result.volume / result.concentrate;
  const concentrateSuffix = result.concentrate > 1
    ? `，做 ${result.concentrate} 倍母液即 ${formatShort(motherLiquorVolume)} L`
    : '';

  html += `<h3>原料用量（配制 ${formatShort(result.volume)} L 工作液${concentrateSuffix}）</h3>`;

  // 只有库里真用到了水合物，才需要多这一列；全无水时保持原样不增加噪声
  const hasHydrate = rows.some((item) => anhydrousDose(item.fertilizer.formula, item.grams) !== null);

  if (rows.length === 0) {
    html += '<div class="neg">未得到有效用量（可能目标过高或原料不足）。</div>';
  } else {
    html += [
      '<table class="t-usage"><thead><tr><th>原料</th><th class="num">用量（g）</th>',
      hasHydrate
        ? '<th class="num" title="买到的若是无水产品：同样多的元素，需要称多少克（等效换算，不改变配方本身）">若买无水物</th>'
        : '',
      '<th class="num">g/L 工作液</th><th>主要贡献</th></tr></thead><tbody>',
    ].join('');
    let total = 0;
    let anhydrousTotal = 0;

    for (const item of rows) {
      total += item.grams;
      const contribution = ELEMENTS
        .map((element, elementIndex) => {
          const content = item.fertilizer.comp[elementIndex] ?? 0;
          const grams = item.grams * content / 100;
          // 贡献量与用量行共用同一个「可称量」阈值，避免出现「S 0g」这种空信息
          return grams >= NEGLIGIBLE_GRAMS
            ? `${displayName(element)} ${formatQuantity(grams)}g`
            : '';
        })
        .filter((text) => text !== '')
        .slice(0, 5)
        .join('，');

      const dose = anhydrousDose(item.fertilizer.formula, item.grams);
      // 无水原料本来就没有"另一种形态"，换算后重量不变 —— 合计必须把它计进去。
      // 否则左边含全部原料、右边只含水合物，两列口径不同，会让人误以为
      // 「全买无水物只要这么点」。
      anhydrousTotal += dose === null ? item.grams : dose.grams;
      const anhydrousCell = hasHydrate
        ? `<td class="num">${dose === null ? '—' : formatQuantity(dose.grams)}</td>`
        : '';

      html += [
        `<tr><td>${escapeHtml(item.fertilizer.name)}</td>`,
        `<td class="num"><strong>${formatQuantity(item.grams)}</strong></td>`,
        anhydrousCell,
        `<td class="num">${formatConcentration(item.grams / result.volume)}</td>`,
        `<td class="contrib">${contribution === '' ? '—' : contribution}</td></tr>`,
      ].join('');
    }

    const anhydrousTotalCell = hasHydrate
      ? `<td class="num"><strong>${formatQuantity(anhydrousTotal)}</strong></td>`
      : '';
    html += [
      '<tr class="total-row"><td><strong>合计</strong></td>',
      `<td class="num"><strong>${formatQuantity(total)}</strong></td>`,
      anhydrousTotalCell,
      `<td class="num">${formatConcentration(total / result.volume)}</td><td></td></tr></tbody></table>`,
    ].join('');

    if (hasHydrate) {
      html += '<div class="sub" style="margin-top:6px">「若买无水物」= 同样多的元素改用无水产品时的称量值'
        + '（等效换算，配方本身不变）——买到的肥料形态与库中不一致时看这一列。</div>';
    }

    html += traceUsageTemplate(rows);
  }

  // —— 2. 达成度表（默认收起，异常优先）——
  const hasWater = water.some((value) => value > 1e-9);
  const achievedRows = [];
  let hasLargeDeviation = false;
  let worstMagnitude = 0;

  ELEMENTS.forEach((element, index) => {
    const target = targets[index];
    const actual = result.actual[index];

    if (target <= 0 && actual <= 1e-6) {
      return;
    }

    let deviation = null;
    let rowClass = '';
    if (target > 0) {
      deviation = (actual - target) / target * 100;
      const magnitude = Math.abs(deviation);
      worstMagnitude = Math.max(worstMagnitude, magnitude);
      if (magnitude > DEVIATION_THRESHOLD.bad) {
        rowClass = 'bad';
        hasLargeDeviation = true;
      } else if (magnitude > DEVIATION_THRESHOLD.warn) {
        rowClass = 'warnrow';
      }
    }

    // 微小负偏差归零：`-0.0%` 与 `0.0%` 并存会让人去找这 0.0 是哪来的
    let deviationText = '—';
    if (deviation !== null) {
      const rounded = Math.abs(deviation) < 0.05 ? 0 : Number(deviation.toFixed(1));
      deviationText = `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
    }

    achievedRows.push({ element, target, water: water[index], actual, rowClass, deviationText });
  });

  const abnormalCount = achievedRows.filter((row) => row.rowClass !== '').length;
  const summary = abnormalCount === 0
    ? `${achievedRows.length} 项全部偏差 ≤${DEVIATION_THRESHOLD.warn}%（最大 ${worstMagnitude.toFixed(2)}%）`
    : `${abnormalCount} 项偏差 &gt;${DEVIATION_THRESHOLD.warn}%（最大 ${worstMagnitude.toFixed(2)}%）`;

  // 未填水源本底时整列都是 0，属于无效信息，直接不渲染该列
  const waterHeader = hasWater ? '<th class="num">水源本底</th>' : '';
  // 只有出现 >10% 的严重偏差时才默认展开，避免用户错过问题
  html += `<details class="achieve"${hasLargeDeviation ? ' open' : ''}>`
    + `<summary${glossaryTipAttribute(glossary, '偏差')}>目标达成情况（mg/L）`
    + `<span class="sum">${summary}</span></summary>`
    + `<table class="t-achieve"><thead><tr><th>元素</th><th class="num">目标</th>${waterHeader}`
    + '<th class="num">实际达成</th><th class="num">偏差</th></tr></thead><tbody>';

  for (const row of achievedRows) {
    const classAttribute = row.rowClass === '' ? '' : ` class="${row.rowClass}"`;
    const waterCell = hasWater ? `<td class="num">${formatFixed(row.water, 2)}</td>` : '';
    html += `<tr${classAttribute}><td>${row.element}</td>`
      + `<td class="num">${formatFixed(row.target, 2)}</td>${waterCell}`
      + `<td class="num">${formatFixed(row.actual, 2)}</td>`
      + `<td class="num">${row.deviationText}</td></tr>`;
  }

  html += '</tbody></table></details>';

  // —— 3. 形态核对（结晶水会显著改变用量）——
  // 判据必须是「化学式里真的有结晶水」，不能用 form 字段：
  // 螯合物（form='螯合物（按标称含量）'）没有水合/无水之分，按 form 判断会被误纳入。
  const hydrated = result.usage.filter((item) => anhydrousFormula(item.fertilizer.formula) !== null);
  if (hydrated.length > 0) {
    html += '<h3>形态核对 '
      + '<span class="sub">— 购买时请核对结晶水形态，同一重量下元素含量可差一倍</span></h3>'
      + '<table class="t-form"><thead><tr><th>原料</th><th>化学式</th><th>形态</th>'
      + '<th>当前元素含量</th></tr></thead><tbody>';

    for (const item of hydrated) {
      const fertilizer = item.fertilizer;
      const mainElements = ELEMENTS
        .map((element, index) => {
          const value = fertilizer.comp[index] ?? 0;
          return value >= 0.5 ? `${displayName(element)} ${formatShort(value)}%` : '';
        })
        .filter((text) => text !== '')
        .slice(0, 5)
        .join('，');

      html += `<tr><td>${escapeHtml(fertilizer.name)}</td>`
        + `<td class="formula">${formatFormula(fertilizer.formula)}</td>`
        + `<td><span class="tag y">${escapeHtml(fertilizer.form)}</span></td>`
        + `<td>${mainElements === '' ? '—' : mainElements}</td></tr>`;

      if (fertilizer.formHint) {
        html += `<tr><td colspan="4" style="background:#fffdf5;color:#b45309">↳ ${escapeHtml(fertilizer.formHint)}</td></tr>`;
      }
    }

    html += '</tbody></table>';
  }

  // —— 4. 提示 ——
  const notes = [];

  if (result.missing.length > 0) {
    notes.push(`<span class="tag r">无原料可提供</span> ${result.missing.join('、')} —— 该目标无法达成，请补充原料`);
  }
  if (result.removed.length > 0) {
    const names = result.removed.map((fertilizer) => escapeHtml(fertilizer.name)).join('、');
    notes.push(`<span class="tag y"${glossaryTipAttribute(glossary, '负用量')}>已剔除（解为负值）</span> ${names}`);
  }
  if (hasLargeDeviation) {
    notes.push(`<span class="tag y"${glossaryTipAttribute(glossary, '偏差')}>存在偏差 &gt;10% 的元素</span> `
      + '通常是原料组合的线性约束所致，可增删原料或微调目标');
  }

  const hasCalcium = result.usage.some((item) => (item.fertilizer.comp[4] ?? 0) > 0);
  const hasSulfate = result.usage.some((item) => (item.fertilizer.comp[6] ?? 0) > 0);
  const hasPhosphate = result.usage.some((item) => (item.fertilizer.comp[2] ?? 0) > 0);

  if (result.concentrate > 1 && hasCalcium && (hasSulfate || hasPhosphate)) {
    notes.push(`<span class="tag r"${glossaryTipAttribute(glossary, '母液')}>母液沉淀风险</span> `
      + '钙与硫酸盐/磷酸盐在浓缩母液中会生成沉淀 —— 请把钙肥分到 A 桶，硫酸盐与磷酸盐分到 B 桶');
  }

  // 理论达标 ≠ 现场达标：这一句常驻，避免用户把「偏差 0.0%」理解成投加精度
  notes.push('<span class="tag g">理论值</span> 偏差列是<b>按库中成分计算的理论偏差</b>，'
    + '不代表现场投加精度 —— 结晶水形态、实际纯度、称量误差都可能带来 10% 以上的实际差异');

  html += `<div class="notes"><ul><li>${notes.join('</li><li>')}</li></ul></div>`;

  return html;
}

/**
 * 数据编辑器：肥料表。
 * @param {Array<Record<string, any>>} draft 编辑中的副本
 * @returns {string}
 */
export function fertilizerEditorTemplate(draft) {
  const header = `<thead><tr>
    <th style="position:sticky;left:0;background:#eef2f7;z-index:3">#</th>
    <th>名称</th><th>化学式</th><th>类别</th><th>纯度</th><th>标准</th><th>备注</th>
    ${ELEMENTS.map((element) => `<th title="每 100 g 商品含该元素克数（自动计算）">${element}</th>`).join('')}
    <th>形态</th><th></th>
  </tr></thead><tbody>`;

  const body = draft.map((fertilizer, index) => {
    const categoryOptions = ['大量', '微量']
      .map((option) => `<option${fertilizer.category === option ? ' selected' : ''}>${option}</option>`)
      .join('');

    const compositionCells = ELEMENTS
      .map((_, elementIndex) => `<td class="calc" data-calc="${index}-${elementIndex}">`
        + `${formatNumber(fertilizer.comp[elementIndex])}</td>`)
      .join('');

    return `<tr data-row="${index}">
      <td style="position:sticky;left:0;background:#f8fafc;color:#8a94a0">${index + 1}</td>
      <td><input data-row="${index}" data-field="name" value="${escapeHtml(fertilizer.name)}"></td>
      <td><input data-row="${index}" data-field="formula" value="${escapeHtml(fertilizer.formula)}"
        style="font-family:Consolas,monospace" title="用普通数字书写（如 Ca(NO3)2·4H2O），显示时会自动转成下标"></td>
      <td><select data-row="${index}" data-field="category">${categoryOptions}</select></td>
      <td><input type="number" step="0.01" min="0" max="1" data-row="${index}" data-field="purity" value="${fertilizer.purity ?? 1}"></td>
      <td style="text-align:center"><input type="checkbox" data-row="${index}" data-field="std"${fertilizer.std ? ' checked' : ''}></td>
      <td><input data-row="${index}" data-field="note" value="${escapeHtml(fertilizer.note ?? '')}"></td>
      ${compositionCells}
      <td class="form" data-form="${index}">${escapeHtml(fertilizer.form ?? '')}</td>
      <td><span class="del" data-delete="${index}" title="删除该行">×</span></td>
    </tr>
    <tr class="formula-error-row" data-formula-error-row="${index}"${fertilizer.formulaError ? '' : ' hidden'}>
      <td colspan="${9 + ELEMENTS.length}">
        <span class="formula-error" data-formula-error="${index}">${escapeHtml(fertilizer.formulaError ?? '')}</span>
      </td>
    </tr>`;
  }).join('');

  return `${header}${body}</tbody>`;
}

/**
 * 术语词典面板内容：按分类分组，每条给出「含义」与「对种植的影响」。
 * @param {Array<{ category: string, term: string, meaning: string, impact: string }>} glossary 术语条目
 * @param {string} [keyword=''] 搜索关键词（匹配术语 / 含义 / 影响）
 * @returns {string}
 */
export function glossaryTemplate(glossary, keyword = '') {
  const needle = keyword.trim().toLowerCase();
  const matched = needle === ''
    ? glossary
    : glossary.filter((entry) => `${entry.category}${entry.term}${entry.meaning}${entry.impact}`
      .toLowerCase()
      .includes(needle));

  if (matched.length === 0) {
    return '<div class="notes" style="padding:18px">没有匹配「'
      + `${escapeHtml(keyword)}」的术语。换个关键词试试，例如「钙」「EC」「螯合」。</div>`;
  }

  const groups = new Map();
  for (const entry of matched) {
    const bucket = groups.get(entry.category);
    if (bucket === undefined) {
      groups.set(entry.category, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  let html = '<div class="glossary">';
  for (const [category, entries] of groups) {
    html += `<h3 class="glossary-category">${escapeHtml(category)}（${entries.length}）</h3>`;
    for (const entry of entries) {
      html += `<div class="glossary-item">
        <div class="glossary-term">${renderEmphasis(entry.term)}</div>
        <div class="glossary-line"><span class="label">含义</span>${renderEmphasis(entry.meaning)}</div>
        <div class="glossary-line impact"><span class="label">对种植的影响</span>${renderEmphasis(entry.impact)}</div>
      </div>`;
    }
  }
  return `${html}</div>`;
}

/**
 * 数据编辑器：作物表。
 * @param {Array<Record<string, any>>} draft 编辑中的副本
 * @returns {string}
 */
export function cropEditorTemplate(draft) {
  const header = `<thead><tr>
    <th style="position:sticky;left:0;background:#eef2f7;z-index:3">#</th>
    <th>作物</th><th>生育期</th>
    ${ELEMENTS.map((element) => `<th>${element}</th>`).join('')}
    <th>EC目标</th><th>pH下限</th><th>pH上限</th><th>备注</th><th>来源</th><th></th>
  </tr></thead><tbody>`;

  const body = draft.map((crop, index) => {
    const targetCells = ELEMENTS
      .map((_, elementIndex) => `<td><input type="number" step="0.001" min="0" style="min-width:72px"`
        + ` data-row="${index}" data-target="${elementIndex}" value="${crop.target[elementIndex] ?? 0}"></td>`)
      .join('');

    return `<tr data-row="${index}">
      <td style="position:sticky;left:0;background:#f8fafc;color:#8a94a0">${index + 1}</td>
      <td><input data-row="${index}" data-field="crop" value="${escapeHtml(crop.crop)}"></td>
      <td><input data-row="${index}" data-field="stage" value="${escapeHtml(crop.stage)}"></td>
      ${targetCells}
      <td><input data-row="${index}" data-field="ec" value="${escapeHtml(crop.ec ?? '')}" style="min-width:72px"></td>
      <td><input data-row="${index}" data-field="phMin" value="${escapeHtml(crop.phMin ?? '')}" style="min-width:52px"></td>
      <td><input data-row="${index}" data-field="phMax" value="${escapeHtml(crop.phMax ?? '')}" style="min-width:52px"></td>
      <td><input data-row="${index}" data-field="note" value="${escapeHtml(crop.note ?? '')}"></td>
      <td><input data-row="${index}" data-field="source" value="${escapeHtml(crop.source ?? '')}"></td>
      <td><span class="del" data-delete="${index}" title="删除该行">×</span></td>
    </tr>`;
  }).join('');

  return `${header}${body}</tbody>`;
}

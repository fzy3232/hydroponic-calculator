/**
 * 视图层：**唯一接触 DOM 的模块**。
 *
 * 职责边界：
 *  - 持有界面状态（当前选择、输入值、编辑草稿）
 *  - 调用 core 层做计算（`compute` / `autoPick` / `calculateComposition`）
 *  - 调用模板层生成 HTML（`ui/html.js`），再挂到 DOM 上
 *  - 绑定事件、读写文件
 *
 * 不包含任何计算公式，也不拼接大段 HTML。
 *
 * @module ui/view
 */

import { ELEMENTS, MACRO_ELEMENTS } from '../core/constants.js';
import { toNumber, positiveNumber, deepClone, formatFixed } from '../core/utils.js';
import {
  parseCSV, toCSV, normalizeFertilizers, normalizeCrops,
  fertilizersFromRows, cropsFromRows, fertilizersToRows, cropsToRows,
  glossaryFromRows, glossaryToRows,
  FERTILIZER_COLUMNS, CROP_COLUMNS, GLOSSARY_COLUMNS,
} from '../core/data.js';
import { calculateComposition } from '../core/chem.js';
import { compute, autoPick } from '../core/calculator.js';
import { buildXlsx } from '../core/xlsx.js';
import { recipeSheets } from './sheets.js';
import {
  targetGridTemplate, waterGridTemplate, fertilizerListTemplate,
  cropInfoTemplate, resultTemplate, fertilizerEditorTemplate, cropEditorTemplate,
  glossaryTemplate,
} from './html.js';

/** @param {string} id 元素 id @returns {HTMLElement} */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** 编辑器模式 */
const EDITOR_MODE = Object.freeze({ FERTILIZER: 'fertilizer', CROP: 'crop' });

/** 界面状态 */
const state = {
  /** @type {Array<Record<string, any>>} */ fertilizers: [],
  /** @type {Array<Record<string, any>> */ crops: [],
  /** @type {number[]} */ targets: new Array(ELEMENTS.length).fill(0),
  /** @type {number[]} */ water: new Array(ELEMENTS.length).fill(0),
  /** @type {Set<number>} */ selected: new Set(),
  /** @type {{ fertilizers: Array<Record<string, any>>, crops: Array<Record<string, any>>, glossary: Array<Record<string, string>> }} */
  builtin: { fertilizers: [], crops: [], glossary: [] },
  /** @type {Array<{ category: string, term: string, meaning: string, impact: string }>} */
  glossary: [],
  /** @type {string} 当前主视图：'calc'（化学计算）| 'data'（数据编辑） */
  view: 'calc',
  /** @type {import('../core/calculator.js').ComputeResult | null} 最近一次计算结果（供导出 Excel 使用） */
  lastResult: null,
  /** @type {string | null} */ editing: null,
  /** @type {Array<Record<string, any>> | null} */ draft: null,
};

const localStorageKeys = Object.freeze({
  fertilizers: 'hb_ferts',
  crops: 'hb_crops',
  glossary: 'hb_glossary',
});

/**
 * 目标浓度是否已经被赋过值。
 * 首屏初始化时 `state.targets` 还是全 0 的占位数组，若不区分，
 * 「你之前的修改已被替换」这句提示会在**第一次打开页面**时就误报。
 */
let targetsInitialized = false;

/* ============================ 数据载入 ============================ */

/**
 * 从本机存储读取 JSON；解析失败时警告并返回 null，**不抛异常**。
 *
 * 必须容错：存储里的内容可能被手工改坏、或来自旧版本格式。
 * 一旦这里抛异常，整个初始化都会中断——用户看到的是**白屏**，
 * 而原因只写在控制台里（桌面应用的使用者根本不会去看控制台）。
 *
 * @param {string} key 存储键
 * @returns {unknown} 读不到或解析失败时返回 null
 */
function readStoredJSON(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`本地数据 ${key} 已损坏，已忽略并回退到内置数据`, error);
    return null;
  }
}

/**
 * 写入本机存储；失败时给出可见提示，但**不中断流程**。
 * 典型失败原因是配额已满（QuotaExceededError），此时数据没保存必须让用户知道。
 *
 * @param {string} key 存储键
 * @param {unknown} value 可序列化的值
 * @returns {boolean} 是否写入成功
 */
function writeStoredJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`保存到本机存储失败：${key}`, error);
    window.alert('保存失败：本机存储空间可能已满，请改用「导出 CSV」备份。');
    return false;
  }
}

/**
 * 读取构建时内联的数据。
 * @param {string} elementId 承载 JSON 的 script 元素 id
 * @returns {unknown} 元素缺失或解析失败时返回空数组
 */
function readInlineJSON(elementId) {
  const element = document.getElementById(elementId);
  if (element === null) {
    console.warn(`内联数据元素缺失：${elementId}（模板与脚本可能不匹配）`);
    return [];
  }
  try {
    return JSON.parse(element.textContent.trim());
  } catch (error) {
    console.warn(`无法解析内联数据 ${elementId}`, error);
    return [];
  }
}

/** 从内联 JSON 载入数据，并用本机保存的修改覆盖。 */
export function loadFromInline() {
  state.builtin.fertilizers = readInlineJSON('data-fertilizers');
  state.builtin.crops = readInlineJSON('data-crops');
  state.glossary = readInlineJSON('data-glossary');
  state.builtin.glossary = deepClone(state.glossary);
  state.fertilizers = normalizeFertilizers(deepClone(state.builtin.fertilizers));
  state.crops = normalizeCrops(deepClone(state.builtin.crops));

  const storedFertilizers = readStoredJSON(localStorageKeys.fertilizers);
  if (Array.isArray(storedFertilizers) && storedFertilizers.length > 0) {
    state.fertilizers = normalizeFertilizers(storedFertilizers);
  }

  const storedCrops = readStoredJSON(localStorageKeys.crops);
  if (Array.isArray(storedCrops) && storedCrops.length > 0) {
    state.crops = normalizeCrops(storedCrops);
  }

  // 术语库也支持本机覆盖：否则使用说明里「可自行扩充术语」对非工程用户是空话
  const storedGlossary = readStoredJSON(localStorageKeys.glossary);
  if (Array.isArray(storedGlossary) && storedGlossary.length > 0) {
    state.glossary = storedGlossary;
  }

  renderMeta();
}

/** 更新顶部数据量提示。 */
function renderMeta() {
  const cropKinds = new Set(state.crops.map((crop) => crop.crop)).size;
  byId('dataMeta').textContent = `肥料 ${state.fertilizers.length} 种 · 作物 ${cropKinds} 种 / ${state.crops.length} 个生育期`;
}

/* ============================ 渲染 ============================ */

/**
 * 元素字段名 → 术语名前缀的**显式映射**。
 *
 * 不用 `term.startsWith(element)` 前缀匹配：词汇表里术语形如 `NO3-N（硝态氮）`、
 * `EC（电导率）`，前缀匹配对 `K`、`P`、`S` 这类单字母元素会误配到别的条目，
 * 而且词汇表的排列顺序一变就会静默失效（没有任何报错）。
 */
const GLOSSARY_TERM_BY_ELEMENT = Object.freeze({
  'NO3-N': 'NO3-N',
  'NH4-N': 'NH4-N',
  P: 'P（磷）',
  K: 'K（钾）',
  Ca: 'Ca（钙）',
  Mg: 'Mg（镁）',
  S: 'S（硫）',
  Fe: 'Fe（铁）',
  Mn: 'Mn（锰）',
  Zn: 'Zn（锌）',
  Cu: 'Cu（铜）',
  B: 'B（硼）',
  Mo: 'Mo（钼）',
  Si: 'Si（硅）',
  Na: 'Na（钠）',
  Cl: 'Cl（氯）',
});

/**
 * 取第一句话，用于悬浮提示（完整内容在词典面板里看）。
 * @param {string} text 术语的影响描述
 * @returns {string}
 */
function firstSentence(text) {
  const matched = /^[^。；]*[。；]?/.exec(text);
  return matched === null ? text : matched[0];
}

/**
 * 由术语库生成元素名的悬浮解释。
 *
 * 同时给出「含义」与「对种植的影响」——后者是用户点名要的内容：
 * 只讲定义对种菜的人没有实际帮助，他要知道的是"高了低了会怎样"。
 *
 * @returns {Record<string, string>}
 */
function buildElementTooltips() {
  const tooltips = {};
  for (const element of ELEMENTS) {
    const prefix = GLOSSARY_TERM_BY_ELEMENT[element];
    if (prefix === undefined) {
      continue;
    }
    const entry = state.glossary.find((item) => item.term.startsWith(prefix));
    if (entry !== undefined) {
      tooltips[element] = `${entry.term}\n${entry.meaning}\n`
        + `【对种植的影响】${firstSentence(entry.impact)}`;
    }
  }
  return tooltips;
}

/** 渲染目标浓度网格并绑定输入事件。 */
export function renderTargets() {
  byId('targetGrid').innerHTML = targetGridTemplate(state.targets, buildElementTooltips());
  ELEMENTS.forEach((_, index) => {
    const input = byId(`t${index}`);
    const handler = () => {
      state.targets[index] = toNumber(input.value, 0);
      renderReferenceRanges();
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
  renderReferenceRanges();
}

/** 在目标输入框旁显示该生育期的文献参考值。 */
function renderReferenceRanges() {
  const crop = currentStage();
  ELEMENTS.forEach((_, index) => {
    const label = byId(`rng${index}`);
    if (label === null) {
      return;
    }
    const reference = crop === undefined ? 0 : (crop.target[index] ?? 0);

    // 与输入框使用同一精度（2 位），否则同一屏会出现「参考 30.96 / 输入框 30.955」
    // 两个数字，用户无法判断哪个可信
    label.textContent = reference > 0 ? `参考 ${formatFixed(reference, 2)}` : '';

    // 用户改过之后，参考值转为「你已偏离文献值」的可见状态，
    // 否则当初始值等于文献值时它只是一条冗余信息
    const changed = reference > 0
      && Math.abs(toNumber(state.targets[index], 0) - reference) > 1e-9;
    label.classList.toggle('deviated', changed);
  });
}

/** 渲染水源本底网格。 */
export function renderWater() {
  byId('waterGrid').innerHTML = waterGridTemplate(state.water);
  ELEMENTS.forEach((_, index) => {
    const input = byId(`w${index}`);
    const handler = () => {
      state.water[index] = toNumber(input.value, 0);
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
}

/** 渲染原料勾选列表。 */
export function renderFertilizerList() {
  byId('fertList').innerHTML = fertilizerListTemplate(state.fertilizers, state.selected);
  byId('fertList').querySelectorAll('input[type=checkbox]').forEach((checkbox) => {
    const element = /** @type {HTMLInputElement} */ (checkbox);
    element.addEventListener('change', () => {
      const index = toNumber(element.dataset.index, -1);
      if (element.checked) {
        state.selected.add(index);
      } else {
        state.selected.delete(index);
      }
      renderSelectedCount();
    });
  });
  renderSelectedCount();
}

function renderSelectedCount() {
  byId('fertCount').textContent = `已选 ${state.selected.size} / ${state.fertilizers.length} 种`;
}

/** 渲染作物下拉框。 */
export function renderCropOptions() {
  const select = /** @type {HTMLSelectElement} */ (byId('selCrop'));
  select.innerHTML = '';
  const names = Array.from(new Set(state.crops.map((crop) => crop.crop)));
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  renderStageOptions();
}

/** 渲染生育期下拉框（随作物联动）。 */
export function renderStageOptions() {
  const cropName = /** @type {HTMLSelectElement} */ (byId('selCrop')).value;
  const select = /** @type {HTMLSelectElement} */ (byId('selStage'));
  select.innerHTML = '';
  for (const crop of state.crops.filter((item) => item.crop === cropName)) {
    const option = document.createElement('option');
    option.value = crop.stage;
    option.textContent = crop.stage;
    select.appendChild(option);
  }
  renderCropInfo();
}

/** 当前选中的作物生育期记录。 */
export function currentStage() {
  const cropName = /** @type {HTMLSelectElement} */ (byId('selCrop')).value;
  const stageName = /** @type {HTMLSelectElement} */ (byId('selStage')).value;
  return state.crops.find((crop) => crop.crop === cropName && crop.stage === stageName);
}

/** 渲染当前生育期的参考信息。 */
export function renderCropInfo() {
  byId('cropInfo').innerHTML = cropInfoTemplate(currentStage());
}

/** 渲染计算结果。 */
export function renderResult(result) {
  byId('resultBox').innerHTML = resultTemplate(result, state.targets, state.water, state.glossary);
}

/* ============================ 交互 ============================ */

/**
 * 切换主视图。
 * @param {string} viewName `'calc'`（化学计算）或 `'data'`（数据编辑）
 */
export function switchView(viewName) {
  state.view = viewName;

  for (const navButton of document.querySelectorAll('.nav-item')) {
    navButton.classList.toggle('is-active', navButton.dataset.view === viewName);
  }
  byId('view-calc').hidden = viewName !== 'calc';
  byId('view-data').hidden = viewName !== 'data';
  // 换视图后回到顶部，避免停在上一屏的半截位置
  byId('contentArea').scrollTop = 0;
}

/**
 * 从当前生育期载入目标浓度。
 *
 * 交互约定（用户明确要求）：
 *  - **载入是自动的** —— 切换作物或生育期立即更新目标，不需要点按钮
 *  - **计算不是自动的** —— 由「开始计算」按钮触发，避免在用户还在调整输入时反复重算
 *
 * @param {boolean} [silent=false] 为 true 时不弹提示（用于自动切换场景）
 */
export function syncTargetsFromStage(silent = false) {
  const crop = currentStage();
  if (crop === undefined) {
    if (!silent) {
      window.alert('该生育期没有预置数据，请手工填写目标浓度。');
    }
    return;
  }

  // 用户是否手改过当前目标？（切换生育期会覆盖它们，必须让用户知道）
  const hadManualEdit = targetsInitialized
    && state.targets.length === crop.target.length
    && state.targets.some((value, index) => Math.abs(value - crop.target[index]) > 1e-9);

  // 统一取 2 位小数：与 ② 的「参考 X」和 ⑤ 的达成表逐位一致，
  // 也避免 input[step="0.01"] 与 3 位数据冲突（点微调箭头会跳值）
  state.targets = crop.target.map((value) => toNumber(formatFixed(value, 2), 0));
  targetsInitialized = true;
  renderTargets();

  // 静默替换用户手改的目标值属于「数据丢失」，必须给出可见反馈
  const status = byId('targetStatus');
  if (status !== null) {
    status.textContent = hadManualEdit && silent
      ? '✓ 已载入该生育期的文献值（你之前的修改已被替换）'
      : '';
  }
}

/** 作物切换：重建生育期列表并自动载入目标。 */
function handleCropChange() {
  renderStageOptions();
  syncTargetsFromStage(true);
}

/** 生育期切换：更新信息行并自动载入目标。 */
function handleStageChange() {
  renderCropInfo();
  syncTargetsFromStage(true);
}

/** 执行智能推荐。 */
export function runAutoPick() {
  const result = autoPick({
    targets: state.targets,
    water: state.water,
    fertilizers: state.fertilizers,
  });
  state.selected = new Set(result.selected);
  renderFertilizerList();

  const timing = byId('calcTiming');
  if (result.uncovered.length > 0) {
    timing.innerHTML = `<span class="tag y">注意：${result.uncovered.join('、')} 无原料可提供`
      + '（大量元素须用「大量」类，微量元素须用「微量」类）</span>';
  } else {
    timing.textContent = '';
  }
}

/** 执行计算并渲染结果。 */
export function runCalculation() {
  const started = performance.now();
  const result = compute({
    targets: state.targets,
    water: state.water,
    fertilizers: state.fertilizers,
    selected: state.selected,
    volume: positiveNumber(byId('volume').value, 1),
    concentrate: positiveNumber(byId('concentrate').value, 1),
  });
  const elapsed = performance.now() - started;

  const iterationText = result.iterations ? `（非负迭代 ${result.iterations} 次）` : '';
  byId('calcTiming').textContent = `求解耗时 ${elapsed.toFixed(2)} ms${iterationText}`;
  state.lastResult = result;   // 导出 Excel 时要用
  renderResult(result);
  return result;
}

/* ============================ 文件读写 ============================ */

/**
 * 保存文本文件（双通道）。
 *
 * **为什么必须分两条路**：Tauri（WebView2）里 `a[download]` 形式的 Blob 下载**不可靠** ——
 * 这不是推测：Tauri 社区里凡是需要「导出文件」的项目，最后都会退回
 * `dialog.save` + `fs.writeFile`，并保留浏览器降级分支。
 *
 * 所以：桌面版走系统「另存为」对话框 + 真实写盘；浏览器 / 单文件 HTML 版回退 Blob 下载。
 *
 * @param {string} filename 建议文件名
 * @param {string} text 文件内容
 * @param {string} [mime='text/csv'] MIME 类型（仅浏览器通道使用）
 * @returns {Promise<string | null>} 桌面版返回实际保存路径；浏览器通道返回 null
 */
/**
 * 保存文件（双通道）。
 *
 * **为什么必须分两条路**：Tauri（WebView2）里 `a[download]` 形式的 Blob 下载**不可靠** ——
 * 这不是推测：Tauri 社区里凡是需要「导出文件」的项目，最后都会退回
 * `dialog.save` + `fs.writeFile`，并保留浏览器降级分支。
 *
 * 所以：桌面版走系统「另存为」对话框 + 真实写盘；浏览器 / 单文件 HTML 版回退 Blob 下载。
 *
 * @param {string} filename 建议文件名
 * @param {string | Uint8Array} data 文本或二进制内容
 * @param {{ mime?: string, filterName?: string, extensions?: string[] }} [options] 保存选项
 * @returns {Promise<string | null>} 桌面版返回实际保存路径；浏览器通道返回 null
 */
async function saveFile(filename, data, options = {}) {
  const mime = options.mime ?? 'text/csv';
  const filterName = options.filterName ?? 'CSV 文件';
  const extensions = options.extensions ?? ['csv'];

  const tauri = globalThis.__TAURI__;
  if (tauri !== undefined && tauri.dialog !== undefined && tauri.fs !== undefined) {
    const chosenPath = await tauri.dialog.save({
      defaultPath: filename,
      filters: [{ name: filterName, extensions }],
    });
    if (chosenPath === null || chosenPath === undefined) {
      return null;   // 用户在对话框里取消
    }
    if (typeof data === 'string') {
      await tauri.fs.writeTextFile(chosenPath, data);
    } else {
      await tauri.fs.writeFile(chosenPath, data);
    }
    return chosenPath;
  }

  const blob = typeof data === 'string'
    ? new Blob([data], { type: `${mime};charset=utf-8` })
    : new Blob([data], { type: mime });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(anchor.href);
    anchor.remove();
  }, 500);
  return null;
}

/**
 * 导出 CSV 并给出可见反馈。
 *
 * 桌面版会显示**真实的保存路径**——这比 HTML 版"下载到哪不知道"是一次升级，
 * 也回应了"导出是用户数据资产的唯一出口，不能静默失败"。
 *
 * @param {string} filename 文件名
 * @param {string} text 内容
 * @returns {Promise<void>}
 */
async function exportCsv(filename, text) {
  try {
    const savedPath = await saveFile(filename, text, { mime: 'text/csv' });
    if (savedPath !== null) {
      byId('dataStatus').textContent = `✓ 已保存到：${savedPath}`;
    }
  } catch (error) {
    window.alert(`导出失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 导出当前配方为 Excel 工作簿（.xlsx）。
 *
 * 为什么用 Excel 取代系统打印：Excel 既能直接打印，又能在表格里继续算
 * ——数字已写成**数值类型**，可以直接求和、按倍数缩放、画图。
 * 另外 `window.print()` 在 WebView2 里的行为本身就不确定（tauri#4917 无官方打印 API）。
 */
export async function exportRecipeExcel() {
  const result = state.lastResult;
  if (result === null || result.error !== undefined) {
    window.alert('请先点「开始计算」生成配方，再导出 Excel。');
    return;
  }

  try {
    const crop = currentStage();
    const sheets = recipeSheets(result, state.targets, state.water, {
      crop: crop === undefined ? '—' : crop.crop,
      stage: crop === undefined ? '—' : crop.stage,
    });
    const bytes = buildXlsx(sheets);

    const savedPath = await saveFile('水培配方.xlsx', bytes, {
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filterName: 'Excel 工作簿',
      extensions: ['xlsx'],
    });
    if (savedPath !== null) {
      byId('dataStatus').textContent = `✓ 已保存到：${savedPath}`;
    }
  } catch (error) {
    window.alert(`导出 Excel 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 打印当前配方。
 *
 * Tauri 窗口没有浏览器的菜单栏，也就没有 Ctrl+P —— 若不提供按钮，打印路径会**完全断裂**
 * （tauri#4917 至今无官方打印 API，这里用 WebView2 的 `window.print()`；
 * 打印样式 `@media print` 已在 style.css 中就位）。
 */
export function printRecipe() {
  window.print();
}

/**
 * 读取文本文件；先按 UTF-8 解码，若出现大量替换字符则回退 GBK（Excel 中文默认编码）。
 * @param {File} file 用户选择的文件
 * @returns {Promise<string>}
 */
function readTextFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
      if (replacementCount <= 3) {
        resolve(text);
        return;
      }
      const binaryReader = new FileReader();
      binaryReader.onload = () => {
        try {
          resolve(new TextDecoder('gbk').decode(binaryReader.result));
        } catch {
          resolve(text);
        }
      };
      binaryReader.readAsArrayBuffer(file);
    };
    reader.readAsText(file, 'UTF-8');
  });
}

/**
 * 导入肥料 CSV。
 * @param {File} file 用户选择的文件
 */
export async function importFertilizerCSV(file) {
  const { records } = parseCSV(await readTextFile(file));
  const fertilizers = fertilizersFromRows(records);
  if (fertilizers.length === 0) {
    window.alert(`未解析到有效肥料行。请确认列名包含：名称、${ELEMENTS.join('、')}`);
    return;
  }
  state.fertilizers = normalizeFertilizers(fertilizers);
  state.selected.clear();
  writeStoredJSON(localStorageKeys.fertilizers, state.fertilizers);
  renderFertilizerList();
  renderMeta();
  window.alert(`已导入 ${state.fertilizers.length} 种肥料（已存本地，下次打开自动生效）`);
}

/**
 * 导入作物 CSV。
 * @param {File} file 用户选择的文件
 */
export async function importCropCSV(file) {
  const { records } = parseCSV(await readTextFile(file));
  const crops = cropsFromRows(records);
  if (crops.length === 0) {
    window.alert(`未解析到有效作物行。请确认列名包含：作物、生育期、${ELEMENTS.join('、')}`);
    return;
  }
  state.crops = normalizeCrops(crops);
  writeStoredJSON(localStorageKeys.crops, state.crops);
  renderCropOptions();
  renderMeta();
  window.alert(`已导入 ${state.crops.length} 条作物生育期数据`);
}

/**
 * 导入术语 CSV。
 * @param {File} file 用户选择的文件
 */
export async function importGlossaryCSV(file) {
  const { records } = parseCSV(await readTextFile(file));
  const glossary = glossaryFromRows(records);
  if (glossary.length === 0) {
    window.alert('未解析到有效术语行。请确认列名包含：分类、术语、含义、对种植的影响');
    return;
  }
  state.glossary = glossary;
  writeStoredJSON(localStorageKeys.glossary, glossary);
  window.alert(`已导入 ${glossary.length} 条术语（已存本地，下次打开自动生效）`);
}

/** 导出肥料库为 CSV。 */
export function exportFertilizers() {
  return exportCsv('fertilizers.csv', toCSV(FERTILIZER_COLUMNS, fertilizersToRows(state.fertilizers)));
}

/** 导出作物库为 CSV。 */
export function exportCrops() {
  return exportCsv('crops.csv', toCSV(CROP_COLUMNS, cropsToRows(state.crops)));
}

/** 导出术语库为 CSV。 */
export function exportGlossary() {
  return exportCsv('glossary.csv', toCSV(GLOSSARY_COLUMNS, glossaryToRows(state.glossary)));
}

/* ============================ 术语词典 ============================ */

/** 打开术语词典面板。 */
export function openGlossary() {
  const searchInput = /** @type {HTMLInputElement} */ (byId('glossarySearch'));
  searchInput.value = '';
  renderGlossary('');
  byId('glossaryPanel').hidden = false;
  searchInput.focus();
}

/** 关闭术语词典面板。 */
export function closeGlossary() {
  byId('glossaryPanel').hidden = true;
}

/**
 * 渲染术语列表（支持关键词过滤）。
 * @param {string} keyword 搜索关键词
 */
export function renderGlossary(keyword) {
  const body = byId('glossaryBody');
  body.innerHTML = glossaryTemplate(state.glossary, keyword);
  const shown = body.querySelectorAll('.glossary-item').length;
  byId('glossaryFoot').textContent = `显示 ${shown} / ${state.glossary.length} 条术语。`
    + '每条都给出「含义」与「对种植的影响」——后者是本工具最想让你看到的部分。';
}

/* ============================ 数据编辑器 ============================ */

/**
 * 打开编辑器。
 * @param {string} mode `EDITOR_MODE.FERTILIZER` 或 `EDITOR_MODE.CROP`
 */
export function openEditor(mode) {
  state.editing = mode;
  if (mode === EDITOR_MODE.FERTILIZER) {
    state.draft = state.fertilizers.map((item) => ({ ...deepClone(item), comp: [...item.comp] }));
  } else {
    state.draft = state.crops.map((item) => ({ ...deepClone(item), target: [...item.target] }));
  }
  byId('editor').hidden = false;
  renderEditor();
}

/** 关闭编辑器（丢弃草稿）。 */
export function closeEditor() {
  byId('editor').hidden = true;
  state.editing = null;
  state.draft = null;
}

/** 渲染编辑器表格。 */
export function renderEditor() {
  if (state.draft === null) {
    return;
  }

  if (state.editing === EDITOR_MODE.FERTILIZER) {
    byId('editorTitle').textContent = '编辑肥料库';
    byId('editorHint').textContent = '改「化学式」或「纯度」会立即重算右侧元素含量；「标准」=1 者会被智能推荐优先选用';
    byId('editorTable').innerHTML = fertilizerEditorTemplate(state.draft);
    byId('editorFoot').innerHTML = `共 <b>${state.draft.length}</b> 种肥料。元素含量列<b>由化学式自动计算</b>，`
      + '不需手填；加新肥料只需填化学式。改动点「保存改动」后生效。';

    byId('editorTable').querySelectorAll('input,select').forEach((node) => {
      const element = /** @type {HTMLInputElement | HTMLSelectElement} */ (node);
      const handler = () => {
        const row = toNumber(element.dataset.row, -1);
        const field = element.dataset.field ?? '';
        if (row < 0 || field === '') {
          return;
        }
        const target = state.draft[row];
        if (element instanceof HTMLInputElement && element.type === 'checkbox') {
          target[field] = element.checked;
        } else if (element instanceof HTMLInputElement && element.type === 'number') {
          target[field] = toNumber(element.value, 0);
        } else {
          target[field] = element.value;
        }
        if (field === 'formula' || field === 'purity') {
          recalculateFertilizerRow(row);
        }
      };
      element.addEventListener('input', handler);
      element.addEventListener('change', handler);
    });
  } else {
    byId('editorTitle').textContent = '编辑作物库';
    byId('editorHint').textContent = '每行 = 一个作物的一个生育期；元素单位为 mg/L (ppm)';
    byId('editorTable').innerHTML = cropEditorTemplate(state.draft);
    const kinds = new Set(state.draft.map((crop) => crop.crop)).size;
    byId('editorFoot').innerHTML = `共 <b>${state.draft.length}</b> 条（${kinds} 个作物/配方组）。`
      + '可整行复制粘贴数值，适合同一套体系批量录入。';

    byId('editorTable').querySelectorAll('input').forEach((node) => {
      const element = /** @type {HTMLInputElement} */ (node);
      element.addEventListener('input', () => {
        const row = toNumber(element.dataset.row, -1);
        if (row < 0) {
          return;
        }
        const targetIndex = element.dataset.target;
        if (targetIndex !== undefined) {
          state.draft[row].target[toNumber(targetIndex, 0)] = toNumber(element.value, 0);
          return;
        }
        const field = element.dataset.field ?? '';
        if (field !== '') {
          state.draft[row][field] = element.value;
        }
      });
    });
  }

  byId('editorTable').querySelectorAll('[data-delete]').forEach((node) => {
    node.addEventListener('click', () => {
      const row = toNumber(/** @type {HTMLElement} */ (node).dataset.delete, -1);
      if (row >= 0 && state.draft !== null) {
        state.draft.splice(row, 1);
        renderEditor();
      }
    });
  });
}

/**
 * 化学式/纯度变化后重算该行 16 个元素含量。
 * @param {number} row 行下标
 */
export function recalculateFertilizerRow(row) {
  if (state.draft === null) {
    return;
  }
  const fertilizer = state.draft[row];
  const rawFormula = fertilizer.formula === '(螯合物，按标称含量)' ? '-' : fertilizer.formula;
  const calculated = calculateComposition(rawFormula, fertilizer.purity, fertilizer.overrides ?? null);

  fertilizer.comp = [...calculated.composition];
  fertilizer.form = calculated.form;
  fertilizer.formHint = calculated.formHint;

  const tableRow = byId('editorTable').querySelector(`tr[data-row="${row}"]`);
  if (tableRow === null) {
    return;
  }
  ELEMENTS.forEach((_, elementIndex) => {
    const cell = tableRow.querySelector(`[data-calc="${row}-${elementIndex}"]`);
    if (cell !== null) {
      cell.textContent = formatEditorNumber(fertilizer.comp[elementIndex]);
    }
  });
  const formCell = tableRow.querySelector(`[data-form="${row}"]`);
  if (formCell !== null) {
    formCell.textContent = fertilizer.form ?? '';
  }
}

/** @param {unknown} value 数值 @returns {string} */
function formatEditorNumber(value) {
  const parsed = toNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) {
    return '';
  }
  if (Math.abs(parsed) < 1e-9) {
    return '0';
  }
  return String(Number(parsed.toFixed(4)));
}

/** 在编辑器中新增一行。 */
export function addRow() {
  if (state.draft === null) {
    return;
  }

  if (state.editing === EDITOR_MODE.FERTILIZER) {
    state.draft.push({
      name: '新肥料',
      formula: 'KNO3',
      category: '大量',
      purity: 1,
      std: false,
      note: '',
      comp: new Array(ELEMENTS.length).fill(0),
      form: '',
      formHint: '',
    });
  } else {
    state.draft.push({
      crop: '新作物',
      stage: '全期',
      target: new Array(ELEMENTS.length).fill(0),
      ec: '',
      phMin: '',
      phMax: '',
      note: '',
      source: '',
    });
  }

  renderEditor();
  const body = document.querySelector('.panel-body');
  if (body !== null) {
    body.scrollTop = body.scrollHeight;
  }
}

/** 保存编辑器草稿到状态与浏览器本地存储。 */
export function saveEditor() {
  if (state.draft === null) {
    return;
  }

  if (state.editing === EDITOR_MODE.FERTILIZER) {
    state.fertilizers = normalizeFertilizers(state.draft);
    state.selected.clear();
    writeStoredJSON(localStorageKeys.fertilizers, state.fertilizers);
    renderFertilizerList();
  } else {
    state.crops = normalizeCrops(state.draft);
    writeStoredJSON(localStorageKeys.crops, state.crops);
    renderCropOptions();
  }

  state.draft = null;
  renderMeta();
  byId('dataStatus').textContent = `✓ 已保存到浏览器本地（${new Date().toLocaleTimeString()}）——下次打开自动生效`;
}

/** 丢弃本地修改，恢复内置数据。 */
export function resetData() {
  if (!window.confirm('将丢弃所有本地修改，恢复程序内置的肥料库与作物库。确定吗？')) {
    return;
  }
  localStorage.removeItem(localStorageKeys.fertilizers);
  localStorage.removeItem(localStorageKeys.crops);
  localStorage.removeItem(localStorageKeys.glossary);
  state.fertilizers = normalizeFertilizers(deepClone(state.builtin.fertilizers));
  state.crops = normalizeCrops(deepClone(state.builtin.crops));
  state.glossary = deepClone(state.builtin.glossary);
  state.selected.clear();
  renderFertilizerList();
  renderCropOptions();
  renderMeta();
  byId('dataStatus').textContent = `已恢复内置数据（${state.fertilizers.length} 种肥料 / `
    + `${state.crops.length} 条作物 / ${state.glossary.length} 条术语）`;
}

/* ============================ 初始化 ============================ */

/**
 * 启动时必须存在的元素 id。
 *
 * 缺任何一个，后续的 `byId(...).addEventListener` 都会抛异常，
 * 而用户看到的只是**白屏**、没有任何提示——所以先在入口集中校验一次。
 */
const REQUIRED_ELEMENT_IDS = Object.freeze([
  'contentArea', 'view-calc', 'view-data', 'dataMeta',
  'data-fertilizers', 'data-crops', 'data-glossary',
  'selCrop', 'selStage', 'volume', 'concentrate', 'targetGrid', 'waterGrid',
  'fertList', 'fertCount', 'btnCalc', 'btnPrint', 'btnExportExcel', 'btnAutoPick', 'resultBox',
  'editor', 'editorTable', 'glossaryPanel', 'glossaryBody',
]);

/**
 * 找出模板里缺失的必要元素。
 * @returns {string[]} 缺失的元素 id
 */
function findMissingElements() {
  return REQUIRED_ELEMENT_IDS.filter((id) => document.getElementById(id) === null);
}

/** 绑定所有界面事件并完成首次渲染。 */
export function init() {
  const missing = findMissingElements();
  if (missing.length > 0) {
    console.error('模板缺少必要元素：', missing);
    document.body.textContent = `界面加载失败：模板缺少元素 ${missing.join('、')}。`
      + '请重新构建（npm run build）后再打开。';
    return;
  }

  loadFromInline();
  renderTargets();
  renderWater();
  renderCropOptions();
  renderFertilizerList();

  // 顶部导入 / 导出
  byId('btnImportFert').addEventListener('click', () => byId('fileFert').click());
  byId('btnImportCrop').addEventListener('click', () => byId('fileCrop').click());
  byId('btnExportFert').addEventListener('click', exportFertilizers);
  bindFileInput('fileFert', importFertilizerCSV);
  bindFileInput('fileCrop', importCropCSV);

  // 作物 / 生育期：切换即自动载入该阶段的目标浓度
  byId('selCrop').addEventListener('change', handleCropChange);
  byId('selStage').addEventListener('change', handleStageChange);
  byId('btnLoadTarget').addEventListener('click', () => syncTargetsFromStage(false));

  // 目标浓度快捷操作
  byId('btnClearTarget').addEventListener('click', () => {
    state.targets = new Array(ELEMENTS.length).fill(0);
    renderTargets();
  });
  byId('btnHalfTarget').addEventListener('click', () => {
    state.targets = state.targets.map((value, index) => (
      MACRO_ELEMENTS.includes(ELEMENTS[index]) ? value / 2 : value
    ));
    renderTargets();
  });

  // 原料选择
  byId('btnAutoPick').addEventListener('click', runAutoPick);
  byId('btnSelectMacro').addEventListener('click', () => {
    state.selected = new Set(state.fertilizers
      .map((fertilizer, index) => (fertilizer.category === '微量' ? -1 : index))
      .filter((index) => index >= 0));
    renderFertilizerList();
  });
  byId('btnSelectAll').addEventListener('click', () => {
    state.selected = new Set(state.fertilizers.map((_, index) => index));
    renderFertilizerList();
  });
  byId('btnSelectNone').addEventListener('click', () => {
    state.selected = new Set();
    renderFertilizerList();
  });

  // 计算、导出与打印
  byId('btnCalc').addEventListener('click', runCalculation);
  byId('btnExportExcel').addEventListener('click', exportRecipeExcel);
  byId('btnPrint').addEventListener('click', printRecipe);

  // 左侧导航
  for (const navButton of document.querySelectorAll('.nav-item')) {
    navButton.addEventListener('click', () => switchView(navButton.dataset.view ?? 'calc'));
  }

  // 术语词典
  const glossarySearchInput = /** @type {HTMLInputElement} */ (byId('glossarySearch'));
  byId('btnGlossary').addEventListener('click', openGlossary);
  byId('btnGlossaryClose').addEventListener('click', closeGlossary);
  glossarySearchInput.addEventListener('input', () => renderGlossary(glossarySearchInput.value));

  // 数据管理
  byId('btnOpenFert').addEventListener('click', () => openEditor(EDITOR_MODE.FERTILIZER));
  byId('btnOpenCrop').addEventListener('click', () => openEditor(EDITOR_MODE.CROP));
  byId('btnEditorClose').addEventListener('click', closeEditor);
  byId('btnEditorSave').addEventListener('click', saveEditor);
  byId('btnEditorAdd').addEventListener('click', addRow);
  // 导出肥料 / 作物的按钮绑定在 init 顶部；这里只补术语导出、术语导入与恢复内置数据
  byId('btnExportGlossary').addEventListener('click', exportGlossary);
  byId('btnImportGlossary').addEventListener('click', () => byId('fileGlossary').click());
  bindFileInput('fileGlossary', importGlossaryCSV);
  byId('btnResetData').addEventListener('click', resetData);

  // 首屏载入第一个生育期的目标，让用户立即看到完整流程
  syncTargetsFromStage(true);

  // 首屏：自动推荐原料并计算一次，让用户打开即看到完整结果
  if (state.targets.some((value) => value > 0)) {
    runAutoPick();
    runCalculation();
  }

  // 供自动化测试与二次开发使用的显式命名空间
  globalThis.__HYDROPONIC__ = {
    state,
    compute, autoPick, calculateComposition,
    loadFromInline, renderTargets, renderFertilizerList, renderCropOptions, renderEditor,
    openEditor, closeEditor, addRow, saveEditor, resetData, recalculateFertilizerRow,
    runAutoPick, runCalculation, currentStage, EDITOR_MODE,
    syncTargetsFromStage, openGlossary, closeGlossary, renderGlossary,
  };
}

/**
 * 绑定文件选择控件。
 * @param {string} inputId 控件 id
 * @param {(file: File) => Promise<void>} handler 处理函数
 */
function bindFileInput(inputId, handler) {
  const input = /** @type {HTMLInputElement} */ (byId(inputId));
  input.addEventListener('change', () => {
    const file = input.files === null ? undefined : input.files[0];
    if (file !== undefined) {
      handler(file).catch((error) => {
        console.error('导入失败', error);
        window.alert(`导入失败：${error instanceof Error ? error.message : String(error)}`);
      });
    }
    input.value = '';
  });
}

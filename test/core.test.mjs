/**
 * core 层单元测试（Node 原生 test runner，零测试框架依赖）。
 * 运行：npm test
 *
 * 这些测试之所以能脱离浏览器运行，正是因为 core 层不接触 DOM。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELEMENTS, MACRO_ELEMENTS, MICRO_ELEMENTS } from '../src/core/constants.js';
import {
  toNumber, positiveNumber, formatNumber, formatQuantity, formatFixed, escapeHtml,
} from '../src/core/utils.js';
import { calculateComposition, parseFormula, hydrateCount, anhydrousFormula, splitNitrogen } from '../src/core/chem.js';
import { solveLeastSquares } from '../src/core/solver.js';
import { compute, autoPick } from '../src/core/calculator.js';
import {
  parseCSV, toCSV, fertilizersFromRows, cropsFromRows, fertilizersToRows,
  glossaryFromRows, glossaryToRows,
} from '../src/core/data.js';
import {
  targetGridTemplate, resultTemplate, glossaryTemplate, formatFormula,
} from '../src/ui/html.js';
import { estimateColumnWidths, buildXlsx } from '../src/core/xlsx.js';
import { recipeSheets } from '../src/ui/sheets.js';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 读取项目 data 目录中的 CSV 并解析为肥料对象。 */
function loadFertilizers() {
  const text = fs.readFileSync(path.join(projectDir, 'data', 'fertilizers.csv'), 'utf8');
  return fertilizersFromRows(parseCSV(text).records);
}

/** 读取作物数据。 */
function loadCrops() {
  const text = fs.readFileSync(path.join(projectDir, 'data', 'crops.csv'), 'utf8');
  return cropsFromRows(parseCSV(text).records);
}

/** 取某元素的含量。 */
const elementOf = (composition, element) => composition[ELEMENTS.indexOf(element)];

describe('core/utils：数值边界', () => {
  test('toNumber 不会把 0 当成缺失', () => {
    assert.equal(toNumber(0, 99), 0);
    assert.equal(toNumber('0', 99), 0);
  });

  test('toNumber 对非法输入返回兜底值', () => {
    assert.equal(toNumber('abc', 7), 7);
    assert.equal(toNumber(null, 7), 7);
    assert.equal(toNumber(Number.NaN, 7), 7);
    assert.equal(toNumber(undefined, 7), 7);
  });

  test('positiveNumber 只接受正数（避免 || 把 0 变成兜底值）', () => {
    assert.equal(positiveNumber(0, 1), 1);
    assert.equal(positiveNumber(-5, 1), 1);
    assert.equal(positiveNumber('2.5', 1), 2.5);
  });

  test('formatQuantity 按量级选择小数位', () => {
    assert.equal(formatQuantity(123.456), '123.5');
    assert.equal(formatQuantity(12.3456), '12.35');
    assert.equal(formatQuantity(0.1234), '0.123');
    assert.equal(formatQuantity(0), '0');
  });

  test('escapeHtml 转义模板注入字符', () => {
    assert.equal(escapeHtml('<img src=x onerror="1">'), '&lt;img src=x onerror=&quot;1&quot;&gt;');
  });

  // 数值列表格必须逐位对齐，所以需要固定小数位而不是按量级切换精度
  test('formatFixed 固定小数位（同列末位对齐用）', () => {
    assert.equal(formatFixed(210.64, 2), '210.64');
    // 注意：30.955 的双精度表示略小于 30.955，因此 toFixed 得 30.95 而非 30.96
    assert.equal(formatFixed(30.955, 2), '30.95');
    assert.equal(formatFixed(0.5, 2), '0.50');
    assert.equal(formatFixed(0, 2), '0', '零显示为 0 而不是 0.00');
    assert.equal(formatFixed('abc', 2), '', '无法解析返回空串');
  });
});

describe('core/chem：化学式解析与成分计算', () => {
  test('parseFormula 支持括号与结晶水', () => {
    assert.deepEqual(parseFormula('KNO3'), { K: 1, N: 1, O: 3 });
    assert.deepEqual(parseFormula('Ca(NO3)2'), { Ca: 1, N: 2, O: 6 });
    assert.deepEqual(parseFormula('MgSO4·7H2O'), { Mg: 1, S: 1, O: 11, H: 14 });
  });

  test('hydrateCount / anhydrousFormula 识别结晶水形态', () => {
    assert.equal(hydrateCount('MgSO4·7H2O'), 7);
    assert.equal(hydrateCount('Ca(NO3)2·4H2O'), 4);
    assert.equal(hydrateCount('Na2MoO4·2H2O'), 2);
    assert.equal(hydrateCount('KNO3'), 0);
    assert.equal(anhydrousFormula('MgSO4·7H2O'), 'MgSO4');
    assert.equal(anhydrousFormula('KNO3'), null);
  });

  test('splitNitrogen 自动拆分硝态/铵态氮', () => {
    assert.deepEqual(splitNitrogen('KNO3'), { nitrate: 1, ammonium: 0 });
    assert.deepEqual(splitNitrogen('NH4H2PO4'), { nitrate: 0, ammonium: 1 });
    assert.deepEqual(splitNitrogen('(NH4)2SO4'), { nitrate: 0, ammonium: 1 });
    assert.deepEqual(splitNitrogen('NH4NO3'), { nitrate: 0.5, ammonium: 0.5 });
  });

  // 与教科书/肥料标签公认值对照
  const knownValues = [
    ['KNO3', { K: 38.67, 'NO3-N': 13.85 }],
    ['KH2PO4', { K: 28.73, P: 22.76 }],
    ['Ca(NO3)2·4H2O', { Ca: 16.97, 'NO3-N': 11.86 }],
    ['MgSO4·7H2O', { Mg: 9.86, S: 13.01 }],
    ['K2SO4', { K: 44.87, S: 18.40 }],
    ['H3BO3', { B: 17.48 }],
    ['(NH4)2SO4', { 'NH4-N': 21.20, S: 24.26 }],
  ];

  for (const [formula, expected] of knownValues) {
    test(`${formula} 的元素含量与公认值一致（±0.05%）`, () => {
      const { composition } = calculateComposition(formula, 1);
      for (const [element, value] of Object.entries(expected)) {
        const actual = elementOf(composition, element);
        assert.ok(
          Math.abs(actual - value) < 0.05,
          `${element}: 计算 ${actual} 与公认 ${value} 偏差过大`,
        );
      }
    });
  }

  test('纯度会折算进有效含量', () => {
    const pure = calculateComposition('H3PO4', 1);
    const industrial = calculateComposition('H3PO4', 0.85);
    // 成分按 4 位小数存储，故容差取 1e-3
    const expected = elementOf(pure.composition, 'P') * 0.85;
    assert.ok(
      Math.abs(elementOf(industrial.composition, 'P') - expected) < 1e-3,
      `85% 磷酸的 P 应为 ${expected}，实际 ${elementOf(industrial.composition, 'P')}`,
    );
  });

  test('螯合物使用标称含量', () => {
    const { composition, form } = calculateComposition('-', 1, { Fe: 13 });
    assert.equal(elementOf(composition, 'Fe'), 13);
    assert.match(form, /螯合物/);
  });

  test('结晶水形态会给出含量变化提示', () => {
    const { form, formHint } = calculateComposition('MgSO4·7H2O', 1);
    assert.equal(form, '七水合物');
    assert.match(formHint, /20\.19/);        // 无水 MgSO4 的 Mg 含量
    assert.match(formHint, /2\.05/);          // 约 2.05 倍
  });

  test('未知元素或空化学式返回全零，不抛异常', () => {
    const { composition } = calculateComposition('', 1);
    assert.ok(composition.every((value) => value === 0));
  });
});

describe('core/solver：最小二乘求解', () => {
  test('方阵可精确求解', () => {
    const matrix = [[2, 0], [0, 4]];
    const { x } = solveLeastSquares(matrix, [2, 8], 1e-12);
    assert.ok(Math.abs(x[0] - 1) < 1e-9);
    assert.ok(Math.abs(x[1] - 2) < 1e-9);
  });

  test('超定系统给出最小二乘解', () => {
    // 完全共线：y = 2x，取三个点，期望斜率 2、截距 0
    const matrix = [[1, 1], [1, 2], [1, 3]];
    const { x } = solveLeastSquares(matrix, [2, 4, 6], 1e-12);
    assert.ok(Math.abs(x[0]) < 1e-8, `截距应为 0，实际 ${x[0]}`);
    assert.ok(Math.abs(x[1] - 2) < 1e-8, `斜率应为 2，实际 ${x[1]}`);
  });

  test('欠定系统给出最小范数解（这是 ALGLIB SVD 语义的关键）', () => {
    // 1 个方程、2 个未知数：x0 + x1 = 2，最小范数解应为 (1, 1)
    const { x } = solveLeastSquares([[1, 1]], [2], 1e-12);
    assert.ok(Math.abs(x[0] - 1) < 1e-8, `x0 应为 1，实际 ${x[0]}`);
    assert.ok(Math.abs(x[1] - 1) < 1e-8, `x1 应为 1，实际 ${x[1]}`);
    assert.ok(Math.abs((x[0] + x[1]) - 2) < 1e-8);
  });

  test('秩亏矩阵不产生 NaN', () => {
    const matrix = [[1, 2], [2, 4]];
    const { x } = solveLeastSquares(matrix, [1, 2], 1e-12);
    assert.ok(x.every((value) => Number.isFinite(value)));
  });
});

describe('core/calculator：端到端配方计算', () => {
  const fertilizers = loadFertilizers();
  const crops = loadCrops();

  test('数据文件可被解析', () => {
    assert.ok(fertilizers.length >= 30, `肥料库应有 30 种以上，实际 ${fertilizers.length}`);
    assert.ok(crops.length >= 30, `作物库应有 30 条以上，实际 ${crops.length}`);
  });

  test('智能推荐会包含标准组合（硝酸钾、硝酸钙、硫酸镁、磷酸二氢钾）', () => {
    const crop = crops.find((item) => item.crop === '番茄' && item.stage.includes('盛果'));
    assert.ok(crop !== undefined, '应能找到番茄盛果期数据');

    const result = autoPick({ targets: crop.target, water: crop.target.map(() => 0), fertilizers, volume: 100 });
    const names = result.selected.map((index) => fertilizers[index].name).join('|');
    for (const expected of ['硝酸钾', '硝酸钙', '硫酸镁', '磷酸二氢钾']) {
      assert.match(names, new RegExp(expected), `推荐组合应包含 ${expected}，实际：${names}`);
    }
  });

  test('每个大量元素都在推荐组合中有「大量」类来源（分域约束）', () => {
    // 分域约束的含义是：大量元素的目标只能由「大量」类原料去满足，
    // 而不是「微量类原料不能含任何大量元素」——微量盐附带硫、钠是正常的。
    const crop = crops.find((item) => item.crop === '番茄');
    const result = autoPick({ targets: crop.target, water: crop.target.map(() => 0), fertilizers, volume: 100 });

    for (const macro of MACRO_ELEMENTS) {
      const position = ELEMENTS.indexOf(macro);
      if (crop.target[position] <= 0) {
        continue;
      }
      const hasMacroSource = result.selected.some((index) => (
        fertilizers[index].category !== '微量' && fertilizers[index].comp[position] > 0
      ));
      assert.ok(hasMacroSource, `${macro} 在推荐组合中缺少「大量」类来源`);
    }
  });

  test('微量元素不会由「大量」类原料来满足', () => {
    // 反向验证：钼酸铵事故的根因是「用微量肥料补大量元素」，
    // 其对称错误是「用大量肥料补微量元素」（例如靠硝酸钙补铁）。
    const crop = crops.find((item) => item.crop === '番茄');
    const result = autoPick({ targets: crop.target, water: crop.target.map(() => 0), fertilizers, volume: 100 });

    for (const micro of MICRO_ELEMENTS) {
      const position = ELEMENTS.indexOf(micro);
      if (crop.target[position] <= 0) {
        continue;
      }
      const sources = result.selected.filter((index) => fertilizers[index].comp[position] > 0);
      assert.ok(sources.length > 0, `${micro} 缺少来源`);
      assert.ok(
        sources.some((index) => fertilizers[index].category === '微量'),
        `${micro} 的全部来源都不是「微量」类原料`,
      );
    }
  });

  test('番茄盛果期：所有目标元素偏差 ≤ 1%', () => {
    const crop = crops.find((item) => item.crop === '番茄' && item.stage.includes('盛果'));
    const picked = autoPick({ targets: crop.target, water: crop.target.map(() => 0), fertilizers, volume: 100 });

    const result = compute({
      targets: crop.target,
      water: crop.target.map(() => 0),
      fertilizers,
      selected: picked.selected,
      volume: 100,
      concentrate: 1,
    });

    assert.equal(result.error, undefined);
    assert.deepEqual(result.missing, [], `不应有无法提供的元素：${result.missing}`);

    crop.target.forEach((target, index) => {
      if (target <= 0) {
        return;
      }
      const deviation = Math.abs((result.actual[index] - target) / target) * 100;
      assert.ok(
        deviation <= 1,
        `${ELEMENTS[index]} 偏差 ${deviation.toFixed(2)}% 超过 1%（目标 ${target}，实际 ${result.actual[index]}）`,
      );
    });
  });

  test('解出的用量全部非负（非负迭代生效）', () => {
    const crop = crops.find((item) => item.crop === '番茄');
    const picked = autoPick({ targets: crop.target, water: crop.target.map(() => 0), fertilizers, volume: 100 });
    const result = compute({
      targets: crop.target,
      water: crop.target.map(() => 0),
      fertilizers,
      selected: picked.selected,
      volume: 100,
      concentrate: 1,
    });
    for (const item of result.usage) {
      assert.ok(item.grams >= -1e-6, `${item.fertilizer.name} 用量为负：${item.grams}`);
    }
  });

  test('水源本底会从目标中扣除', () => {
    const crop = crops.find((item) => item.crop === '番茄');
    const water = crop.target.map(() => 0);
    water[ELEMENTS.indexOf('Ca')] = 40;                 // 自来水自带 40 ppm 钙

    const picked = autoPick({ targets: crop.target, water, fertilizers, volume: 100 });
    const result = compute({ targets: crop.target, water, fertilizers, selected: picked.selected, volume: 100, concentrate: 1 });

    const calciumIndex = ELEMENTS.indexOf('Ca');
    assert.ok(Math.abs(result.actual[calciumIndex] - crop.target[calciumIndex]) / crop.target[calciumIndex] < 0.05);
    assert.equal(result.demand[calciumIndex], crop.target[calciumIndex] - 40);
  });

  test('未选原料时返回明确错误而不是抛异常', () => {
    const result = compute({ targets: new Array(ELEMENTS.length).fill(0), fertilizers, selected: [], volume: 100 });
    assert.ok(typeof result.error === 'string');
  });
});

describe('core/data：CSV 编解码', () => {
  test('parseCSV 处理引号、逗号与 BOM', () => {
    const text = '\uFEFF名称,备注\r\n"含水, 逗号","引号""转义"""\r\n';
    const { header, records } = parseCSV(text);
    assert.deepEqual(header, ['名称', '备注']);
    assert.equal(records[0]['名称'], '含水, 逗号');
    assert.equal(records[0]['备注'], '引号"转义"');
  });

  test('toCSV → parseCSV 往返一致', () => {
    const original = loadFertilizers();
    const rows = fertilizersToRows(original);
    const roundTripped = fertilizersFromRows(parseCSV(toCSV(Object.keys(rows[0]), rows)).records);
    assert.equal(roundTripped.length, original.length);
    assert.equal(roundTripped[0].name, original[0].name);
    assert.ok(Math.abs(roundTripped[0].comp[0] - original[0].comp[0]) < 1e-6);
  });

  test('空输入不会抛异常', () => {
    assert.deepEqual(parseCSV('').records, []);
    assert.deepEqual(fertilizersFromRows([]), []);
  });

  test('术语 CSV 往返一致（支撑页面内导入/导出）', () => {
    const original = [
      { category: '营养元素', term: 'K（钾）', meaning: '调节水分运输', impact: '决定果实甜度' },
    ];
    const rows = glossaryToRows(original);
    const roundTripped = glossaryFromRows(parseCSV(toCSV(Object.keys(rows[0]), rows)).records);
    assert.equal(roundTripped.length, 1);
    assert.equal(roundTripped[0].term, 'K（钾）');
    assert.equal(roundTripped[0].impact, '决定果实甜度');
  });
});

describe('ui/html：模板函数（纯字符串，可脱离浏览器测试）', () => {
  test('目标网格会生成 16 个输入框', () => {
    const html = targetGridTemplate(new Array(ELEMENTS.length).fill(1));
    assert.equal((html.match(/<input/g) ?? []).length, ELEMENTS.length);
  });

  test('结果模板对错误结果显示提示而非抛异常', () => {
    const html = resultTemplate({ error: '请先选择至少一种原料。' }, new Array(16).fill(0), new Array(16).fill(0));
    assert.match(html, /请先选择至少一种原料/);
  });

  /** 造一个最小的计算结果对象（只填被测字段，其余给安全默认值）。 */
  const makeResult = (overrides = {}) => ({
    volume: 100,
    concentrate: 1,
    usage: [],
    actual: new Array(ELEMENTS.length).fill(0),
    demand: new Array(ELEMENTS.length).fill(0),
    missing: [],
    removed: [],
    iterations: 0,
    activeCount: 0,
    ...overrides,
  });

  /** 造一个只有 K 有目标/实际值的场景。 */
  const potassiumOnly = (targetValue, actualValue) => {
    const targets = new Array(ELEMENTS.length).fill(0);
    const actual = new Array(ELEMENTS.length).fill(0);
    const position = ELEMENTS.indexOf('K');
    targets[position] = targetValue;
    actual[position] = actualValue;
    return { targets, actual };
  };

  test('用量表过滤掉低于可称量阈值的原料（不再出现 0 值行）', () => {
    const usage = [
      { fertilizer: { name: '有效项', formula: 'X', comp: new Array(16).fill(0) }, grams: 1, gramsPerLiter: 0.01, index: 0 },
      { fertilizer: { name: '噪声项', formula: 'Y', comp: new Array(16).fill(0) }, grams: 1e-6, gramsPerLiter: 1e-8, index: 1 },
    ];
    const html = resultTemplate(makeResult({ usage }), new Array(16).fill(0), new Array(16).fill(0));
    assert.match(html, /有效项/);
    assert.ok(!html.includes('噪声项'), '低于阈值的原料不应出现在用量表里');
  });

  test('偏差列不会输出 -0.0%（微小负偏差归零）', () => {
    const { targets, actual } = potassiumOnly(100, 99.96);   // 偏差 -0.04%
    const html = resultTemplate(makeResult({ actual }), targets, new Array(16).fill(0));
    assert.ok(!html.includes('-0.0%'), '不应出现 -0.0%');
    assert.match(html, /0\.0%/);
  });

  test('达成表默认收起，出现 >10% 偏差时才默认展开', () => {
    const normal = potassiumOnly(100, 99);
    const collapsed = resultTemplate(makeResult({ actual: normal.actual }), normal.targets, new Array(16).fill(0));
    assert.match(collapsed, /<details class="achieve">/);

    const abnormal = potassiumOnly(100, 50);                 // 偏差 -50%
    const expanded = resultTemplate(makeResult({ actual: abnormal.actual }), abnormal.targets, new Array(16).fill(0));
    assert.match(expanded, /<details class="achieve" open>/);
  });

  test('未填水源本底时不渲染该列（全 0 列属于无效信息）', () => {
    const { targets, actual } = potassiumOnly(100, 100);
    const html = resultTemplate(makeResult({ actual }), targets, new Array(16).fill(0));
    assert.ok(!html.includes('水源本底'), '未填水时不应出现水源本底列');
  });

  test('微量原料会给出母液取用建议（让家庭天平可执行）', () => {
    const usage = [{
      fertilizer: { name: '钼酸钠', formula: 'Na2MoO4·2H2O', comp: new Array(16).fill(0) },
      grams: 0.008,
      gramsPerLiter: 0.00008,
      index: 0,
    }];
    const html = resultTemplate(makeResult({ usage }), new Array(16).fill(0), new Array(16).fill(0));
    assert.match(html, /微量原料称量建议/);
    assert.match(html, /溶于 1 L 水配成母液/);
    assert.match(html, /取 <b>8\.0 mL<\/b>/, '0.008 g 应换算为「称 1 g、取 8.0 mL」');
  });

  test('结果模板会转义肥料名中的 HTML', () => {
    const result = {
      volume: 100,
      concentrate: 1,
      usage: [{ fertilizer: { name: '<script>x</script>', formula: 'X', comp: new Array(16).fill(0) }, grams: 1, gramsPerLiter: 0.01, index: 0 }],
      actual: new Array(16).fill(0),
      demand: new Array(16).fill(0),
      missing: [],
      removed: [],
      iterations: 0,
      activeCount: 1,
    };
    const html = resultTemplate(result, new Array(16).fill(0), new Array(16).fill(0));
    assert.ok(!html.includes('<script>x</script>'), '肥料名中的标签应被转义');
    assert.match(html, /&lt;script&gt;/);
  });
});

describe('ui/sheets：Excel 导出结构', () => {
  test('配方转成四张表，数字是数值类型、化学式用 Unicode 下标', () => {
    const fertilizers = loadFertilizers();
    const crops = loadCrops();
    const crop = crops.find((item) => item.crop === '番茄' && item.stage.includes('盛果'));
    assert.ok(crop !== undefined, '应能找到番茄盛果期数据');

    const water = new Array(ELEMENTS.length).fill(0);
    const picked = autoPick({ targets: crop.target, water, fertilizers, volume: 100 });
    const result = compute({
      targets: crop.target, water, fertilizers, selected: picked.selected, volume: 100, concentrate: 1,
    });

    const sheets = recipeSheets(result, crop.target, water, { crop: crop.crop, stage: crop.stage });

    assert.deepEqual(sheets.map((sheet) => sheet.name),
      ['配方信息', '原料用量', '目标达成', '形态核对']);

    const usage = sheets.find((sheet) => sheet.name === '原料用量');
    assert.equal(usage.rows[0][0].v, '原料');
    assert.equal(usage.rows[0][0].bold, true, '表头应加粗');

    const firstRow = usage.rows[1];
    assert.equal(typeof firstRow[2].v, 'number', '用量必须是数值，Excel 里才能继续计算');
    assert.ok(firstRow[2].v > 0);

    // 化学式在 Excel 里只能用 Unicode 下标（单元格不支持 <sub>）
    const hasSubscript = usage.rows.some(
      (row) => typeof row[1].v === 'string' && /[\u2080-\u2089]/.test(row[1].v),
    );
    assert.ok(hasSubscript, '化学式应含 Unicode 下标字符');

    // 每张表都算过列宽
    assert.ok(sheets.every((sheet) => Array.isArray(sheet.widths) && sheet.widths.length > 0));
  });

  test('生成的工作簿是合法 ZIP（PK 签名）', () => {
    const bytes = buildXlsx([{ name: 'A', rows: [[{ v: 'x' }]], widths: [10] }]);
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4B);
    assert.ok(bytes.length > 200);
  });

  test('空工作表列表会明确报错，而不是产出坏文件', () => {
    assert.throws(() => buildXlsx([]), /至少需要一张工作表/);
  });
});

describe('ui/html：化学式下标渲染', () => {
  test('原子个数转成 <sub>，数据本身仍是纯 ASCII', () => {
    assert.equal(formatFormula('KNO3'), 'KNO<sub>3</sub>');
    assert.equal(formatFormula('Ca(NO3)2·4H2O'), 'Ca(NO<sub>3</sub>)<sub>2</sub>·4H<sub>2</sub>O');
    assert.equal(formatFormula('C6H12O6'), 'C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>');
  });

  test('结晶水前的系数不当作下标（4H2O 的 4 保持原样）', () => {
    assert.equal(formatFormula('MgSO4·7H2O'), 'MgSO<sub>4</sub>·7H<sub>2</sub>O');
    assert.equal(formatFormula('Na2MoO4·2H2O'), 'Na<sub>2</sub>MoO<sub>4</sub>·2H<sub>2</sub>O');
  });

  test('仍然做 HTML 转义（不因换实现而失去防注入）', () => {
    assert.equal(formatFormula('<img src=x>'), '&lt;img src=x&gt;');
  });

  test('无数字或空串时原样返回', () => {
    assert.equal(formatFormula('NaCl'), 'NaCl');
    assert.equal(formatFormula(''), '');
  });
});

describe('ui/html：术语词典模板', () => {
  /** 造一组测试用术语。 */
  const sampleGlossary = [
    { category: '营养元素', term: 'NO3-N（硝态氮）', meaning: '硝态氮的含义', impact: '**促进**叶片生长' },
    { category: '营养元素', term: 'K（钾）', meaning: '钾的含义', impact: '决定果实品质' },
    { category: '浓度与单位', term: 'EC（电导率）', meaning: '总盐浓度的度量', impact: '偏高会烧根' },
  ];

  test('按分类分组渲染，并显示每类条数', () => {
    const html = glossaryTemplate(sampleGlossary);
    assert.match(html, /营养元素（2）/);
    assert.match(html, /浓度与单位（1）/);
    assert.equal((html.match(/class="glossary-item"/g) ?? []).length, 3);
  });

  test('同时输出「含义」与「对种植的影响」两栏', () => {
    const html = glossaryTemplate(sampleGlossary);
    assert.match(html, /class="label">含义</);
    assert.match(html, /class="label">对种植的影响</);
    // `**促进**` 应已渲染为标签，因此这里用带标签的形式断言
    assert.match(html, /<strong>促进<\/strong>叶片生长/);
  });

  test('`**重点**` 标记渲染为 <strong>', () => {
    const html = glossaryTemplate(sampleGlossary);
    assert.match(html, /<strong>促进<\/strong>/);
    assert.ok(!html.includes('**促进**'), '标记本身不应残留');
  });

  test('关键词过滤（匹配术语、含义与影响三处）', () => {
    assert.equal((glossaryTemplate(sampleGlossary, '钾').match(/class="glossary-item"/g) ?? []).length, 1);
    assert.equal((glossaryTemplate(sampleGlossary, '烧根').match(/class="glossary-item"/g) ?? []).length, 1);
    assert.equal((glossaryTemplate(sampleGlossary, '营养元素').match(/class="glossary-item"/g) ?? []).length, 2);
    assert.equal((glossaryTemplate(sampleGlossary, '不存在的词').match(/class="glossary-item"/g) ?? []).length, 0);
  });

  test('无匹配结果时给出提示而不是空面板', () => {
    const html = glossaryTemplate(sampleGlossary, '不存在的词');
    assert.match(html, /没有匹配/);
  });

  test('术语内容会做 HTML 转义（防注入）', () => {
    const malicious = [{ category: '<b>类</b>', term: '<script>alert(1)</script>', meaning: 'm', impact: 'i' }];
    const html = glossaryTemplate(malicious);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.match(html, /&lt;script&gt;/);
  });

  test('真实术语库可正常渲染（34 条 / 4 个分类）', () => {
    const glossaryPath = path.join(projectDir, 'data', 'glossary.csv');
    const { records } = parseCSV(fs.readFileSync(glossaryPath, 'utf8'));
    const glossary = records.map((record) => ({
      category: record['分类'],
      term: record['术语'],
      meaning: record['含义'],
      impact: record['对种植的影响'],
    }));

    assert.ok(glossary.length >= 30, `术语库应有 30 条以上，实际 ${glossary.length}`);
    const html = glossaryTemplate(glossary);
    assert.equal((html.match(/class="glossary-item"/g) ?? []).length, glossary.length);
    // 每条都必须有「对种植的影响」，否则术语解释就失去意义
    for (const entry of glossary) {
      assert.ok(entry.impact.length > 10, `术语「${entry.term}」缺少对种植的影响`);
    }
  });
});

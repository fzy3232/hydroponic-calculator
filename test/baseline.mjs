/**
 * 计算结果基线采集 / 比对工具。
 *
 * 用途：Tauri 版与 HTML 版必须给出**逐位一致**的用量与偏差。
 * 本脚本复用 core 层（零 DOM 依赖），在 Node 里直接算出代表性作物的结果并落盘，
 * 之后在任一版本上重跑同样的命令即可比对——不依赖浏览器，也不依赖 Tauri。
 *
 * 用法：
 *   node test/baseline.mjs --data <data目录> [--out baseline.json]   # 采集
 *   node test/baseline.mjs --data <data目录> --compare baseline.json # 比对
 *
 * 退出码：0 = 一致 / 采集成功；1 = 存在差异或读取失败。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELEMENTS } from '../src/core/constants.js';
import { parseCSV, fertilizersFromRows, cropsFromRows } from '../src/core/data.js';
import { compute, autoPick } from '../src/core/calculator.js';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 解析命令行参数。 */
function parseArguments(argv) {
  const options = { data: null, out: null, compare: null, volume: 100 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--data') {
      options.data = argv[index + 1];
      index += 1;
    } else if (token === '--out') {
      options.out = argv[index + 1];
      index += 1;
    } else if (token === '--compare') {
      options.compare = argv[index + 1];
      index += 1;
    } else if (token === '--volume') {
      options.volume = Number(argv[index + 1]);
      index += 1;
    }
  }
  return options;
}

/**
 * 采集指定数据目录下的基线结果。
 * @param {string} dataDir CSV 数据目录
 * @param {number} volume 配制体积（升）
 * @returns {Record<string, any>}
 */
function collectBaseline(dataDir, volume) {
  const readCSV = (name) => {
    const filePath = path.join(dataDir, name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`缺少数据文件：${filePath}`);
    }
    return parseCSV(fs.readFileSync(filePath, 'utf8')).records;
  };

  const fertilizers = fertilizersFromRows(readCSV('fertilizers.csv'));
  const crops = cropsFromRows(readCSV('crops.csv'));

  // 三个代表性作物：茄果类（盛果期高钾配方）、叶菜类（低浓度供给液）、瓜类
  const targets = [
    { crop: '番茄', stage: '第10花序后(盛果期)' },
    { crop: '生菜', stage: '供给液（全期）' },
    { crop: '黄瓜', stage: '营养生长期' },
  ];

  const cases = [];
  for (const wanted of targets) {
    const crop = crops.find((item) => item.crop === wanted.crop
      && (wanted.stage === '' || item.stage.includes(wanted.stage)));
    if (crop === undefined) {
      cases.push({ crop: wanted.crop, stage: wanted.stage, error: '未找到该作物数据' });
      continue;
    }

    const water = new Array(ELEMENTS.length).fill(0);
    const picked = autoPick({ targets: crop.target, water, fertilizers, volume });
    const result = compute({
      targets: crop.target,
      water,
      fertilizers,
      selected: picked.selected,
      volume,
      concentrate: 1,
    });

    cases.push({
      crop: crop.crop,
      stage: crop.stage,
      // 用量按原料名排序，避免顺序差异造成假失败
      usage: result.usage
        .filter((item) => item.grams >= 0.005)
        .map((item) => ({ name: item.fertilizer.name, grams: round(item.grams, 6) }))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      actual: result.actual.map((value) => round(value, 6)),
      deviations: crop.target.map((target, index) => (target > 0
        ? round((result.actual[index] - target) / target * 100, 6)
        : null)),
    });
  }

  return { volume, cases };
}

/**
 * 四舍五入到指定小数位，消除浮点尾差。
 * @param {number} value 数值
 * @param {number} digits 小数位
 * @returns {number}
 */
function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 逐项比对两份基线。 */
function compareBaseline(expected, actual) {
  const differences = [];
  if (expected.cases.length !== actual.cases.length) {
    differences.push(`用例数量不同：${expected.cases.length} vs ${actual.cases.length}`);
    return differences;
  }

  expected.cases.forEach((expectedCase, caseIndex) => {
    const actualCase = actual.cases[caseIndex];
    const label = `${expectedCase.crop}/${expectedCase.stage}`;

    // 采集阶段就失败的用例（例如数据里查不到该作物）没有 usage 字段，跳过逐项比对
    if (expectedCase.error !== undefined || actualCase.error !== undefined) {
      if (expectedCase.error !== actualCase.error) {
        differences.push(`${label}：状态不同 ${expectedCase.error ?? '正常'} vs ${actualCase.error ?? '正常'}`);
      }
      return;
    }

    if (expectedCase.usage.length !== actualCase.usage.length) {
      differences.push(`${label}：原料条目数不同 ${expectedCase.usage.length} vs ${actualCase.usage.length}`);
      return;
    }

    expectedCase.usage.forEach((expectedItem, itemIndex) => {
      const actualItem = actualCase.usage[itemIndex];
      if (expectedItem.name !== actualItem.name) {
        differences.push(`${label}：第 ${itemIndex + 1} 项原料名不同 ${expectedItem.name} vs ${actualItem.name}`);
      } else if (Math.abs(expectedItem.grams - actualItem.grams) > 1e-6) {
        differences.push(`${label}：${expectedItem.name} 用量不同 `
          + `${expectedItem.grams} vs ${actualItem.grams}`);
      }
    });

    expectedCase.actual.forEach((value, index) => {
      const other = actualCase.actual[index];
      if (value === null || other === null) {
        return;
      }
      if (Math.abs(value - other) > 1e-4) {
        differences.push(`${label}：${ELEMENTS[index]} 达成值不同 ${value} vs ${other}`);
      }
    });
  });

  return differences;
}

const options = parseArguments(process.argv.slice(2));
const dataDir = options.data === null ? path.join(projectDir, 'data') : options.data;

if (!fs.existsSync(dataDir)) {
  console.error(`数据目录不存在：${dataDir}`);
  process.exit(1);
}

const baseline = collectBaseline(dataDir, options.volume);

if (options.compare !== null) {
  if (!fs.existsSync(options.compare)) {
    console.error(`基线文件不存在：${options.compare}`);
    process.exit(1);
  }
  const expected = JSON.parse(fs.readFileSync(options.compare, 'utf8'));
  const differences = compareBaseline(expected, baseline);

  if (differences.length === 0) {
    console.log(`基线一致：${baseline.cases.length} 个用例、`
      + `${baseline.cases.reduce((sum, item) => sum + item.usage.length, 0)} 条原料用量完全吻合`);
    process.exit(0);
  }

  console.error(`发现 ${differences.length} 处差异：`);
  for (const difference of differences.slice(0, 20)) {
    console.error(`  - ${difference}`);
  }
  process.exit(1);
}

const outPath = options.out === null ? path.join(projectDir, 'test', 'baseline.json') : options.out;
fs.writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

console.log(`基线已写入：${outPath}`);
for (const item of baseline.cases) {
  if (item.error !== undefined) {
    console.log(`  ${item.crop}：${item.error}`);
    continue;
  }
  const total = item.usage.reduce((sum, entry) => sum + entry.grams, 0);
  console.log(`  ${item.crop} / ${item.stage}：${item.usage.length} 种原料，合计 ${total.toFixed(3)} g`
    + `（配制 ${baseline.volume} L）`);
}

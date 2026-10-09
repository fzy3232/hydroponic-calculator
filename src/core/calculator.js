/**
 * 配方计算核心：给定目标浓度与所选原料，倒算用量；并负责智能推荐原料组合。
 * 本模块为纯函数实现，不接触 DOM，可在 Node 中直接单元测试。
 *
 * @module core/calculator
 */

import { ELEMENTS, MICRO_ELEMENTS } from './constants.js';
import { solveLeastSquares } from './solver.js';
import { positiveNumber, toNumber } from './utils.js';

/** 非负迭代的收敛阈值（g）。 */
const NEGATIVE_TOLERANCE = -1e-7;

/** 相对截断阈值，传给最小二乘求解器。 */
const SOLVER_EPSILON = 1e-12;

/** 偏差驱动补料的触发阈值（相对偏差）。 */
const SUPPLEMENT_THRESHOLD = 0.05;

/** 偏差驱动补料的最大轮数。 */
const SUPPLEMENT_ROUNDS = 3;

/**
 * @typedef {Object} Fertilizer
 * @property {string} name 名称
 * @property {string} formula 化学式
 * @property {string} category '大量' | '微量'
 * @property {number} purity 纯度
 * @property {boolean} [std] 是否属于标准组合
 * @property {number[]} comp 16 个元素的质量分数（%）
 */

/**
 * @typedef {Object} ComputeParams
 * @property {number[]} targets 目标浓度（mg/L），长度 16
 * @property {number[]} [water] 水源本底（mg/L），长度 16
 * @property {Fertilizer[]} fertilizers 肥料库
 * @property {Iterable<number>} selected 选中的肥料下标
 * @property {number} [volume=1] 配制体积（升）
 * @property {number} [concentrate=1] 母液浓缩倍数
 */

/**
 * @typedef {Object} UsageItem
 * @property {Fertilizer} fertilizer 肥料
 * @property {number} grams 需要量（g）
 * @property {number} gramsPerLiter 每升工作液用量
 * @property {number} index 肥料在库中的下标
 */

/**
 * @typedef {Object} ComputeResult
 * @property {number} volume 配制体积
 * @property {number} concentrate 浓缩倍数
 * @property {UsageItem[]} usage 各原料用量
 * @property {number[]} actual 实际达成浓度（含水源本底）
 * @property {number[]} demand 需求浓度（目标 − 本底）
 * @property {string[]} missing 无任何原料可提供的目标元素
 * @property {Fertilizer[]} removed 因解为负值而被剔除的原料
 * @property {number} iterations 非负迭代次数
 * @property {number} activeCount 最终参与解算的原料数
 * @property {string} [error] 无法计算时的原因
 */

/**
 * 倒算原料用量。
 *
 * 算法要点：
 *  1. 需求 = 目标 − 水源本底；
 *  2. **按目标值归一化每一行** → 最小化相对偏差而非绝对偏差。
 *     否则 0.02 mg/L 的 Cu 会被 300 mg/L 的 K 完全淹没，微量元素被忽略甚至解成负值；
 *  3. 解出负用量时迭代剔除最负者后重解，保证结果物理上可执行。
 *
 * @param {ComputeParams} params 计算参数
 * @returns {ComputeResult}
 */
export function compute(params) {
  const volume = positiveNumber(params.volume, 1);
  const concentrate = Math.max(1, positiveNumber(params.concentrate, 1));
  const fertilizers = params.fertilizers ?? [];
  const targets = params.targets ?? new Array(ELEMENTS.length).fill(0);
  const water = params.water ?? new Array(ELEMENTS.length).fill(0);
  const selectedIndexes = Array.from(params.selected ?? [], (value) => toNumber(value, 0))
    .sort((left, right) => left - right);

  if (selectedIndexes.length === 0) {
    return { error: '请先选择至少一种原料。' };
  }

  /** 需求浓度 = 目标 − 水源本底，负值截为 0 */
  const demand = ELEMENTS.map((_, index) => Math.max(0, targets[index] - water[index]));

  /** 每 1 g 原料（溶于 volume 升）贡献的浓度 mg/L */
  const rawMatrix = ELEMENTS.map((_, elementIndex) => selectedIndexes.map(
    (fertilizerIndex) => (fertilizers[fertilizerIndex].comp[elementIndex] ?? 0) * 10 / volume,
  ));

  /** 行归一化权重：目标为 0 的元素不参与拟合 */
  const weights = demand.map((value) => (value > 1e-9 ? 1 / value : 0));
  const matrix = rawMatrix.map((row, index) => row.map((value) => value * weights[index]));
  const normalizedDemand = demand.map((value, index) => value * weights[index]);

  const missing = ELEMENTS.filter((_, elementIndex) => demand[elementIndex] > 1e-9
    && selectedIndexes.every((fertilizerIndex) => (fertilizers[fertilizerIndex].comp[elementIndex] ?? 0) <= 0));

  const activeIndexes = selectedIndexes.map((_, position) => position);
  let solution = [];
  const removedPositions = [];
  let iterations = 0;

  for (; iterations <= selectedIndexes.length; iterations += 1) {
    const subMatrix = matrix.map((row) => activeIndexes.map((position) => row[position]));
    solution = solveLeastSquares(subMatrix, normalizedDemand, SOLVER_EPSILON).x;

    let worstPosition = -1;
    let worstValue = NEGATIVE_TOLERANCE;
    solution.forEach((value, position) => {
      if (value < worstValue) {
        worstValue = value;
        worstPosition = position;
      }
    });

    if (worstPosition < 0) {
      break;
    }

    removedPositions.push(activeIndexes[worstPosition]);
    activeIndexes.splice(worstPosition, 1);

    if (activeIndexes.length === 0) {
      solution = [];
      break;
    }
  }

  const usage = activeIndexes.map((position, index) => {
    const fertilizer = fertilizers[selectedIndexes[position]];
    return {
      fertilizer,
      grams: solution[index],
      gramsPerLiter: solution[index] / volume,
      index: selectedIndexes[position],
    };
  });

  const removed = removedPositions.map((position) => fertilizers[selectedIndexes[position]]);

  const actual = ELEMENTS.map((_, elementIndex) => {
    let total = water[elementIndex];
    activeIndexes.forEach((position, index) => {
      total += solution[index] * (fertilizers[selectedIndexes[position]].comp[elementIndex] ?? 0) * 10 / volume;
    });
    return total;
  });

  return {
    volume,
    concentrate,
    usage,
    actual,
    demand,
    missing,
    removed,
    iterations,
    activeCount: activeIndexes.length,
  };
}

/**
 * @typedef {Object} AutoPickParams
 * @property {number[]} targets 目标浓度
 * @property {number[]} [water] 水源本底
 * @property {Fertilizer[]} fertilizers 肥料库
 * @property {number} [volume=100] 计算偏差时使用的体积
 */

/**
 * @typedef {Object} AutoPickResult
 * @property {number[]} selected 推荐的肥料下标
 * @property {string[]} uncovered 没有任何原料可提供的元素
 * @property {string[]} steps 推荐过程说明（便于界面展示与排查）
 */

/**
 * 智能推荐原料组合。
 *
 * 四个阶段：
 *  1. 只用「标准组合」（行业通用原料集）按**需求量加权**贪心覆盖；
 *  2. 放开到全部原料，补齐标准组合未覆盖的元素（如铵态氮）；
 *  3. 分域约束：大量元素只由「大量」类提供，微量元素只由「微量」类提供
 *     —— 避免「用钼酸铵补铵态氮导致钼超标百倍」这类组合；
 *  4. 偏差驱动补料：对求解后仍不足的元素，补入「引入其他元素最少」的原料再解。
 *
 * @param {AutoPickParams} params 推荐参数
 * @returns {AutoPickResult}
 */
export function autoPick(params) {
  const fertilizers = params.fertilizers ?? [];
  const targets = params.targets ?? new Array(ELEMENTS.length).fill(0);
  const water = params.water ?? new Array(ELEMENTS.length).fill(0);
  const volume = positiveNumber(params.volume, 100);

  const isMicro = (elementIndex) => MICRO_ELEMENTS.includes(ELEMENTS[elementIndex]);
  const demand = ELEMENTS.map((_, index) => Math.max(0, targets[index] - water[index]));
  const needed = ELEMENTS.map((_, index) => index).filter((index) => demand[index] > 1e-9);
  const steps = [];

  if (needed.length === 0) {
    return { selected: [], uncovered: [], steps: ['目标浓度为空，无需推荐'] };
  }

  const picked = new Set();
  const covered = new Set();

  /**
   * 在给定原料池中贪心补齐缺口。
   * 评分 = Σ(该原料对缺口元素的含量 × 该元素目标需求量)，
   * 因此补 300 mg/L 的 K 会优先选硝酸钾（K 38.7%），而不是磷酸二氢钾（K 28.7% 且带入大量 P）。
   * @param {number[]} pool 候选下标
   */
  const greedilyFill = (pool) => {
    for (;;) {
      const gap = needed.filter((index) => !covered.has(index));
      if (gap.length === 0) {
        return;
      }

      let bestIndex = -1;
      let bestScore = 1e-12;

      for (const candidate of pool) {
        if (picked.has(candidate)) {
          continue;
        }
        const fertilizer = fertilizers[candidate];
        let score = 0;
        let coverage = 0;

        for (const elementIndex of gap) {
          const content = fertilizer.comp[elementIndex] ?? 0;
          if (content <= 0) {
            continue;
          }
          if (isMicro(elementIndex) !== (fertilizer.category === '微量')) {
            continue;
          }
          score += content / 100 * demand[elementIndex];
          coverage += 1;
        }

        if (coverage === 0) {
          continue;
        }
        if (score > bestScore) {
          bestScore = score;
          bestIndex = candidate;
        }
      }

      if (bestIndex < 0) {
        return;
      }

      picked.add(bestIndex);
      ELEMENTS.forEach((_, index) => {
        if ((fertilizers[bestIndex].comp[index] ?? 0) > 0) {
          covered.add(index);
        }
      });
    }
  };

  const standardPool = fertilizers
    .map((fertilizer, index) => (fertilizer.std ? index : -1))
    .filter((index) => index >= 0);

  greedilyFill(standardPool);
  steps.push(`标准组合覆盖 ${covered.size}/${needed.length} 个目标元素`);
  greedilyFill(fertilizers.map((_, index) => index));

  for (let round = 0; round < SUPPLEMENT_ROUNDS; round += 1) {
    const result = compute({
      targets,
      water,
      fertilizers,
      selected: Array.from(picked),
      volume,
      concentrate: 1,
    });

    if (result.error !== undefined || result.actual === undefined) {
      break;
    }

    let worstElement = -1;
    let worstDeviation = SUPPLEMENT_THRESHOLD;

    for (const elementIndex of needed) {
      const target = demand[elementIndex];
      if (target <= 1e-9) {
        continue;
      }
      const deviation = (result.actual[elementIndex] - target) / target;
      // 只对「不足」补料；已超标时再加该元素来源只会更糟 —— 必须区分方向
      if (deviation < 0 && -deviation > worstDeviation) {
        worstDeviation = -deviation;
        worstElement = elementIndex;
      }
    }

    if (worstElement < 0) {
      break;
    }

    const candidates = fertilizers
      .map((fertilizer, index) => ({ fertilizer, index }))
      .filter(({ fertilizer, index }) => !picked.has(index)
        && (fertilizer.comp[worstElement] ?? 0) > 0
        && (isMicro(worstElement) === (fertilizer.category === '微量')))
      .map(({ fertilizer, index }) => {
        let burden = 0;
        ELEMENTS.forEach((_, elementIndex) => {
          if (elementIndex !== worstElement && (fertilizer.comp[elementIndex] ?? 0) > 0) {
            burden += 1;
          }
        });
        return {
          index,
          name: fertilizer.name,
          std: fertilizer.std === true,
          burden,
          content: fertilizer.comp[worstElement] ?? 0,
        };
      })
      .sort((left, right) => {
        if (left.std !== right.std) {
          return left.std ? -1 : 1;
        }
        if (left.burden !== right.burden) {
          return left.burden - right.burden;
        }
        return right.content - left.content;
      });

    if (candidates.length === 0) {
      break;
    }

    picked.add(candidates[0].index);
    steps.push(`补料：${candidates[0].name}（补 ${ELEMENTS[worstElement]}，缺口 ${(worstDeviation * 100).toFixed(0)}%）`);
  }

  const uncovered = needed
    .filter((index) => !covered.has(index))
    .map((index) => ELEMENTS[index]);

  return { selected: Array.from(picked), uncovered, steps };
}

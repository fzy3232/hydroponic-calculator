/**
 * 稠密线性最小二乘求解器（纯 JavaScript，零依赖）。
 *
 * 语义对应经典数值库的「SVD + 奇异值截断」最小二乘：小于阈值的奇异值视为 0，
 * 因此对欠定（方程少于未知数）与秩亏矩阵同样给出**最小范数解**。
 *
 * 维度优化：令 m = 方程数、n = 未知数，
 *   m ≤ n → x = Aᵀ(AAᵀ)⁺b   （只需对 m×m 求伪逆）
 *   m > n → x = (AᵀA)⁺Aᵀb   （只需对 n×n 求伪逆）
 * 从而把矩阵规模压到 min(m, n)。
 *
 * @module core/solver
 */

/**
 * 构造单位矩阵。
 * @param {number} size 阶数
 * @returns {number[][]}
 */
function identityMatrix(size) {
  const matrix = [];
  for (let row = 0; row < size; row += 1) {
    const cells = new Array(size).fill(0);
    cells[row] = 1;
    matrix.push(cells);
  }
  return matrix;
}

/**
 * 对称矩阵的 Jacobi 特征分解。
 * @param {number[][]} matrix 对称方阵
 * @returns {{ values: number[], vectors: number[][] }} `values[i]` 对应 `vectors` 的第 i 列
 */
function jacobiEigenDecomposition(matrix) {
  const size = matrix.length;
  const work = matrix.map((row) => [...row]);
  const vectors = identityMatrix(size);
  const maxSweeps = 100;

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let offDiagonalNorm = 0;

    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        const offDiagonal = work[p][q];
        if (Math.abs(offDiagonal) < 1e-18) {
          continue;
        }
        offDiagonalNorm += offDiagonal * offDiagonal;

        const theta = (work[q][q] - work[p][p]) / (2 * offDiagonal);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cosine = 1 / Math.sqrt(t * t + 1);
        const sine = t * cosine;

        for (let i = 0; i < size; i += 1) {
          const left = work[i][p];
          const right = work[i][q];
          work[i][p] = cosine * left - sine * right;
          work[i][q] = sine * left + cosine * right;
        }
        for (let i = 0; i < size; i += 1) {
          const upper = work[p][i];
          const lower = work[q][i];
          work[p][i] = cosine * upper - sine * lower;
          work[q][i] = sine * upper + cosine * lower;
        }
        for (let i = 0; i < size; i += 1) {
          const left = vectors[i][p];
          const right = vectors[i][q];
          vectors[i][p] = cosine * left - sine * right;
          vectors[i][q] = sine * left + cosine * right;
        }
      }
    }

    if (offDiagonalNorm < 1e-30) {
      break;
    }
  }

  const values = work.map((row, index) => row[index]);
  return { values, vectors };
}

/**
 * 计算「对称矩阵的伪逆」作用到右端项上的结果。
 * @param {number[][]} symmetric 对称方阵
 * @param {number[]} rhs 右端项
 * @param {number} epsilon 相对截断阈值
 * @returns {number[]}
 */
function applyPseudoInverse(symmetric, rhs, epsilon) {
  const { values, vectors } = jacobiEigenDecomposition(symmetric);
  const size = symmetric.length;
  const largest = values.reduce((acc, value) => Math.max(acc, Math.abs(value)), 0);
  const cutoff = epsilon * (largest > 0 ? largest : 1);
  const result = new Array(size).fill(0);

  for (let column = 0; column < size; column += 1) {
    if (Math.abs(values[column]) <= cutoff) {
      continue;
    }
    let projection = 0;
    for (let i = 0; i < size; i += 1) {
      projection += vectors[i][column] * rhs[i];
    }
    const coefficient = projection / values[column];
    for (let i = 0; i < size; i += 1) {
      result[i] += vectors[i][column] * coefficient;
    }
  }

  return result;
}

/**
 * 计算 A·Aᵀ（结果为 m×m，m 为行数）。
 * @param {number[][]} matrix 输入矩阵
 * @returns {number[][]}
 */
function rowGramMatrix(matrix) {
  const rowCount = matrix.length;
  const columnCount = matrix[0].length;
  const result = [];

  for (let i = 0; i < rowCount; i += 1) {
    const row = new Array(rowCount).fill(0);
    for (let k = 0; k < rowCount; k += 1) {
      let sum = 0;
      for (let index = 0; index < columnCount; index += 1) {
        sum += matrix[i][index] * matrix[k][index];
      }
      row[k] = sum;
    }
    result.push(row);
  }

  return result;
}

/**
 * 计算 Aᵀ·A（结果为 n×n，n 为列数）。
 * @param {number[][]} matrix 输入矩阵
 * @returns {number[][]}
 */
function columnGramMatrix(matrix) {
  const rowCount = matrix.length;
  const columnCount = matrix[0].length;
  const result = [];

  for (let i = 0; i < columnCount; i += 1) {
    const row = new Array(columnCount).fill(0);
    for (let k = 0; k < columnCount; k += 1) {
      let sum = 0;
      for (let index = 0; index < rowCount; index += 1) {
        sum += matrix[index][i] * matrix[index][k];
      }
      row[k] = sum;
    }
    result.push(row);
  }

  return result;
}

/**
 * 求解最小二乘问题 `min ‖Ax − b‖`，返回最小范数解。
 * @param {number[][]} a 系数矩阵，按行给出
 * @param {number[]} b 右端项
 * @param {number} [epsilon=1e-10] 奇异值截断阈值（相对于最大奇异值）
 * @returns {{ x: number[], dimension: number }} `dimension` 为实际参与分解的矩阵阶数
 */
export function solveLeastSquares(a, b, epsilon = 1e-10) {
  const rowCount = a.length;
  const columnCount = a[0].length;

  // 欠定 / 恰定：x = Aᵀ(A Aᵀ)⁺b —— 只需对 m×m 求伪逆
  if (rowCount <= columnCount) {
    const intermediate = applyPseudoInverse(rowGramMatrix(a), b, epsilon);
    const x = [];
    for (let j = 0; j < columnCount; j += 1) {
      let sum = 0;
      for (let i = 0; i < rowCount; i += 1) {
        sum += a[i][j] * intermediate[i];
      }
      x.push(sum);
    }
    return { x, dimension: rowCount };
  }

  // 超定：x = (AᵀA)⁺Aᵀb —— 只需对 n×n 求伪逆
  const rhs = [];
  for (let j = 0; j < columnCount; j += 1) {
    let sum = 0;
    for (let row = 0; row < rowCount; row += 1) {
      sum += a[row][j] * b[row];
    }
    rhs.push(sum);
  }

  return { x: applyPseudoInverse(columnGramMatrix(a), rhs, epsilon), dimension: columnCount };
}

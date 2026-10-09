/**
 * xlsx 生成器的交叉验证脚本。
 *
 * Node 侧生成一个 .xlsx，再由 Python 的 openpyxl 读取（见同目录 verify-xlsx.py），
 * 用**独立的第三方实现**证明生成的文件结构合法——自己写 ZIP 最容易出错的地方
 * 就是 CRC 与中央目录，只靠自测是发现不了的。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildXlsx, estimateColumnWidths } from '../src/core/xlsx.js';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputPath = path.join(projectDir, 'test', 'xlsx-check-output.xlsx');

// 化学式在这里用 Unicode 下标（Excel 单元格不支持 <sub> 标签）
const sheets = [
  {
    name: '原料用量',
    rows: [
      [{ v: '原料', bold: true }, { v: '用量（g）', bold: true }, { v: 'g/L 工作液', bold: true }],
      [{ v: '硝酸钙(四水)  Ca(NO₃)₂·4H₂O' }, { v: 118.0 }, { v: 1.18 }],
      [{ v: '硝酸钾  KNO₃' }, { v: 51.0 }, { v: 0.51 }],
      [{ v: '硫酸镁(七水)  MgSO₄·7H₂O' }, { v: 48.87 }, { v: 0.489 }],
      [{ v: '合计' }, { v: 233.9 }, { v: 2.34 }],
    ],
  },
  {
    name: '目标达成',
    rows: [
      [{ v: '元素', bold: true }, { v: '目标', bold: true }, { v: '实际达成', bold: true }, { v: '偏差', bold: true }],
      [{ v: 'NO3-N' }, { v: 210.64 }, { v: 210.64 }, { v: '+0.0%' }],
      [{ v: 'K' }, { v: 236.3 }, { v: 236.3 }, { v: '+0.0%' }],
      [{ v: 'Mg' }, { v: 48.32 }, { v: 48.2 }, { v: '-0.2%' }],
    ],
  },
  {
    name: '中文与特殊字符',
    rows: [
      [{ v: '含 & < > " 的文本', bold: true }, { v: '换行\n符与制表\t符' }],
      [{ v: '零值' }, { v: 0 }],
      [{ v: '负数' }, { v: -12.5 }],
      [{ v: '' }, { v: '空单元格上方应保持为空' }],
    ],
  },
];

const withWidths = sheets.map((sheet) => ({
  ...sheet,
  widths: estimateColumnWidths(sheet.rows),
}));

const bytes = buildXlsx(withWidths);
fs.writeFileSync(outputPath, bytes);

console.log(`已生成：${outputPath}`);
console.log(`  字节数：${bytes.length}`);
console.log(`  ZIP 签名校验：${bytes[0] === 0x50 && bytes[1] === 0x4B ? 'PK ✓' : '✗ 不是 ZIP'}`);
console.log(`  工作表：${sheets.map((sheet) => sheet.name).join('、')}`);

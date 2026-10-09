/**
 * 最小 XLSX 生成器（**零依赖**）。
 *
 * 为什么自己写而不是引 SheetJS / ExcelJS：
 *   本项目要求「单文件、零依赖」，而那两个库会往产物里塞几百 KB；
 *   我们只需要「把几张表写成 Excel」这一件事，自己实现约 250 行就够。
 *
 * xlsx 的本质是一个 ZIP 包，里面是若干 XML：
 *   [Content_Types].xml
 *   _rels/.rels
 *   xl/workbook.xml
 *   xl/_rels/workbook.xml.rels
 *   xl/styles.xml
 *   xl/worksheets/sheetN.xml
 *
 * 两个简化决定（都经过 Excel / WPS / LibreOffice 验证可正常打开）：
 *   1. ZIP 用 **store 模式（不压缩）**：省掉 deflate 实现，ZIP 规范本来就允许
 *   2. 字符串用 **inlineStr**：免去 sharedStrings 表与索引维护
 *
 * @module core/xlsx
 */

/** CRC32 查表（ZIP 的每个条目都必须带校验值）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * 计算 CRC32。
 * @param {Uint8Array} bytes 数据
 * @returns {number} 无符号 32 位校验值
 */
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 字符串转 UTF-8 字节。
 * @param {string} text 文本
 * @returns {Uint8Array}
 */
function utf8(text) {
  return new TextEncoder().encode(text);
}

/**
 * 把多个条目打包成一个 ZIP（store 模式，不压缩）。
 * @param {Array<{ name: string, data: Uint8Array }>} entries 条目
 * @returns {Uint8Array} 完整的 ZIP 字节流
 */
function zipStore(entries) {
  /** @type {Uint8Array[]} */
  const parts = [];
  /** @type {Array<{ nameBytes: Uint8Array, crc: number, size: number, offset: number }>} */
  const directory = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = utf8(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    // —— 本地文件头（30 字节固定 + 文件名）——
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034B50, true);      // 本地文件头签名
    view.setUint16(4, 20, true);              // 解压所需版本 2.0
    view.setUint16(6, 0x0800, true);          // 标志位：文件名是 UTF-8
    view.setUint16(8, 0, true);               // 压缩方法 0 = store
    view.setUint16(10, 0, true);              // 修改时间
    view.setUint16(12, 0x21, true);           // 修改日期（1980-01-01）
    view.setUint32(14, crc, true);            // CRC32
    view.setUint32(18, data.length, true);    // 压缩后大小
    view.setUint32(22, data.length, true);    // 原始大小
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);              // 额外字段长度
    header.set(nameBytes, 30);

    parts.push(header, data);
    directory.push({ nameBytes, crc, size: data.length, offset });
    offset += header.length + data.length;
  }

  // —— 中央目录 ——
  const centralParts = [];
  let centralSize = 0;
  for (const item of directory) {
    const record = new Uint8Array(46 + item.nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014B50, true);      // 中央目录签名
    view.setUint16(4, 20, true);              // 创建版本
    view.setUint16(6, 20, true);              // 解压所需版本
    view.setUint16(8, 0x0800, true);          // UTF-8 文件名
    view.setUint16(10, 0, true);              // store
    view.setUint16(12, 0, true);
    view.setUint16(14, 0x21, true);
    view.setUint32(16, item.crc, true);
    view.setUint32(20, item.size, true);
    view.setUint32(24, item.size, true);
    view.setUint16(28, item.nameBytes.length, true);
    view.setUint16(30, 0, true);              // 额外字段
    view.setUint16(32, 0, true);              // 注释
    view.setUint16(34, 0, true);              // 起始磁盘号
    view.setUint16(36, 0, true);              // 内部属性
    view.setUint32(38, 0, true);              // 外部属性
    view.setUint32(42, item.offset, true);    // 本地头偏移
    record.set(item.nameBytes, 46);
    centralParts.push(record);
    centralSize += record.length;
  }

  // —— 中央目录结束记录 ——
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054B50, true);     // 结束记录签名
  endView.setUint16(8, directory.length, true);
  endView.setUint16(10, directory.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const all = [...parts, ...centralParts, end];
  const total = all.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of all) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

/**
 * XML 文本转义（含控制字符剔除：Excel 遇到非法字符会直接报文件损坏）。
 * @param {string} text 文本
 * @returns {string}
 */
function escapeXml(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 列序号转 Excel 列名（1 → A，27 → AA）。
 * @param {number} index 从 1 开始的列号
 * @returns {string}
 */
function columnName(index) {
  let value = index;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

/**
 * @typedef {Object} Cell
 * @property {string | number | null | undefined} [v] 值（字符串或数字）
 * @property {boolean} [bold] 是否加粗（用于表头）
 */

/**
 * 生成一张工作表的 XML。
 * @param {Cell[][]} rows 二维单元格
 * @param {number[]} widths 各列宽度（字符数）
 * @returns {string}
 */
function worksheetXml(rows, widths) {
  const columnXml = widths.length === 0
    ? ''
    : `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" `
      + `width="${width}" customWidth="1"/>`).join('')}</cols>`;

  const rowXml = rows.map((cells, rowIndex) => {
    const cellXml = cells.map((cell, columnIndex) => {
      const reference = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
      const style = cell.bold === true ? ' s="1"' : '';
      const value = cell.v;

      if (value === null || value === undefined || value === '') {
        return '';
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        // 数字直接写 <v>，Excel 会按数值处理（可继续参与计算）
        return `<c r="${reference}"${style}><v>${value}</v></c>`;
      }
      return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">`
        + `${escapeXml(String(value))}</t></is></c>`;
    }).join('');

    return `<row r="${rowIndex + 1}">${cellXml}</row>`;
  }).join('');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    columnXml,
    `<sheetData>${rowXml}</sheetData>`,
    '</worksheet>',
  ].join('');
}

/** 样式表：0 = 正文，1 = 加粗（表头）。 */
const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2">'
  + '<font><sz val="11"/><color theme="1"/><name val="微软雅黑"/></font>'
  + '<font><b/><sz val="11"/><color theme="1"/><name val="微软雅黑"/></font>'
  + '</fonts>'
  + '<fills count="2">'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '</fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="2">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '</cellXfs>'
  // 缺 cellStyles 时 openpyxl 会警告「contains no default style」，补上才规范
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

/**
 * 构建 xlsx 工作簿。
 *
 * @param {Array<{ name: string, rows: Cell[][], widths?: number[] }>} sheets 工作表
 * @returns {Uint8Array} xlsx 文件字节流
 */
export function buildXlsx(sheets) {
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error('至少需要一张工作表');
  }

  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join(''),
    '</Types>',
  ].join('');

  const rootRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '</Relationships>',
  ].join('');

  const workbook = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheets>',
    sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join(''),
    '</sheets>',
    '</workbook>',
  ].join('');

  const workbookRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join(''),
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    '</Relationships>',
  ].join('');

  const entries = [
    { name: '[Content_Types].xml', data: utf8(contentTypes) },
    { name: '_rels/.rels', data: utf8(rootRels) },
    { name: 'xl/workbook.xml', data: utf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) },
    { name: 'xl/styles.xml', data: utf8(STYLES_XML) },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: utf8(worksheetXml(sheet.rows, sheet.widths ?? [])),
    })),
  ];

  return zipStore(entries);
}

/**
 * 估算列宽：取该列所有单元格文本的显示宽度（中文按 2 个字符算）。
 * @param {Cell[][]} rows 二维单元格
 * @returns {number[]} 每列宽度（字符数，已夹在 8–60 之间）
 */
export function estimateColumnWidths(rows) {
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      const text = cell.v === null || cell.v === undefined ? '' : String(cell.v);
      // 中日韩字符按 2 倍宽度估算
      const displayWidth = [...text].reduce(
        (sum, char) => sum + (char.charCodeAt(0) > 0x2E80 ? 2 : 1),
        0,
      );
      widths[index] = Math.max(widths[index] ?? 0, displayWidth);
    });
  }
  return widths.map((width) => Math.min(60, Math.max(8, width + 2)));
}

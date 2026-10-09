# 水培营养液配方计算器

> 选定「作物 + 生育期」→ 自动载入营养目标（mg/L）→ 用线性最小二乘倒算每种肥料要称多少克。
>
> 桌面应用（Tauri 2）与单文件 HTML **双形态**，共享同一份源码与数据。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4.svg)](#已知限制)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app)
[![No runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](#核心实现)

![化学计算视图](docs/screenshots/01-calc.png)

---

## 它解决什么问题

配水培营养液时，真正麻烦的不是「该用哪些肥料」，而是**「要称多少克」**：

- 每种肥料的成分含量各不相同——硝酸钙含 15.5% N、20.3% Ca，硝酸钾含 13.85% N、38.67% K……
- 一种肥料**同时补充多个元素**，彼此耦合。多称一点钙，就顺带带进了氮
- 配方表给的是**浓度**（mg/L），而你要称的是**克数**
- 手算容易顾此失彼，尤其微量元素只有 0.01 ppm 量级

这个工具把「目标浓度 + 所选原料」写成一个**线性方程组**解出来，
顺便告诉你每种原料贡献了多少、哪个元素没达成、结晶水形态会带来多大偏差。

## 功能

| 功能 | 说明 |
| --- | --- |
| **自动载入目标** | 切换作物或生育期即自动载入该阶段营养目标，无需点按钮 |
| **智能推荐原料** | 标准组合优先 + 按需求量加权 + 分域约束 + 偏差驱动补料 |
| **倒算用量** | 线性最小二乘求非负解，负用量自动剔除后重算 |
| **偏差可视化** | 每个元素的达成值与偏差百分比，超出阈值高亮 |
| **形态核对** | 买到的是一水物还是七水物？同一重量下元素含量可差一倍 |
| **水源本底** | 填入自来水/井水检测值，自动从目标中扣除 |
| **母液 A/B 分桶** | 钙肥与硫酸盐/磷酸盐不能高浓度混合（会沉淀），给出分桶提示 |
| **微量称量建议** | 天平称不出 0.1 g 以下时，先配母液再按体积取用 |
| **页面内编辑数据** | 肥料库 / 作物库 / 术语库可直接改，改动保存在本机 |
| **导入导出 CSV** | 用 Excel 编辑后导入；导入自动识别 UTF-8 与 GBK |
| **导出 Excel** | 4 张工作表的 `.xlsx`，数字可直接继续计算 |
| **术语词典** | 34 条专业术语，每条都说明「含义」与**「对种植的影响」** |

### 界面

| 化学计算 | 原料选择（化学式自动下标） | 数据编辑 |
| --- | --- | --- |
| ![化学计算](docs/screenshots/01-calc.png) | ![原料选择](docs/screenshots/02-fertilizers.png) | ![数据编辑](docs/screenshots/03-data.png) |

---

## 两种形态，同一份源码

| 形态 | 产物 | 适用 |
| --- | --- | --- |
| **Tauri 桌面版** | `水培营养液配方计算器-便携版.exe`（10.3 MB）<br>+ NSIS 安装包 + MSI | 独立应用窗口；导出走系统「另存为」，能显示真实保存路径 |
| **单文件 HTML** | `水培营养液计算器.html`（约 147 KB） | 任何电脑双击即用，零依赖，也能放进 U 盘 |

> **双产物不会分叉**：两者都由 `npm run build` 系列命令从 `src/` 与 `data/` 生成，
> 不存在手写的第二份代码。`test/baseline.mjs` 会验证两者计算结果**逐位一致**。

```bash
npm run build          # → dist/index.html（Tauri 加载的前端产物）
npm run build:single   # → 额外产出一份独立单文件 HTML
```

---

## 快速开始

前置：Node.js 18+、Rust 工具链。（要出桌面版还需要 Windows + WebView2）

```bash
git clone <仓库地址> && cd hydroponic-calculator
npm install                # esbuild / eslint / Tauri CLI
npm run build              # 生成 dist/index.html
npm run tauri:dev          # 开发模式：热重载窗口
npm run tauri:build        # 出正式产物（便携版 exe + 安装包）
```

> `dist/` 不入库（构建产物），但 `data/*.csv` 已入库，
> 所以 clone 后直接 `npm run build` 就能跑，**不需要装 Python**。
> 只有要改肥料化学式 / 加作物 / 加术语时，才用得上 `tools/` 下的脚本。

首次 `tauri:build` 需要编译全部 Rust 依赖，约 10 分钟。

**一键构建（干净 Windows 机器）**：

```bat
build-windows.bat
```

脚本自检 Node.js / Rust / WebView2 运行时，缺失时给出安装指引，然后完成前端构建与 Tauri 打包，
并把产物复制到项目根目录。

---

## 核心实现

### 求解器：为什么不用普通最小二乘

设 `A` 是「原料 × 元素」的成分矩阵，要求解 `Ax = b`（`b` 是目标营养量）。
难点在于：

1. **方程数与未知数不匹配**。原料可能比元素多（欠定）或少（超定）。
   解法按维度分两路：`m ≤ n` 时 `x = Aᵀ(AAᵀ)⁺b`，否则 `x = (AᵀA)⁺Aᵀb`，
   伪逆用 **Jacobi 特征分解**手写实现，不引矩阵库。

2. **必须最小化相对误差而不是绝对误差**。
   这是整个项目最关键的一处洞察：目标里 Cu 只有 0.02 ppm，K 有 300 ppm。
   若直接最小化绝对误差，Cu 的偏差会被 K 完全淹没，结果里铜要么是 0 要么偏差 100 倍。
   所以**每行按目标值归一化**后再求解，让每个元素有同等话语权。

3. **解出现负用量**。物理上不可执行（不能"负称"某种肥料），
   因此迭代：剔除当前最负的变量后重解，直到全非负。

4. **分域约束**。大量元素只能由「大量」类肥料提供，微量元素只能由「微量」类提供。
   这条规则来自一个真实事故：不加约束时，求解器发现用钼酸铵来凑阴离子最省事，
   结果钼超标 148 倍——而钼对多数作物的安全窗口极窄。

### 化学式引擎

肥料成分**不来自任何数据库，而是由化学式现算**：

```
Ca(NO3)2·4H2O  →  N 11.86%  Ca 16.97%   （含结晶水）
MgSO4          →  Mg 9.86%  S 13.01%    （无水）
```

支持括号嵌套、结晶水（`·nH2O`）、水合/无水换算，原子量用 IUPAC 值。
改化学式即可自动重算含量——这是数据可维护性的基础。

**化学式在数据层始终是纯 ASCII**（`Ca(NO3)2·4H2O`），只在显示时转换：

| 场景 | 转换函数 | 结果 |
| --- | --- | --- |
| 网页界面 | `formatFormula` → `<sub>` | `Ca(NO₃)₂·4H₂O` |
| Excel 导出 | `toUnicodeSubscript` → Unicode | `Ca(NO₃)₂·4H₂O` |

之所以不把 Unicode 下标直接存进 CSV——那样用户编辑时打不出来，搜索排序也会乱。

### 导出 Excel：零依赖自己写

SheetJS / ExcelJS 会给单文件产物加几百 KB，而本项目只需要「把表写成 Excel」这一件事。
`src/core/xlsx.js` 约 250 行自己实现：

- ZIP 用 **store 模式**（不压缩）——省掉 deflate 实现，ZIP 规范本就允许
- 字符串用 **inlineStr**——免去 sharedStrings 表与索引维护
- 手写 CRC32、本地文件头、中央目录

生成 4 张工作表：**配方信息 / 原料用量 / 目标达成 / 形态核对**。
数字一律以**数值类型**写入（不是字符串），在 Excel 里可直接求和、按倍数缩放、画图。

> **为什么自写 ZIP 也必须交叉验证**：xlsx = ZIP + XML，自己写 ZIP 最容易在 CRC32、
> 中央目录偏移上出错，而**自测永远发现不了**（自己写的读自己写的）。所以：
>
> ```bash
> node test/recipe-export-check.mjs      # 真实配方 → xlsx
> python test/verify-recipe.py           # 用 openpyxl（第三方实现）读回校验
> ```
>
> openpyxl 能成功打开，并正确还原数值类型、Unicode 下标、合计校验，才算真的验证过。

### 为什么 Rust 侧只有几十行

业务逻辑全在前端，Rust 只做两件事：**开窗口**、**注册「另存为」插件**。

好处是 Tauri 版与 HTML 版共享 100% 业务代码，改动只发生在一个地方。
唯一必须分叉的是「保存文件」——WebView2 里 `a[download]` 形式的 Blob 下载不可靠，
所以桌面版走 `plugin-dialog.save` + `plugin-fs.writeFile`，浏览器版回退 Blob 下载。

---

## 目录结构

```
hydroponic-calculator/
├── src/                    前端源码（原生 ESM，无框架）
│   ├── core/                 纯逻辑层：零 DOM 依赖，可在 Node 直接测试
│   │   ├── constants.js        营养指标、元素分组、CSV 列契约
│   │   ├── utils.js            数值解析与格式化
│   │   ├── solver.js           线性最小二乘（Jacobi 特征分解 + 伪逆）
│   │   ├── chem.js             化学式引擎（含结晶水识别）
│   │   ├── xlsx.js             最小 xlsx 生成器（ZIP store + inlineStr）
│   │   ├── data.js             数据模型与 CSV 编解码
│   │   └── calculator.js       配方计算与智能推荐
│   ├── ui/
│   │   ├── html.js             模板层：纯函数，数据 → HTML 字符串
│   │   ├── sheets.js           结果 → Excel 工作表结构（纯函数）
│   │   └── view.js             视图层：唯一接触 DOM 的模块
│   ├── template.html           页面骨架（含构建占位符）
│   ├── style.css               样式表（含 @media print）
│   └── main.js                 入口
├── data/                   数据源（CSV，可用 Excel 编辑后重新构建）
│   ├── fertilizers.csv         肥料库 35 种（成分由化学式计算）
│   ├── crops.csv               作物库 40 条生育期
│   └── glossary.csv            术语词典 34 条（含「对种植的影响」）
├── dist/                   构建产物 → Tauri 加载此目录（不入库）
├── src-tauri/              Rust 外壳（刻意保持最小）
│   ├── src/lib.rs              注册窗口 + dialog/fs 插件
│   ├── src/main.rs             入口
│   ├── tauri.conf.json         窗口、打包、中文产品名
│   ├── capabilities/           最小权限集
│   └── icons/                  应用图标
├── test/
│   ├── core.test.mjs           58 个单元测试（Node 原生 test runner）
│   ├── baseline.mjs            计算结果基线：逐位比对两种形态
│   ├── baseline.json           基线数据
│   ├── xlsx-check.mjs          xlsx 生成器的合成用例
│   ├── recipe-export-check.mjs 真实配方导出
│   ├── verify-xlsx.py          用 openpyxl 交叉验证（合成用例）
│   ├── verify-recipe.py        用 openpyxl 交叉验证（真实配方）
│   ├── browser-check.ps1       浏览器端到端验证（29 项断言）
│   └── capture.ps1             整页截图（CDP，供视觉回归）
├── tools/                  构建期工具（不参与应用运行）
│   ├── build-fertilizers.mjs   由化学式生成肥料库 CSV（复用 core/chem.js）
│   ├── build-crops.mjs         生成作物库 CSV
│   ├── build-glossary.mjs      生成术语词典 CSV
│   ├── sources/                知识数据（JSON）：肥料清单 / 作物目标 / 术语释义
│   ├── gen-icon.py             生成应用图标源图（Pillow，一次性）
│   └── app-icon.png            图标源图
├── docs/
│   ├── screenshots/            界面截图
│   ├── ui-review.md            界面评审与改进记录
│   └── acceptance-checklist.md 交付验收清单
├── build.mjs               前端构建：ESM → IIFE → 内联单文件 HTML
└── build-windows.bat       一键构建（GBK 编码，供 cmd.exe 直接运行）
```

## 与浏览器版的关键差异

| 能力 | 浏览器 / 单文件 HTML | Tauri 桌面版 |
| --- | --- | --- |
| 导出 CSV | Blob 下载（下载到哪不可见） | **系统「另存为」+ 真实写盘**，界面显示保存路径 |
| 导入 CSV | `<input type=file>` + GBK 回退 | **相同**（Web 文件输入在 WebView2 可用） |
| 导出 Excel | 有（Blob 下载） | **有**（系统「另存为」），4 张工作表 |
| 打印 | 浏览器 Ctrl+P | 「打印」按钮（Tauri 窗口无菜单栏） |
| 数据存放 | 浏览器 localStorage | WebView2 用户数据目录（由 `identifier` 决定） |

> **注意**：`identifier`（`com.hydroponic.calculator`）决定数据目录位置，
> **发布后不可再改**，否则用户既有数据会「看似丢失」。

---

## 代码约定

### Rust 侧：不使用会 panic 的写法

- **禁止 `unwrap()` / `expect()` / `panic!` / `unreachable!`**
  release 构建是 `windows_subsystem = "windows"`，**没有控制台**。
  一旦 panic，用户看到的就是「双击没反应」，连错误信息都拿不到。
  因此 `src/lib.rs` 把启动失败改为：**原生消息框提示 → 非零码退出**。
- 错误用 `Result` + `?` 传播（`setup` 闭包返回 `Result`），由上层统一处理；
  缺失主窗口等异常情况不 panic 而是返回 `Err` 交给统一出口。

### 前端：读写与解析都要容错

- `localStorage` 的读写全部走 `readStoredJSON` / `writeStoredJSON` 两个封装：
  - 读取失败（数据被手工改坏、旧版本格式）→ 警告 + **回退内置数据**，不中断启动
  - 写入失败（配额满 `QuotaExceededError`）→ 提示用户改用「导出 CSV」备份
- 内联数据缺失或解析失败 → 返回空数组并警告，**不抛异常**
- 启动时集中校验关键 DOM 元素（`REQUIRED_ELEMENT_IDS`）：
  缺元素时直接显示明确原因，而不是让 `byId(...).addEventListener` 抛异常变成白屏

---

## 数据来源

- **肥料成分**：由化学式 + IUPAC 原子量精确计算，并与教科书公认值逐项核对
  （`npm run data:build` 会打印自检对照表）
- **作物营养目标**：公开文献，逐行标注来源
  （Hoagland & Arnon、日本园试、山崎、雅典农业大学配方表、SARE、IARI）
- **未找到可靠文献的元素浓度不编造**——宁可留空

## 数据重建

改了化学式、要加作物、要加术语之后重新生成数据：

```bash
npm run data:build                 # 依次重建 肥料库 / 作物库 / 术语库
```

也可以单独重建：

```bash
node tools/build-fertilizers.mjs   # 由化学式重算肥料成分（含与教科书值的自检）
node tools/build-crops.mjs         # 作物营养目标
node tools/build-glossary.mjs      # 术语词典
```

**知识数据**（肥料清单、作物目标、术语释义）在 `tools/sources/*.json`；
**计算逻辑**直接复用 `src/core/chem.js` —— 构建期与运行期**只有一份化学实现**。

> 这是本仓库的一条硬约束。此前 `build_fertilizers.py` 与 `core/chem.js` 各维护一份
> 化学解析与形态提示，**实测已经漂移**：CSV 里写「请在 CSV 中把化学式改为 X 后重新导入」，
> 而界面实时重算写「请把化学式改为 X」——同一功能两种说法。
> 现已统一由 `core/chem.js` 提供，Python 版删除。

> **这些脚本不参与应用运行**。它们的产物是 `data/*.csv`，
> 由 `npm run build` 读入并内联进 `dist/index.html`。
> 便携版 exe 里没有 Python 运行时，最终用户也不需要装 Python。

## 为什么还有几个 Python 文件

数据构建已全部迁到 Node，剩下 3 个 Python 是**刻意保留**的：

| 文件 | 用途 | 为什么不迁移 |
| --- | --- | --- |
| `test/verify-xlsx.py` | 用 openpyxl 读回我们自己生成的 xlsx | **交叉验证的价值就在于换一个独立实现**；改用 JS 就退化成"自己验自己" |
| `test/verify-recipe.py` | 同上（真实配方用例） | 同上 |
| `tools/gen-icon.py` | 画图标源图（一次性） | Pillow 绘制；Node 没有零依赖的等价物，且图标与数据/计算无关 |

前两个只在跑交叉验证时用，`gen-icon.py` 只在换图标时用——**都不参与构建与运行**。

## 常用命令

```bash
npm run verify             # lint + 单元测试 + 构建
npm run test:baseline      # 与基线逐位比对（确认计算未被改动）
npm run baseline           # 重新采集基线（改了算法或数据后才需要）
npm run build:single       # 额外产出一份独立单文件 HTML
pwsh -File test/browser-check.ps1              # 浏览器端到端验证
pwsh -File test/capture.ps1 -Output shot.png   # 整页截图
```

---

## 常见问题

**Q：为什么便携版换台电脑后我的数据不见了？**
A：数据存在系统里的 WebView2 用户目录，**不跟着 exe 走**。
换电脑请用「导出 CSV」→ 在新机器上「导入 CSV」。

**Q：我在页面里改了肥料数据，下次打开还在吗？**
A：在。改动保存在本机，并可用「导出 CSV」备份。

**Q：某个元素偏差一直很大，为什么？**
A：通常是**没有选中能提供该元素的原料**。检查 ④ 的选择，或看结果里的警告行。
也可能是该元素的供给被大量元素"顺带"带偏——这时看「主要贡献」列。

**Q：能加自己的作物/肥料吗？**
A：能。数据编辑视图里直接改，或编辑 `data/*.csv` 后重新构建。
加肥料只需填化学式和纯度，成分会自动算。

**Q：求解耗时要多久？**
A：典型配方 **0.5 ms** 以内（界面会显示实际耗时）。这是纯前端计算，不联网。

**Q：有 Mac / Linux 版吗？**
A：源码本身跨平台（Tauri 支持 macOS / Linux），但**只在 Windows 上构建与验证过**。
在 Mac/Linux 上执行 `npm run tauri:build` 理论上可出包，未实测。

---

## 已知限制

- **中文输入法**：WebView2 存在 CJK 输入法的公开缺陷（WebView2Feedback#5625、tauri#15436）。
  主流程（①→⑤）全是下拉框/数字框/复选框，**不需要中文输入**；
  只有 ⑥ 数据管理里编辑肥料名、作物名时才涉及，请以实测为准。
- **打印**：Tauri 无官方打印 API（tauri#4917）。首选**导出 Excel**——Excel 既能直接打印，
  数字还能在表里继续算；「打印」按钮走 `window.print()`，打印样式已就绪（只保留结果表）。
- **Vite**：Tauri 支持省略 `devUrl`（用内置 dev server），因此首版没引 Vite；
  若需要 HMR，加 Vite 后把 `tauri.conf.json` 的 `build.devUrl` 指向它即可。
  当前用 esbuild 是为了**最小改动复用既有可用前端**。
- **外置数据**：`frontendDist` 目录会被递归嵌入二进制，把 `data/*.csv` 放进去即可用 `fetch()` 读取，
  代价是改数据要重新构建。
- **未做代码签名**：Windows SmartScreen 可能对未签名的 exe 给出警告。

---

## 免责声明

- 本工具给出的是**按库中成分计算的理论值**，不是现场投加的保证值。
  结晶水形态、肥料纯度、称量精度都会带来实际差异——形态核对表里列出了可能达 **1.5–2 倍**的偏差。
- 营养液配方与作物生长强相关，**请结合自己的水质、品种、栽培环境调整**，并以实测 EC / pH 为准。
- 数据来自公开文献并逐行标注来源，但**不保证适用于所有品种与地区**。
- 使用本工具产生的任何后果由使用者自行承担。

## 许可证

[MIT](LICENSE) —— 可自由使用、修改、商用，只需保留版权声明。

> 本项目为**独立实现**：化学式解析、求解算法、xlsx 生成均为原创代码，
> 数据来自公开文献并注明出处。

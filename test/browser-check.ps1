<#
.SYNOPSIS
    浏览器端到端验证：用无头浏览器打开构建产物，检查真实渲染结果。

.DESCRIPTION
    验证层次：
      1. core 层单元测试        → npm test
      2. 模块与语法规范检查     → npm run lint
      3. 构建产物结构与渲染验证 → 本脚本

    说明：本脚本用 PowerShell 而非 Node 调用浏览器，
    因为本机沙箱限制了 Node 捕获子进程输出的能力（piped stdio）。

.EXAMPLE
    pwsh -File test/browser-check.ps1
#>
param(
    [string]$Html = (Join-Path $PSScriptRoot '..\dist\index.html'),
    [switch]$Quiet,
    # 显式允许「找不到浏览器就跳过」。默认不允许：静默跳过会掩盖回归。
    [switch]$AllowSkipBrowser
)

$ErrorActionPreference = 'Stop'

function Write-Check {
    param([string]$Name, [bool]$Passed, [string]$Detail = '')
    $mark = if ($Passed) { '  [通过]' } else { '  [失败]' }
    $color = if ($Passed) { 'Green' } else { 'Red' }
    Write-Host "$mark $Name$(if ($Detail) { "  — $Detail" })" -ForegroundColor $color
    return $Passed
}

# ---------- 定位构建产物与浏览器 ----------
if (-not (Test-Path $Html)) {
    Write-Host "未找到构建产物：$Html" -ForegroundColor Red
    Write-Host "请先运行：node build.mjs" -ForegroundColor Yellow
    exit 1
}

$browserCandidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Google\Chrome\Application\chrome.exe'
)
$browser = $browserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) {
    # 默认**失败退出**而不是静默跳过：跳过会让「验证通过」变成假象。
    Write-Host '  [失败] 未找到 Edge 或 Chrome —— 浏览器端到端验证无法执行' -ForegroundColor Red
    if ($AllowSkipBrowser) {
        Write-Host '  已显式传入 -AllowSkipBrowser，本次按跳过处理（结果不可作为验收依据）' -ForegroundColor Yellow
        exit 0
    }
    Write-Host '  如确实要在无浏览器环境跳过，请显式传 -AllowSkipBrowser。' -ForegroundColor Yellow
    exit 1
}

$htmlPath = (Resolve-Path $Html).Path
$url = 'file:///' + ($htmlPath -replace '\\', '/')

if (-not $Quiet) {
    Write-Host "产物：$htmlPath"
    Write-Host "浏览器：$(Split-Path $browser -Leaf)"
    Write-Host ''
}

# ---------- 无头模式加载并抓取 DOM ----------
$dom = & $browser --headless=new --disable-gpu --no-sandbox --virtual-time-budget=9000 --dump-dom $url 2>$null | Out-String

if ([string]::IsNullOrWhiteSpace($dom)) {
    Write-Host '浏览器未返回 DOM，验证失败' -ForegroundColor Red
    exit 1
}

# ---------- 断言 ----------
$allPassed = $true
$results = @()

# 1) 数据加载成功（肥料与作物数量已渲染到页头）
$metaMatch = [regex]::Match($dom, '肥料\s*(\d+)\s*种\s*·\s*作物\s*(\d+)\s*种\s*/\s*(\d+)\s*个生育期')
$results += Write-Check '数据已加载（肥料/作物/生育期数量已渲染）' $metaMatch.Success `
    $(if ($metaMatch.Success) { "肥料 $($metaMatch.Groups[1].Value) 种，$($metaMatch.Groups[3].Value) 个生育期" })

# 2) 首屏自动计算：结果区应有内容
$results += Write-Check '首屏自动计算并渲染结果' ($dom -match '原料用量') 
$results += Write-Check '目标达成情况表已渲染' ($dom -match '目标达成情况')
$results += Write-Check '形态核对表已渲染' ($dom -match '形态核对')

# 3) 原材料列表与编辑器模板已注入
$results += Write-Check '原料勾选列表已渲染' ($dom -match '微量元素（\d+）')
$results += Write-Check '编辑器容器存在' ($dom -match 'id="editorTable"')

# 4) 结果数值正确性：从渲染出的「目标达成情况」表里提取偏差，最大值应 < 1%
#    注意：不能用「DOM 中是否出现错误文案」判断，因为源码字符串本身就内联在 <script> 里。
#    偏差单元格现在带 class="num"（数值列右对齐），断言必须跟着写法走。
$deviationMatches = [regex]::Matches($dom, '<td class="num">([+-]?[0-9.]+)%</td>')
$maxDeviation = 0.0
foreach ($match in $deviationMatches) {
    $magnitude = [math]::Abs([double]$match.Groups[1].Value)
    if ($magnitude -gt $maxDeviation) { $maxDeviation = $magnitude }
}
$results += Write-Check '目标达成偏差 < 1%（求解结果正确）' `
    ($deviationMatches.Count -gt 0 -and $maxDeviation -lt 1) `
    "$($deviationMatches.Count) 个元素，最大偏差 $maxDeviation%"

# 5) 打包产物中不应残留 ES module 语法（file:// 下不可用）
$htmlText = Get-Content $htmlPath -Raw -Encoding UTF8
$results += Write-Check '产物为普通脚本（无 import/export 残留）' `
    (-not ($htmlText -match '(?m)^\s*(import|export)\s'))
$results += Write-Check '样式已内联（无外部 css 链接）' (-not ($htmlText -match '<link[^>]+stylesheet'))

# 6) 数据以内联 JSON 形式存在（构建时注入）
$results += Write-Check '肥料数据已内联' ($htmlText -match 'id="data-fertilizers"')
$results += Write-Check '作物数据已内联' ($htmlText -match 'id="data-crops"')
$results += Write-Check '术语数据已内联' ($htmlText -match 'id="data-glossary"')

# 7) 构建产物不应残留开发期内容（防回归）
$results += Write-Check '开发期警告块已剔除' (-not ($htmlText -match '这是源模板'))
$results += Write-Check '模板占位符已全部替换' `
    (-not ($htmlText -match '/\*__(STYLE|APP|FERTILIZERS|CROPS)__\*/'))

# 8) 配套交付文件完整性
#
# 关于批处理脚本的编码：cmd.exe 按**系统代码页**（中文 Windows 为 GBK/936）读取批处理文件。
# 若脚本以 UTF-8 保存，其中的中文文件名会被解成乱码，导致找不到文件而构建失败
# —— 这是实际踩过的坑，故在此固化为验证项。
$srcDir = Split-Path $htmlPath -Parent
# 构建产物在 dist/ 下，而交付文件（README、构建脚本）在项目根，故上跳一级。
# 兼容直接指向单文件 HTML 的旧用法：父目录不叫 dist 时就用父目录本身。
$deliverableDir = if ((Split-Path $srcDir -Leaf) -eq 'dist') { Split-Path $srcDir -Parent } else { $srcDir }
$launcherPath = Join-Path $deliverableDir 'build-windows.bat'
$hasLauncher = Test-Path $launcherPath
$results += Write-Check '一键构建脚本存在（build-windows.bat）' $hasLauncher

if ($hasLauncher) {
    $launcherBytes = [System.IO.File]::ReadAllBytes($launcherPath)
    $hasUtf8Chinese = $false
    for ($i = 0; $i -lt $launcherBytes.Length - 2; $i++) {
        if ($launcherBytes[$i] -eq 0xE6 -and $launcherBytes[$i + 1] -eq 0xB0 -and $launcherBytes[$i + 2] -eq 0xB4) {
            $hasUtf8Chinese = $true
            break
        }
    }
    $results += Write-Check '构建脚本为 GBK 编码（cmd.exe 能正确解析中文路径）' (-not $hasUtf8Chinese)
    $hasBom = $launcherBytes.Length -ge 3 -and $launcherBytes[0] -eq 0xEF -and $launcherBytes[1] -eq 0xBB
    $results += Write-Check '构建脚本无 BOM（BOM 会让 cmd 报错）' (-not $hasBom)
}

$results += Write-Check 'README 存在' (Test-Path (Join-Path $deliverableDir 'README.md'))

# 9) 交互逻辑：切换作物/生育期应自动载入目标浓度，无需手动点按钮
$targetInput = [regex]::Match($dom, 'id="t0"[^>]*value="([0-9.]+)"')
$targetLoaded = $targetInput.Success -and [double]$targetInput.Groups[1].Value -gt 0
$results += Write-Check '目标浓度已自动载入（切换作物无需手动点按钮）' $targetLoaded `
    $(if ($targetInput.Success) { "NO3-N 目标 = $($targetInput.Groups[1].Value) ppm" } else { '未找到目标输入框' })

# 10) 术语词典：入口与面板应存在，且元素名带悬浮解释
$results += Write-Check '术语词典入口存在' ($dom -match 'id="btnGlossary"')
$results += Write-Check '术语词典面板存在' ($dom -match 'id="glossaryBody"')
$results += Write-Check '元素名带术语悬浮提示（title 属性）' ($dom -match 'title="[^"]*硝态氮[^"]*"')

# 11) 界面精修回归断言（对应本轮视觉/数据呈现改造）
$results += Write-Check '元素悬浮提示含「对种植的影响」（不只是含义）' `
    ($dom -match 'title="[^"]*对种植的影响')
# 断言写成「恰好是 <details class="achieve">」而不是「后面跟 open」：
# 后者会匹配到内联 <script> 里的模板源码 `<details class="achieve"${... ? ' open' : ''}>`。
$results += Write-Check '达成表默认收起（details 未带 open）' `
    ($dom -match '<details class="achieve">')
$results += Write-Check '数值列已标记右对齐（class="num"）' ($dom -match '<td class="num">')
$results += Write-Check '偏差列无 -0.0%（微小负偏差已归零）' (-not ($dom -match '<td class="num">-0\.0%</td>'))
$results += Write-Check '用量表无显示为 0 的行（阈值已统一）' `
    (-not ($dom -match '<td class="num"><strong>0</strong></td>'))
$results += Write-Check '硝态氮未被误显示成 NO3（语义正确）' (-not ($dom -match '>NO3 \d'))
$results += Write-Check '术语可在页面内维护（导入/导出入口存在）' `
    (($dom -match 'id="btnImportGlossary"') -and ($dom -match 'id="btnExportGlossary"'))

# ---------- 汇总 ----------
$passed = ($results | Where-Object { $_ -eq $true }).Count
$total = $results.Count

Write-Host ''
if ($passed -eq $total) {
    Write-Host "浏览器端到端验证：$passed/$total 全部通过" -ForegroundColor Green
    exit 0
}

Write-Host "浏览器端到端验证：$passed/$total 通过，存在失败项" -ForegroundColor Red
exit 1

<#
.SYNOPSIS
    对构建产物做整页截图（供视觉评审与回归对比）。

.DESCRIPTION
    为什么不用 `--screenshot`：Edge / Chrome 154 起已移除该命令行参数（帮助里也查不到），
    因此必须走 CDP（DevTools 协议）：PowerShell 启动无头浏览器并开放调试端口，
    再由 Node 脚本（test/screenshot.mjs）连上去发 Page.captureScreenshot。

    浏览器使用**独立 user-data-dir**，不会影响用户已打开的浏览器实例。

.EXAMPLE
    pwsh -File test/capture.ps1 -Output shot-after.png
#>
param(
    [string]$Html = (Join-Path $PSScriptRoot '..\dist\index.html'),
    [string]$Output = 'shot.png',
    [int]$Width = 1400,
    [int]$Height = 900,
    [int]$Port = 9222,
    [int]$WaitSeconds = 3,
    # 截图前执行的 JS（可选），例如切到「数据编辑」视图：switchView('data')
    [string]$Script = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Html)) {
    Write-Error "未找到构建产物：$Html（请先运行 node build.mjs）"
    exit 1
}

$browserCandidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
)
$browser = $browserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) {
    Write-Error '未找到 Chrome / Edge'
    exit 1
}

$profileDir = Join-Path $env:TEMP 'dsh-cdp-profile'
Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue

$htmlPath = (Resolve-Path $Html).Path
$url = 'file:///' + ($htmlPath -replace '\\', '/')
$outputPath = if ([System.IO.Path]::IsPathRooted($Output)) { $Output } else { Join-Path (Get-Location).Path $Output }

Start-Process $browser -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', "--user-data-dir=$profileDir", "--remote-debugging-port=$Port",
    "--window-size=$Width,$Height", $url
) | Out-Null

# 等待调试端口就绪
$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try {
        Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 | Out-Null
        $ready = $true
        break
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
if (-not $ready) {
    Write-Error "调试端口 $Port 未就绪"
    exit 1
}

Start-Sleep -Seconds $WaitSeconds   # 等首屏自动计算渲染完成

& node (Join-Path $PSScriptRoot 'screenshot.mjs') "$Port" "$outputPath" "$Width" "$Height" "$Script"
$exitCode = $LASTEXITCODE

# 只关闭本次启动的实例（按命令行里的 profile 路径识别，不误杀用户浏览器）
Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
    Where-Object { $_.CommandLine -like '*dsh-cdp-profile*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (Test-Path $outputPath) {
    Add-Type -AssemblyName System.Drawing
    $image = [System.Drawing.Image]::FromFile($outputPath)
    Write-Host "截图：$outputPath（$($image.Width) x $($image.Height) px）" -ForegroundColor Green
    $image.Dispose()
}

exit $exitCode

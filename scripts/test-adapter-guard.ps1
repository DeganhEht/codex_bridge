[CmdletBinding()]
param([string]$TestRoot = '')

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $TestRoot) {
    $TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-bridge-guard-test-' + [guid]::NewGuid().ToString('N'))
}
$TestRoot = [IO.Path]::GetFullPath($TestRoot)
if (Test-Path -LiteralPath $TestRoot) { throw "测试目录必须事先不存在：$TestRoot" }

$guard = Join-Path $repoRoot 'work\thread-localizer\launcher\ensure-deepseek-adapter.ps1'
$installRoot = Join-Path $TestRoot 'install'
$codexHome = Join-Path $TestRoot '.codex'
$configPath = Join-Path $codexHome 'config.toml'
$settingsPath = Join-Path $installRoot 'thread-localizer\data\handoff-settings.json'
$adapterStub = Join-Path $installRoot 'thread-localizer\src\model-name-adapter.mjs'
$realAdapter = Join-Path $repoRoot 'work\thread-localizer\src\model-name-adapter.mjs'
$realSettings = Join-Path $repoRoot 'work\thread-localizer\data\handoff-settings.json'
$logPath = Join-Path $TestRoot 'guard.log'
$port = 10993
$stub = $null
$realAdapterProcess = $null
$cases = 0

function Write-TestConfig {
    param([Parameter(Mandatory = $true)][string]$Mode)

    Set-Content -LiteralPath $configPath -Encoding UTF8 -Value @"
# >>> Codex desktop model switcher: mode (managed; do not edit)
# active_mode = $Mode
model_provider = "$Mode"
# <<< Codex desktop model switcher: mode
"@
}

function Invoke-Guard {
    param([Parameter(Mandatory = $true)][string]$CodexRunning, [switch]$Preview)

    $arguments = @{
        InstallRoot = $installRoot
        CodexHome = $codexHome
        LogPath = $logPath
        CodexRunningOverride = $CodexRunning
    }
    if ($Preview) { $arguments.WhatIf = $true }
    return (& $guard @arguments | ConvertFrom-Json)
}

function Start-HealthStub {
    param([Parameter(Mandatory = $true)][string]$Product)

    $node = (Get-Command 'node.exe' -ErrorAction SilentlyContinue).Source
    if (-not $node) { throw '找不到 node.exe，无法运行守护测试。' }
    # 写成临时脚本再启动：Start-Process 会把含空格的 -e 代码拆成多个参数。
    $scriptPath = Join-Path $TestRoot 'health-stub.cjs'
    Set-Content -LiteralPath $scriptPath -Encoding UTF8 -Value @"
require('http').createServer((q, s) => {
  s.writeHead(200, { 'content-type': 'application/json' });
  s.end(JSON.stringify({ product: '$Product', pid: process.pid, stats: {} }));
}).listen($port, '127.0.0.1');
"@
    $process = Start-Process -FilePath $node -ArgumentList @($scriptPath) -WindowStyle Hidden -PassThru
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 100
        try {
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:$port/__handoff_model_adapter_health" -TimeoutSec 2
            return $process
        } catch { }
    }
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    throw '健康检查桩进程没有启动。'
}

function Wait-PortFree {
    param([Parameter(Mandatory = $true)][int]$Port, [int]$TimeoutMs = 5000)

    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    while ((Get-Date) -lt $deadline) {
        $client = $null
        try {
            $client = [System.Net.Sockets.TcpClient]::new()
            $connect = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
            if (-not ($connect.AsyncWaitHandle.WaitOne(300) -and $client.Connected)) { return $true }
        } catch {
            return $true
        } finally {
            if ($client) { $client.Dispose() }
        }
        Start-Sleep -Milliseconds 200
    }
    return $false
}

try {
    New-Item -ItemType Directory -Path $codexHome, (Split-Path -Parent $settingsPath), (Split-Path -Parent $adapterStub) -Force | Out-Null
    Set-Content -LiteralPath $adapterStub -Value '// 测试占位文件' -Encoding UTF8
    @{
        managedProviders = @{
            deepseek = @{
                modelAdapter = @{ port = $port; upstreamBaseUrl = 'https://api.deepseek.com/' }
            }
        }
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $settingsPath -Encoding UTF8

    Write-TestConfig -Mode 'gpt'
    $result = Invoke-Guard -CodexRunning true -Preview
    if ($result.action -ne 'skip-not-deepseek') { throw "GPT 模式应跳过，实际：$($result.action)" }
    $cases++

    Write-TestConfig -Mode 'deepseek'
    $result = Invoke-Guard -CodexRunning false -Preview
    if ($result.action -ne 'skip-no-codex') { throw "Codex 未运行时应跳过，实际：$($result.action)" }
    $cases++

    $result = Invoke-Guard -CodexRunning true -Preview
    if ($result.action -ne 'would-start') { throw "端口空闲时应启动，实际：$($result.action)" }
    $cases++

    $stub = Start-HealthStub -Product 'Codex-DeepSeek-Handoff model-name-adapter'
    $result = Invoke-Guard -CodexRunning true -Preview
    if ($result.action -ne 'reuse') { throw "已有适配器时应复用，实际：$($result.action)" }
    $cases++
    Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
    $stub = $null
    $null = Wait-PortFree -Port $port

    $stub = Start-HealthStub -Product 'some-other-program'
    $result = Invoke-Guard -CodexRunning true -Preview
    if ($result.action -ne 'port-occupied-by-other') { throw "端口被占用时应退让，实际：$($result.action)" }
    $cases++
    Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
    $stub = $null
    if (-not (Wait-PortFree -Port $port)) { throw "测试端口 $port 没有及时释放。" }

    # 6) 真实启动路径：端口空闲时守护会把真正的适配器拉起来（用测试端口，不碰 10101）
    # 适配器会 import 同目录的其它模块，所以整份 src 都要复制过去。
    Copy-Item -Path (Join-Path (Split-Path -Parent $realAdapter) '*') `
        -Destination (Split-Path -Parent $adapterStub) -Recurse -Force
    $settings = Get-Content -LiteralPath $realSettings -Raw -Encoding UTF8 | ConvertFrom-Json
    $settings.managedProviders.deepseek.modelAdapter.port = $port
    $settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $settingsPath -Encoding UTF8
    $result = Invoke-Guard -CodexRunning true
    if ($result.action -ne 'started') { throw "守护应启动适配器，实际：$($result.action) $($result.detail)" }
    if ([int]$result.port -ne $port) { throw "守护启动了错误端口：$($result.port)" }
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/__handoff_model_adapter_health" -TimeoutSec 3
    if ($health.product -ne 'Codex-DeepSeek-Handoff model-name-adapter') { throw '守护启动的进程不是本项目适配器。' }
    $realAdapterProcess = Get-Process -Id ([int]$health.pid) -ErrorAction SilentlyContinue
    $result = Invoke-Guard -CodexRunning true -Preview
    if ($result.action -ne 'reuse') { throw "第二次检查应复用，实际：$($result.action)" }
    $cases++

    [ordered]@{ status = 'ok'; cases = $cases; port = $port } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $realAdapterProcess -and -not $realAdapterProcess.HasExited) {
        Stop-Process -Id $realAdapterProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $stub -and -not $stub.HasExited) {
        Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $TestRoot) {
        $resolved = (Resolve-Path -LiteralPath $TestRoot).Path
        if ($resolved -ne $TestRoot) { throw "拒绝清理意外路径：$resolved" }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

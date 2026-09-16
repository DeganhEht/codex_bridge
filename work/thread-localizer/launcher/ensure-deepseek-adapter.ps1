<#
.SYNOPSIS
  确保“配置处于 DeepSeek 模式时本机一定有人在监听适配器端口”。

.DESCRIPTION
  给“直接点 Codex 图标”（没有走快捷方式）做的安全网。它只做四件事：

    1. 读 config.toml 的受管模式区块；不是 deepseek 就直接退出；
    2. 健康检查 127.0.0.1:<port>；已有本项目适配器就直接退出（绝不重复启动）；
    3. 端口被别的程序占用时只记日志并退出（绝不抢占、绝不结束任何进程）；
    4. 端口空闲时才启动一个适配器（隐藏窗口、日志照旧、不传 --parent-pid，
       由适配器自己按“Codex 是否还在”决定何时退出）。

  它不改 config.toml、不建/删快捷方式、不碰任务数据库，也不结束任何进程，
  因此与两个桌面快捷方式和启动器都不冲突：快捷方式已经启动的适配器会被它识别为
  “已健康”并直接复用。
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Low')]
param(
    [string]$InstallRoot = '',
    [string]$CodexHome = '',
    [string]$LogPath = '',
    [ValidateSet('auto', 'true', 'false')][string]$CodexRunningOverride = 'auto'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $InstallRoot) {
    $InstallRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Join-Path $env:USERPROFILE '.codex\model-switcher' }
}
if (-not $CodexHome) {
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
}

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$configPath = Join-Path $CodexHome 'config.toml'
$settingsPath = Join-Path $InstallRoot 'thread-localizer\data\handoff-settings.json'
$adapterPath = Join-Path $InstallRoot 'thread-localizer\src\model-name-adapter.mjs'
$handoffLogRoot = Join-Path $InstallRoot 'handoff-logs'
if (-not $LogPath) { $LogPath = Join-Path $handoffLogRoot 'adapter-guard.log' }

$managedStart = '# >>> Codex desktop model switcher: mode (managed; do not edit)'
$managedEnd = '# <<< Codex desktop model switcher: mode'
$adapterProduct = 'Codex-DeepSeek-Handoff model-name-adapter'
$mutexName = 'Local\CodexDeepSeekAdapterGuard'

function Write-GuardLog {
    param([Parameter(Mandatory = $true)][string]$Message)

    try {
        New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force | Out-Null
        Add-Content -LiteralPath $LogPath -Value ("{0} {1}" -f (Get-Date).ToString('o'), $Message) -Encoding UTF8
    } catch {
        # 日志写不进去不影响守护逻辑。
    }
}

function Read-CurrentMode {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return $null }
    $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
    $pattern = "(?ms)^$([regex]::Escape($managedStart))\r?\n(?<body>.*?)^$([regex]::Escape($managedEnd))"
    $match = [regex]::Match($raw, $pattern)
    if (-not $match.Success) { return $null }
    $modeMatch = [regex]::Match($match.Groups['body'].Value, '(?m)^\s*#?\s*active_mode\s*=\s*([A-Za-z]+)')
    if (-not $modeMatch.Success) { return $null }
    $mode = $modeMatch.Groups[1].Value.ToLowerInvariant()
    if ($mode -in @('gpt', 'deepseek')) { return $mode }
    return $null
}

function Test-AdapterHealth {
    param([Parameter(Mandatory = $true)][int]$Port)

    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/__handoff_model_adapter_health" -TimeoutSec 1
        if ($health.product -eq $adapterProduct) {
            return [pscustomobject]@{ State = 'healthy'; Pid = [int]$health.pid; Port = $Port }
        }
        return [pscustomobject]@{ State = 'foreign'; Pid = $null; Port = $Port }
    } catch {
        $client = $null
        try {
            $client = [System.Net.Sockets.TcpClient]::new()
            $connect = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
            if ($connect.AsyncWaitHandle.WaitOne(500) -and $client.Connected) {
                return [pscustomobject]@{ State = 'foreign'; Pid = $null; Port = $Port }
            }
            return [pscustomobject]@{ State = 'free'; Pid = $null; Port = $Port }
        } catch {
            return [pscustomobject]@{ State = 'free'; Pid = $null; Port = $Port }
        } finally {
            if ($client) { $client.Dispose() }
        }
    }
}

function Test-CodexRunning {
    if ($CodexRunningOverride -eq 'true') { return $true }
    if ($CodexRunningOverride -eq 'false') { return $false }
    try {
        $output = (& tasklist /FI 'IMAGENAME eq ChatGPT.exe' /NH 2>$null | Out-String)
        return [bool]($output -match 'ChatGPT\.exe')
    } catch {
        # 无法判断时按“在运行”处理：多检查一次比漏掉守护安全。
        return $true
    }
}

function Find-NodePath {
    $command = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    return $null
}

function Write-GuardResult {
    param([Parameter(Mandatory = $true)][hashtable]$Result)

    $Result | ConvertTo-Json -Compress
}

$mutex = $null
$mutexAcquired = $false
try {
    $mutex = [System.Threading.Mutex]::new($false, $mutexName)
    try {
        $mutexAcquired = $mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        $mutexAcquired = $true
    }
    if (-not $mutexAcquired) {
        Write-GuardResult @{ action = 'skip-already-running'; mode = $null; port = $null; pid = $null }
        exit 0
    }

    $mode = Read-CurrentMode
    if (-not $mode) {
        Write-GuardLog 'skip-no-config-mode'
        Write-GuardResult @{ action = 'skip-no-config-mode'; mode = $null; port = $null; pid = $null }
        exit 0
    }
    if ($mode -ne 'deepseek') {
        Write-GuardResult @{ action = 'skip-not-deepseek'; mode = $mode; port = $null; pid = $null }
        exit 0
    }
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $adapterPath -PathType Leaf)) {
        Write-GuardLog 'skip-missing-files'
        Write-GuardResult @{ action = 'skip-missing-files'; mode = $mode; port = $null; pid = $null }
        exit 0
    }
    if (-not (Test-CodexRunning)) {
        # Codex 没在跑就不需要适配器：避免登录常驻时反复拉起又自我清理。
        Write-GuardResult @{ action = 'skip-no-codex'; mode = $mode; port = $null; pid = $null }
        exit 0
    }

    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $port = [int]$settings.managedProviders.deepseek.modelAdapter.port
    $upstream = [string]$settings.managedProviders.deepseek.modelAdapter.upstreamBaseUrl

    $health = Test-AdapterHealth -Port $port
    if ($health.State -eq 'healthy') {
        Write-GuardResult @{ action = 'reuse'; mode = $mode; port = $port; pid = $health.Pid }
        exit 0
    }
    if ($health.State -eq 'foreign') {
        Write-GuardLog "port-occupied-by-other port=$port"
        Write-GuardResult @{ action = 'port-occupied-by-other'; mode = $mode; port = $port; pid = $null }
        exit 0
    }

    if ($WhatIfPreference) {
        Write-GuardResult @{ action = 'would-start'; mode = $mode; port = $port; pid = $null }
        exit 0
    }

    $node = Find-NodePath
    if (-not $node) {
        Write-GuardLog 'start-failed reason=node-not-found'
        Write-GuardResult @{ action = 'start-failed'; mode = $mode; port = $port; pid = $null; detail = 'node-not-found' }
        exit 0
    }

    New-Item -ItemType Directory -Path $handoffLogRoot -Force | Out-Null
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutPath = Join-Path $handoffLogRoot "model-adapter.$timestamp.stdout.txt"
    $stderrPath = Join-Path $handoffLogRoot "model-adapter.$timestamp.stderr.txt"
    $arguments = @(
        $adapterPath,
        '--port', [string]$port,
        '--upstream', $upstream,
        '--settings', $settingsPath,
        '--log-dir', $handoffLogRoot
    )
    $process = Start-Process -FilePath $node -ArgumentList $arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        if ($process.HasExited) { break }
        $probe = Test-AdapterHealth -Port $port
        if ($probe.State -eq 'healthy') {
            Write-GuardLog "started pid=$($probe.Pid) port=$port"
            Write-GuardResult @{ action = 'started'; mode = $mode; port = $port; pid = $probe.Pid }
            exit 0
        }
    }

    $detail = if (Test-Path -LiteralPath $stderrPath) {
        (Get-Content -LiteralPath $stderrPath -Tail 3) -join ' '
    } else {
        'adapter did not become healthy'
    }
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    Write-GuardLog "start-failed port=$port detail=$detail"
    Write-GuardResult @{ action = 'start-failed'; mode = $mode; port = $port; pid = $null; detail = $detail }
    exit 0
} catch {
    Write-GuardLog "guard-error $($_.Exception.Message)"
    Write-GuardResult @{ action = 'guard-error'; mode = $null; port = $null; pid = $null; detail = $_.Exception.Message }
    exit 0
} finally {
    if ($mutexAcquired -and $null -ne $mutex) {
        try { $mutex.ReleaseMutex() } catch { }
    }
    if ($null -ne $mutex) { $mutex.Dispose() }
}

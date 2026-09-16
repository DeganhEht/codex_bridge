[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string]$InstallRoot = '',
    [string]$CodexHome = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $CodexHome) {
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
}
if (-not $InstallRoot) {
    $InstallRoot = Join-Path $CodexHome 'model-switcher'
}
$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)

$configPath = Join-Path $CodexHome 'config.toml'
$settingsPath = Join-Path $InstallRoot 'thread-localizer\data\handoff-settings.json'
$catalogPath = Join-Path $InstallRoot 'models-deepseek.json'
$keyHelperPath = Join-Path $InstallRoot 'get-deepseek-key.ps1'
$statePath = Join-Path $InstallRoot 'handoff-install-state.json'
$backupRoot = Join-Path $CodexHome 'backups\codex-deepseek-handoff-install'
$modeStart = '# >>> Codex desktop model switcher: mode (managed; do not edit)'
$modeEnd = '# <<< Codex desktop model switcher: mode'
$providerStart = '# >>> Codex desktop model switcher: DeepSeek provider (managed; do not edit)'
$providerEnd = '# <<< Codex desktop model switcher: DeepSeek provider'

foreach ($requiredPath in @($settingsPath, $catalogPath, $keyHelperPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw @"
缺少 DeepSeek 官方接入文件：$requiredPath

请先按照 DeepSeek 官方 Codex 安装说明完成基础接入，再运行本项目安装器。
本项目负责跨模型任务交接，不重新分发官方模型目录。
"@
    }
}

function Find-CodexExecutable {
    $binRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
    if (Test-Path -LiteralPath $binRoot -PathType Container) {
        $candidate = Get-ChildItem -LiteralPath $binRoot -Directory -ErrorAction SilentlyContinue |
            ForEach-Object {
                $exe = Join-Path $_.FullName 'codex.exe'
                if (Test-Path -LiteralPath $exe -PathType Leaf) { Get-Item -LiteralPath $exe }
            } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($candidate) { return $candidate.FullName }
    }
    $command = Get-Command 'codex.exe' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw '找不到 Codex CLI，无法验证候选配置。请先正常安装并启动一次 Codex。'
}

function Find-PowerShellExecutable {
    $command = Get-Command 'pwsh.exe' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
}

function ConvertTo-TomlPath {
    param([string]$Path)
    return ([IO.Path]::GetFullPath($Path) -replace '\\', '/').Replace('"', '\"')
}

function Assert-MarkerPair {
    param([string]$Raw, [string]$Start, [string]$End, [string]$Label)
    $startCount = [regex]::Matches($Raw, "(?m)^$([regex]::Escape($Start))\r?$").Count
    $endCount = [regex]::Matches($Raw, "(?m)^$([regex]::Escape($End))\r?$").Count
    if ($startCount -ne $endCount -or $startCount -gt 1) {
        throw "$Label 受管区块标记不完整或重复（开始 $startCount，结束 $endCount）。为避免误改，已停止。"
    }
    return $startCount
}

function Replace-ManagedBlock {
    param([string]$Raw, [string]$Start, [string]$End, [string]$Block)
    $pattern = "(?ms)^$([regex]::Escape($Start))\r?\n.*?^$([regex]::Escape($End))\r?$"
    return [regex]::Replace($Raw, $pattern, $Block, 1)
}

function Remove-TopLevelKeys {
    param([string]$Raw, [string[]]$Keys)
    $keyPattern = ($Keys | ForEach-Object { [regex]::Escape($_) }) -join '|'
    $lines = $Raw -split "`r?`n"
    $out = New-Object System.Collections.Generic.List[string]
    $insideTable = $false
    foreach ($line in $lines) {
        if (-not $insideTable -and $line -match '^\s*\[') {
            $insideTable = $true
        }
        if (-not $insideTable -and $line -match "^\s*(?:$keyPattern)\s*=") {
            continue
        }
        $out.Add($line)
    }
    return ($out -join "`r`n")
}

function Test-CandidateConfig {
    param([string]$Candidate)
    $validationHome = Join-Path $InstallRoot ('.config-validation-' + [guid]::NewGuid().ToString('N'))
    $validationConfig = Join-Path $validationHome 'config.toml'
    New-Item -ItemType Directory -Path $validationHome -Force | Out-Null
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($validationConfig, $Candidate, $utf8NoBom)
    $savedCodexHome = $env:CODEX_HOME
    try {
        $env:CODEX_HOME = $validationHome
        $doctorOutput = & (Find-CodexExecutable) --strict-config doctor --json 2>&1
        $doctorExit = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
        try {
            $doctorText = ((@($doctorOutput | ForEach-Object { "$_" })) -join [Environment]::NewLine)
            # Codex doctor can emit non-JSON warnings before the JSON document
            # (for example, PATH-alias warnings under a temporary CODEX_HOME).
            # Parse the JSON document instead of requiring stdout to be pure JSON.
            $jsonStart = $doctorText.IndexOf('{')
            if ($jsonStart -lt 0) { throw 'doctor output did not contain a JSON document' }
            $doctorJson = $doctorText.Substring($jsonStart) | ConvertFrom-Json
        } catch {
            throw "无法解析 Codex doctor 输出（退出码 $doctorExit）：$((@($doctorOutput) | Select-Object -Last 5) -join [Environment]::NewLine)"
        }
        if ($doctorJson.checks.'config.load'.status -ne 'ok') {
            throw "候选 config.toml 未通过 Codex config.load 检查（doctor 退出码 $doctorExit）。"
        }
    } finally {
        if ($null -eq $savedCodexHome) { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue } else { $env:CODEX_HOME = $savedCodexHome }
        Remove-Item -LiteralPath $validationHome -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$openAIModel = [string]$settings.managedProviders.openai.activeModel
if (-not $openAIModel) { throw 'handoff-settings.json 缺少 managedProviders.openai.activeModel。' }
$rawConfig = if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
} else {
    ''
}

# The active config may already contain model/provider keys written by the
# official DeepSeek installer. Remove only the top-level keys owned by this
# handoff mode block before adding the managed GPT mode block. This prevents
# duplicate TOML keys when Codex has strict config loading enabled.
$rawConfig = Remove-TopLevelKeys -Raw $rawConfig -Keys @(
    'model',
    'model_provider',
    'preferred_auth_method',
    'forced_login_method',
    'model_reasoning_effort',
    'model_catalog_json'
)

$modeBlock = @"
$modeStart
# active_mode = gpt
model = "$openAIModel"
model_reasoning_effort = "high"
forced_login_method = "chatgpt"
$modeEnd
"@
$modeCount = Assert-MarkerPair -Raw $rawConfig -Start $modeStart -End $modeEnd -Label '模式'
$candidate = if ($modeCount -eq 1) {
    Replace-ManagedBlock -Raw $rawConfig -Start $modeStart -End $modeEnd -Block $modeBlock
} else {
    "$modeBlock`r`n`r`n$rawConfig"
}

$providerManagedCount = Assert-MarkerPair -Raw $candidate -Start $providerStart -End $providerEnd -Label 'DeepSeek provider'
$externalProvider = $candidate -match '(?m)^\s*\[model_providers\.deepseek\]\s*$'
$providerAdded = $false
if ($providerManagedCount -eq 0 -and -not $externalProvider) {
    $pwshPath = ConvertTo-TomlPath (Find-PowerShellExecutable)
    $helperTomlPath = ConvertTo-TomlPath $keyHelperPath
    $providerBlock = @"
$providerStart
[model_providers.deepseek]
name = "DeepSeek"
base_url = "https://api.deepseek.com/"
wire_api = "responses"
requires_openai_auth = false

[model_providers.deepseek.auth]
command = "$pwshPath"
args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$helperTomlPath"]
timeout_ms = 5000
refresh_interval_ms = 300000
$providerEnd
"@
    $candidate = "$($candidate.TrimEnd())`r`n`r`n$providerBlock`r`n"
    $providerAdded = $true
}
$candidate = $candidate.TrimEnd() + "`r`n"

if ($WhatIfPreference) {
    [ordered]@{
        configPath = $configPath
        modeAction = if ($modeCount -eq 1) { 'replace-managed-block' } else { 'add-managed-block' }
        providerAction = if ($providerAdded) { 'add-managed-provider' } elseif ($providerManagedCount -eq 1) { 'keep-managed-provider' } else { 'keep-external-provider' }
        validation = 'skipped-in-whatif'
        changed = ($candidate -cne $rawConfig)
    } | ConvertTo-Json
    exit 0
}

Test-CandidateConfig -Candidate $candidate
if (-not ($candidate -cne $rawConfig)) {
    [ordered]@{ configPath = $configPath; changed = $false; validated = $true } | ConvertTo-Json
    exit 0
}

if ($PSCmdlet.ShouldProcess($configPath, '备份并写入 Codex-DeepSeek-Handoff 受管配置')) {
    New-Item -ItemType Directory -Path $CodexHome -Force | Out-Null
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backupPath = Join-Path $backupRoot "config.$timestamp.before-handoff-install.toml"
    $temporaryPath = Join-Path $CodexHome "config.toml.handoff-install-$timestamp.tmp"
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    try {
        [IO.File]::WriteAllText($temporaryPath, $candidate, $utf8NoBom)
        if (Test-Path -LiteralPath $configPath -PathType Leaf) {
            [IO.File]::Replace($temporaryPath, $configPath, $backupPath, $true)
        } else {
            Move-Item -LiteralPath $temporaryPath -Destination $configPath
        }
    } finally {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
    $state = [ordered]@{
        version = 1
        configuredAt = [DateTime]::UtcNow.ToString('o')
        configPath = $configPath
        configBackupPath = if (Test-Path -LiteralPath $backupPath) { $backupPath } else { $null }
        modeBlockManaged = $true
        providerBlockAdded = $providerAdded
        externalProviderPreserved = [bool]($externalProvider -and $providerManagedCount -eq 0)
    }
    $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

[ordered]@{
    configPath = $configPath
    changed = $true
    validated = $true
    providerAdded = $providerAdded
    statePath = $statePath
} | ConvertTo-Json

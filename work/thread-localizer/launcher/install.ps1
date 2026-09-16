[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string]$SourceRoot = '',
    [string]$InstallRoot = '',
    [string]$CodexHome = '',
    [string]$DesktopPath = '',
    [switch]$SkipConfiguration,
    [switch]$SkipShortcuts
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $SourceRoot) {
    $toolSource = Split-Path -Parent $PSScriptRoot
    $SourceRoot = Split-Path -Parent (Split-Path -Parent $toolSource)
}
if (-not $InstallRoot) {
    $InstallRoot = Join-Path (Join-Path $env:USERPROFILE '.codex') 'model-switcher'
}
if (-not $CodexHome) {
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
}

$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$threadSource = Join-Path $SourceRoot 'work\thread-localizer'
$modelSource = Join-Path $SourceRoot 'work\model-switcher'

foreach ($requiredPath in @(
        (Join-Path $threadSource 'src'),
        (Join-Path $threadSource 'data\handoff-settings.json'),
        (Join-Path $threadSource 'package.json'),
        (Join-Path $threadSource 'launcher\codex-desktop-model-launcher.ps1'),
        (Join-Path $threadSource 'launcher\handoff-result-contract.psm1'),
        (Join-Path $threadSource 'launcher\initialize-handoff.ps1'),
        (Join-Path $threadSource 'launcher\create-handoff-shortcuts.ps1'),
        (Join-Path $threadSource 'launcher\uninstall.ps1'),
        (Join-Path $modelSource 'get-deepseek-key.ps1')
    )) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "安装源不完整，找不到：$requiredPath"
    }
}

$catalogPath = Join-Path $InstallRoot 'models-deepseek.json'
if (-not (Test-Path -LiteralPath $catalogPath -PathType Leaf)) {
    throw @"
找不到 DeepSeek 官方模型目录：$catalogPath

请先运行并检查 DeepSeek 官方 Codex 接入脚本，确认 DeepSeek 能在 Codex 中启动，
再运行 Codex-DeepSeek-Handoff 安装器。本项目不重新分发官方模型目录。
"@
}

function Copy-FileChecked {
    param([string]$Source, [string]$Destination)
    if ($PSCmdlet.ShouldProcess($Destination, "复制 $Source")) {
        $parent = Split-Path -Parent $Destination
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
    }
}

function Copy-DirectoryChecked {
    param([string]$Source, [string]$Destination)
    if ($PSCmdlet.ShouldProcess($Destination, "复制目录 $Source")) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
    }
}

if ($PSCmdlet.ShouldProcess($InstallRoot, '创建 Codex-DeepSeek-Handoff 安装目录')) {
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
}

Copy-FileChecked (Join-Path $threadSource 'launcher\codex-desktop-model-launcher.ps1') (Join-Path $InstallRoot 'codex-desktop-model-launcher.ps1')
Copy-FileChecked (Join-Path $threadSource 'launcher\handoff-result-contract.psm1') (Join-Path $InstallRoot 'handoff-result-contract.psm1')
Copy-FileChecked (Join-Path $threadSource 'launcher\create-gpt-handoff-shortcut.ps1') (Join-Path $InstallRoot 'create-gpt-handoff-shortcut.ps1')
Copy-FileChecked (Join-Path $threadSource 'launcher\create-handoff-shortcuts.ps1') (Join-Path $InstallRoot 'create-handoff-shortcuts.ps1')
Copy-FileChecked (Join-Path $threadSource 'launcher\initialize-handoff.ps1') (Join-Path $InstallRoot 'initialize-handoff.ps1')
Copy-FileChecked (Join-Path $threadSource 'launcher\uninstall.ps1') (Join-Path $InstallRoot 'uninstall.ps1')
$keyHelperDestination = Join-Path $InstallRoot 'get-deepseek-key.ps1'
if (-not (Test-Path -LiteralPath $keyHelperDestination -PathType Leaf)) {
    Copy-FileChecked (Join-Path $modelSource 'get-deepseek-key.ps1') $keyHelperDestination
}
Copy-DirectoryChecked (Join-Path $threadSource 'src') (Join-Path $InstallRoot 'thread-localizer\src')
$obsoleteTaskBackupModule = Join-Path $InstallRoot 'thread-localizer\src\backup.mjs'
if ((Test-Path -LiteralPath $obsoleteTaskBackupModule -PathType Leaf) -and
    $PSCmdlet.ShouldProcess($obsoleteTaskBackupModule, '移除旧版累计任务备份模块')) {
    Remove-Item -LiteralPath $obsoleteTaskBackupModule -Force
}
Copy-FileChecked (Join-Path $threadSource 'data\handoff-settings.json') (Join-Path $InstallRoot 'thread-localizer\data\handoff-settings.json')
Copy-FileChecked (Join-Path $threadSource 'package.json') (Join-Path $InstallRoot 'thread-localizer\package.json')
Copy-FileChecked (Join-Path $threadSource 'README.md') (Join-Path $InstallRoot 'thread-localizer\README.md')

$configurationResult = $null
$shortcutResult = $null
if (-not $WhatIfPreference -and -not $SkipConfiguration) {
    $configurationResult = & (Join-Path $InstallRoot 'initialize-handoff.ps1') -InstallRoot $InstallRoot -CodexHome $CodexHome -Confirm:$false | ConvertFrom-Json
}
if (-not $WhatIfPreference -and -not $SkipShortcuts) {
    if ($DesktopPath) {
        $shortcutResult = & (Join-Path $InstallRoot 'create-handoff-shortcuts.ps1') -InstallRoot $InstallRoot -DesktopPath $DesktopPath -Provider both -Confirm:$false | ConvertFrom-Json
    } else {
        $shortcutResult = & (Join-Path $InstallRoot 'create-handoff-shortcuts.ps1') -InstallRoot $InstallRoot -Provider both -Confirm:$false | ConvertFrom-Json
    }
}

$manifest = [ordered]@{
    product = 'Codex-DeepSeek-Handoff'
    installedAt = [DateTime]::UtcNow.ToString('o')
    sourceRoot = $SourceRoot
    installRoot = $InstallRoot
    handoffRoot = (Join-Path $InstallRoot 'thread-localizer')
    files = @(
        'codex-desktop-model-launcher.ps1',
        'handoff-result-contract.psm1',
        'create-gpt-handoff-shortcut.ps1',
        'create-handoff-shortcuts.ps1',
        'initialize-handoff.ps1',
        'uninstall.ps1',
        'get-deepseek-key.ps1',
        'thread-localizer\src',
        'thread-localizer\data\handoff-settings.json',
        'thread-localizer\package.json',
        'thread-localizer\README.md'
    )
    officialCatalogPreserved = 'models-deepseek.json is required but never overwritten by this installer.'
    secretFilePreserved = 'deepseek-api-key.dpapi is never created or overwritten by this installer.'
    configuration = $configurationResult
    shortcuts = $shortcutResult
}
$manifestPath = Join-Path $InstallRoot 'install-manifest.json'
if ($PSCmdlet.ShouldProcess($manifestPath, '写入安装清单')) {
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
}

[ordered]@{
    sourceRoot = $SourceRoot
    installRoot = $InstallRoot
    handoffRoot = (Join-Path $InstallRoot 'thread-localizer')
    whatIf = [bool]$WhatIfPreference
    configurationPlanned = -not $SkipConfiguration
    shortcutsPlanned = -not $SkipShortcuts
    next = if ($WhatIfPreference) { '检查计划无误后，去掉 -WhatIf 再运行。' } else { '使用桌面的两个任务交接入口切换模型。' }
} | ConvertTo-Json

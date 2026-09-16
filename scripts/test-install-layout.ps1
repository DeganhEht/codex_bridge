[CmdletBinding()]
param([string]$TestRoot = '')

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $TestRoot) {
    $TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-deepseek-handoff-install-test-' + [guid]::NewGuid().ToString('N'))
}
$TestRoot = [IO.Path]::GetFullPath($TestRoot)
if (Test-Path -LiteralPath $TestRoot) { throw "测试目录必须事先不存在：$TestRoot" }

$installRoot = Join-Path $TestRoot 'install'
$codexHome = Join-Path $TestRoot '.codex'
$desktopPath = Join-Path $TestRoot 'Desktop'
$installer = Join-Path $repoRoot 'work\thread-localizer\launcher\install.ps1'

try {
    New-Item -ItemType Directory -Path $installRoot, $codexHome, $desktopPath -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $installRoot 'models-deepseek.json') -Value '{"models":[]}' -Encoding UTF8

    # -SkipAdapterGuard: 布局测试不注册真实的计划任务，避免污染当前用户。
    $null = & $installer -SourceRoot $repoRoot -InstallRoot $installRoot -CodexHome $codexHome -DesktopPath $desktopPath -SkipConfiguration -SkipShortcuts -SkipAdapterGuard -Confirm:$false
    foreach ($requiredPath in @(
            'codex-desktop-model-launcher.ps1',
            'ensure-deepseek-adapter.ps1',
            'handoff-result-contract.psm1',
            'initialize-handoff.ps1',
            'create-handoff-shortcuts.ps1',
            'uninstall.ps1',
            'thread-localizer\src\cli.mjs',
            'thread-localizer\data\handoff-settings.json'
        )) {
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot $requiredPath))) {
            throw "安装布局缺少：$requiredPath"
        }
    }

    New-Item -ItemType Directory -Path (Join-Path $installRoot 'thread-localizer\reports') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $installRoot 'thread-localizer\data\batch-handoff-manifest.json') -Value '{}'
    Set-Content -LiteralPath (Join-Path $installRoot 'thread-localizer\reports\preserve-check.txt') -Value 'preserve'
    $null = & (Join-Path $installRoot 'uninstall.ps1') -InstallRoot $installRoot -CodexHome $codexHome -DesktopPath $desktopPath -Confirm:$false

    $checks = [ordered]@{
        catalogPreserved = Test-Path -LiteralPath (Join-Path $installRoot 'models-deepseek.json')
        manifestPreserved = Test-Path -LiteralPath (Join-Path $installRoot 'thread-localizer\data\batch-handoff-manifest.json')
        reportPreserved = Test-Path -LiteralPath (Join-Path $installRoot 'thread-localizer\reports\preserve-check.txt')
        sourceRemoved = -not (Test-Path -LiteralPath (Join-Path $installRoot 'thread-localizer\src'))
        adapterGuardRemoved = -not (Test-Path -LiteralPath (Join-Path $installRoot 'ensure-deepseek-adapter.ps1'))
        resultContractRemoved = -not (Test-Path -LiteralPath (Join-Path $installRoot 'handoff-result-contract.psm1'))
        shortcutsAbsent = @(Get-ChildItem -LiteralPath $desktopPath -Filter '*.lnk').Count -eq 0
    }
    if ($checks.Values -contains $false) { throw "安装/卸载布局验收失败：$($checks | ConvertTo-Json -Compress)" }
    [ordered]@{ status = 'ok'; checks = $checks } | ConvertTo-Json -Depth 4
} finally {
    if (Test-Path -LiteralPath $TestRoot) {
        $resolved = (Resolve-Path -LiteralPath $TestRoot).Path
        if ($resolved -ne $TestRoot) { throw "拒绝清理意外路径：$resolved" }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

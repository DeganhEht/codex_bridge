$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $repoRoot 'work\thread-localizer\launcher\codex-desktop-model-launcher.ps1'
$launcherText = Get-Content -LiteralPath $launcherPath -Raw -Encoding UTF8

$pattern = '(?ms)^function\s+Sync-CodexSidebarRegistrations\s*\{.*?^\}'
$match = [regex]::Match($launcherText, $pattern)
if (-not $match.Success) { throw '启动器中找不到 Sync-CodexSidebarRegistrations' }
Invoke-Expression $match.Value

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)][AllowNull()][object]$Actual,
        [Parameter(Mandatory = $true)][AllowNull()][object]$Expected,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if ("$Actual" -ne "$Expected") { throw "$Message；实际=$Actual，期望=$Expected" }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-sidebar-sync-' + [guid]::NewGuid().ToString('N'))
try {
    $codexHome = Join-Path $testRoot 'codex-home'
    $handoffLogRoot = Join-Path $testRoot 'handoff-logs'
    New-Item -ItemType Directory -Path $codexHome, $handoffLogRoot -Force | Out-Null

    $sourceId = '01a0720b-0988-77a0-994c-4a2ab19581a8'
    $targetId = '01a0a924-958f-7ec3-9b2a-96fa0e039779'
    $otherId = '01a09b4c-41fc-7d61-920f-3614df22d6b4'
    $fixture = [ordered]@{
        'thread-workspace-root-hints' = [ordered]@{ $sourceId = 'C:\Users\ozq\Documents\Codex'; $otherId = 'C:\Users\ozq\Documents\Codex' }
        'thread-writable-roots' = [ordered]@{ $sourceId = @('C:\Users\ozq\Documents\Codex\2026-09-05\agents-md-skills-1-2-3') }
        'thread-projectless-output-directories' = [ordered]@{ $sourceId = 'C:\Users\ozq\Documents\Codex\2026-09-05\agents-md-skills-1-2-3\outputs' }
        'projectless-thread-ids' = @($sourceId, $otherId)
        'unrelated-key' = 'keep-me'
    }
    $statePath = Join-Path $codexHome '.codex-global-state.json'
    $fixture | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $statePath -Encoding UTF8

    $handoffResult = [pscustomobject]@{
        results = @(
            [pscustomobject]@{ status = 'noop'; sourceThreadId = $sourceId; targetThreadId = $targetId }
        )
    }
    $sync = Sync-CodexSidebarRegistrations -HandoffResult $handoffResult
    Assert-Equal $sync.Applied $true '同步应当写入状态文件'

    $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $hints = $state.'thread-workspace-root-hints'
    $writableRoots = $state.'thread-writable-roots'
    $outputDirectories = $state.'thread-projectless-output-directories'
    Assert-Equal $hints.PSObject.Properties[$targetId].Value 'C:\Users\ozq\Documents\Codex' '目标端点缺少工作区根提示'
    Assert-Equal ($state.'projectless-thread-ids' -contains $targetId) $true '目标端点未登记为 projectless'
    Assert-Equal $writableRoots.PSObject.Properties[$targetId].Value[0] 'C:\Users\ozq\Documents\Codex\2026-09-05\agents-md-skills-1-2-3' '目标端点缺少可写根'
    Assert-Equal $outputDirectories.PSObject.Properties[$targetId].Value 'C:\Users\ozq\Documents\Codex\2026-09-05\agents-md-skills-1-2-3\outputs' '目标端点缺少输出目录'
    Assert-Equal $state.'unrelated-key' 'keep-me' '同步不应破坏其它键'
    Assert-Equal (Test-Path -LiteralPath $sync.Backup) $true '同步前应当生成备份'

    $second = Sync-CodexSidebarRegistrations -HandoffResult $handoffResult
    Assert-Equal $second.Applied $false '重复同步不应再次写入'
    Assert-Equal $second.Reason 'nothing-to-sync' '重复同步原因错误'

    [ordered]@{ status = 'ok'; cases = 8 } | ConvertTo-Json
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        $resolved = (Resolve-Path -LiteralPath $testRoot).Path
        if ($resolved -ne $testRoot) { throw "拒绝清理意外路径：$resolved" }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

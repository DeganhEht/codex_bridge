$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$modulePath = Join-Path $repoRoot 'work\thread-localizer\launcher\handoff-result-contract.psm1'
Import-Module -Name $modulePath -Force

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)] [object]$Actual,
        [Parameter(Mandatory = $true)] [object]$Expected,
        [Parameter(Mandatory = $true)] [string]$Message
    )
    if ($Actual -ne $Expected) {
        throw "$Message；实际=$Actual，期望=$Expected"
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)] [scriptblock]$Script,
        [Parameter(Mandatory = $true)] [string]$Message
    )
    try {
        & $Script
    } catch {
        if ($_.Exception.Message -notlike "*$Message*") {
            throw "异常消息不匹配：$($_.Exception.Message)"
        }
        return
    }
    throw "预期抛出异常：$Message"
}

$dryRun = [pscustomobject]@{
    type = 'batch-handoff-dry-run'
    counts = [pscustomobject]@{ handoff = 2 }
    requestedTaskIds = @('source-a', 'source-b')
    resolvedTaskIds = @('source-a', 'source-b')
    unresolvedTaskIds = @()
    dryRunPath = 'C:\reports\dry-run.json'
}
$view = ConvertTo-HandoffResultContract -Result $dryRun -DryRun
Assert-Equal $view.PlannedHandoff 2 'dry-run 计划交接数错误'
Assert-Equal $view.HandedOff 0 'dry-run 实际交接数应为 0'
Assert-Equal $view.Failed 0 '缺失的 dry-run failed 应默认为 0'
Assert-Equal $view.Blocked 0 '缺失的 dry-run blocked 应默认为 0'
Assert-Equal $view.ReportPath 'C:\reports\dry-run.json' 'dry-run 报告路径错误'

$blockedDryRun = [pscustomobject]@{
    type = 'batch-handoff-dry-run'
    counts = [pscustomobject]@{ blocked = 1 }
    requestedTaskIds = @('source-a')
    resolvedTaskIds = @()
    unresolvedTaskIds = @('source-a')
    dryRunPath = 'C:\reports\blocked.json'
}
$view = ConvertTo-HandoffResultContract -Result $blockedDryRun -DryRun
Assert-Equal $view.Blocked 1 '阻塞 dry-run 未被识别'
Assert-Equal $view.Noop 0 '缺失的 dry-run noop 应默认为 0'

$complete = [pscustomobject]@{
    type = 'batch-handoff-complete'
    summary = [pscustomobject]@{ handedOff = 1; noop = 0; skipped = 0; blocked = 0; failed = 0 }
    requestedTaskIds = @('source-a')
    resolvedTaskIds = @('source-a')
    unresolvedTaskIds = @()
    resultPath = 'C:\reports\result.json'
}
$view = ConvertTo-HandoffResultContract -Result $complete
Assert-Equal $view.HandedOff 1 '正式结果 handedOff 错误'
Assert-Equal $view.PlannedHandoff 0 '正式结果 plannedHandoff 应为 0'
Assert-Equal $view.ReportPath 'C:\reports\result.json' '正式结果路径错误'

$failedWithFallback = [pscustomobject]@{
    type = 'batch-handoff-complete-with-errors'
    summary = [pscustomobject]@{ handedOff = 0; noop = 0; skipped = 0; blocked = 0; failed = 1 }
    requestedTaskIds = @('source-a')
    resolvedTaskIds = @()
    unresolvedTaskIds = @('source-a')
    dryRunPath = 'C:\reports\fallback.json'
}
$view = ConvertTo-HandoffResultContract -Result $failedWithFallback
Assert-Equal $view.Failed 1 '正式失败结果未被识别'
Assert-Equal $view.ReportPath 'C:\reports\fallback.json' '正式结果路径回退错误'

$missingField = [pscustomobject]@{
    type = 'batch-handoff-dry-run'
    counts = [pscustomobject]@{ handoff = 1 }
}
Assert-Throws {
    ConvertTo-HandoffResultContract -Result $missingField -DryRun
} '交接结果缺少必要字段：requestedTaskIds'

[ordered]@{
    status = 'ok'
    cases = 5
} | ConvertTo-Json

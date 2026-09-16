Set-StrictMode -Version Latest

function Get-ResultProperty {
    param(
        [AllowNull()]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-RequiredResultProperty {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        throw "交接结果缺少必要字段：$Name"
    }
    return $property.Value
}

function Get-ResultCount {
    param(
        [AllowNull()]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $value = Get-ResultProperty -Object $Object -Name $Name
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { return 0 }
    try {
        return [int]$value
    } catch {
        throw "交接结果字段不是整数：$Name=$value"
    }
}

function ConvertTo-ResultArray {
    param(
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value) { return @() }
    if ($Value -is [string]) { return @([string]$Value) }
    return @($Value)
}

function ConvertTo-HandoffResultContract {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Result,
        [switch]$DryRun
    )

    $type = [string](Get-RequiredResultProperty -Object $Result -Name 'type')
    if ($DryRun) {
        if ($type -ne 'batch-handoff-dry-run') {
            throw "交接 dry-run 返回了意外结果类型：$type"
        }
    } elseif ($type -notin @('batch-handoff-complete', 'batch-handoff-complete-with-errors')) {
        throw "交接执行返回了意外结果类型：$type"
    }

    $requestedTaskIds = ConvertTo-ResultArray (Get-RequiredResultProperty -Object $Result -Name 'requestedTaskIds')
    $resolvedTaskIds = ConvertTo-ResultArray (Get-RequiredResultProperty -Object $Result -Name 'resolvedTaskIds')
    $unresolvedTaskIds = ConvertTo-ResultArray (Get-RequiredResultProperty -Object $Result -Name 'unresolvedTaskIds')

    $counts = Get-ResultProperty -Object $Result -Name 'counts'
    $summary = Get-ResultProperty -Object $Result -Name 'summary'
    if ($DryRun) {
        if ($null -eq $counts) { throw '交接 dry-run 结果缺少 counts 字段' }
        $plannedHandoff = Get-ResultCount -Object $counts -Name 'handoff'
        $noop = Get-ResultCount -Object $counts -Name 'noop'
        $skipped = Get-ResultCount -Object $counts -Name 'skip'
        $blocked = Get-ResultCount -Object $counts -Name 'blocked'
        $failed = Get-ResultCount -Object $counts -Name 'failed'
        $handedOff = 0
    } else {
        if ($null -eq $summary) { throw '交接执行结果缺少 summary 字段' }
        $handedOff = Get-ResultCount -Object $summary -Name 'handedOff'
        $plannedHandoff = 0
        $noop = Get-ResultCount -Object $summary -Name 'noop'
        $skipped = Get-ResultCount -Object $summary -Name 'skipped'
        $blocked = Get-ResultCount -Object $summary -Name 'blocked'
        $failed = Get-ResultCount -Object $summary -Name 'failed'
    }

    $reportPath = [string](Get-ResultProperty -Object $Result -Name 'resultPath')
    if ([string]::IsNullOrWhiteSpace($reportPath)) {
        $reportPath = [string](Get-ResultProperty -Object $Result -Name 'dryRunPath')
    }

    [pscustomobject]@{
        Type = $type
        HandedOff = $handedOff
        PlannedHandoff = $plannedHandoff
        Noop = $noop
        Skipped = $skipped
        Blocked = $blocked
        Failed = $failed
        RequestedTaskIds = $requestedTaskIds
        ResolvedTaskIds = $resolvedTaskIds
        UnresolvedTaskIds = $unresolvedTaskIds
        ReportPath = $reportPath
    }
}

Export-ModuleMember -Function ConvertTo-HandoffResultContract

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $repoRoot 'work\thread-localizer\launcher\codex-desktop-model-launcher.ps1'
$launcherText = Get-Content -LiteralPath $launcherPath -Raw -Encoding UTF8

function Get-LauncherFunction {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Text
    )

    $pattern = '(?ms)^function\s+' + [regex]::Escape($Name) + '\s*\{.*?^\}'
    $match = [regex]::Match($Text, $pattern)
    if (-not $match.Success) { throw "启动器中找不到函数：$Name" }
    return $match.Value
}

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)][AllowNull()][object]$Actual,
        [Parameter(Mandatory = $true)][object]$Expected,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if ("$Actual" -ne "$Expected") { throw "$Message；实际=$Actual，期望=$Expected" }
}

$managedStart = '# >>> Codex desktop model switcher: mode (managed; do not edit)'
$managedEnd = '# <<< Codex desktop model switcher: mode'

$definitions = @('ConvertTo-HandoffPickerEntry', 'Sort-HandoffPickerEntries', 'Get-HandoffPickerHeader', 'Get-CurrentMode', 'Get-DesktopTargetThreadIds', 'Resolve-LauncherOpenPlan') |
    ForEach-Object { Get-LauncherFunction -Name $_ -Text $launcherText }
Invoke-Expression ($definitions -join [Environment]::NewLine)

$tasks = @(
    [pscustomobject]@{
        id = 'thread-old'; stableTaskId = 'stable-old'; displayName = 'Alpha 旧任务'
        provider = 'openai'; model = 'gpt-5.6-sol'; cwd = 'C:\work\alpha'; updatedAt = 1700000000
    },
    [pscustomobject]@{
        id = 'thread-new'; stableTaskId = 'stable-new'; displayName = 'Bravo 新任务'
        provider = 'deepseek'; model = 'deepseek-v4-pro'; cwd = 'C:\work\zeta'; updatedAt = 1800000000
    },
    [pscustomobject]@{
        id = 'thread-milli'; stableTaskId = 'stable-milli'; displayName = 'Charlie 毫秒时间戳任务'
        provider = 'deepseek'; model = 'deepseek-v4-pro'; cwd = 'C:\work\beta'; updatedAt = 1900000000000
    },
    [pscustomobject]@{
        id = 'thread-none'; stableTaskId = 'stable-none'; displayName = 'Delta 没有时间的任务'
        provider = 'openai'; model = 'gpt-5.6-sol'; cwd = 'C:\work\gamma'; updatedAt = $null
    }
)

$entries = @($tasks | ForEach-Object { ConvertTo-HandoffPickerEntry -Task $_ })
Assert-Equal $entries.Count 4 '条目数量错误'

$byTimeDescending = @(Sort-HandoffPickerEntries -Entries $entries -SortKey 'time' -Descending $true)
Assert-Equal (($byTimeDescending | ForEach-Object { $_.Id }) -join ',') 'thread-milli,thread-new,thread-old,thread-none' '按时间倒序（毫秒自动归一，无时间排最后）错误'

$byTimeAscending = @(Sort-HandoffPickerEntries -Entries $entries -SortKey 'time' -Descending $false)
Assert-Equal (($byTimeAscending | ForEach-Object { $_.Id }) -join ',') 'thread-none,thread-old,thread-new,thread-milli' '按时间正序错误'

$byName = @(Sort-HandoffPickerEntries -Entries $entries -SortKey 'name' -Descending $false)
Assert-Equal (($byName | ForEach-Object { $_.Id }) -join ',') 'thread-old,thread-new,thread-milli,thread-none' '按任务名排序错误'

$byProvider = @(Sort-HandoffPickerEntries -Entries $entries -SortKey 'provider' -Descending $false)
Assert-Equal (($byProvider[0].Provider) + '/' + ($byProvider[0].Model)) 'deepseek/deepseek-v4-pro' '按 Provider 排序错误'

$byCwd = @(Sort-HandoffPickerEntries -Entries $entries -SortKey 'cwd' -Descending $false)
Assert-Equal $byCwd[0].Id 'thread-old' '按工作目录排序错误'

Assert-Equal (Get-HandoffPickerHeader -Title '时间' -SortKey 'time' -ActiveSortKey 'time' -Descending $true) '时间 ▼' '倒序表头标记错误'
Assert-Equal (Get-HandoffPickerHeader -Title '时间' -SortKey 'time' -ActiveSortKey 'time' -Descending $false) '时间 ▲' '正序表头标记错误'
Assert-Equal (Get-HandoffPickerHeader -Title '任务' -SortKey 'name' -ActiveSortKey 'time' -Descending $true) '任务' '非活动列不应带标记'

$deepSeekConfig = "$managedStart`n# active_mode = deepseek`nmodel = `"gpt-5.6-sol`"`nmodel_provider = `"deepseek`"`n$managedEnd`n"
$gptConfig = "$managedStart`n# active_mode = gpt`nmodel = `"gpt-5.6-sol`"`n$managedEnd`n"
$providerOnlyConfig = "$managedStart`nmodel_provider = `"deepseek`"`n$managedEnd`n"
Assert-Equal (Get-CurrentMode -RawConfig $deepSeekConfig) 'deepseek' 'DeepSeek 模式判定错误'
Assert-Equal (Get-CurrentMode -RawConfig $gptConfig) 'gpt' 'GPT 模式判定错误'
Assert-Equal (Get-CurrentMode -RawConfig $providerOnlyConfig) 'deepseek' '缺少 active_mode 时应按 model_provider 推断'
Assert-Equal (Get-CurrentMode -RawConfig 'model = "x"') '' '缺少受管区块时应返回空'

$handoffResult = [pscustomobject]@{
    results = @(
        [pscustomobject]@{ status = 'handed-off'; targetThreadId = '01a0a924-958f-7ec3-9b2a-96fa0e039779' },
        [pscustomobject]@{ status = 'handed-off'; targetThreadId = '01a0a924-a042-7922-9c39-f956238e3591' }
    )
}
$targetIds = @(Get-DesktopTargetThreadIds -HandoffResult $handoffResult)
Assert-Equal (($targetIds -join ',') -join ',') '01a0a924-958f-7ec3-9b2a-96fa0e039779,01a0a924-a042-7922-9c39-f956238e3591' '批量交接目标 ID 收集错误'

# open-only 必须留在当前模式；handoff 与新增的 switch-only 都要打开目标模式。
Assert-Equal (Resolve-LauncherOpenPlan -SelectionMode 'open-only' -CurrentMode 'deepseek' -TargetProvider 'gpt') 'deepseek' 'open-only 不应切换模式'
Assert-Equal (Resolve-LauncherOpenPlan -SelectionMode 'handoff' -CurrentMode 'deepseek' -TargetProvider 'gpt') 'gpt' '交接应切换到目标模式'
Assert-Equal (Resolve-LauncherOpenPlan -SelectionMode 'switch-only' -CurrentMode 'deepseek' -TargetProvider 'gpt') 'gpt' '只切换模型应切换到目标模式'
Assert-Equal (Resolve-LauncherOpenPlan -SelectionMode 'switch-only' -CurrentMode 'gpt' -TargetProvider 'deepseek') 'deepseek' '只切换模型应支持 GPT 到 DeepSeek 方向'

[ordered]@{
    status = 'ok'
    cases = 17
} | ConvertTo-Json

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('gpt', 'deepseek')]
    [string]$Provider,

    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$codexHome = if ($env:CODEX_HOME) {
    [IO.Path]::GetFullPath($env:CODEX_HOME)
} else {
    Join-Path $env:USERPROFILE '.codex'
}
$configPath = Join-Path $codexHome 'config.toml'
$installDir = if ($env:CODEX_MODEL_SWITCHER_ROOT) {
    [IO.Path]::GetFullPath($env:CODEX_MODEL_SWITCHER_ROOT)
} else {
    Join-Path $codexHome 'model-switcher'
}
$secretPath = Join-Path $installDir 'deepseek-api-key.dpapi'
$backupRoot = Join-Path $codexHome 'backups\desktop-model-switcher-switches'
$handoffLogRoot = Join-Path $installDir 'handoff-logs'
$lastOpenedPath = Join-Path $handoffLogRoot 'last-opened.json'
$lastHandoffPath = Join-Path $handoffLogRoot 'last-handoff.json'
$managedStart = '# >>> Codex desktop model switcher: mode (managed; do not edit)'
$managedEnd = '# <<< Codex desktop model switcher: mode'

function Resolve-HandoffToolRoot {
    $scriptRoot = $PSScriptRoot
    $candidates = New-Object System.Collections.Generic.List[string]

    if ($env:CODEX_HANDOFF_ROOT) {
        $candidates.Add([IO.Path]::GetFullPath($env:CODEX_HANDOFF_ROOT))
    }

    # Repository checkout: launcher is under work/thread-localizer/launcher.
    $repositoryToolRoot = Split-Path -Parent $scriptRoot
    $candidates.Add($repositoryToolRoot)

    # Installed layout: launcher is beside a copied thread-localizer directory.
    $candidates.Add((Join-Path $scriptRoot 'thread-localizer'))
    $candidates.Add($scriptRoot)

    foreach ($candidate in $candidates) {
        $cliCandidate = Join-Path $candidate 'src\cli.mjs'
        $settingsCandidate = Join-Path $candidate 'data\handoff-settings.json'
        if ((Test-Path -LiteralPath $cliCandidate -PathType Leaf) -and
            (Test-Path -LiteralPath $settingsCandidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw @"
找不到 Codex-DeepSeek-Handoff 工具目录。

请确认启动器旁边存在 thread-localizer\src\cli.mjs，或设置 CODEX_HANDOFF_ROOT 指向包含 src\cli.mjs 和 data\handoff-settings.json 的目录。
当前启动器目录：$scriptRoot
"@
}

function Resolve-ModelSwitcherRoot {
    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add($installDir)
    $candidates.Add((Join-Path (Split-Path -Parent $handoffToolRoot) 'model-switcher'))
    foreach ($candidate in $candidates) {
        if ((Test-Path -LiteralPath (Join-Path $candidate 'models-deepseek.json') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $candidate 'get-deepseek-key.ps1') -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw '找不到 DeepSeek 模型目录。请确认 models-deepseek.json 和 get-deepseek-key.ps1 存在。'
}

$handoffToolRoot = Resolve-HandoffToolRoot
$modelSwitcherRoot = Resolve-ModelSwitcherRoot
$resultContractModulePath = Join-Path $PSScriptRoot 'handoff-result-contract.psm1'
if (-not (Test-Path -LiteralPath $resultContractModulePath -PathType Leaf)) {
    throw "找不到交接结果解析模块：$resultContractModulePath"
}
Import-Module -Name $resultContractModulePath -Force
$modelsPath = Join-Path $modelSwitcherRoot 'models-deepseek.json'
$pickerModelsPath = Join-Path $modelSwitcherRoot 'models-deepseek-picker.json'
$keyHelperPath = Join-Path $modelSwitcherRoot 'get-deepseek-key.ps1'
$handoffCliPath = Join-Path $handoffToolRoot 'src\cli.mjs'
$handoffSettingsPath = Join-Path $handoffToolRoot 'data\handoff-settings.json'
$catalogBuilderPath = Join-Path $handoffToolRoot 'src\build-picker-catalog.mjs'
$modelAdapterPath = Join-Path $handoffToolRoot 'src\model-name-adapter.mjs'

function Show-LauncherMessage {
    param(
        [string]$Text,
        [string]$Title,
        [Windows.Forms.MessageBoxIcon]$Icon = [Windows.Forms.MessageBoxIcon]::Information
    )

    [void][Windows.Forms.MessageBox]::Show(
        $Text,
        $Title,
        [Windows.Forms.MessageBoxButtons]::OK,
        $Icon
    )
}

function Show-HandoffStartedNotice {
    param([string]$TargetProvider)

    $providerName = if ($TargetProvider -eq 'gpt') { 'GPT' } else { 'DeepSeek' }
    try {
        $popup = New-Object -ComObject WScript.Shell
        [void]$popup.Popup(
            "正在准备交接到 $providerName。完成后会自动打开目标任务；只想打开、不交接时，请在选择器里选「仅打开 Codex（继续当前模式）」。重复点击不会创建新任务。",
            2,
            'Codex 任务交接',
            64
        )
    } catch {
        # The handoff must still proceed if Windows cannot display the notice.
    }
}

function Find-CodexExecutable {
    $binRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
    if (Test-Path -LiteralPath $binRoot) {
        $candidate = Get-ChildItem -LiteralPath $binRoot -Directory -ErrorAction SilentlyContinue |
            ForEach-Object {
                $exe = Join-Path $_.FullName 'codex.exe'
                if (Test-Path -LiteralPath $exe) { Get-Item -LiteralPath $exe }
            } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if ($candidate) { return $candidate.FullName }
    }

    $command = Get-Command 'codex.exe' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    throw '找不到 Codex CLI。请先正常启动一次 Codex 桌面应用，再重试。'
}

function Find-NodeExecutable {
    $command = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw '找不到 Node.js，无法执行任务交接。'
}

function Get-HandoffSettings {
    if (-not (Test-Path -LiteralPath $handoffSettingsPath)) {
        throw "找不到交接模型配置：$handoffSettingsPath"
    }
    return Get-Content -LiteralPath $handoffSettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-ValidatedDeepSeekCatalog {
    $catalog = Get-Content -LiteralPath $pickerModelsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $settings = Get-HandoffSettings
    $aliases = $settings.managedProviders.deepseek.modelAliases
    foreach ($slug in @($aliases.PSObject.Properties | ForEach-Object { [string]$_.Value })) {
        $entry = @($catalog.models | Where-Object { [string]$_.slug -eq $slug }) | Select-Object -First 1
        if (-not $entry) {
            throw "DeepSeek 选择器目录缺少 $slug，无法提供完整的任务内模型选择菜单：$pickerModelsPath"
        }
        $levels = @($entry.supported_reasoning_levels | ForEach-Object { [string]$_.effort })
        $missingLevels = @(@('low', 'high', 'max') | Where-Object { $_ -notin $levels })
        if ($missingLevels.Count -gt 0) {
            throw "DeepSeek 模型 $slug 缺少思考强度 $($missingLevels -join ', ')：$modelsPath"
        }
    }
    return $catalog
}

function Get-ActiveModel {
    param([string]$TargetProvider)
    $settings = Get-HandoffSettings
    $property = $settings.managedProviders.PSObject.Properties[$TargetProvider]
    if (-not $property -or -not $property.Value.activeModel) {
        throw "交接模型配置中没有提供商：$TargetProvider"
    }
    $activeModel = [string]$property.Value.activeModel
    if ($TargetProvider -eq 'deepseek') {
        $catalog = Get-ValidatedDeepSeekCatalog
        $aliasProperty = $property.Value.modelAliases.PSObject.Properties[$activeModel]
        if (-not $aliasProperty) {
            throw "DeepSeek 活动模型 $activeModel 没有配置界面兼容名称。"
        }
        $activeModel = [string]$aliasProperty.Value
        $catalogModels = @($catalog.models | ForEach-Object { [string]$_.slug })
        if ($activeModel -notin $catalogModels) {
            throw "DeepSeek 活动模型 $activeModel 不在选择器目录 $pickerModelsPath 中。"
        }
    }
    return $activeModel
}

function Build-DeepSeekPickerCatalog {
    $arguments = @(
        $catalogBuilderPath,
        '--source', $modelsPath,
        '--settings', $handoffSettingsPath,
        '--output', $pickerModelsPath
    )
    $process = Start-Process -FilePath (Find-NodeExecutable) -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $pickerModelsPath -PathType Leaf)) {
        throw '生成 DeepSeek 任务内模型选择目录失败。'
    }
    $null = Get-ValidatedDeepSeekCatalog
}

function Get-DeepSeekModeSetting {
    param([string]$Name)
    $settings = Get-HandoffSettings
    $property = $settings.managedProviders.PSObject.Properties['deepseek']
    $value = if ($property -and $property.Value.PSObject.Properties[$Name]) {
        [string]$property.Value.PSObject.Properties[$Name].Value
    } else {
        ''
    }
    if (-not $value) {
        throw "DeepSeek 配置缺少 $Name。请在 handoff-settings.json 中明确设置。"
    }
    return $value
}

function Get-ModelAdapterSetting {
    param([string]$Name)
    $settings = Get-HandoffSettings
    $adapter = $settings.managedProviders.deepseek.modelAdapter
    $property = if ($adapter) { $adapter.PSObject.Properties[$Name] } else { $null }
    if (-not $property -or $null -eq $property.Value -or [string]$property.Value -eq '') {
        throw "DeepSeek modelAdapter 配置缺少 $Name。"
    }
    return $property.Value
}

function Start-ModelNameAdapter {
    New-Item -ItemType Directory -Path $handoffLogRoot -Force | Out-Null
    $port = [int](Get-ModelAdapterSetting 'port')
    $upstream = [string](Get-ModelAdapterSetting 'upstreamBaseUrl')
    $healthUrl = "http://127.0.0.1:$port/__handoff_model_adapter_health"
    try {
        $existing = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
        if ($existing.product -eq 'Codex-DeepSeek-Handoff model-name-adapter') {
            return [pscustomobject]@{ Process = $null; Owned = $false; Port = $port }
        }
        throw "端口 $port 已被其他程序占用。"
    } catch {
        if ($_.Exception.Message -like "端口 $port 已被其他程序占用。") { throw }
    }

    $adapterTimestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutPath = Join-Path $handoffLogRoot "model-adapter.$adapterTimestamp.stdout.txt"
    $stderrPath = Join-Path $handoffLogRoot "model-adapter.$adapterTimestamp.stderr.txt"
    $arguments = @(
        $modelAdapterPath,
        '--port', [string]$port,
        '--upstream', $upstream,
        '--settings', $handoffSettingsPath,
        '--log-dir', $handoffLogRoot,
        '--parent-pid', [string]$PID
    )
    $process = Start-Process -FilePath (Find-NodeExecutable) -ArgumentList $arguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($process.HasExited) { break }
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
            if ($health.product -eq 'Codex-DeepSeek-Handoff model-name-adapter') {
                return [pscustomobject]@{ Process = $process; Owned = $true; Port = $port }
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    $details = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Tail 5) -join [Environment]::NewLine } else { '' }
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    throw "DeepSeek 模型名称适配器启动失败。`n$details"
}

function Stop-ModelNameAdapter {
    <#
      收掉本机正在监听的适配器（离开 DeepSeek 模式时用）。
      只结束健康检查确认是本项目适配器的进程，别的程序占用端口时不动。
    #>
    param([int]$Port)

    if (-not $Port) { $Port = [int](Get-ModelAdapterSetting 'port') }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/__handoff_model_adapter_health" -TimeoutSec 1
        if ($health.product -eq 'Codex-DeepSeek-Handoff model-name-adapter') {
            $adapterPid = [int]$health.pid
            Stop-Process -Id $adapterPid -Force -ErrorAction SilentlyContinue
            return $adapterPid
        }
    } catch { }
    return $null
}

function Write-ManagedConfigForProvider {
    <#
      把受管模式区块写成目标 provider 的版本，并返回备份路径。
      与交接流程共用，保证备份/替换语义一致。
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Provider,
        [Parameter(Mandatory = $true)][string]$Candidate
    )

    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backupPath = Join-Path $backupRoot "config.$timestamp.before-$Provider.toml"
    $temporaryConfig = Join-Path $codexHome "config.toml.model-switcher-$timestamp.tmp"
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporaryConfig, $Candidate, $utf8NoBom)
    [IO.File]::Replace($temporaryConfig, $configPath, $backupPath, $true)
    return $backupPath
}

function Resolve-LauncherOpenPlan {
    <#
      open-only 保持当前模式；handoff / switch-only 打开目标模式。
    #>
    param(
        [Parameter(Mandatory = $true)][string]$SelectionMode,
        [Parameter(Mandatory = $true)][string]$CurrentMode,
        [Parameter(Mandatory = $true)][string]$TargetProvider
    )

    if ($SelectionMode -eq 'open-only') { return $CurrentMode }
    return $TargetProvider
}

function Invoke-TaskInventory {
    param([string]$TargetProvider)
    New-Item -ItemType Directory -Path $handoffLogRoot -Force | Out-Null
    $inventoryTimestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutPath = Join-Path $handoffLogRoot "inventory.$inventoryTimestamp.stdout.json"
    $stderrPath = Join-Path $handoffLogRoot "inventory.$inventoryTimestamp.stderr.txt"
    $engineProvider = if ($TargetProvider -eq 'gpt') { 'openai' } else { $TargetProvider }
    $arguments = @($handoffCliPath, 'batch-inventory', '--target-provider', $engineProvider)

    $savedCodexBin = $env:CODEX_BIN
    $savedHome = $env:HOME
    $savedCodexHome = $env:CODEX_HOME
    $env:CODEX_BIN = Find-CodexExecutable
    if (-not $env:HOME) { $env:HOME = $env:USERPROFILE }
    $env:CODEX_HOME = $codexHome
    try {
        $process = Start-Process -FilePath (Find-NodeExecutable) `
            -ArgumentList $arguments `
            -WorkingDirectory $handoffToolRoot `
            -WindowStyle Hidden `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath
    } finally {
        if ($null -eq $savedCodexBin) { Remove-Item Env:CODEX_BIN -ErrorAction SilentlyContinue } else { $env:CODEX_BIN = $savedCodexBin }
        if ($null -eq $savedHome) { Remove-Item Env:HOME -ErrorAction SilentlyContinue } else { $env:HOME = $savedHome }
        if ($null -eq $savedCodexHome) { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue } else { $env:CODEX_HOME = $savedCodexHome }
    }
    if ($process.ExitCode -ne 0) {
        $details = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Tail 12) -join [Environment]::NewLine } else { '' }
        throw "读取任务列表失败。`n$details"
    }
    try {
        $inventory = Get-Content -LiteralPath $stdoutPath -Raw -Encoding UTF8 | ConvertFrom-Json
        return @($inventory.tasks)
    } finally {
        Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function ConvertTo-HandoffPickerEntry {
    param([Parameter(Mandatory = $true)][object]$Task)

    $time = ''
    $sortTime = 0
    $hasTime = $false
    try {
        $rawTime = [double]$Task.updatedAt
        if ($rawTime -gt 100000000000) { $rawTime = $rawTime / 1000 }
        if ($rawTime -gt 0) {
            $hasTime = $true
            $sortTime = $rawTime
            $time = [DateTimeOffset]::FromUnixTimeSeconds([int64]$rawTime).ToLocalTime().ToString('yyyy-MM-dd HH:mm')
        }
    } catch { }
    [pscustomobject]@{
        Id = [string]$Task.id
        StableTaskId = [string]$Task.stableTaskId
        DisplayName = [string]$Task.displayName
        Text = "[$time] [$($Task.provider)/$($Task.model)] $($Task.displayName)  |  $($Task.cwd)"
        Provider = [string]$Task.provider
        Model = [string]$Task.model
        Cwd = [string]$Task.cwd
        UpdatedAt = $Task.updatedAt
        TimeText = $time
        SortTime = $sortTime
        HasTime = $hasTime
    }
}

function Sort-HandoffPickerEntries {
    param(
        [object[]]$Entries = @(),
        [string]$SortKey = 'time',
        [bool]$Descending = $true
    )

    $decorated = foreach ($entry in @($Entries)) {
        $primary = switch ($SortKey) {
            'provider' { "$($entry.Provider)/$($entry.Model)" }
            'name' { [string]$entry.DisplayName }
            'cwd' { [string]$entry.Cwd }
            default {
                if ($entry.HasTime) { [double]$entry.SortTime } else { -1 }
            }
        }
        [pscustomobject]@{ Entry = $entry; Primary = $primary }
    }
    $sorted = @($decorated | Sort-Object -Property `
        @{ Expression = { $_.Primary }; Descending = $Descending }, `
        @{ Expression = { $_.Entry.DisplayName }; Descending = $false })
    return @($sorted | ForEach-Object { $_.Entry })
}

function Get-HandoffPickerHeader {
    param(
        [string]$Title,
        [string]$SortKey,
        [string]$ActiveSortKey,
        [bool]$Descending
    )

    if ($SortKey -ne $ActiveSortKey) { return $Title }
    if ($Descending) { return "$Title ▼" }
    return "$Title ▲"
}

function Select-HandoffTask {
    param([string]$TargetProvider)

    $tasks = @(Invoke-TaskInventory -TargetProvider $TargetProvider | Where-Object {
        [bool]$_.managed -and
        [string]$_.status -notin @('active', 'inProgress')
    })

    $entries = @($tasks | ForEach-Object { ConvertTo-HandoffPickerEntry -Task $_ })

    $form = New-Object Windows.Forms.Form
    $form.Text = "选择要交接到 $TargetProvider 的任务"
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'Sizable'
    $form.MinimizeBox = $false
    $form.ClientSize = New-Object Drawing.Size(1080, 640)

    $label = New-Object Windows.Forms.Label
    $label.Text = if ($entries.Count -gt 0) {
        ('找到 {0} 个可交接端点。勾选后按「交接并切换」；只想换模型请按「只切换模型（不交接）」；保持当前模式请按「仅打开 Codex」。' -f $entries.Count)
    } else {
        '当前没有可交接的端点。可点「只切换模型（不交接）」直接切到目标模式，或点「仅打开 Codex（继续当前模式）」。'
    }
    $label.AutoSize = $false
    $label.Location = New-Object Drawing.Point(14, 12)
    $label.Size = New-Object Drawing.Size(1045, 34)
    $form.Controls.Add($label)

    $search = New-Object Windows.Forms.TextBox
    $search.Location = New-Object Drawing.Point(14, 52)
    $search.Size = New-Object Drawing.Size(1045, 25)
    $search.PlaceholderText = '搜索任务名、provider、模型或路径'
    $form.Controls.Add($search)

    $list = New-Object Windows.Forms.ListView
    $list.Location = New-Object Drawing.Point(14, 86)
    $list.Size = New-Object Drawing.Size(1045, 476)
    $list.View = [Windows.Forms.View]::Details
    $list.CheckBoxes = $true
    $list.FullRowSelect = $true
    $list.GridLines = $true
    $list.HideSelection = $false
    $list.MultiSelect = $false
    $list.Font = New-Object Drawing.Font('Consolas', 9)
    [void]$list.Columns.Add('时间', 125)
    [void]$list.Columns.Add('Provider/模型', 180)
    [void]$list.Columns.Add('任务', 360)
    [void]$list.Columns.Add('工作目录', 360)
    $form.Controls.Add($list)

    # 默认按最近更新时间倒序；点击列头可在同一列切换升降序。
    $columnTitles = @('时间', 'Provider/模型', '任务', '工作目录')
    $columnKeys = @('time', 'provider', 'name', 'cwd')
    $sortState = @{ Key = 'time'; Descending = $true }

    $selectedLabel = New-Object Windows.Forms.Label
    $selectedLabel.Location = New-Object Drawing.Point(14, 575)
    $selectedLabel.Size = New-Object Drawing.Size(180, 34)
    $form.Controls.Add($selectedLabel)

    $checked = @{}
    $syncChecked = {
        foreach ($item in $list.Items) {
            $checked[[string]$item.Tag] = [bool]$item.Checked
        }
    }
    $updateHeaders = {
        for ($index = 0; $index -lt $columnTitles.Count; $index++) {
            $list.Columns[$index].Text = Get-HandoffPickerHeader `
                -Title $columnTitles[$index] `
                -SortKey $columnKeys[$index] `
                -ActiveSortKey $sortState['Key'] `
                -Descending $sortState['Descending']
        }
    }
    $renderList = {
        & $syncChecked
        $list.BeginUpdate()
        try {
            $list.Items.Clear()
            $filter = [string]$search.Text
            $visible = @($entries | Where-Object {
                if (-not $filter) { return $true }
                return $_.Text.IndexOf($filter, [StringComparison]::OrdinalIgnoreCase) -ge 0
            })
            $sorted = @(Sort-HandoffPickerEntries -Entries $visible -SortKey $sortState['Key'] -Descending $sortState['Descending'])
            foreach ($entry in $sorted) {
                $row = New-Object Windows.Forms.ListViewItem([string]$entry.TimeText)
                [void]$row.SubItems.Add("$($entry.Provider)/$($entry.Model)")
                [void]$row.SubItems.Add([string]$entry.DisplayName)
                [void]$row.SubItems.Add([string]$entry.Cwd)
                $row.Tag = $entry.Id
                $row.Checked = $checked.ContainsKey($entry.Id) -and $checked[$entry.Id]
                [void]$list.Items.Add($row)
            }
        } finally {
            $list.EndUpdate()
        }
        $selectedLabel.Text = "已选择 $(@($checked.Keys | Where-Object { $checked[$_] }).Count) 个"
    }
    $list.Add_ColumnClick({
        param($sender, $eventArgs)
        $keys = @('time', 'provider', 'name', 'cwd')
        $clickedKey = $keys[$eventArgs.Column]
        if ($null -eq $clickedKey) { return }
        if ($sortState['Key'] -eq $clickedKey) {
            $sortState['Descending'] = -not $sortState['Descending']
        } else {
            $sortState['Key'] = $clickedKey
            $sortState['Descending'] = ($clickedKey -eq 'time')
        }
        & $updateHeaders
        & $renderList
    })
    $search.Add_TextChanged({ & $renderList })
    & $updateHeaders
    & $renderList

    $ok = New-Object Windows.Forms.Button
    $ok.Text = '交接并切换'
    $ok.Location = New-Object Drawing.Point(808, 575)
    $ok.Size = New-Object Drawing.Size(140, 34)
    $ok.Add_Click({
        & $syncChecked
        $selected = @($checked.Keys | Where-Object { $checked[$_] } | ForEach-Object { [string]$_ })
        if ($selected.Count -gt 0) {
            $form.Tag = [pscustomobject]@{ Mode = 'handoff'; TaskIds = $selected }
            $form.DialogResult = [Windows.Forms.DialogResult]::OK
            $form.Close()
        } else {
            [Windows.Forms.MessageBox]::Show('请至少勾选一个任务；只想换模型请点「只切换模型（不交接）」。', '没有选择任务', 'OK', 'Information') | Out-Null
        }
    })
    $form.Controls.Add($ok)

    $switchOnly = New-Object Windows.Forms.Button
    $switchOnly.Text = '只切换模型（不交接）'
    $switchOnly.Location = New-Object Drawing.Point(390, 575)
    $switchOnly.Size = New-Object Drawing.Size(200, 34)
    $switchOnly.Add_Click({
        $form.Tag = [pscustomobject]@{ Mode = 'switch-only' }
        $form.DialogResult = [Windows.Forms.DialogResult]::OK
        $form.Close()
    })
    $form.Controls.Add($switchOnly)

    $openOnly = New-Object Windows.Forms.Button
    $openOnly.Text = '仅打开 Codex（继续当前模式）'
    $openOnly.Location = New-Object Drawing.Point(600, 575)
    $openOnly.Size = New-Object Drawing.Size(200, 34)
    $openOnly.Add_Click({
        $form.Tag = [pscustomobject]@{ Mode = 'open-only' }
        $form.DialogResult = [Windows.Forms.DialogResult]::OK
        $form.Close()
    })
    $form.Controls.Add($openOnly)

    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = '取消'
    $cancel.Location = New-Object Drawing.Point(956, 575)
    $cancel.Size = New-Object Drawing.Size(77, 34)
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($cancel)
    $form.AcceptButton = $ok
    $form.CancelButton = $cancel
    $all = New-Object Windows.Forms.Button
    $all.Text = '全选'
    $all.Location = New-Object Drawing.Point(200, 575)
    $all.Size = New-Object Drawing.Size(85, 34)
    $all.Add_Click({ foreach ($item in $list.Items) { $item.Checked = $true }; & $syncChecked; & $renderList })
    $form.Controls.Add($all)

    $clear = New-Object Windows.Forms.Button
    $clear.Text = '清空'
    $clear.Location = New-Object Drawing.Point(293, 575)
    $clear.Size = New-Object Drawing.Size(85, 34)
    $clear.Add_Click({ foreach ($item in $list.Items) { $item.Checked = $false }; & $syncChecked; & $renderList })
    $form.Controls.Add($clear)

    try {
        $dialogResult = $form.ShowDialog()
        if ($dialogResult -eq [Windows.Forms.DialogResult]::OK) { return $form.Tag }
        return $null
    } finally {
        $form.Dispose()
    }
}

function Invoke-BatchHandoff {
    param(
        [string]$TargetProvider,
        [string[]]$OnlyTaskIds = @(),
        [switch]$DryRun
    )

    if (-not (Test-Path -LiteralPath $handoffCliPath)) {
        throw "找不到滚动交接工具：$handoffCliPath"
    }
    New-Item -ItemType Directory -Path $handoffLogRoot -Force | Out-Null
    $handoffTimestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutPath = Join-Path $handoffLogRoot "handoff.$handoffTimestamp.$TargetProvider.stdout.json"
    $stderrPath = Join-Path $handoffLogRoot "handoff.$handoffTimestamp.$TargetProvider.stderr.txt"
    $engineProvider = if ($TargetProvider -eq 'gpt') { 'openai' } else { $TargetProvider }

    $batchCommand = if ($DryRun) { 'batch-handoff-dry-run' } else { 'batch-handoff' }
    $arguments = @(
        $handoffCliPath,
        $batchCommand,
        '--target-provider', $engineProvider
    )
    if (-not $DryRun) { $arguments += '--execute' }
    if ($OnlyTaskIds.Count -gt 0) { $arguments += @('--task-ids', ($OnlyTaskIds -join ',')) }
    $savedCodexBin = $env:CODEX_BIN
    $savedHome = $env:HOME
    $savedCodexHome = $env:CODEX_HOME
    $env:CODEX_BIN = Find-CodexExecutable
    if (-not $env:HOME) { $env:HOME = $env:USERPROFILE }
    $env:CODEX_HOME = $codexHome
    try {
        $process = Start-Process -FilePath (Find-NodeExecutable) `
            -ArgumentList $arguments `
            -WorkingDirectory $handoffToolRoot `
            -WindowStyle Hidden `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath
    } finally {
        if ($null -eq $savedCodexBin) {
            Remove-Item Env:CODEX_BIN -ErrorAction SilentlyContinue
        } else {
            $env:CODEX_BIN = $savedCodexBin
        }
        if ($null -eq $savedHome) {
            Remove-Item Env:HOME -ErrorAction SilentlyContinue
        } else {
            $env:HOME = $savedHome
        }
        if ($null -eq $savedCodexHome) {
            Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
        } else {
            $env:CODEX_HOME = $savedCodexHome
        }
    }
    if ($process.ExitCode -ne 0) {
        $details = @()
        if (Test-Path -LiteralPath $stderrPath) {
            $details += Get-Content -LiteralPath $stderrPath -Tail 8 -ErrorAction SilentlyContinue
        }
        if (-not $details -and (Test-Path -LiteralPath $stdoutPath)) {
            $details += Get-Content -LiteralPath $stdoutPath -Tail 8 -ErrorAction SilentlyContinue
        }
        throw "任务交接到 $TargetProvider 失败。`n$($details -join [Environment]::NewLine)"
    }
    $result = Get-Content -LiteralPath $stdoutPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $contract = ConvertTo-HandoffResultContract -Result $result -DryRun:$DryRun
    $requestedCount = @($contract.RequestedTaskIds).Count
    $resolvedCount = @($contract.ResolvedTaskIds).Count
    $unresolvedCount = @($contract.UnresolvedTaskIds).Count
    if ($contract.Failed -gt 0 -or $contract.Blocked -gt 0 -or ($requestedCount -gt 0 -and ($unresolvedCount -gt 0 -or $resolvedCount -ne $requestedCount))) {
        $successCount = if ($DryRun) { $contract.PlannedHandoff } else { $contract.HandedOff }
        $reportPath = if ([string]::IsNullOrWhiteSpace($contract.ReportPath)) { $stdoutPath } else { $contract.ReportPath }
        throw @"
任务尚未全部交接到 $TargetProvider，因此 Codex 不会启动。

成功：$successCount
无需交接：$($contract.Noop)
阻塞：$($contract.Blocked)
失败：$($contract.Failed)
已解析：$resolvedCount / $requestedCount
未解析：$unresolvedCount

请根据详细报告处理后，再点击相应的交接快捷方式：
$reportPath
"@
    }
    return $result
}

function Get-DesktopTargetThreadIds {
    param([Parameter(Mandatory = $true)][object]$HandoffResult)

    $ids = New-Object System.Collections.Generic.List[string]
    foreach ($result in @($HandoffResult.results | Where-Object { $_.status -eq 'handed-off' })) {
        $threadId = [string]$result.targetThreadId
        if ($threadId -notmatch '^[0-9a-fA-F-]{36}$') { continue }
        if (-not $ids.Contains($threadId)) { $ids.Add($threadId) }
    }
    foreach ($result in @($HandoffResult.results | Where-Object { $_.status -eq 'noop' })) {
        $threadId = [string]$result.targetThreadId
        if ($threadId -notmatch '^[0-9a-fA-F-]{36}$') { continue }
        if (-not $ids.Contains($threadId)) { $ids.Add($threadId) }
    }
    return $ids.ToArray()
}

function Get-DesktopTargetThreadId {
    param([Parameter(Mandatory = $true)][object]$HandoffResult)

    $ids = @(Get-DesktopTargetThreadIds -HandoffResult $HandoffResult)
    if ($ids.Count -eq 0) {
        throw '交接结果没有可打开的目标任务 ID，Codex 不会启动。'
    }
    return [string]$ids[0]
}

function Sync-CodexSidebarRegistrations {
    param([Parameter(Mandatory = $true)][object]$HandoffResult)

    # 桌面端只给它自己打开过的线程写侧栏登记项（工作区根提示、projectless 列表、
    # 可写根）。工具直接创建的端点没有这些登记项时不会出现在侧栏，所以这里把源任务
    # 的登记项照抄给目标端点。写法是纯增量：已存在的值不覆盖。
    $statePath = Join-Path $codexHome '.codex-global-state.json'
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        return [pscustomobject]@{ Applied = $false; Reason = 'state-file-missing'; Synced = @() }
    }
    try {
        $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return [pscustomobject]@{ Applied = $false; Reason = 'state-file-unreadable'; Synced = @() }
    }

    $hints = $state.'thread-workspace-root-hints'
    $writableRoots = $state.'thread-writable-roots'
    $outputDirectories = $state.'thread-projectless-output-directories'
    if ($null -eq $hints) {
        return [pscustomobject]@{ Applied = $false; Reason = 'state-shape-unknown'; Synced = @() }
    }
    $projectlessThreadIds = @($state.'projectless-thread-ids')

    $pairs = @($HandoffResult.results | Where-Object {
        $_.sourceThreadId -and $_.targetThreadId -and ([string]$_.sourceThreadId -ne [string]$_.targetThreadId)
    })
    $synced = New-Object System.Collections.Generic.List[object]
    foreach ($pair in $pairs) {
        $sourceThreadId = [string]$pair.sourceThreadId
        $targetThreadId = [string]$pair.targetThreadId
        if ($targetThreadId -notmatch '^[0-9a-fA-F-]{36}$') { continue }
        $sourceHint = $hints.PSObject.Properties[$sourceThreadId]
        if ($null -eq $sourceHint -or -not $sourceHint.Value) { continue }
        $hint = $sourceHint.Value

        $added = New-Object System.Collections.Generic.List[string]
        if ($null -eq $hints.PSObject.Properties[$targetThreadId]) {
            $hints | Add-Member -NotePropertyName $targetThreadId -NotePropertyValue $hint -Force
            $added.Add('workspaceRootHint')
        }
        if ($null -ne $writableRoots) {
            $sourceWritableRoots = $writableRoots.PSObject.Properties[$sourceThreadId]
            if ($null -ne $sourceWritableRoots -and $null -eq $writableRoots.PSObject.Properties[$targetThreadId]) {
                $writableRoots | Add-Member -NotePropertyName $targetThreadId -NotePropertyValue $sourceWritableRoots.Value -Force
                $added.Add('writableRoots')
            }
        }
        if ($null -ne $outputDirectories) {
            $sourceOutputDirectory = $outputDirectories.PSObject.Properties[$sourceThreadId]
            if ($null -ne $sourceOutputDirectory -and $null -eq $outputDirectories.PSObject.Properties[$targetThreadId]) {
                $outputDirectories | Add-Member -NotePropertyName $targetThreadId -NotePropertyValue $sourceOutputDirectory.Value -Force
                $added.Add('projectlessOutputDirectory')
            }
        }
        if (($projectlessThreadIds -contains $sourceThreadId) -and -not ($projectlessThreadIds -contains $targetThreadId)) {
            $projectlessThreadIds = @($projectlessThreadIds + $targetThreadId)
            $added.Add('projectlessThreadId')
        }
        if ($added.Count -gt 0) {
            $synced.Add([pscustomobject]@{
                sourceThreadId = $sourceThreadId
                targetThreadId = $targetThreadId
                added = $added.ToArray()
            })
        }
    }

    if ($synced.Count -eq 0) {
        return [pscustomobject]@{ Applied = $false; Reason = 'nothing-to-sync'; Synced = @() }
    }

    $state.'projectless-thread-ids' = $projectlessThreadIds
    New-Item -ItemType Directory -Path $handoffLogRoot -Force | Out-Null
    $syncTimestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backupPath = Join-Path $handoffLogRoot "codex-global-state.$syncTimestamp.before-sidebar-sync.json"
    $temporaryPath = Join-Path $codexHome ".codex-global-state.$syncTimestamp.tmp"
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporaryPath, ($state | ConvertTo-Json -Depth 100 -Compress), $utf8NoBom)
    [IO.File]::Replace($temporaryPath, $statePath, $backupPath, $true)
    return [pscustomobject]@{
        Applied = $true
        Reason = $null
        Synced = $synced.ToArray()
        Backup = $backupPath
    }
}

function Write-HandoffSummary {
    param(
        [Parameter(Mandatory = $true)][object]$HandoffResult,
        [Parameter(Mandatory = $true)][string]$TargetProvider,
        [object]$SidebarSync = $null
    )

    $items = @($HandoffResult.results | Where-Object {
        $_.status -in @('handed-off', 'noop') -and
        -not [string]::IsNullOrWhiteSpace([string]$_.targetThreadId)
    })
    if ($items.Count -eq 0) { return $null }

    $tasks = @($items | ForEach-Object {
        $target = [string]$_.targetThreadId
        $name = if ($_.tagging -and $_.tagging.baseName) { [string]$_.tagging.baseName } else { '' }
        [ordered]@{
            stableTaskId = [string]$_.stableTaskId
            displayName = $name
            targetThreadId = $target
            deepLink = "codex://threads/$target"
            status = [string]$_.status
        }
    })
    $summary = [ordered]@{
        provider = $TargetProvider
        at = (Get-Date).ToString('o')
        count = $tasks.Count
        handedOff = @($items | Where-Object { $_.status -eq 'handed-off' }).Count
        noop = @($items | Where-Object { $_.status -eq 'noop' }).Count
        sidebarSync = $SidebarSync
        previewBackfill = $HandoffResult.previewBackfill
        tasks = $tasks
    }
    try {
        New-Item -ItemType Directory -Path $handoffLogRoot -Force | Out-Null
        $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $lastHandoffPath -Encoding UTF8
    } catch {
        # 记录失败不影响打开流程。
    }
    return $summary
}

function Show-HandoffSummaryNotice {
    param([Parameter(Mandatory = $true)][object]$Summary)

    if ($null -eq $Summary -or [int]$Summary.count -lt 2) { return }
    $providerName = if ($Summary.provider -eq 'gpt') { 'GPT' } else { 'DeepSeek' }
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("已交接到 $providerName 的任务共 $($Summary.count) 个，并已逐个打开（前台是第一个）：")
    $lines.Add('')
    foreach ($task in $Summary.tasks) {
        $label = if ($task.displayName) { $task.displayName } else { $task.stableTaskId }
        $state = if ($task.status -eq 'noop') { '无需交接' } else { '已交接' }
        $lines.Add("・$label（$state）")
        $lines.Add("  $($task.deepLink)")
    }
    $lines.Add('')
    $lines.Add("任务已经全部打开过，侧栏里应能看到它们（按 [$providerName] 前缀识别）；上面的链接也可留作备用。")
    $text = $lines -join [Environment]::NewLine
    try {
        $popup = New-Object -ComObject WScript.Shell
        [void]$popup.Popup($text, 12, "交接完成：$($Summary.count) 个任务", 64)
    } catch {
        # 提示失败不影响打开流程。
    }
}

function Open-CodexTargetThread {
    param(
        [Parameter(Mandatory = $true)][string]$TargetThreadId,
        [Parameter(Mandatory = $true)][string]$TargetProvider
    )

    $targetUri = "codex://threads/$TargetThreadId"
    try {
        Start-Process -FilePath $targetUri -ErrorAction Stop | Out-Null
    } catch {
        throw "无法打开 $TargetProvider 目标任务 $TargetThreadId。Codex 深链失败：$($_.Exception.Message)"
    }

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue) { return $targetUri }
        Start-Sleep -Milliseconds 500
    }
    throw "Codex 已收到目标任务深链但未在 30 秒内启动：$targetUri"
}

function Open-CodexTargetThreads {
    param(
        [Parameter(Mandatory = $true)][string[]]$ThreadIds,
        [Parameter(Mandatory = $true)][string]$TargetProvider
    )

    if ($ThreadIds.Count -eq 0) {
        throw '交接结果没有可打开的目标任务 ID，Codex 不会启动。'
    }
    $primary = [string]$ThreadIds[0]
    $extras = @($ThreadIds | Select-Object -Skip 1)
    # 先把其余任务逐个打开，最后再打开第一个：这样侧栏会把每一条都登记一次，
    # 前台留在本次真正新交接的那条上。
    foreach ($threadId in $extras) {
        try {
            Start-Process -FilePath "codex://threads/$threadId" -ErrorAction Stop | Out-Null
            Start-Sleep -Milliseconds 1200
        } catch {
            # 单条打开失败不阻断其余任务；汇总提示里仍会给出深链。
        }
    }
    $null = Open-CodexTargetThread -TargetThreadId $primary -TargetProvider $TargetProvider
    return @($ThreadIds)
}

function Write-LastOpenedRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Mode,
        [string]$ThreadId = '',
        [string[]]$ThreadIds = @()
    )

    try {
        New-Item -ItemType Directory -Path $handoffLogRoot -Force | Out-Null
        $allThreadIds = @($ThreadIds | Where-Object { $_ } | ForEach-Object { [string]$_ })
        if ($allThreadIds.Count -eq 0 -and $ThreadId) { $allThreadIds = @([string]$ThreadId) }
        [ordered]@{
            provider = $Mode
            threadId = if ($ThreadId) { $ThreadId } else { $null }
            threadIds = $allThreadIds
            at = (Get-Date).ToString('o')
        } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $lastOpenedPath -Encoding UTF8
    } catch {
        # 记录失败不影响打开流程。
    }
}

function Get-LastOpenedThreadId {
    param([Parameter(Mandatory = $true)][string]$Mode)

    if (-not (Test-Path -LiteralPath $lastOpenedPath -PathType Leaf)) { return $null }
    try {
        $record = Get-Content -LiteralPath $lastOpenedPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return $null
    }
    if ([string]$record.provider -ne $Mode) { return $null }
    $threadId = [string]$record.threadId
    if ($threadId -notmatch '^[0-9a-fA-F-]{36}$') { return $null }
    return $threadId
}

function Open-CodexPlain {
    $savedErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $launchOutput = & (Find-CodexExecutable) app 2>&1
    # Native applications may write ordinary status text to stderr. In
    # Windows PowerShell that can make `$?` false even when the native
    # process exited successfully, so only trust the native exit code.
    $launchExit = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    $ErrorActionPreference = $savedErrorActionPreference
    $reportedOpening = (@($launchOutput | ForEach-Object { "$_" }) -join "`n") -match 'Opening workspace .+ in the Desktop app'
    if ($launchExit -ne 0 -and -not $reportedOpening) {
        $launchDetails = @($launchOutput | Select-Object -Last 5 | ForEach-Object { "$_" }) -join [Environment]::NewLine
        throw "Codex 官方 app 启动命令返回错误 $launchExit。`n$launchDetails"
    }
    return $true
}

function Open-CodexForMode {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('gpt', 'deepseek')][string]$Mode,
        [switch]$PreferLastOpened
    )

    $adapter = $null
    if ($Mode -eq 'deepseek') {
        $adapter = Start-ModelNameAdapter
    }

    $threadId = $null
    if ($PreferLastOpened) {
        $threadId = Get-LastOpenedThreadId -Mode $Mode
    }
    if ($threadId) {
        try {
            $null = Open-CodexTargetThread -TargetThreadId $threadId -TargetProvider $Mode
        } catch {
            $threadId = $null
        }
    }
    if (-not $threadId) {
        $null = Open-CodexPlain
    } else {
        Write-LastOpenedRecord -Mode $Mode -ThreadId $threadId
    }

    return [pscustomobject]@{
        Mode = $Mode
        ThreadId = $threadId
        Adapter = $adapter
    }
}

function New-ModeBlock {
    param([string]$Mode)

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add($managedStart)
    $lines.Add("# active_mode = $Mode")

    if ($Mode -eq 'gpt') {
        $lines.Add("model = `"$(Get-ActiveModel 'openai')`"")
        $lines.Add('model_reasoning_effort = "high"')
        $lines.Add('forced_login_method = "chatgpt"')
    } else {
        $catalog = $pickerModelsPath -replace '\\', '/'
        $lines.Add("model = `"$(Get-ActiveModel 'deepseek')`"")
        $lines.Add('model_provider = "deepseek"')
        $lines.Add("model_reasoning_effort = `"$(Get-DeepSeekModeSetting 'reasoningEffort')`"")
        $lines.Add("web_search = `"$(Get-DeepSeekModeSetting 'webSearch')`"")
        $lines.Add("model_catalog_json = `"$catalog`"")
        $lines.Add('forced_login_method = "api"')
    }

    $lines.Add($managedEnd)
    return ($lines -join "`n")
}

function Set-CandidateMode {
    param(
        [string]$RawConfig,
        [string]$Mode
    )

    $startPattern = [regex]::Escape($managedStart)
    $endPattern = [regex]::Escape($managedEnd)
    $pattern = "(?ms)^$startPattern\r?\n.*?^$endPattern"
    $matches = [regex]::Matches($RawConfig, $pattern)
    if ($matches.Count -ne 1) {
        throw "配置中应当恰好存在一个受管模式区块，实际找到 $($matches.Count) 个。为避免误改，已停止。"
    }

    $replacement = New-ModeBlock $Mode
    $candidate = [regex]::Replace($RawConfig, $pattern, $replacement, 1)
    $adapterPort = [int](Get-ModelAdapterSetting 'port')
    $baseUrl = if ($Mode -eq 'deepseek') {
        "http://127.0.0.1:$adapterPort/"
    } else {
        [string](Get-ModelAdapterSetting 'upstreamBaseUrl')
    }
    $providerPattern = '(?ms)(^\s*\[model_providers\.deepseek\]\s*\r?\n)(.*?)(?=^\s*\[|\z)'
    $providerMatch = [regex]::Match($candidate, $providerPattern)
    if (-not $providerMatch.Success) { throw '找不到 [model_providers.deepseek] 配置区块。' }
    $providerBody = $providerMatch.Groups[2].Value
    $baseUrlMatches = [regex]::Matches($providerBody, '(?m)^\s*base_url\s*=.*$')
    if ($baseUrlMatches.Count -ne 1) { throw 'DeepSeek provider 应当恰好包含一个 base_url。' }
    $newBody = [regex]::Replace($providerBody, '(?m)^\s*base_url\s*=.*$', "base_url = `"$baseUrl`"", 1)
    return $candidate.Substring(0, $providerMatch.Groups[2].Index) + $newBody + $candidate.Substring($providerMatch.Groups[2].Index + $providerMatch.Groups[2].Length)
}

function Get-CurrentMode {
    param([Parameter(Mandatory = $true)][string]$RawConfig)

    $pattern = "(?ms)^$([regex]::Escape($managedStart))\r?\n(?<body>.*?)^$([regex]::Escape($managedEnd))"
    $match = [regex]::Match($RawConfig, $pattern)
    if (-not $match.Success) { return $null }

    $body = $match.Groups['body'].Value
    $modeMatch = [regex]::Match($body, '(?m)^\s*#?\s*active_mode\s*=\s*([A-Za-z]+)')
    if ($modeMatch.Success) {
        $mode = $modeMatch.Groups[1].Value.ToLowerInvariant()
        if ($mode -in @('gpt', 'deepseek')) { return $mode }
    }
    if ([regex]::IsMatch($body, '(?m)^\s*model_provider\s*=\s*"deepseek"')) { return 'deepseek' }
    return 'gpt'
}

function Test-CandidateConfig {
    param([string]$Candidate)

    $codexExe = Find-CodexExecutable
    $validationHome = Join-Path $installDir ('.preflight-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $validationHome -Force | Out-Null
    $validationConfig = Join-Path $validationHome 'config.toml'
    $validationError = Join-Path $validationHome 'doctor.stderr.txt'
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($validationConfig, $Candidate, $utf8NoBom)

    $savedCodexHome = $env:CODEX_HOME
    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $env:CODEX_HOME = $validationHome
        $ErrorActionPreference = 'Continue'
        $doctorOutput = & $codexExe --strict-config doctor --json 2>$validationError
        $doctorJson = (($doctorOutput | ForEach-Object { "$_" }) -join [Environment]::NewLine) | ConvertFrom-Json
        $configCheck = $doctorJson.checks.'config.load'
    } finally {
        $ErrorActionPreference = $savedErrorActionPreference
        if ($null -eq $savedCodexHome) {
            Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
        } else {
            $env:CODEX_HOME = $savedCodexHome
        }
        Remove-Item -LiteralPath $validationHome -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (-not $configCheck -or $configCheck.status -ne 'ok') {
        throw '新配置未通过 Codex 严格检查，因此没有写入。'
    }
}

function Request-DeepSeekKey {
    $form = New-Object Windows.Forms.Form
    $form.Text = 'DeepSeek API Key'
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ClientSize = New-Object Drawing.Size(470, 165)

    $label = New-Object Windows.Forms.Label
    $label.Text = '请输入 DeepSeek API Key（以 sk- 开头）。密钥将由 Windows 加密保存。'
    $label.AutoSize = $false
    $label.Location = New-Object Drawing.Point(18, 18)
    $label.Size = New-Object Drawing.Size(430, 42)
    $form.Controls.Add($label)

    $textBox = New-Object Windows.Forms.TextBox
    $textBox.Location = New-Object Drawing.Point(20, 67)
    $textBox.Size = New-Object Drawing.Size(425, 25)
    $textBox.UseSystemPasswordChar = $true
    $form.Controls.Add($textBox)

    $okButton = New-Object Windows.Forms.Button
    $okButton.Text = '保存并启动'
    $okButton.Location = New-Object Drawing.Point(274, 112)
    $okButton.Size = New-Object Drawing.Size(92, 30)
    $okButton.DialogResult = [Windows.Forms.DialogResult]::OK
    $form.Controls.Add($okButton)

    $cancelButton = New-Object Windows.Forms.Button
    $cancelButton.Text = '取消'
    $cancelButton.Location = New-Object Drawing.Point(374, 112)
    $cancelButton.Size = New-Object Drawing.Size(72, 30)
    $cancelButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($cancelButton)

    $form.AcceptButton = $okButton
    $form.CancelButton = $cancelButton
    $form.Add_Shown({ $textBox.Focus() })

    $result = $form.ShowDialog()
    if ($result -ne [Windows.Forms.DialogResult]::OK) { return $null }
    return $textBox.Text.Trim()
}

function Save-DeepSeekKey {
    param([string]$PlainValue)

    if ($PlainValue -cnotlike 'sk-*') { throw 'DeepSeek API Key 必须以 sk- 开头。' }
    $secureValue = ConvertTo-SecureString $PlainValue -AsPlainText -Force
    $encrypted = ConvertFrom-SecureString $secureValue
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($secretPath, $encrypted + [Environment]::NewLine, $utf8NoBom)
}

function Restore-GptMode {
    # 正常交接（DeepSeek → GPT）走上面的候选配置写入路径；这里只保留给
    # 「不交接、仅恢复 GPT 配置」的人工恢复场景，启动器不再自动调用。
    $currentConfig = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
    $gptConfig = Set-CandidateMode -RawConfig $currentConfig -Mode 'gpt'
    $restoreTimestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $restoreTemporary = Join-Path $codexHome "config.toml.restore-gpt-$restoreTimestamp.tmp"
    $restoreBackup = Join-Path $backupRoot "config.$restoreTimestamp.before-auto-restore-gpt.toml"
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($restoreTemporary, $gptConfig, $utf8NoBom)
    [IO.File]::Replace($restoreTemporary, $configPath, $restoreBackup, $true)
}

function Wait-For-CodexToExit {
    $deadline = (Get-Date).AddSeconds(30)
    $appStarted = $false
    while ((Get-Date) -lt $deadline) {
        if (Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue) {
            $appStarted = $true
            break
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $appStarted) {
        return
    }

    $noProcessChecks = 0
    while ($noProcessChecks -lt 3) {
        if (Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue) {
            $noProcessChecks = 0
        } else {
            $noProcessChecks++
        }
        Start-Sleep -Seconds 1
    }
}

$requestMutex = $null
$requestMutexAcquired = $false
$handoffMutex = $null
$handoffMutexAcquired = $false
$modelAdapter = $null
$keepAdapterAlive = $false

try {
    if (-not $ValidateOnly) {
        $requestMutexName = "Local\CodexDesktopProviderRequest-$Provider"
        $requestMutex = [System.Threading.Mutex]::new($false, $requestMutexName)
        try {
            $requestMutexAcquired = $requestMutex.WaitOne(0)
        } catch [System.Threading.AbandonedMutexException] {
            $requestMutexAcquired = $true
        }
        if (-not $requestMutexAcquired) {
            exit 0
        }

        Show-HandoffStartedNotice -TargetProvider $Provider

        $handoffMutex = [System.Threading.Mutex]::new($false, 'Local\CodexDesktopProviderHandoff')
        try {
            $handoffMutexAcquired = $handoffMutex.WaitOne([TimeSpan]::FromMinutes(30))
        } catch [System.Threading.AbandonedMutexException] {
            $handoffMutexAcquired = $true
        }
        if (-not $handoffMutexAcquired) {
            throw '等待上一轮模型交接超过 30 分钟。Codex 未启动，请确认没有遗留的交接进程后重试。'
        }
    }

    foreach ($required in @($configPath, $modelsPath, $keyHelperPath, $handoffSettingsPath, $catalogBuilderPath, $modelAdapterPath)) {
        if (-not (Test-Path -LiteralPath $required)) { throw "缺少必需文件：$required" }
    }
    Build-DeepSeekPickerCatalog

    $rawConfig = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
    $currentMode = Get-CurrentMode -RawConfig $rawConfig
    if (-not $currentMode) {
        throw '无法从 config.toml 的受管模式区块判断当前模式（区块缺失或被改动）。为避免误改配置，已停止。'
    }
    $candidate = Set-CandidateMode -RawConfig $rawConfig -Mode $Provider
    Test-CandidateConfig $candidate

    if ($ValidateOnly) {
        [ordered]@{
            provider = $Provider
            current_mode = $currentMode
            config_valid = $true
            config_would_change = ($candidate -cne $rawConfig)
        } | ConvertTo-Json
        exit 0
    }

    $runningApp = Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue
    if ($runningApp) {
        Show-LauncherMessage -Title '请先关闭 Codex' -Icon Warning -Text @'
Codex 桌面应用仍在运行。

请先完全关闭当前 Codex 窗口，再重新点击此快捷方式。这样新配置才能在启动时生效，也能避免同一个任务被两个进程同时写入。
'@
        exit 2
    }

    if (($Provider -eq 'deepseek' -or $currentMode -eq 'deepseek') -and -not (Test-Path -LiteralPath $secretPath)) {
        $deepSeekKey = Request-DeepSeekKey
        if (-not $deepSeekKey) { exit 0 }
        Save-DeepSeekKey $deepSeekKey
        $deepSeekKey = $null
    }

    $selection = Select-HandoffTask -TargetProvider $Provider
    if ($null -eq $selection) { exit 0 }

    if ($selection.Mode -eq 'open-only') {
        $openMode = Resolve-LauncherOpenPlan -SelectionMode $selection.Mode -CurrentMode $currentMode -TargetProvider $Provider
        $openResult = Open-CodexForMode -Mode $openMode -PreferLastOpened
        $modelAdapter = $openResult.Adapter
        if ($openMode -eq 'deepseek') {
            # 保持适配器存活到 Codex 退出；退出后由 finally 停止适配器，配置保持 DeepSeek 不变。
            Wait-For-CodexToExit
        }
        exit 0
    }

    if ($selection.Mode -eq 'switch-only') {
        # 只换模型：写目标模式的配置、按需启停适配器、打开 Codex。
        # 不读任务清单、不做任何交接同步，因此不会写 rollout，也不会推进任何游标。
        $openMode = Resolve-LauncherOpenPlan -SelectionMode $selection.Mode -CurrentMode $currentMode -TargetProvider $Provider
        if ($openMode -eq $currentMode) {
            # 已经处于目标模式：等同于「仅打开 Codex」。
            $openResult = Open-CodexForMode -Mode $currentMode -PreferLastOpened
            $modelAdapter = $openResult.Adapter
            if ($currentMode -eq 'deepseek') { Wait-For-CodexToExit }
            exit 0
        }

        $backupPath = Write-ManagedConfigForProvider -Provider $Provider -Candidate $candidate
        try {
            if ($currentMode -eq 'deepseek') {
                # 离开 DeepSeek 模式：收掉本机适配器，避免 GPT 模式下残留一个没人用的本地代理。
                $null = Stop-ModelNameAdapter -Port ([int](Get-ModelAdapterSetting 'port'))
            }
            $openResult = Open-CodexForMode -Mode $openMode -PreferLastOpened
            $modelAdapter = $openResult.Adapter
            if ($openMode -eq 'deepseek') {
                Wait-For-CodexToExit
            }
        } catch {
            Copy-Item -LiteralPath $backupPath -Destination $configPath -Force
            throw "只切换模型失败，配置已自动恢复（仍是 $currentMode 模式）。$($_.Exception.Message)"
        }
        exit 0
    }

    $selectedTaskIds = @($selection.TaskIds)
    if ($selectedTaskIds.Count -eq 0) { exit 0 }

    $handoffPreflight = Invoke-BatchHandoff -TargetProvider $Provider -OnlyTaskIds $selectedTaskIds -DryRun

    $backupPath = Write-ManagedConfigForProvider -Provider $Provider -Candidate $candidate

    try {
        if ($Provider -eq 'deepseek') {
            $modelAdapter = Start-ModelNameAdapter
        } elseif ($currentMode -eq 'deepseek') {
            # 交接到 GPT 同样是离开 DeepSeek 模式：把适配器收掉，别让它一直挂在 10101。
            $null = Stop-ModelNameAdapter -Port ([int](Get-ModelAdapterSetting 'port'))
        }
        $handoffResult = Invoke-BatchHandoff -TargetProvider $Provider -OnlyTaskIds $selectedTaskIds
        $sidebarSync = Sync-CodexSidebarRegistrations -HandoffResult $handoffResult
        $handoffSummary = Write-HandoffSummary -HandoffResult $handoffResult -TargetProvider $Provider -SidebarSync $sidebarSync
        $targetThreadIds = @(Get-DesktopTargetThreadIds -HandoffResult $handoffResult)
        $null = Open-CodexTargetThreads -ThreadIds $targetThreadIds -TargetProvider $Provider
        Write-LastOpenedRecord -Mode $Provider -ThreadId $targetThreadIds[0] -ThreadIds $targetThreadIds
        Show-HandoffSummaryNotice -Summary $handoffSummary

        if ($Provider -eq 'deepseek') {
            # 关闭 DeepSeek 模式的 Codex 不再自动写配置、不再自动回程：
            # 等 Codex 退出后停止适配器并直接退出，config.toml 保持 DeepSeek。
            Wait-For-CodexToExit
        }
    } catch {
        Copy-Item -LiteralPath $backupPath -Destination $configPath -Force
        # 配置已回滚到切换前的模式。回滚后若是 DeepSeek 模式，必须同时把适配器恢复起来：
        # 否则 Codex 会指向 127.0.0.1:10101 却没有人应答，表现就是“断网”。
        $restoredMode = $null
        $adapterRestoreError = $null
        try {
            $restoredMode = Get-CurrentMode -RawConfig (Get-Content -LiteralPath $configPath -Raw -Encoding UTF8)
        } catch { }
        if ($restoredMode -eq 'deepseek') {
            try {
                $modelAdapter = Start-ModelNameAdapter
                $keepAdapterAlive = $true
            } catch {
                $adapterRestoreError = $_.Exception.Message
            }
        }
        $adapterNote = if ($restoredMode -eq 'deepseek' -and -not $keepAdapterAlive) {
            "再次运行「交接给deepseek」可以重新启动它。`n$adapterRestoreError`n"
        } else {
            ''
        }
        throw "任务交接或桌面 Codex 启动失败，配置已自动恢复（仍是 $restoredMode 模式）。$adapterNote$($_.Exception.Message)"
    }
} catch {
    if ($ValidateOnly) {
        [Console]::Error.WriteLine($_.Exception.Message)
    } else {
        Show-LauncherMessage -Title 'Codex 模型切换失败' -Icon Error -Text $_.Exception.Message
    }
    exit 1
} finally {
    if (-not $keepAdapterAlive -and $null -ne $modelAdapter -and $modelAdapter.Owned -and $null -ne $modelAdapter.Process -and -not $modelAdapter.Process.HasExited) {
        Stop-Process -Id $modelAdapter.Process.Id -Force -ErrorAction SilentlyContinue
    }
    if ($handoffMutexAcquired -and $null -ne $handoffMutex) {
        $handoffMutex.ReleaseMutex()
    }
    if ($null -ne $handoffMutex) {
        $handoffMutex.Dispose()
    }
    if ($requestMutexAcquired -and $null -ne $requestMutex) {
        $requestMutex.ReleaseMutex()
    }
    if ($null -ne $requestMutex) {
        $requestMutex.Dispose()
    }
}

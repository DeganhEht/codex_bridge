[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string]$InstallRoot = '',
    [string]$CodexHome = '',
    [string]$DesktopPath = '',
    [switch]$RemoveEncryptedKey
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $InstallRoot) {
    $InstallRoot = if ($env:CODEX_MODEL_SWITCHER_ROOT) {
        [IO.Path]::GetFullPath($env:CODEX_MODEL_SWITCHER_ROOT)
    } else {
        Join-Path (Join-Path $env:USERPROFILE '.codex') 'model-switcher'
    }
}
if (-not $CodexHome) {
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
}
if (-not $DesktopPath) { $DesktopPath = [Environment]::GetFolderPath('Desktop') }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$DesktopPath = [IO.Path]::GetFullPath($DesktopPath)
if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) {
    [ordered]@{ installRoot = $InstallRoot; removed = @(); message = '安装目录不存在。' } | ConvertTo-Json
    exit 0
}

$statePath = Join-Path $InstallRoot 'handoff-install-state.json'
$state = if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
    $null
}
$configPath = Join-Path $CodexHome 'config.toml'
$modeStart = '# >>> Codex desktop model switcher: mode (managed; do not edit)'
$modeEnd = '# <<< Codex desktop model switcher: mode'
$providerStart = '# >>> Codex desktop model switcher: DeepSeek provider (managed; do not edit)'
$providerEnd = '# <<< Codex desktop model switcher: DeepSeek provider'

function Remove-ManagedBlock {
    param([string]$Raw, [string]$Start, [string]$End, [string]$Label)
    $pattern = '(?ms)^' + [regex]::Escape($Start) + '\r?\n.*?^' + [regex]::Escape($End) + '\r?$(\r?\n){0,2}'
    $matches = [regex]::Matches($Raw, $pattern)
    if ($matches.Count -gt 1) { throw "$Label 受管区块重复，卸载器已停止以避免误删。" }
    if ($matches.Count -eq 0) { return $Raw }
    return [regex]::Replace($Raw, $pattern, '', 1)
}

if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    $rawConfig = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
    $candidate = Remove-ManagedBlock -Raw $rawConfig -Start $modeStart -End $modeEnd -Label '模式'
    if ($null -ne $state -and [bool]$state.providerBlockAdded) {
        $candidate = Remove-ManagedBlock -Raw $candidate -Start $providerStart -End $providerEnd -Label 'DeepSeek provider'
    }
    $candidate = $candidate.TrimStart()
    if ($candidate -cne $rawConfig -and $PSCmdlet.ShouldProcess($configPath, '备份并移除 Codex-DeepSeek-Handoff 受管配置')) {
        $backupRoot = Join-Path $CodexHome 'backups\codex-deepseek-handoff-install'
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $backupPath = Join-Path $backupRoot "config.$timestamp.before-handoff-uninstall.toml"
        $temporaryPath = Join-Path $CodexHome "config.toml.handoff-uninstall-$timestamp.tmp"
        $utf8NoBom = New-Object Text.UTF8Encoding($false)
        try {
            [IO.File]::WriteAllText($temporaryPath, $candidate, $utf8NoBom)
            [IO.File]::Replace($temporaryPath, $configPath, $backupPath, $true)
        } finally {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
    }
}

# Keep official provider files and task handoff state by default. A user must
# opt in explicitly to remove the encrypted key.
$knownFiles = @(
    'codex-desktop-model-launcher.ps1',
    'handoff-result-contract.psm1',
    'create-gpt-handoff-shortcut.ps1',
    'create-handoff-shortcuts.ps1',
    'initialize-handoff.ps1',
    'ensure-deepseek-adapter.ps1',
    'ensure-deepseek-adapter-hidden.vbs',
    'pwsh-path.txt',
    'uninstall.ps1',
    'install-manifest.json',
    'handoff-install-state.json'
)
$removed = New-Object System.Collections.Generic.List[string]
foreach ($relativePath in $knownFiles) {
    $path = Join-Path $InstallRoot $relativePath
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        if ($PSCmdlet.ShouldProcess($path, '删除项目安装文件')) {
            Remove-Item -LiteralPath $path -Force
            $removed.Add($path)
        }
    }
}

$threadSourceRoot = Join-Path $InstallRoot 'thread-localizer\src'
if (Test-Path -LiteralPath $threadSourceRoot -PathType Container) {
    if ($PSCmdlet.ShouldProcess($threadSourceRoot, '删除项目交接程序目录并保留 data/reports')) {
        Remove-Item -LiteralPath $threadSourceRoot -Recurse -Force
        $removed.Add($threadSourceRoot)
    }
}
foreach ($relativePath in @('thread-localizer\package.json', 'thread-localizer\README.md')) {
    $path = Join-Path $InstallRoot $relativePath
    if ((Test-Path -LiteralPath $path -PathType Leaf) -and $PSCmdlet.ShouldProcess($path, '删除项目交接程序文件')) {
        Remove-Item -LiteralPath $path -Force
        $removed.Add($path)
    }
}

foreach ($shortcutName in @('任务交接GPT.lnk', 'DeepSeek交接.lnk', '交接给GPT.lnk', '交接给deepseek.lnk')) {
    $shortcutPath = Join-Path $DesktopPath $shortcutName
    if ((Test-Path -LiteralPath $shortcutPath -PathType Leaf) -and $PSCmdlet.ShouldProcess($shortcutPath, '删除项目快捷方式')) {
        Remove-Item -LiteralPath $shortcutPath -Force
        $removed.Add($shortcutPath)
    }
}

$adapterGuardRemoved = $false
$adapterGuardTaskName = 'CodexDeepSeekAdapterGuard'
try {
    $guardTask = Get-ScheduledTask -TaskName $adapterGuardTaskName -ErrorAction SilentlyContinue
    if ($guardTask -and $PSCmdlet.ShouldProcess($adapterGuardTaskName, '删除 DeepSeek 适配器守护计划任务')) {
        try {
            Unregister-ScheduledTask -TaskName $adapterGuardTaskName -Confirm:$false
            $adapterGuardRemoved = $true
        } catch {
            $output = & schtasks /Delete /F /TN $adapterGuardTaskName 2>&1
            if ($LASTEXITCODE -eq 0) {
                $adapterGuardRemoved = $true
            } else {
                Write-Warning "删除计划任务失败：$($output -join ' ')"
            }
        }
        if ($adapterGuardRemoved) { $removed.Add("task:$adapterGuardTaskName") }
    }
} catch {
    # 计划任务不存在或没有权限时不影响卸载其余部分。
}

$secretPath = Join-Path $InstallRoot 'deepseek-api-key.dpapi'
if ($RemoveEncryptedKey -and (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
    if ($PSCmdlet.ShouldProcess($secretPath, '删除当前 Windows 用户的加密 DeepSeek key')) {
        Remove-Item -LiteralPath $secretPath -Force
        $removed.Add($secretPath)
    }
}

[ordered]@{
    installRoot = $InstallRoot
    removed = @($removed)
    encryptedKeyRemoved = [bool]($RemoveEncryptedKey -and ($removed -contains $secretPath))
    adapterGuardRemoved = $adapterGuardRemoved
    taskDataPreserved = $true
    configPreserved = $true
    officialCatalogPreserved = (Test-Path -LiteralPath (Join-Path $InstallRoot 'models-deepseek.json') -PathType Leaf)
    handoffStatePreserved = (Test-Path -LiteralPath (Join-Path $InstallRoot 'thread-localizer\data') -PathType Container)
} | ConvertTo-Json

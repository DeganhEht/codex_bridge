[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string]$InstallRoot = '',
    [string]$DesktopPath = '',
    [ValidateSet('both', 'gpt', 'deepseek')]
    [string]$Provider = 'both',
    [string]$GptIconPath = '',
    [string]$DeepSeekIconPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $InstallRoot) {
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $InstallRoot = if ($env:CODEX_MODEL_SWITCHER_ROOT) { $env:CODEX_MODEL_SWITCHER_ROOT } else { Join-Path $codexHome 'model-switcher' }
}
if (-not $DesktopPath) { $DesktopPath = [Environment]::GetFolderPath('Desktop') }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DesktopPath = [IO.Path]::GetFullPath($DesktopPath)
$launcherPath = Join-Path $InstallRoot 'codex-desktop-model-launcher.ps1'
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw "找不到桌面启动器：$launcherPath" }

$pwsh = Get-Command 'pwsh.exe' -ErrorAction SilentlyContinue
$powershellPath = if ($pwsh) { $pwsh.Source } else { Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe' }
if (-not (Test-Path -LiteralPath $powershellPath -PathType Leaf)) { throw "找不到 PowerShell：$powershellPath" }
$workingDirectory = Join-Path $env:USERPROFILE 'Documents\Codex'
if (-not (Test-Path -LiteralPath $workingDirectory -PathType Container)) { $workingDirectory = $env:USERPROFILE }
$fallbackIcon = Join-Path $env:SystemRoot 'System32\shell32.dll'

$legacyShortcuts = @(
    [ordered]@{ name = '任务交接GPT.lnk'; provider = 'gpt' },
    [ordered]@{ name = 'DeepSeek交接.lnk'; provider = 'deepseek' }
)
$removedLegacy = New-Object System.Collections.Generic.List[string]
$legacyConflicts = New-Object System.Collections.Generic.List[string]
$shell = New-Object -ComObject WScript.Shell
foreach ($legacy in $legacyShortcuts) {
    $legacyPath = Join-Path $DesktopPath $legacy.name
    if (-not (Test-Path -LiteralPath $legacyPath -PathType Leaf)) { continue }
    $existing = $shell.CreateShortcut($legacyPath)
    $expectedArgument = "-Provider $($legacy.provider)"
    $isOurShortcut = ($existing.Arguments -like "*$launcherPath*") -and ($existing.Arguments -like "*$expectedArgument*")
    if (-not $isOurShortcut) {
        $legacyConflicts.Add($legacyPath)
        continue
    }
    if ($PSCmdlet.ShouldProcess($legacyPath, '移除旧版重复任务交接快捷方式')) {
        Remove-Item -LiteralPath $legacyPath -Force
        $removedLegacy.Add($legacyPath)
    }
}

$definitions = @(
    [ordered]@{
        provider = 'gpt'
        name = '交接给GPT.lnk'
        description = 'Finish the DeepSeek-to-GPT task handoff before opening Codex.'
        icon = if ($GptIconPath) { $GptIconPath } else { $fallbackIcon }
        iconIndex = 2
    },
    [ordered]@{
        provider = 'deepseek'
        name = '交接给deepseek.lnk'
        description = 'Finish the GPT-to-DeepSeek task handoff before opening Codex.'
        icon = if ($DeepSeekIconPath) { $DeepSeekIconPath } else { $fallbackIcon }
        iconIndex = 13
    }
)
if ($Provider -ne 'both') { $definitions = @($definitions | Where-Object { $_.provider -eq $Provider }) }

$created = New-Object System.Collections.Generic.List[object]
foreach ($definition in $definitions) {
    $iconPath = [IO.Path]::GetFullPath([string]$definition.icon)
    if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) { throw "找不到快捷方式图标：$iconPath" }
    $shortcutPath = Join-Path $DesktopPath ([string]$definition.name)
    $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcherPath`" -Provider $($definition.provider)"
    if ($PSCmdlet.ShouldProcess($shortcutPath, "创建 $($definition.provider) 任务交接快捷方式")) {
        New-Item -ItemType Directory -Path $DesktopPath -Force | Out-Null
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $powershellPath
        $shortcut.Arguments = $arguments
        $shortcut.WorkingDirectory = $workingDirectory
        $shortcut.IconLocation = "$iconPath,$($definition.iconIndex)"
        $shortcut.Description = [string]$definition.description
        $shortcut.WindowStyle = 7
        $shortcut.Save()
    }
    $created.Add([ordered]@{
        provider = $definition.provider
        shortcut = $shortcutPath
        target = $powershellPath
        arguments = $arguments
        icon = "$iconPath,$($definition.iconIndex)"
    })
}

[ordered]@{
    whatIf = [bool]$WhatIfPreference
    shortcuts = $created.ToArray()
    removedLegacyShortcuts = $removedLegacy.ToArray()
    legacyShortcutConflicts = $legacyConflicts.ToArray()
} | ConvertTo-Json -Depth 5

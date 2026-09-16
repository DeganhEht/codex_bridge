$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$files = Get-ChildItem -LiteralPath $repoRoot -File -Recurse |
    Where-Object { $_.Extension -in @('.ps1', '.psm1') } |
    Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' }
$failures = New-Object System.Collections.Generic.List[string]

foreach ($file in $files) {
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $file.FullName,
        [ref]$tokens,
        [ref]$errors
    ) | Out-Null
    if ($errors.Count -gt 0) {
        $messages = ($errors | ForEach-Object { $_.Message }) -join '; '
        $failures.Add("$($file.FullName): $messages")
    }
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

[ordered]@{ files = $files.Count; status = 'ok' } | ConvertTo-Json

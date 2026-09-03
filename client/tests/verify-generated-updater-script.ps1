[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '..\Services\UpdateHelper.cs'
$source = Get-Content -LiteralPath $sourcePath -Raw
$match = [regex]::Match(
    $source,
    'var script = \$@"(?<body>.*?)";\s*File\.WriteAllText',
    [Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $match.Success) { throw 'Generated updater script literal was not found.' }

$script = $match.Groups['body'].Value
foreach ($interpolation in @(
    '{Ps(logPath)}',
    '{ServiceName}',
    '{DesktopAgentSupervisor.ScheduledTaskName}',
    '{Ps(currentExe)}',
    '{Ps(stagedExePath)}',
    '{Ps(versionDir)}',
    '{Ps(targetExe)}',
    '{Ps(installRoot)}',
    '{Ps(LockFile)}'
)) {
    $script = $script.Replace($interpolation, 'C:\BelfTest\value')
}

# Decode the C# interpolated-verbatim literal without evaluating it: known C#
# substitutions were replaced above, doubled braces are PowerShell braces, and
# doubled quotes are quotes in a verbatim string.
$openBrace = [char]0xE000
$closeBrace = [char]0xE001
$script = $script.Replace('{{', $openBrace).Replace('}}', $closeBrace)
$script = $script.Replace('""', '"').Replace($openBrace, '{').Replace($closeBrace, '}')

$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseInput(
    $script, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) {
    throw ('Generated updater PowerShell is invalid: ' +
        (($errors | ForEach-Object Message) -join '; '))
}

Write-Host 'Generated updater PowerShell AST: PASS'

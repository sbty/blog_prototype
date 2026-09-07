# Repository validation entrypoint.
param(
    [string]$NpmCommand
)

$ErrorActionPreference = "Continue"

$LogDir = ".agent\logs"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Resolve-NpmCommand {
    if (-not [string]::IsNullOrWhiteSpace($NpmCommand)) {
        if (-not (Test-Path -LiteralPath $NpmCommand -PathType Leaf)) {
            Write-Output "VALIDATION FAILED: npm command not found: $NpmCommand"
            exit 1
        }

        return (Resolve-Path -LiteralPath $NpmCommand).Path
    }

    $resolved = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $resolved) {
        $resolved = Get-Command npm -ErrorAction SilentlyContinue
    }
    if (-not $resolved) {
        Write-Output "VALIDATION FAILED: npm command not found"
        exit 1
    }

    return $resolved.Source
}

function Run-Check {
    param(
        [string]$Name,
        [string]$Executable,
        [string[]]$Arguments,
        [string]$LogFile
    )

    $fullLogPath = Join-Path $LogDir $LogFile

    try {
        $global:LASTEXITCODE = $null
        & $Executable @Arguments *> $fullLogPath
        $invocationSucceeded = $?
        $exitCode = $global:LASTEXITCODE

        if ($null -eq $exitCode) {
            $exitCode = if ($invocationSucceeded) { 0 } else { 1 }
        }
    }
    catch {
        $_ | Out-String | Set-Content -LiteralPath $fullLogPath
        $exitCode = 1
    }

    if ($exitCode -eq 0) {
        Write-Host "PASS: $Name"
        return $true
    }

    Write-Host "FAIL: $Name (exit $exitCode)"
    Write-Host "--- Relevant tail ---"

    Get-Content $fullLogPath -Tail 80 | ForEach-Object { Write-Host $_ }

    return $false
}

$npmExecutable = Resolve-NpmCommand
$allPassed = $true

if (-not (Run-Check `
    -Name "tests" `
    -Executable $npmExecutable `
    -Arguments @("test") `
    -LogFile "test.log")) {
    $allPassed = $false
}

if (-not (Run-Check `
    -Name "lint" `
    -Executable $npmExecutable `
    -Arguments @("run", "lint") `
    -LogFile "lint.log")) {
    $allPassed = $false
}

if (-not (Run-Check `
    -Name "typecheck" `
    -Executable $npmExecutable `
    -Arguments @("run", "typecheck") `
    -LogFile "typecheck.log")) {
    $allPassed = $false
}

if ($allPassed) {
    Write-Output "VALIDATION PASS"
    exit 0
}

Write-Output "VALIDATION FAILED"
exit 1

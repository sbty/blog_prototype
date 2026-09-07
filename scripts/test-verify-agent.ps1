$ErrorActionPreference = "Stop"

$verifyScript = (Resolve-Path (Join-Path $PSScriptRoot "verify-agent.ps1")).Path
$powershellExecutable = (Get-Process -Id $PID).Path
$systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = Join-Path $systemTemp ("verify-agent-test-" + [Guid]::NewGuid().ToString("N"))
$fakeNpm = Join-Path $testRoot "npm.cmd"

function Assert-Case {
    param(
        [string]$Mode,
        [int]$ExpectedExitCode,
        [string[]]$ExpectedOutput
    )

    $env:VERIFY_AGENT_TEST_MODE = $Mode
    $output = & $powershellExecutable `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $verifyScript `
        -NpmCommand $fakeNpm 2>&1
    $actualExitCode = $LASTEXITCODE
    $outputText = $output -join [Environment]::NewLine

    if ($actualExitCode -ne $ExpectedExitCode) {
        throw "Mode $Mode exited $actualExitCode, expected $ExpectedExitCode.`n$outputText"
    }

    foreach ($expected in $ExpectedOutput) {
        if (-not $outputText.Contains($expected)) {
            throw "Mode $Mode did not contain '$expected'.`n$outputText"
        }
    }
}

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    @"
@echo off
if "%VERIFY_AGENT_TEST_MODE%"=="fail-test" if "%1"=="test" exit /b 7
if "%VERIFY_AGENT_TEST_MODE%"=="fail-lint" if "%1"=="run" if "%2"=="lint" exit /b 8
if "%VERIFY_AGENT_TEST_MODE%"=="fail-typecheck" if "%1"=="run" if "%2"=="typecheck" exit /b 9
echo fake npm %*
exit /b 0
"@ | Set-Content -LiteralPath $fakeNpm -Encoding Ascii

    Push-Location $testRoot
    try {
        Assert-Case `
            -Mode "pass" `
            -ExpectedExitCode 0 `
            -ExpectedOutput @("PASS: tests", "PASS: lint", "PASS: typecheck", "VALIDATION PASS")
        Assert-Case `
            -Mode "fail-test" `
            -ExpectedExitCode 1 `
            -ExpectedOutput @("FAIL: tests (exit 7)", "VALIDATION FAILED")
        Assert-Case `
            -Mode "fail-lint" `
            -ExpectedExitCode 1 `
            -ExpectedOutput @("FAIL: lint (exit 8)", "VALIDATION FAILED")
        Assert-Case `
            -Mode "fail-typecheck" `
            -ExpectedExitCode 1 `
            -ExpectedOutput @("FAIL: typecheck (exit 9)", "VALIDATION FAILED")

        $missingNpm = Join-Path $testRoot "missing-npm.cmd"
        $missingOutput = & $powershellExecutable `
            -NoProfile `
            -ExecutionPolicy Bypass `
            -File $verifyScript `
            -NpmCommand $missingNpm 2>&1
        if ($LASTEXITCODE -ne 1 -or
            -not (($missingOutput -join [Environment]::NewLine).Contains("npm command not found"))) {
            throw "Missing npm command was not rejected.`n$($missingOutput -join [Environment]::NewLine)"
        }
    }
    finally {
        Pop-Location
    }

    Write-Output "PASS: verify-agent success and failure propagation"
}
finally {
    Remove-Item Env:VERIFY_AGENT_TEST_MODE -ErrorAction SilentlyContinue
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    if ($resolvedTestRoot.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and
        $resolvedTestRoot -ne $systemTemp -and
        (Test-Path -LiteralPath $resolvedTestRoot)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}

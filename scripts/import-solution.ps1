#Requires -Version 5.0
<#
.SYNOPSIS
    Import a Power Platform solution to target environment

.DESCRIPTION
    Imports managed solutions to target Dataverse environment with conflict resolution

.PARAMETER SolutionZipPath
    Path to the solution ZIP file(s) to import

.PARAMETER TargetEnvironmentUrl
    URL of the target environment

.PARAMETER ForceOverwrite
    Force overwrite existing solutions (default: $true)

.PARAMETER SkipDiagnostics
    Skip diagnostics validation (default: $true)

.EXAMPLE
    .\import-solution.ps1 -SolutionZipPath "./exports/MyCoreSolution.zip" -TargetEnvironmentUrl "https://ecellors-newfeatures.crm8.dynamics.com"
#>

param(
    [Parameter(Mandatory=$true)][string[]]$SolutionZipPath,
    [Parameter(Mandatory=$true)][string]$TargetEnvironmentUrl,
    [bool]$ForceOverwrite = $true,
    [bool]$SkipDiagnostics = $true
)

# Validate input paths
foreach ($path in $SolutionZipPath) {
    if (-not (Test-Path $path)) {
        Write-Host "✗ File not found: $path" -ForegroundColor Red
        exit 1
    }
    if (-not $path.EndsWith('.zip')) {
        Write-Host "✗ Invalid file type (must be .zip): $path" -ForegroundColor Red
        exit 1
    }
}

$envName = "import-env"

try {
    Write-Host "Authenticating to: $TargetEnvironmentUrl" -ForegroundColor Cyan
    
    # Authenticate to target environment
    pac auth create `
        --name $envName `
        --url $TargetEnvironmentUrl `
        --cloud Public `
        --username $env:POWERPLATFORM_CLI_USER_EMAIL `
        --password $env:POWERPLATFORM_CLI_USER_PASSWORD

    if ($LASTEXITCODE -ne 0) {
        throw "Authentication failed. Ensure POWERPLATFORM_CLI_USER_EMAIL and POWERPLATFORM_CLI_USER_PASSWORD are set."
    }

    Write-Host "✓ Authentication successful" -ForegroundColor Green

    # Import solutions
    foreach ($zipFile in $SolutionZipPath) {
        $fileName = Split-Path $zipFile -Leaf
        Write-Host "`nImporting: $fileName" -ForegroundColor Cyan
        
        $importParams = @(
            "--env", $envName
            "--path-to-file", $zipFile
        )
        
        if ($ForceOverwrite) {
            $importParams += "--force-overwrite"
        }
        
        if ($SkipDiagnostics) {
            $importParams += "--skip-diagnostics"
        }
        
        # Attempt import as upgrade first, then as new if it fails
        Write-Host "  Attempting import as upgrade..." -ForegroundColor Gray
        pac solution import @importParams --import-as-upgrade 2>$null
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Attempting import as new..." -ForegroundColor Gray
            pac solution import @importParams
        }
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ $fileName imported successfully" -ForegroundColor Green
        } else {
            throw "Failed to import: $fileName"
        }
    }

    Write-Host "`n✓ All solutions imported successfully" -ForegroundColor Green
    
    # List solutions in target environment
    Write-Host "`nSolutions in target environment:" -ForegroundColor Cyan
    pac solution list --env $envName

} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
    exit 1
} finally {
    # Cleanup
    pac auth delete --name $envName --force 2>$null
}

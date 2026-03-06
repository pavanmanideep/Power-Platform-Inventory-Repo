#Requires -Version 5.0
<#
.SYNOPSIS
    Export a Power Platform solution from source environment

.DESCRIPTION
    Exports managed solutions from source Dataverse environment with optional filtering

.PARAMETER SolutionName
    Name of the solution to export (optional - exports all if not specified)

.PARAMETER SourceEnvironmentUrl
    URL of the source environment

.PARAMETER OutputPath
    Path where exported ZIP will be stored

.PARAMETER AsManaged
    Export as managed solution (default: $true)

.EXAMPLE
    .\export-solution.ps1 -SolutionName "MyCoreSolution" -SourceEnvironmentUrl "https://ecellorsdev.crm8.dynamics.com" -OutputPath "./exports"
#>

param(
    [string]$SolutionName = "",
    [Parameter(Mandatory=$true)][string]$SourceEnvironmentUrl,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [bool]$AsManaged = $true
)

# Ensure PAC CLI is installed
Write-Host "Checking Power Platform CLI installation..." -ForegroundColor Cyan
$pac = @(Get-Command pac -ErrorAction SilentlyContinue)
if (-not $pac) {
    Write-Host "Power Platform CLI not found. Installing..." -ForegroundColor Yellow
    npm install -g @microsoft/powerplatform-cli
}

# Create output directory
if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
    Write-Host "Created output directory: $OutputPath" -ForegroundColor Green
}

# Authenticate to environment
Write-Host "Authenticating to: $SourceEnvironmentUrl" -ForegroundColor Cyan
$envName = "export-env"

try {
    # Use service principal credentials from environment variables
    pac auth create `
        --name $envName `
        --url $SourceEnvironmentUrl `
        --cloud Public `
        --username $env:POWERPLATFORM_CLI_USER_EMAIL `
        --password $env:POWERPLATFORM_CLI_USER_PASSWORD

    if ($LASTEXITCODE -ne 0) {
        throw "Authentication failed. Ensure POWERPLATFORM_CLI_USER_EMAIL and POWERPLATFORM_CLI_USER_PASSWORD are set."
    }

    Write-Host "✓ Authentication successful" -ForegroundColor Green

    # List available solutions
    Write-Host "Available solutions:" -ForegroundColor Cyan
    pac solution list --env $envName

    # Export solution(s)
    if ($SolutionName) {
        Write-Host "`nExporting solution: $SolutionName" -ForegroundColor Cyan
        $outputFile = "$OutputPath\$SolutionName.zip"
        
        pac solution export `
            --env $envName `
            --solution-name $SolutionName `
            --path-to-file $outputFile `
            --managed-solution
        
        if ($LASTEXITCODE -eq 0) {
            $fileSize = (Get-Item $outputFile).Length / 1MB
            Write-Host "✓ Exported: $outputFile ($([math]::Round($fileSize, 2)) MB)" -ForegroundColor Green
        } else {
            throw "Export failed for: $SolutionName"
        }
    } else {
        Write-Host "Exporting all managed solutions..." -ForegroundColor Cyan
        
        # Get list of solutions
        $solutions = pac solution list --env $envName | ConvertFrom-Json
        
        foreach ($solution in $solutions) {
            $solutionName = $solution.name
            $outputFile = "$OutputPath\$solutionName.zip"
            
            Write-Host "  Exporting: $solutionName..." -ForegroundColor Cyan
            pac solution export `
                --env $envName `
                --solution-name $solutionName `
                --path-to-file $outputFile `
                --managed-solution
            
            if ($LASTEXITCODE -eq 0) {
                $fileSize = (Get-Item $outputFile).Length / 1MB
                Write-Host "  ✓ $solutionName ($([math]::Round($fileSize, 2)) MB)" -ForegroundColor Green
            }
        }
    }

    Write-Host "`n✓ Export completed successfully" -ForegroundColor Green

} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
    exit 1
} finally {
    # Cleanup
    pac auth delete --name $envName --force 2>$null
}

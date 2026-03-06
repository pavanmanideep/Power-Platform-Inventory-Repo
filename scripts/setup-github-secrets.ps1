#Requires -Version 5.0
<#
.SYNOPSIS
    Setup GitHub Secrets for Power Platform deployment automation

.DESCRIPTION
    Interactive script to configure all required GitHub secrets for Power Platform ALM automation

.NOTES
    Requires GitHub CLI (gh) to be installed and authenticated

.EXAMPLE
    .\setup-github-secrets.ps1
#>

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Power Platform - GitHub Secrets Setup                    ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check if GitHub CLI is installed
Write-Host "Checking GitHub CLI installation..." -ForegroundColor Yellow
$ghCheck = @(Get-Command gh -ErrorAction SilentlyContinue)
if (-not $ghCheck) {
    Write-Host "❌ GitHub CLI not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install from: https://cli.github.com/" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Windows (Winget):"
    Write-Host "  winget install GitHub.cli" -ForegroundColor Gray
    Write-Host ""
    exit 1
}
Write-Host "✓ GitHub CLI found" -ForegroundColor Green
Write-Host ""

# Verify authenticated
Write-Host "Checking GitHub authentication..." -ForegroundColor Yellow
try {
    gh auth status 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Not authenticated"
    }
    Write-Host "✓ GitHub authenticated" -ForegroundColor Green
} catch {
    Write-Host "❌ Not authenticated to GitHub" -ForegroundColor Red
    Write-Host ""
    Write-Host "Run: gh auth login" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
Write-Host ""

# Collect secrets
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Enter your Power Platform configuration details:" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# TENANT_URL
Write-Host "1. TENANT_URL" -ForegroundColor Yellow
Write-Host "   Your Dataverse environment URL (base URL for dev environment)" -ForegroundColor Gray
Write-Host "   Example: https://ecellorsdev.crm8.dynamics.com" -ForegroundColor Gray
$tenantUrl = Read-Host "   Enter TENANT_URL"
if ([string]::IsNullOrWhiteSpace($tenantUrl)) {
    Write-Host "   Using default: https://ecellorsdev.crm8.dynamics.com" -ForegroundColor Gray
    $tenantUrl = "https://ecellorsdev.crm8.dynamics.com"
}
Write-Host ""

# CLIENT_ID
Write-Host "2. CLIENT_ID" -ForegroundColor Yellow
Write-Host "   Your App Registration (Service Principal) Client ID" -ForegroundColor Gray
Write-Host "   Location: Azure AD → App registrations → [Your app] → Application (client) ID" -ForegroundColor Gray
Write-Host "   Example: a977b011-cf62-4355-b76b-7a0be75a8d2f" -ForegroundColor Gray
$clientId = Read-Host "   Enter CLIENT_ID"
if ([string]::IsNullOrWhiteSpace($clientId)) {
    Write-Host "❌ CLIENT_ID is required" -ForegroundColor Red
    exit 1
}
Write-Host ""

# CLIENT_SECRET
Write-Host "3. CLIENT_SECRET" -ForegroundColor Yellow -NoNewline
Write-Host " (⚠️  SENSITIVE - Not saved locally)" -ForegroundColor Red
Write-Host "   Your App Registration Client Secret" -ForegroundColor Gray
Write-Host "   Location: Azure AD → App registrations → [Your app] → Certificates & secrets" -ForegroundColor Gray
$clientSecret = Read-Host "   Enter CLIENT_SECRET" -AsSecureString
$clientSecretPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($clientSecret))
if ([string]::IsNullOrWhiteSpace($clientSecretPlain)) {
    Write-Host "❌ CLIENT_SECRET is required" -ForegroundColor Red
    exit 1
}
Write-Host ""

# TENANT_ID
Write-Host "4. TENANT_ID" -ForegroundColor Yellow
Write-Host "   Your Microsoft Entra ID Tenant ID" -ForegroundColor Gray
Write-Host "   Location: Azure AD → Overview → Tenant ID" -ForegroundColor Gray
Write-Host "   Example: 12345678-1234-1234-1234-123456789012" -ForegroundColor Gray
$tenantId = Read-Host "   Enter TENANT_ID"
if ([string]::IsNullOrWhiteSpace($tenantId)) {
    Write-Host "❌ TENANT_ID is required" -ForegroundColor Red
    exit 1
}
Write-Host ""

# USER_EMAIL
Write-Host "5. USER_EMAIL" -ForegroundColor Yellow
Write-Host "   Email/UPN of the Service Principal user" -ForegroundColor Gray
Write-Host "   Location: Azure AD → App registrations → [Your app] → Managed application in Azure AD" -ForegroundColor Gray
Write-Host "   Format: service-principal@yourtenant.onmicrosoft.com" -ForegroundColor Gray
$userEmail = Read-Host "   Enter USER_EMAIL"
if ([string]::IsNullOrWhiteSpace($userEmail)) {
    Write-Host "❌ USER_EMAIL is required" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Summary
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Summary of secrets to be set:" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  TENANT_URL   : $tenantUrl" -ForegroundColor Green
Write-Host "  CLIENT_ID    : $($clientId.Substring(0,8))...$(($clientId).Substring($clientId.Length-8))" -ForegroundColor Green
Write-Host "  CLIENT_SECRET: ••••••••••••••••••••" -ForegroundColor Green
Write-Host "  TENANT_ID    : $($tenantId.Substring(0,8))...$(($tenantId).Substring($tenantId.Length-8))" -ForegroundColor Green
Write-Host "  USER_EMAIL   : $userEmail" -ForegroundColor Green
Write-Host ""

$confirm = Read-Host "Proceed with setting secrets? (yes/no)"
if ($confirm -ne "yes" -and $confirm -ne "y") {
    Write-Host "Setup cancelled" -ForegroundColor Yellow
    exit 0
}
Write-Host ""

# Set secrets
Write-Host "Setting GitHub secrets..." -ForegroundColor Yellow
Write-Host ""

try {
    Write-Host "Setting TENANT_URL..." -ForegroundColor Cyan
    gh secret set TENANT_URL --body $tenantUrl
    Write-Host "✓ TENANT_URL set" -ForegroundColor Green
    
    Write-Host "Setting CLIENT_ID..." -ForegroundColor Cyan
    gh secret set CLIENT_ID --body $clientId
    Write-Host "✓ CLIENT_ID set" -ForegroundColor Green
    
    Write-Host "Setting CLIENT_SECRET..." -ForegroundColor Cyan
    gh secret set CLIENT_SECRET --body $clientSecretPlain
    Write-Host "✓ CLIENT_SECRET set" -ForegroundColor Green
    
    Write-Host "Setting TENANT_ID..." -ForegroundColor Cyan
    gh secret set TENANT_ID --body $tenantId
    Write-Host "✓ TENANT_ID set" -ForegroundColor Green
    
    Write-Host "Setting USER_EMAIL..." -ForegroundColor Cyan
    gh secret set USER_EMAIL --body $userEmail
    Write-Host "✓ USER_EMAIL set" -ForegroundColor Green

    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "✓ All secrets set successfully!" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "Verify secrets were saved:" -ForegroundColor Yellow
    gh secret list
    Write-Host ""
    Write-Host "👉 Next step: Go to GitHub Actions and run 'Deploy Power Platform Solutions'" -ForegroundColor Cyan
    Write-Host ""

} catch {
    Write-Host ""
    Write-Host "❌ Error setting secrets: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Ensure you're authenticated: gh auth login" -ForegroundColor Gray
    Write-Host "2. Check you have write access to the repository" -ForegroundColor Gray
    Write-Host "3. Verify gh CLI is up to date: gh upgrade" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

Write-Host "Setup script completed successfully! 🚀" -ForegroundColor Cyan

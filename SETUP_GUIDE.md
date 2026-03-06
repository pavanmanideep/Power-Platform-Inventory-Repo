# Power Platform Solution Deployment Automation - Setup Guide

## Overview

This automation framework enables **free, zero-cost** automated deployment of Power Platform managed solutions between environments using GitHub Actions. No additional Azure services or paid plans required.

**Environment Flow:**
```
ecellorsdev → New Features Environment → ecellorstest → ecellorsuat → ecellorsprod
```

**Deployment Methods:**
- ✅ Manual trigger from GitHub UI (Workflow Dispatch)
- ✅ Automatic on PR merge to main branch
- ✅ Local deployment via PowerShell scripts

---

## Prerequisites

### 1. Service Principal Setup (Already Done ✓)
Your app registration is configured with:
- **Client ID:** a977b011-cf62-4355-b76b-7a0be75a8d2f
- **Tenant ID:** Your Microsoft Entra tenant ID
- **Secret:** Generated in Azure AD

### 2. Required Permissions

Ensure your service principal has **minimal required permissions** in each Dataverse environment:

```
Required Roles:
- Environment Administrator
- System Administrator
- Solution Administrator (basic)
```

Assign via:
1. Power Platform Admin Center → Environments → {{ environment }}
2. Access → Users
3. Search for service principal app
4. Assign "Environment Administrator" role

### 3. GitHub Repository
- ✓ Repository: `https://github.com/pavanmanideep/Qiddiya`
- ✓ Access: You have admin/write access

---

## Configuration Steps

### Step 1: Add GitHub Secrets

Navigate to: **Settings → Secrets and variables → Actions → New repository secret**

Add the following secrets:

| Secret Name | Value | Source |
|------------|-------|--------|
| `TENANT_URL` | `https://ecellorsdev.crm8.dynamics.com` | Your Dataverse URL |
| `CLIENT_ID` | Your app application ID | Azure AD App Registration |
| `CLIENT_SECRET` | Your service principal secret | ⚠️ Keep secure! |
| `TENANT_ID` | Your Microsoft Entra tenant ID | Azure AD → Overview |
| `USER_EMAIL` | Service principal email | Azure AD → App Registration → Service Principal |

**Adding Secrets:**
```powershell
# Via GitHub CLI (fastest)
gh secret set TENANT_URL --body "https://ecellorsdev.crm8.dynamics.com"
gh secret set CLIENT_ID --body "a977b011-cf62-4355-b76b-7a0be75a8d2f"
gh secret set CLIENT_SECRET --body "YOUR_SECRET_VALUE_HERE"
gh secret set TENANT_ID --body "YOUR_TENANT_ID"
gh secret set USER_EMAIL --body "your-sp@yourtenant.onmicrosoft.com"
```

**Or Via GitHub UI:**
1. Go to: https://github.com/pavanmanideep/Qiddiya/settings/secrets/actions
2. Click "New repository secret"
3. Enter secret name and value
4. Click "Add secret"

### Step 2: Verify Environment Configuration

Check `/config/environments.json`:
```json
{
  "name": "ecellorsdev",
  "url": "https://ecellorsdev.crm8.dynamics.com",
  "region": "India"
}
```

Update URLs if needed for your environments.

### Step 3: Folder Structure

Create the following folder in repo root if not exists:
```
Qiddiya/
├── .github/
│   └── workflows/
│       └── deploy-solutions.yml
├── config/
│   └── environments.json
├── scripts/
│   ├── export-solution.ps1
│   └── import-solution.ps1
├── solutions/             ← Power Platform solutions stored here
└── README.md
```

---

## How to Deploy

### Method 1: GitHub UI (Manual Deployment) - Recommended for Testing

**Steps:**

1. Go to: **Actions** → **Deploy Power Platform Solutions**
2. Click **"Run workflow"**
3. Fill in the form:

   | Field | Value | Example |
   |-------|-------|---------|
   | Source Environment | Dropdown selection | `ecellorsdev` |
   | Target Environment | Dropdown selection | `New Features Environment` |
   | Solution Name | (Optional - leave blank for all) | `MyCoreSolution` |
   | Deployment Mode | `staged` (recommended) or `direct` | `staged` |

4. Click **"Run workflow"**
5. Monitor in **Actions** tab → Watch live logs

**Screenshot Steps:**
```
GitHub → Repository → "Actions" tab
  ↓
Select "Deploy Power Platform Solutions" workflow
  ↓
Click "Run workflow" dropdown
  ↓
Fill all fields
  ↓
Click "Run workflow" button
  ↓
View live logs in real-time
```

### Method 2: Automatic on Merge to Main

**Setup:**
1. Create a branch: `git checkout -b feature/sample-solution`
2. Add/update solution files to `solutions/` folder
3. Create Pull Request
4. After merge to `main` → **Automatic deployment to all environments** 🚀

**Workflow Flow:**
```
Push to main branch
  ↓
Trigger: push to main + changes in solutions/**
  ↓
Auto-export from ecellorsdev
  ↓
Auto-import to New Features Environment
  ↓
Auto-import to ecellorstest (with approval)
  ↓
Auto-import to ecellorsuat (with approval)
  ↓
Manual to ecellorsprod (manual approval)
```

### Method 3: Local Testing with PowerShell

**Prerequisites:**
```powershell
# Install Power Platform CLI
npm install -g @microsoft/powerplatform-cli

# Verify installation
pac --version
```

**Set Environment Variables:**
```powershell
$env:POWERPLATFORM_CLI_USER_EMAIL = "your-sp@yourtenant.onmicrosoft.com"
$env:POWERPLATFORM_CLI_USER_PASSWORD = "YOUR_CLIENT_SECRET"
```

**Export Solution:**
```powershell
.\scripts\export-solution.ps1 `
  -SolutionName "MyCoreSolution" `
  -SourceEnvironmentUrl "https://ecellorsdev.crm8.dynamics.com" `
  -OutputPath "./exports"
```

**Import Solution:**
```powershell
.\scripts\import-solution.ps1 `
  -SolutionZipPath "./exports/MyCoreSolution.zip" `
  -TargetEnvironmentUrl "https://ecellors-newfeatures.crm8.dynamics.com"
```

---

## Workflow Details

### What Happens During Deployment:

1. **Authentication** (30 seconds)
   - Uses service principal credentials
   - Connects to source and target environments

2. **Export** (depends on solution size)
   - Extracts solution from source as managed (.zip)
   - Stores in `exports/` artifact

3. **Import** (depends on solution complexity)
   - Imports to target environment
   - Handles upgrade scenarios automatically
   - Resolves component conflicts

4. **Verification** (1-2 minutes)
   - Lists solutions in target environment
   - Confirms successful import
   - Generates deployment report

### Deployment Logs

All logs available at: **Actions → [Workflow Run] → View logs**

Key log sections:
```
✓ Authenticate to Dataverse
✓ Export Solutions from Source
✓ Publish Solutions to Target Environment
✓ Verify Deployment
✓ Cleanup Authentication
```

---

## Cost Analysis - 100% FREE ✅

| Service | Free Tier | Usage | Cost |
|---------|-----------|-------|------|
| GitHub Actions | **3,000 minutes/month** | ~50 deployments × 10 min = 500 min | **$0** |
| Power Platform CLI | Open Source | Unlimited | **$0** |
| Service Principal | Azure AD Free | Unlimited | **$0** |
| Data Transfer | Within tenant | No egress charges | **$0** |
| **TOTAL** | | | **$0** 💰 |

**300+ free minutes remaining monthly** for other tasks!

---

## Troubleshooting

### Issue: Authentication Failed

**Solution:**
```powershell
# Verify secrets are set
gh secret list

# If missing, re-add with correct values
gh secret set CLIENT_SECRET --body "YOUR_ACTUAL_SECRET"
```

### Issue: Solution Not Found

**Check available solutions:**
```powershell
pac auth create --name debug-auth --url "https://ecellorsdev.crm8.dynamics.com"
pac solution list --env debug-auth
pac auth delete --name debug-auth --force
```

### Issue: Insufficient Permissions

**Steps:**
1. Power Platform Admin Center
2. Environment → Access
3. Find service principal (search by app ID)
4. Assign "Environment Administrator" role
5. Wait 2-3 minutes for sync
6. Retry deployment

### Issue: Import Conflicts

**Automatic Handling:**
- Workflow uses `--force-overwrite` flag
- Automatically imports as upgrade if exists
- Falls back to new import if needed

**Manual Resolution:**
```powershell
# Force reimport by deleting solution first
# (requires System Administrator role)
pac solution delete --env target --solution-unique-id "XXX"
```

---

## Best Practices

### ✅ DO's

- ✓ Export solutions with **versioning**: `MySolution_1.0.0.zip`
- ✓ Test deployments to DEV first before PROD
- ✓ Use **managed solutions** for more control
- ✓ Review deployment logs after each run
- ✓ Keep service principal credentials **secure in GitHub Secrets**
- ✓ Rotate secrets **quarterly**

### ❌ DON'Ts

- ✗ Never commit secrets to repository
- ✗ Don't use personal credentials
- ✗ Avoid direct production deployments without testing
- ✗ Don't leave workflow logs visible with sensitive data
- ✗ Avoid concurrent deployments to same environment

---

## Monitoring & Reporting

### GitHub Actions Dashboard

**View all deployments:**
- Repository → Actions → Deploy Power Platform Solutions
- Detailed logs: Click workflow run → Click job
- Artifacts: Exported solutions available for 30 days

### Deployment Artifacts

Exported solutions available for download:
- Navigate to Actions → [Workflow Run] → Artifacts
- Download `exported-solutions` ZIP
- Contains all solution files with timestamps

### Scheduled Reporting

Add weekly automated deployment report:

```yaml
# Add to deploy-solutions.yml
  notify:
    runs-on: ubuntu-latest
    if: always()
    steps:
      - name: Send Report
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          text: 'Power Platform Deployment: ${{ job.status }}'
          webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

---

## Advanced Configuration

### Multi-Environment Support

Add new environment to `config/environments.json`:
```json
{
  "name": "sandbox-two",
  "displayName": "Sandbox 2",
  "url": "https://sandbox-two.crm8.dynamics.com",
  "tier": 2.5
}
```

Then available in workflow dropdown automatically.

### Scheduled Deployments

Deploy solutions on schedule (e.g., nightly to TEST):

```yaml
on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily
env:
  AUTO_SOURCE: 'ecellorsdev'
  AUTO_TARGET: 'ecellorstest'
```

### PR-based Deployments

Deploy only when specific files change:

```yaml
on:
  pull_request:
    paths:
      - 'solutions/CriticalSolution/**'
```

---

## Support & Updates

**Repository:** https://github.com/pavanmanideep/Qiddiya

**Workflow File:** `.github/workflows/deploy-solutions.yml`

**Config Files:**
- `config/environments.json` - Environment URLs
- `scripts/export-solution.ps1` - Export logic
- `scripts/import-solution.ps1` - Import logic

---

## Next Steps

1. ✅ Add GitHub Secrets (as shown above)
2. ✅ Verify environment URLs in `config/environments.json`
3. ✅ Test with DEV → NewFeatures deployment
4. ✅ Monitor workflow run in Actions tab
5. ✅ Review deployment logs
6. ✅ Scale to production deployments

**Ready to deploy?** Go to **Actions tab** and click **"Run workflow"** 🚀


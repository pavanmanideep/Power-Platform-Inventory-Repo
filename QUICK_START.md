# Quick Start - Power Platform Solution Deployment

## ⚡ 5-Minute Setup

### Step 1: Add GitHub Secrets (2 min)

Use this GitHub CLI command:
```bash
gh secret set TENANT_URL --body "https://ecellorsdev.crm8.dynamics.com"
gh secret set CLIENT_ID --body "a977b011-cf62-4355-b76b-7a0be75a8d2f"
gh secret set CLIENT_SECRET --body "YOUR_SECRET_FROM_AZURE_AD"
gh secret set TENANT_ID --body "YOUR_TENANT_ID_HERE"
gh secret set USER_EMAIL --body "your-sp-email@yourtenant.onmicrosoft.com"
```

**No GitHub CLI?** Add manually:
1. Go to: https://github.com/pavanmanideep/Qiddiya/settings/secrets/actions
2. Click "New repository secret" 5 times (once for each secret above)

### Step 2: Verify Secrets (1 min)

```bash
gh secret list
```

Should show:
```
CLIENT_ID           ****
CLIENT_SECRET       ****
TENANT_ID           ****
TENANT_URL          ****
USER_EMAIL          ****
```

### Step 3: Deploy! (2 min)

1. Go to: https://github.com/pavanmanideep/Qiddiya/actions
2. Select: "Deploy Power Platform Solutions"
3. Click: "Run workflow"
4. Fill in:
   - **Source:** `ecellorsdev`
   - **Target:** `New Features Environment`
   - **Solution:** Leave blank (all)
   - **Mode:** `staged`
5. Click: "Run workflow"
6. Watch logs in real-time ✓

---

## 🎯 Common Deployments

### Deploy All Solutions (Dev → Features)
```
Source: ecellorsdev
Target: New Features Environment
Solution: [blank - all solutions]
Mode: staged
```

### Deploy One Solution (Dev → Test)
```
Source: ecellorsdev
Target: ecellorstest
Solution: MyCoreSolution
Mode: staged
```

### Deploy to Production
```
Source: ecellorsuat
Target: ecellorsprod
Solution: [blank - all]
Mode: staged
```

---

## 📋 Required Information

**You need these to complete setup:**

- ✅ **Client ID:** `a977b011-cf62-4355-b76b-7a0be75a8d2f` (you have this)
- ❓ **Client Secret:** (from Azure AD App Registration)
- ❓ **Tenant ID:** (from Azure AD)
- ❓ **Service Principal Email:** (from Azure AD)

**Where to find them:**

### Get Client Secret:
1. Azure Portal → Azure AD → App registrations
2. Search: `a977b011-cf62-4355-b76b-7a0be75a8d2f`
3. Certificates & secrets
4. "New client secret"
5. Copy value (create one if none exists)

### Get Tenant ID:
1. Azure Portal → Azure AD → Overview
2. Copy "Tenant ID" value

### Get Service Principal Email:
1. Azure Portal → Azure AD → App registrations
2. Search: `a977b011-cf62-4355-b76b-7a0be75a8d2f`
3. Look for application display name
4. Format: `{AppName}@{TenantName}.onmicrosoft.com`

---

## ✔️ Verification Checklist

Before deploying to production:

- [ ] All 5 GitHub secrets added
- [ ] Service principal has "Environment Administrator" role in all target environments
- [ ] Tested deployment to DEV → New Features Environment
- [ ] Reviewed workflow logs (no errors)
- [ ] Solutions imported successfully in target environment
- [ ] Team notified of deployment automation

---

## 💬 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| "Authentication failed" | Check CLIENT_SECRET is correct and not expired |
| "Solution not found" | Verify source environment has solution; check name spelling |
| "Insufficient permissions" | Assign "Environment Administrator" to service principal in target environment |
| "Import failed" | Check solution compatibility; try with older version first |

---

## 📚 Full Documentation

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for detailed instructions.

---

**Ready? Go to Actions → Deploy Power Platform Solutions → Run workflow** 🚀

#!/usr/bin/env bash
# Deployment Checklist - Run this before first deployment

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Power Platform Deployment - Pre-Launch Checklist         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_mark="✓"
cross_mark="✗"

# Function to check if secret exists
check_secret() {
    local secret=$1
    if gh secret list | grep -q "^${secret}"; then
        echo -e "${GREEN}${check_mark}${NC} Secret '${secret}' exists"
        return 0
    else
        echo -e "${RED}${cross_mark}${NC} Secret '${secret}' NOT found"
        return 1
    fi
}

# Function to check if file exists
check_file() {
    local file=$1
    if [ -f "$file" ]; then
        echo -e "${GREEN}${check_mark}${NC} File exists: ${file}"
        return 0
    else
        echo -e "${RED}${cross_mark}${NC} File NOT found: ${file}"
        return 1
    fi
}

# Function to check if directory exists
check_dir() {
    local dir=$1
    if [ -d "$dir" ]; then
        echo -e "${GREEN}${check_mark}${NC} Directory exists: ${dir}"
        return 0
    else
        echo -e "${RED}${cross_mark}${NC} Directory NOT found: ${dir}"
        return 1
    fi
}

# Check GitHub CLI
echo "═══════════════════════════════════════════════════════════"
echo "1. Environment Checks"
echo "═══════════════════════════════════════════════════════════"
if command -v gh &> /dev/null; then
    echo -e "${GREEN}${check_mark}${NC} GitHub CLI installed ($(gh --version | cut -d' ' -f3))"
else
    echo -e "${RED}${cross_mark}${NC} GitHub CLI not installed"
    echo "   Install: https://cli.github.com/"
    exit 1
fi

if gh auth status &> /dev/null; then
    echo -e "${GREEN}${check_mark}${NC} GitHub authenticated"
else
    echo -e "${RED}${cross_mark}${NC} Not authenticated to GitHub"
    echo "   Run: gh auth login"
    exit 1
fi
echo ""

# Check required secrets
echo "═══════════════════════════════════════════════════════════"
echo "2. GitHub Secrets"
echo "═══════════════════════════════════════════════════════════"
SECRETS_MISSING=0
for secret in TENANT_URL CLIENT_ID CLIENT_SECRET TENANT_ID USER_EMAIL; do
    check_secret "$secret" || SECRETS_MISSING=1
done
echo ""

if [ $SECRETS_MISSING -eq 1 ]; then
    echo -e "${YELLOW}Add missing secrets:${NC}"
    echo "  ./scripts/setup-github-secrets.ps1"
    echo "  OR"
    echo "  gh secret set SECRET_NAME --body 'value'"
    echo ""
fi

# Check required files
echo "═══════════════════════════════════════════════════════════"
echo "3. Project Files"
echo "═══════════════════════════════════════════════════════════"
check_file ".github/workflows/deploy-solutions.yml"
check_file ".github/workflows/test-connectivity.yml"
check_file "config/environments.json"
check_file "scripts/export-solution.ps1"
check_file "scripts/import-solution.ps1"
check_file "SETUP_GUIDE.md"
echo ""

# Check directories
echo "═══════════════════════════════════════════════════════════"
echo "4. Project Structure"
echo "═══════════════════════════════════════════════════════════"
check_dir ".github"
check_dir ".github/workflows"
check_dir "scripts"
check_dir "config"
echo ""

# Summary
echo "═══════════════════════════════════════════════════════════"
echo "Setup Status"
echo "═══════════════════════════════════════════════════════════"

if [ $SECRETS_MISSING -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Ready to deploy. Next steps:"
    echo "1. Assign service principal permissions in each environment"
    echo "2. Go to GitHub Actions → Deploy Power Platform Solutions"
    echo "3. Click 'Run workflow'"
    echo "4. Select source and target environments"
    echo "5. Monitor deployment logs"
    echo ""
else
    echo -e "${YELLOW}⚠ Some checks failed${NC}"
    echo "Please complete setup before deploying"
    echo ""
fi

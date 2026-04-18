#!/usr/bin/env node
/**
 * generate-report.mjs
 * Reads collected Power Platform data from --data-dir and writes a
 * self-contained HTML inventory report to --output.
 *
 * Usage:
 *   node scripts/generate-report.mjs \
 *     --data-dir /tmp/pp-data \
 *     --output   reports/20260418/1934/inventory-report.html \
 *     --date     20260418 \
 *     --time     1934
 */

import fs   from 'node:fs';
import path from 'node:path';

// ── CLI argument parsing ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

const dataDir    = arg('--data-dir') ?? '/tmp/pp-data';
const outputFile = arg('--output')   ?? 'inventory-report.html';
const reportDate = arg('--date')     ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');
const reportTime = arg('--time')     ?? new Date().toISOString().slice(11, 16).replace(':', '');

// ── Safe JSON loader ─────────────────────────────────────────────────────────
function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.json'))
    .map(f => loadJson(path.join(dirPath, f), {}))
    .filter(Boolean);
}

// ── Load data ────────────────────────────────────────────────────────────────
const tenantSettings = loadJson(path.join(dataDir, 'tenant-settings.json'), {});
const dlpPolicies    = loadJson(path.join(dataDir, 'dlp-policies.json'), []);
const dlpDetails     = loadDir(path.join(dataDir, 'dlp-details'));
const inventoryRaw   = loadJson(path.join(dataDir, 'inventory.json'), { value: [] });
const environmentsRaw = loadJson(path.join(dataDir, 'environments.json'), []);
const envSettingsAll = loadDir(path.join(dataDir, 'env-settings'));

const inventoryItems  = inventoryRaw.value ?? inventoryRaw.data ?? [];
const environments    = Array.isArray(environmentsRaw) ? environmentsRaw : (environmentsRaw.value ?? []);

// ── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return String(d); }
}

// ── Categorise inventory resources ──────────────────────────────────────────
const TYPE_LABELS = {
  'microsoft.powerapps/canvasapps':      'Canvas Apps',
  'microsoft.flow/flows':                'Cloud Flows',
  'microsoft.copilotstudio/agents':      'Agents',
  'microsoft.powerplatform/environments':'Environments',
  'microsoft.powerapps/modeldrivenapps': 'Model-driven Apps',
};

const counts = {};
const byEnv  = {};

for (const item of inventoryItems) {
  const type    = (item.type ?? '').toLowerCase();
  const envName = item.properties?.environmentDisplayName
               ?? item.properties?.environment?.displayName
               ?? item.location
               ?? 'Unknown';

  counts[type] = (counts[type] ?? 0) + 1;

  if (!byEnv[envName]) byEnv[envName] = {};
  byEnv[envName][type] = (byEnv[envName][type] ?? 0) + 1;
}

const totalResources  = inventoryItems.length;
const totalEnvs       = environments.length || Object.keys(byEnv).length;
const totalApps       = (counts['microsoft.powerapps/canvasapps'] ?? 0)
                      + (counts['microsoft.powerapps/modeldrivenapps'] ?? 0);
const totalFlows      = counts['microsoft.flow/flows'] ?? 0;
const totalAgents     = counts['microsoft.copilotstudio/agents'] ?? 0;
const managedCount    = environments.filter(e =>
  e.isManaged === true || e.governanceConfiguration?.protectionLevel === 'Standard'
).length;

// ── Environment type helper ──────────────────────────────────────────────────
function envTypeBadge(env) {
  const t = (env.environmentSku ?? env.type ?? '').toLowerCase();
  if (t.includes('production'))  return '<span class="env-type env-type-production">Production</span>';
  if (t.includes('sandbox'))     return '<span class="env-type env-type-sandbox">Sandbox</span>';
  if (t.includes('developer'))   return '<span class="env-type env-type-developer">Developer</span>';
  if (t.includes('default'))     return '<span class="env-type env-type-default">Default</span>';
  if (t.includes('trial'))       return '<span class="env-type env-type-trial">Trial</span>';
  return `<span class="env-type">${esc(t || 'Unknown')}</span>`;
}

// ── Build Environments table ─────────────────────────────────────────────────
function buildEnvRows() {
  if (environments.length === 0) {
    return '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No environment data collected</td></tr>';
  }
  return environments.map(env => {
    const name    = esc(env.displayName ?? env.name ?? 'Unknown');
    const region  = esc(env.location ?? env.azureRegion ?? '—');
    const managed = env.isManaged === true || env.governanceConfiguration?.protectionLevel === 'Standard'
      ? '<span class="badge badge-success">✓ Managed</span>'
      : '<span class="badge badge-warning">Not Managed</span>';
    const envName = env.displayName ?? env.name ?? 'Unknown';
    const resources = (byEnv[envName] ?? {});
    const total = Object.values(resources).reduce((a, b) => a + b, 0);
    const breakdown = total > 0
      ? Object.entries(resources).map(([t, c]) => `${TYPE_LABELS[t] ?? t}: ${c}`).join(', ')
      : '<span class="text-muted">No resources</span>';
    return `<tr>
        <td class="env-name">${name}</td>
        <td>${envTypeBadge(env)}</td>
        <td>${managed}</td>
        <td>${region}</td>
        <td class="num">${total}</td>
        <td class="breakdown">${breakdown}</td>
    </tr>`;
  }).join('');
}

// ── Build Resources table ────────────────────────────────────────────────────
function buildResourceRows() {
  const sorted = Object.entries(byEnv).sort((a, b) => {
    const ta = Object.values(a[1]).reduce((x,y) => x+y, 0);
    const tb = Object.values(b[1]).reduce((x,y) => x+y, 0);
    return tb - ta;
  });
  if (sorted.length === 0) {
    return '<tr><td colspan="9" style="text-align:center;color:var(--text-muted)">No inventory data collected</td></tr>';
  }
  return sorted.map(([name, res]) => {
    const agents  = res['microsoft.copilotstudio/agents'] ?? 0;
    const mda     = res['microsoft.powerapps/modeldrivenapps'] ?? 0;
    const flows   = res['microsoft.flow/flows'] ?? 0;
    const apps    = res['microsoft.powerapps/canvasapps'] ?? 0;
    const total   = agents + mda + flows + apps;
    const num = n => n > 0 ? `<td class="num">${n}</td>` : '<td class="num">—</td>';
    return `<tr>
        <td class="env-name">${esc(name)}</td>
        ${num(agents)}${num(mda)}${num(flows)}
        <td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>
        <td class="num" style="font-weight:700;">${total}</td>
    </tr>`;
  }).join('');
}

// ── Governance findings ──────────────────────────────────────────────────────
function boolVal(obj, ...keys) {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

const ts = tenantSettings;
const govFindings = [];

if (boolVal(ts, 'disableEnvironmentCreationByNonAdminUsers') === false) {
  govFindings.push({ sev: 'critical', title: 'Critical: Environment creation open to all users',
    body: '<strong>Current value:</strong> <code>disableEnvironmentCreationByNonAdminUsers = false</code><br>Any licensed user can create production and sandbox environments, leading to environment sprawl and ungoverned shadow IT.',
    fix: 'pac admin update-tenant-settings --setting-name "disableEnvironmentCreationByNonAdminUsers" --setting-value "true"' });
}
if (boolVal(ts, 'disableTrialEnvironmentCreationByNonAdminUsers') === false) {
  govFindings.push({ sev: 'critical', title: 'Critical: Trial environment creation open to all users',
    body: '<strong>Current value:</strong> <code>disableTrialEnvironmentCreationByNonAdminUsers = false</code><br>Trials auto-expire after 30 days. Users may build real workloads in trials, losing data when they expire.',
    fix: 'pac admin update-tenant-settings --setting-name "disableTrialEnvironmentCreationByNonAdminUsers" --setting-value "true"' });
}
if (boolVal(ts, 'powerPlatform', 'disableDeveloperEnvironmentCreationByNonAdminUsers') === false ||
    boolVal(ts, 'disableDeveloperEnvironmentCreationByNonAdminUsers') === false) {
  govFindings.push({ sev: 'warning', title: 'High: Developer environment creation open to all users',
    body: '<strong>Current value:</strong> <code>disableDeveloperEnvironmentCreationByNonAdminUsers = false</code><br>Developer environments are personal but still consume capacity. Unrestricted creation leads to environment sprawl.',
    fix: 'pac admin update-tenant-settings --setting-name "powerPlatform.governance.disableDeveloperEnvironmentCreationByNonAdminUsers" --setting-value "true"' });
}

function buildGovFindings() {
  if (govFindings.length === 0 && Object.keys(ts).length === 0) {
    return '<div class="finding finding-info"><h3>ℹ️ No tenant settings data collected</h3><p>The tenant settings file was empty or could not be retrieved. Ensure the service principal has Power Platform admin permissions.</p></div>';
  }
  if (govFindings.length === 0) {
    return '<div class="finding finding-success"><h3>✅ No critical governance issues detected</h3><p>Tenant settings appear to be configured appropriately based on the collected data.</p></div>';
  }
  return govFindings.map(f =>
    `<div class="finding finding-${f.sev}">
      <h3>${f.sev === 'critical' ? '🔴' : '🟡'} ${esc(f.title)}</h3>
      <p>${f.body}</p>
      <div class="fix">${esc(f.fix)}</div>
    </div>`
  ).join('\n');
}

// ── Build tenant settings table ──────────────────────────────────────────────
const SETTING_MAP = [
  ['disableEnvironmentCreationByNonAdminUsers',       'Environment creation by non-admins', false, 'critical'],
  ['disableTrialEnvironmentCreationByNonAdminUsers',  'Trial creation by non-admins',        false, 'critical'],
  ['disableDeveloperEnvironmentCreationByNonAdminUsers','Developer env creation by non-admins', false, 'warning'],
  ['disableShareWithEveryoneByDefault',               'Share with Everyone disabled',         true,  'success'],
  ['disableGuestMakerSetting',                        'Guest makers disabled',                true,  'success'],
];

function buildSettingsTable() {
  if (Object.keys(ts).length === 0) {
    return '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No tenant settings data available</td></tr>';
  }
  return SETTING_MAP.map(([key, label, goodVal, goodClass]) => {
    const val = boolVal(ts, key);
    if (val === undefined) return '';
    const display = val === true ? 'Enabled / True' : val === false ? 'Disabled / False' : esc(String(val));
    const ok = val === goodVal;
    const badge = ok
      ? `<span class="badge badge-${goodClass}">✅ Good</span>`
      : `<span class="badge badge-${goodClass === 'success' ? 'critical' : goodClass}">⚠️ Review</span>`;
    return `<tr><td>${esc(label)}</td><td>${display}</td><td>${badge}</td></tr>`;
  }).filter(Boolean).join('');
}

// ── DLP analysis ─────────────────────────────────────────────────────────────
const policies = Array.isArray(dlpPolicies) ? dlpPolicies : (dlpPolicies.value ?? []);

function buildDlpTable() {
  if (policies.length === 0) {
    return '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No DLP policy data collected</td></tr>';
  }
  return policies.map(p => {
    const name       = esc(p.displayName ?? p.policyName ?? p.name ?? 'Unknown');
    const scope      = p.environments?.length > 0
      ? `<span class="badge badge-info">${p.environments.length} Environments</span>`
      : '<span class="badge badge-info">All Environments</span>';
    const detail     = dlpDetails.find(d => d.policyName === (p.policyName ?? p.name) || d.name === (p.policyName ?? p.name)) ?? {};
    const connectors = detail.connectorGroups ?? detail.connectorSettings ?? {};
    const conf       = (connectors.confidential ?? connectors.Confidential ?? []).length;
    const gen        = (connectors.general ?? connectors.General ?? []).length;
    const blocked    = (connectors.blocked ?? connectors.Blocked ?? []).length;
    return `<tr>
      <td class="env-name">${name}</td>
      <td>${scope}</td>
      <td class="num">${conf || '—'}</td>
      <td class="num">${gen || '—'}</td>
      <td class="num">${blocked || '—'}</td>
      <td>${fmtDate(p.createdTime ?? p.created)}</td>
    </tr>`;
  }).join('');
}

function buildDlpFindings() {
  if (policies.length === 0) {
    return '<div class="finding finding-info"><h3>ℹ️ No DLP policy data collected</h3><p>No DLP policies were found or the query failed. Ensure at least one DLP policy is configured for your tenant.</p></div>';
  }
  const findings = [];
  for (const p of policies) {
    const detail  = dlpDetails.find(d => d.policyName === (p.policyName ?? p.name)) ?? {};
    const groups  = detail.connectorGroups ?? detail.connectorSettings ?? {};
    const blocked = (groups.blocked ?? groups.Blocked ?? []).length;
    const conf    = (groups.confidential ?? groups.Confidential ?? []).length;
    if (blocked === 0) {
      findings.push(`<div class="finding finding-critical">
        <h3>🔴 Critical: No connectors blocked in policy "${esc(p.displayName ?? p.policyName ?? p.name)}"</h3>
        <p>The HTTP connector, custom connectors, and other high-risk connectors are not blocked. Any connector can call any external endpoint.</p>
        <div class="fix">Add HTTP, custom connectors, and other high-risk connectors to the Blocked group in your DLP policy.</div>
      </div>`);
    }
    if (conf === 0) {
      findings.push(`<div class="finding finding-critical">
        <h3>🔴 Critical: No connectors in Confidential group for policy "${esc(p.displayName ?? p.policyName ?? p.name)}"</h3>
        <p>All connectors are in General (non-business) tier — any connector can communicate with any other connector. There is effectively zero data loss prevention.</p>
        <div class="fix">Reclassify sensitive connectors (Dataverse, SharePoint, SQL Server, Office 365) into the Confidential group to prevent data exfiltration.</div>
      </div>`);
    }
  }
  return findings.length > 0 ? findings.join('\n')
    : '<div class="finding finding-success"><h3>✅ DLP policies appear well-configured</h3><p>Policies have connectors in Confidential and Blocked groups.</p></div>';
}

// ── Environment settings analysis ────────────────────────────────────────────
function buildEnvSettingsFindings() {
  if (envSettingsAll.length === 0) {
    return '<div class="finding finding-info"><h3>ℹ️ No environment settings collected</h3><p>Environment settings files were not found. Ensure the service principal has environment-level admin access.</p></div>';
  }
  const findings = [];
  const auditDisabled = envSettingsAll.filter(e => {
    const v = (e.isauditenabled ?? e.IsAuditEnabled ?? e.auditEnabled ?? '').toString().toLowerCase();
    return v === 'false' || v === 'no' || v === '0';
  });
  if (auditDisabled.length > 0) {
    findings.push(`<div class="finding finding-critical">
      <h3>🔴 Critical: Auditing disabled in ${auditDisabled.length} environment(s)</h3>
      <p>Auditing is disabled in ${auditDisabled.length} sampled environment(s). Without auditing there is no record of who accessed, modified, or deleted data — required for SOC 2, ISO 27001, GDPR, and HIPAA compliance.</p>
      <div class="fix">pac env update-settings --name isauditenabled --value true --environment "&lt;environment-id&gt;"</div>
    </div>`);
  }
  const sessionDisabled = envSettingsAll.filter(e => {
    const v = (e.sessiontimeoutenabled ?? e.SessionTimeoutEnabled ?? '').toString().toLowerCase();
    return v === 'false' || v === 'no' || v === '0';
  });
  if (sessionDisabled.length > 0) {
    findings.push(`<div class="finding finding-warning">
      <h3>🟡 Warning: Session timeout disabled in ${sessionDisabled.length} environment(s)</h3>
      <p>Session timeout is disabled. Users who walk away from a shared device remain authenticated indefinitely — a session hijacking risk on shared workspaces or public computers.</p>
      <div class="fix">pac env update-settings --name sessiontimeoutenabled --value true --environment "&lt;environment-id&gt;"</div>
    </div>`);
  }
  return findings.length > 0 ? findings.join('\n')
    : '<div class="finding finding-success"><h3>✅ No critical environment setting issues detected</h3></div>';
}

// ── Recommendations ──────────────────────────────────────────────────────────
function buildRecommendations() {
  const recs = [
    ...govFindings.map((f, i) => ({
      n: i + 1, priority: f.sev === 'critical' ? 'Critical' : 'High',
      action: f.title.replace(/^(Critical|High): /, ''),
      why: f.body.replace(/<[^>]+>/g, ''),
      how: `<code>${esc(f.fix)}</code>`
    })),
  ];
  if (recs.length === 0) {
    return '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No recommendations generated — data may be incomplete.</td></tr>';
  }
  return recs.map((r, i) => {
    const badge = r.priority === 'Critical'
      ? '<span class="badge badge-critical">Critical</span>'
      : '<span class="badge badge-warning">High</span>';
    return `<tr><td>${i + 1}</td><td>${badge}</td><td>${esc(r.action)}</td><td>${esc(r.why)}</td><td>${r.how}</td></tr>`;
  }).join('');
}

// ── Stat cards ───────────────────────────────────────────────────────────────
function statCard(icon, value, label) {
  return `<div class="stat-card"><div class="stat-icon">${icon}</div><div class="stat-value">${value}</div><div class="stat-label">${esc(label)}</div></div>`;
}

// ── Date/time formatting helpers ─────────────────────────────────────────────
function fmtReportDate(d) {
  return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
}
function fmtReportTime(t) {
  return `${t.slice(0,2)}:${t.slice(2,4)}`;
}
const displayDate = fmtReportDate(reportDate);
const displayTime = fmtReportTime(reportTime);

// ── Assemble HTML ────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Power Platform Inventory Report — ${displayDate}</title>
<script>
  (function() {
    var saved = localStorage.getItem('pp-report-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  })();
</script>
<style>

:root {
  --bg-primary: #0a0e17;
  --bg-secondary: #111827;
  --bg-card: #1a2233;
  --bg-card-hover: #1f2a3d;
  --bg-input: #0d1321;
  --border-color: #1e2d44;
  --border-accent: #2563eb;
  --text-primary: #e8ecf4;
  --text-secondary: #8b97b0;
  --text-muted: #5b6782;
  --accent: #3b82f6;
  --accent-glow: rgba(59, 130, 246, 0.15);
  --success: #22c55e;
  --success-bg: rgba(34, 197, 94, 0.1);
  --warning: #f59e0b;
  --warning-bg: rgba(245, 158, 11, 0.1);
  --critical: #ef4444;
  --critical-bg: rgba(239, 68, 68, 0.1);
  --info: #06b6d4;
  --info-bg: rgba(6, 182, 212, 0.1);
  --hero-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%);
  --card-shadow: 0 4px 24px rgba(0,0,0,0.3);
  --table-stripe: rgba(255,255,255,0.02);
  --toggle-bg: #1e2d44;
  --toggle-fg: #e8ecf4;
  --bar-bg: #1e2d44;
  --bar-fill: #3b82f6;
  --pill-bg: rgba(59,130,246,0.15);
  --pill-text: #60a5fa;
}

[data-theme="light"] {
  --bg-primary: #f8fafc;
  --bg-secondary: #ffffff;
  --bg-card: #ffffff;
  --bg-card-hover: #f1f5f9;
  --bg-input: #f1f5f9;
  --border-color: #e2e8f0;
  --border-accent: #2563eb;
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  --accent: #2563eb;
  --accent-glow: rgba(37, 99, 235, 0.08);
  --success: #16a34a;
  --success-bg: rgba(22, 163, 74, 0.08);
  --warning: #d97706;
  --warning-bg: rgba(217, 119, 6, 0.08);
  --critical: #dc2626;
  --critical-bg: rgba(220, 38, 38, 0.06);
  --info: #0891b2;
  --info-bg: rgba(8, 145, 178, 0.06);
  --hero-gradient: linear-gradient(135deg, #eff6ff 0%, #e0e7ff 50%, #f0f9ff 100%);
  --card-shadow: 0 1px 12px rgba(0,0,0,0.06);
  --table-stripe: rgba(0,0,0,0.02);
  --toggle-bg: #e2e8f0;
  --toggle-fg: #0f172a;
  --bar-bg: #e2e8f0;
  --bar-fill: #2563eb;
  --pill-bg: rgba(37,99,235,0.08);
  --pill-text: #2563eb;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
}

.theme-toggle {
  position: fixed; top: 20px; right: 20px; z-index: 1000;
  width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--border-color);
  background: var(--toggle-bg); color: var(--toggle-fg); font-size: 20px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}

.hero {
  background: var(--hero-gradient);
  padding: 60px 40px 40px;
  border-bottom: 1px solid var(--border-color);
}
.hero h1 { font-size: 2rem; font-weight: 700; margin-bottom: 8px; }
.hero .meta { color: var(--text-secondary); font-size: 0.9rem; }

.stats-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px; padding: 32px 40px;
}
.stat-card {
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: 12px; padding: 20px; text-align: center;
  box-shadow: var(--card-shadow);
}
.stat-icon { font-size: 1.5rem; margin-bottom: 8px; }
.stat-value { font-size: 2rem; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px; }

.nav {
  display: flex; gap: 4px; padding: 0 40px;
  border-bottom: 1px solid var(--border-color); overflow-x: auto;
}
.nav-tab {
  padding: 14px 20px; border: none; background: none; cursor: pointer;
  color: var(--text-secondary); font-size: 0.9rem; font-family: inherit;
  border-bottom: 2px solid transparent; white-space: nowrap; transition: all 0.2s;
}
.nav-tab:hover { color: var(--text-primary); }
.nav-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

.tab-content { display: none; }
.tab-content.active { display: block; }

.section { padding: 32px 40px; }
.section-header {
  display: flex; align-items: center; gap: 12px; margin-bottom: 24px;
}
.section-header h2 { font-size: 1.25rem; font-weight: 600; }
.icon { font-size: 1.25rem; }

.card {
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: 12px; padding: 24px; box-shadow: var(--card-shadow);
}

table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
th { text-align: left; padding: 10px 12px; color: var(--text-secondary); font-weight: 500;
     border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); }
td { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
tr:last-child td { border-bottom: none; }
tr:nth-child(even) td { background: var(--table-stripe); }
.num { text-align: right; font-variant-numeric: tabular-nums; font-family: 'Courier New', 'Consolas', monospace; }
.breakdown { color: var(--text-secondary); font-size: 0.82rem; }
.env-name { font-weight: 500; }

.badge {
  display: inline-flex; align-items: center; padding: 2px 10px;
  border-radius: 20px; font-size: 0.78rem; font-weight: 500; white-space: nowrap;
}
.badge-success  { background: var(--success-bg);  color: var(--success); }
.badge-warning  { background: var(--warning-bg);  color: var(--warning); }
.badge-critical { background: var(--critical-bg); color: var(--critical); }
.badge-info     { background: var(--info-bg);     color: var(--info); }

.env-type {
  display: inline-flex; padding: 2px 10px; border-radius: 20px;
  font-size: 0.78rem; font-weight: 500;
}
.env-type-production { background: rgba(34,197,94,0.1);  color: #22c55e; }
.env-type-sandbox    { background: rgba(245,158,11,0.1); color: #f59e0b; }
.env-type-developer  { background: rgba(59,130,246,0.1); color: #3b82f6; }
.env-type-default    { background: rgba(6,182,212,0.1);  color: #06b6d4; }
.env-type-trial      { background: rgba(239,68,68,0.1);  color: #ef4444; }

.finding {
  border-radius: 10px; padding: 20px; margin-bottom: 16px;
  border-left: 4px solid;
}
.finding h3 { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
.finding p  { color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 10px; }
.finding-critical { background: var(--critical-bg); border-color: var(--critical); }
.finding-warning  { background: var(--warning-bg);  border-color: var(--warning); }
.finding-info     { background: var(--info-bg);      border-color: var(--info); }
.finding-success  { background: var(--success-bg);   border-color: var(--success); }
.fix {
  font-family: 'Courier New', 'Consolas', 'Lucida Console', monospace; font-size: 0.8rem;
  background: var(--bg-input); padding: 10px 14px; border-radius: 6px;
  color: var(--text-primary); overflow-x: auto;
}
code { font-family: 'Courier New', 'Consolas', 'Lucida Console', monospace; font-size: 0.85em;
       background: var(--bg-input); padding: 2px 6px; border-radius: 4px; }

.rec-table th:nth-child(4), .rec-table th:nth-child(5) { min-width: 200px; }

.footer {
  text-align: center; padding: 32px; color: var(--text-muted);
  font-size: 0.82rem; border-top: 1px solid var(--border-color);
}

@media (max-width: 768px) {
  .hero, .stats-grid, .section, .nav { padding-left: 16px; padding-right: 16px; }
  .hero h1 { font-size: 1.4rem; }
}
</style>
</head>
<body>

<button class="theme-toggle" id="themeToggle" aria-label="Toggle theme">🌙</button>

<div class="hero">
  <h1>⚡ Power Platform Inventory Report</h1>
  <p class="meta">Generated: ${displayDate} ${displayTime} UTC &nbsp;·&nbsp; ${totalEnvs} environments &nbsp;·&nbsp; ${totalResources} resources</p>
</div>

<div class="stats-grid">
  ${statCard('🌍', totalEnvs, 'Environments')}
  ${statCard('📱', totalApps, 'Apps')}
  ${statCard('⚡', totalFlows, 'Cloud Flows')}
  ${statCard('🤖', totalAgents, 'Agents')}
  ${statCard('🛡️', policies.length, 'DLP Policies')}
  ${statCard('✅', managedCount, 'Managed Envs')}
</div>

<nav class="nav">
  <button class="nav-tab active" onclick="showTab('overview', event)">Overview</button>
  <button class="nav-tab" onclick="showTab('environments', event)">Environments</button>
  <button class="nav-tab" onclick="showTab('resources', event)">Resources</button>
  <button class="nav-tab" onclick="showTab('governance', event)">Tenant Governance</button>
  <button class="nav-tab" onclick="showTab('dlp', event)">DLP Policies</button>
  <button class="nav-tab" onclick="showTab('env-settings', event)">Environment Settings</button>
  <button class="nav-tab" onclick="showTab('recommendations', event)">Recommendations</button>
</nav>

<div id="tab-overview" class="tab-content active">
  <div class="section">
    <div class="section-header"><span class="icon">📊</span><h2>Inventory Summary</h2></div>
    <div class="card" style="overflow-x:auto;">
      <table>
        <thead><tr><th>Resource Type</th><th style="text-align:right;">Count</th></tr></thead>
        <tbody>
          ${Object.entries(TYPE_LABELS).map(([t, label]) =>
            `<tr><td>${esc(label)}</td><td class="num">${counts[t] ?? 0}</td></tr>`
          ).join('')}
          <tr style="font-weight:700;"><td>Total</td><td class="num">${totalResources}</td></tr>
        </tbody>
      </table>
    </div>
    <div style="margin-top:24px;">
      ${buildGovFindings()}
    </div>
  </div>
</div>

<div id="tab-environments" class="tab-content">
  <div class="section">
    <div class="section-header"><span class="icon">🌍</span><h2>Environments (${totalEnvs} total)</h2></div>
    <div class="card" style="overflow-x:auto;">
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Managed</th><th>Region</th><th>Resources</th><th>Breakdown</th></tr></thead>
        <tbody>${buildEnvRows()}</tbody>
      </table>
    </div>
  </div>
</div>

<div id="tab-resources" class="tab-content">
  <div class="section">
    <div class="section-header"><span class="icon">📦</span><h2>All Resources (${totalResources} total)</h2></div>
    <div class="card" style="overflow-x:auto;">
      <table>
        <thead><tr><th>Environment</th><th>Agents</th><th>Model-driven</th><th>Cloud Flows</th><th>Agent Flows</th><th>Code Apps</th><th>Builder Apps</th><th>M365 Flows</th><th>Total</th></tr></thead>
        <tbody>${buildResourceRows()}</tbody>
      </table>
    </div>
  </div>
</div>

<div id="tab-governance" class="tab-content">
  <div class="section">
    <div class="section-header"><span class="icon">🏛️</span><h2>Tenant Governance Settings</h2></div>
    ${buildGovFindings()}
    <div class="section-header" style="margin-top:32px;"><span class="icon">📋</span><h2>Key Tenant Settings Overview</h2></div>
    <div class="card" style="overflow-x:auto;">
      <table>
        <thead><tr><th>Setting</th><th>Current Value</th><th>Status</th></tr></thead>
        <tbody>${buildSettingsTable()}</tbody>
      </table>
    </div>
  </div>
</div>

<div id="tab-dlp" class="tab-content">
  <div class="section">
    <div class="section-header"><span class="icon">🛡️</span><h2>DLP Policy Overview</h2></div>
    <div class="card" style="margin-bottom:20px;overflow-x:auto;">
      <table>
        <thead><tr><th>Policy</th><th>Scope</th><th>Confidential</th><th>General</th><th>Blocked</th><th>Created</th></tr></thead>
        <tbody>${buildDlpTable()}</tbody>
      </table>
    </div>
    ${buildDlpFindings()}
  </div>
</div>

<div id="tab-env-settings" class="tab-content">
  <div class="section">
    <div class="section-header"><span class="icon">⚙️</span><h2>Environment Settings Analysis</h2></div>
    ${buildEnvSettingsFindings()}
  </div>
</div>

<div id="tab-recommendations" class="tab-content">
  <div class="section">
    <div class="section-header"><span class="icon">🎯</span><h2>Prioritized Recommendations</h2></div>
    <div class="card" style="overflow-x:auto;">
      <table class="rec-table">
        <thead><tr><th>#</th><th>Priority</th><th>Action</th><th>Why</th><th>How</th></tr></thead>
        <tbody>${buildRecommendations()}</tbody>
      </table>
    </div>
  </div>
</div>

<div class="footer">
  Power Platform Inventory Report &nbsp;·&nbsp; ${displayDate} ${displayTime} UTC
</div>

<script>
const toggle = document.getElementById('themeToggle');
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  toggle.textContent = theme === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('pp-report-theme', theme);
}
toggle.addEventListener('click', function() {
  var current = document.documentElement.dataset.theme || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});
var saved = localStorage.getItem('pp-report-theme') || 'dark';
toggle.textContent = saved === 'dark' ? '🌙' : '☀️';

function showTab(name, event) {
  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.nav-tab').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  if (event && event.target) event.target.classList.add('active');
}
</script>
</body>
</html>`;

// ── Write output ─────────────────────────────────────────────────────────────
const outDir = path.dirname(outputFile);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outputFile, html, 'utf8');
console.log(`✓ Report written to ${outputFile}`);
console.log(`  Environments : ${totalEnvs}`);
console.log(`  Resources    : ${totalResources}`);
console.log(`  DLP Policies : ${policies.length}`);
console.log(`  Gov findings : ${govFindings.length}`);

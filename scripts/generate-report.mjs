#!/usr/bin/env node
/**
 * generate-report.mjs
 * Generates a self-contained Power Platform Inventory HTML report from
 * data collected by pac CLI and az CLI during the GitHub Actions workflow.
 *
 * Usage:
 *   node scripts/generate-report.mjs \
 *     --data-dir /tmp/pp-data \
 *     --output   reports/YYYYMMDD/HHmm/inventory-report.html \
 *     --date     YYYYMMDD \
 *     --time     HHmm
 *
 * Expected files under --data-dir:
 *   tenant-settings.json          pac admin list-tenant-settings --output json
 *   dlp-policies.json             pac admin dlp-policy list --output json
 *   dlp-details/<guid>.json       pac admin dlp-policy show --output json
 *   environments.json             pac admin list --output json
 *   env-settings/<env-id>.json    pac env list-settings --output json
 *   inventory.json                az rest POST to PowerPlatformResources
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

const dataDir = getArg('--data-dir') || '/tmp/pp-data';
const output  = getArg('--output')   || 'reports/latest/inventory-report.html';
const rDate   = getArg('--date')     || new Date().toISOString().slice(0, 10).replace(/-/g, '');
const rTime   = getArg('--time')     || new Date().toISOString().slice(11, 16).replace(':', '');

const formattedTs = `${rDate.slice(0,4)}-${rDate.slice(4,6)}-${rDate.slice(6,8)} ${rTime.slice(0,2)}:${rTime.slice(2,4)} UTC`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJson(p, fallback) {
  try {
    if (!existsSync(p)) return fallback;
    const raw = readFileSync(p, 'utf-8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`Warning: could not parse ${p}: ${e.message}`);
    return fallback;
  }
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const toArr = (v) =>
  Array.isArray(v) ? v : (v?.value || v?.policies || v?.environments || v?.items || []);

// ── Load data ─────────────────────────────────────────────────────────────────
const tenantRaw    = readJson(join(dataDir, 'tenant-settings.json'), {});
const dlpListRaw   = readJson(join(dataDir, 'dlp-policies.json'), []);
const envsRaw      = readJson(join(dataDir, 'environments.json'), []);
const inventoryRaw = readJson(join(dataDir, 'inventory.json'), { value: [] });

const dlpPolicies    = toArr(dlpListRaw);
const environments   = toArr(envsRaw);
const inventoryItems = toArr(inventoryRaw?.value !== undefined ? inventoryRaw.value : inventoryRaw);

// Per-policy DLP details
const dlpDetailsDir = join(dataDir, 'dlp-details');
const dlpDetails = {};
if (existsSync(dlpDetailsDir)) {
  for (const f of readdirSync(dlpDetailsDir)) {
    if (f.endsWith('.json')) dlpDetails[f.replace('.json', '')] = readJson(join(dlpDetailsDir, f), {});
  }
}

// Per-env settings
const envSettingsDir = join(dataDir, 'env-settings');
const envSettingsMap = {};
if (existsSync(envSettingsDir)) {
  for (const f of readdirSync(envSettingsDir)) {
    if (f.endsWith('.json')) envSettingsMap[f.replace('.json', '')] = readJson(join(envSettingsDir, f), {});
  }
}

// ── Normalize ─────────────────────────────────────────────────────────────────
// Tenant settings — pac output can be flat or nested
const tsFlat = tenantRaw?.settings || tenantRaw?.value || tenantRaw || {};
const ts = (key) => {
  if (tsFlat[key] !== undefined) return tsFlat[key];
  const k = Object.keys(tsFlat).find(k2 => k2.toLowerCase() === key.toLowerCase());
  return k ? tsFlat[k] : undefined;
};

// Derive the human-readable region from the Dataverse instance URL.
// pac admin list doesn't expose a region field directly — the CRM subdomain
// suffix is the authoritative source: crm.dynamics.com → United States,
// crm2 → South America, crm3 → Canada, crm4 → Europe, crm5 → Asia Pacific,
// crm6 → Australia, crm7 → Japan, crm8 → India, crm9 → United States 2,
// crm11 → UK, crm12 → France, crm15 → UAE, crm16 → South Africa,
// crm17 → Germany, crm19 → Switzerland, crm20 → Norway.
const CRM_REGION_MAP = {
  'crm.dynamics.com':   'United States',
  'crm2.dynamics.com':  'South America',
  'crm3.dynamics.com':  'Canada',
  'crm4.dynamics.com':  'Europe',
  'crm5.dynamics.com':  'Asia Pacific',
  'crm6.dynamics.com':  'Australia',
  'crm7.dynamics.com':  'Japan',
  'crm8.dynamics.com':  'India',
  'crm9.dynamics.com':  'United States 2',
  'crm11.dynamics.com': 'United Kingdom',
  'crm12.dynamics.com': 'France',
  'crm14.dynamics.com': 'South America 2',
  'crm15.dynamics.com': 'UAE',
  'crm16.dynamics.com': 'South Africa',
  'crm17.dynamics.com': 'Germany',
  'crm19.dynamics.com': 'Switzerland',
  'crm20.dynamics.com': 'Norway',
};

function regionFromUrl(url) {
  if (!url) return '—';
  try {
    const host = new URL(url).hostname.toLowerCase();
    // Match hostnames like org1234.crm8.dynamics.com
    const m = host.match(/\.(crm\d*\.dynamics\.com)$/);
    if (m) return CRM_REGION_MAP[m[1]] || m[1];
  } catch { /* ignore */ }
  return '—';
}

const normEnv = (e) => {
  const url = e.EnvironmentUrl || e.environmentUrl || e.Url || e.url || '';
  // Prefer explicit region field if present, fall back to URL-derived region
  const rawRegion = e.Region || e.region || '';
  const region = rawRegion && rawRegion !== '—' ? rawRegion : regionFromUrl(url);
  return {
    id:        e.EnvironmentId  || e.environmentId  || e.id        || '',
    name:      e.DisplayName    || e.displayName    || e.name      || 'Unknown',
    type:      e.EnvironmentType|| e.environmentType|| e.type      || 'Unknown',
    url,
    region,
    groupId:   e.GroupId        || e.groupId        || '',
    groupName: e.GroupName      || e.groupName      || '',
    isManaged: !!(e.IsManaged   || e.isManaged),
    state:     e.State          || e.state          || 'Ready',
  };
};
const envList = environments.map(normEnv);

// Tenant identity (env var injected by workflow)
const tenantDomain = process.env.PP_TENANT_DOMAIN || ts('tenantDomainName') || 'your-tenant.onmicrosoft.com';
const tenantId     = process.env.PP_TENANT_ID     || ts('tenantId')         || '—';

// ── DLP analysis ──────────────────────────────────────────────────────────────
function analyzeDlp(policyId) {
  const d   = dlpDetails[policyId] || {};
  const def = d.policyDefinition || d.policy || d;
  const groups = def.connectorGroups || def.ConnectorGroups || [];
  const find = (label) => groups.find(g => {
    const c = (g.classification || g.Classification || '').toLowerCase();
    return c === label || (label === 'business' && c === 'confidential');
  });
  const cnt = (label) => (find(label)?.connectors || find(label)?.Connectors || []).length;
  return {
    blocked:      cnt('blocked'),
    confidential: cnt('confidential') || cnt('business'),
    general:      cnt('general'),
    defaultCls:   def.defaultConnectorsClassification || def.DefaultConnectorsClassification || 'General',
    scope:        def.environmentType || def.EnvironmentType || 'ExceptEnvironments',
    displayName:  def.displayName     || def.DisplayName     || policyId,
    hasDetails:   Object.keys(d).length > 0,
  };
}

// ── Resource inventory analysis ───────────────────────────────────────────────
const typeLabels = {
  'microsoft.powerapps/canvasapps':       { icon: '📱', label: 'Canvas Apps' },
  'microsoft.powerapps/modeldrivenapps':  { icon: '📊', label: 'Model-driven Apps' },
  'microsoft.flow/flows':                 { icon: '⚡', label: 'Cloud Flows' },
  'microsoft.copilotstudio/agents':       { icon: '🧠', label: 'Copilot Agents' },
  'microsoft.flow/agentflows':            { icon: '🤖', label: 'Agent Flows' },
};

const resourceCounts = {};
for (const item of inventoryItems) {
  const t = (item.type || item.resourceType || '').toLowerCase();
  resourceCounts[t] = (resourceCounts[t] || 0) + 1;
}
const totalResources = Object.values(resourceCounts).reduce((s, v) => s + v, 0);
const sortedResources = Object.entries(resourceCounts).sort((a, b) => b[1] - a[1]);

const recentItems = [...inventoryItems]
  .map(i => ({ ...i, _ts: i.createdTime || i.properties?.createdTime || i.createdAt || '' }))
  .filter(i => i._ts)
  .sort((a, b) => b._ts.localeCompare(a._ts))
  .slice(0, 12);

// ── Findings engine ───────────────────────────────────────────────────────────
const criticals = [];
const warnings  = [];
const healthy   = [];

const finding = (arr, title, detail, fix) => arr.push({ title, detail, fix });

// F1 — DLP connector classification
for (const p of dlpPolicies) {
  const pid  = p.policyName || p.PolicyName || p.name || p.Name || '';
  const name = p.displayName || p.DisplayName || p.name || pid;
  const a    = analyzeDlp(pid);

  if (a.hasDetails && a.blocked === 0) {
    finding(criticals,
      `DLP policy "${name}" — 0 connectors blocked`,
      `${a.general} connectors are in the General (permissive) bucket with none in Blocked. Any maker can bridge business data (SharePoint, Dataverse) to consumer services (social media, personal email, file sharing).`,
      `PPAC → Data Policies → open "${name}" → move high-risk consumer connectors to the Blocked group.`
    );
  } else if (!a.hasDetails && pid) {
    finding(warnings,
      `DLP details not loaded for policy "${name}"`,
      `Connector classification could not be verified. Run the workflow with proper pac credentials to collect DLP details.`,
      `pac admin dlp-policy show --policy-name "${pid}" --output json`
    );
  }

  if ((a.defaultCls || '').toLowerCase() === 'general') {
    finding(warnings,
      'DLP default classification is General — new connectors auto-permitted',
      'Microsoft periodically adds new connectors. With General as the default, they are immediately usable without admin review.',
      'Update the DLP policy: set defaultConnectorsClassification to Blocked.'
    );
  }
}

// F2 — Environment creation
if (ts('disableEnvironmentCreationByNonAdminUsers') !== true && ts('disableEnvironmentCreationByNonAdminUsers') !== 'true') {
  finding(criticals,
    'Any licensed user can create environments',
    'disableEnvironmentCreationByNonAdminUsers is not enforced. Users can spin up environments outside DLP scope, creating shadow IT.',
    'PPAC → Settings → Environment creation → restrict to Admins only.'
  );
}
if (ts('disableDeveloperEnvironmentCreationByNonAdminUsers') !== true && ts('disableDeveloperEnvironmentCreationByNonAdminUsers') !== 'true') {
  finding(warnings,
    'Non-admins can create developer environments',
    'Developer environments created by end users may bypass DLP and governance oversight.',
    'Tenant Settings → disableDeveloperEnvironmentCreationByNonAdminUsers = true.'
  );
}

// F3 — Managed environments
const managedCount = envList.filter(e => e.isManaged).length;
if (envList.length > 0 && managedCount === 0) {
  finding(criticals,
    'No environments enrolled in Managed Environments',
    'IP firewall, sharing limits, solution checker enforcement, and weekly usage digests are unavailable without Managed Environments.',
    'PPAC → each environment → Enable Managed Environments (requires Power Apps Premium license).'
  );
} else if (envList.length > 0 && managedCount < envList.length) {
  finding(warnings,
    `Only ${managedCount}/${envList.length} environments are Managed`,
    `${envList.length - managedCount} environment(s) lack Managed Environments controls: IP firewall, sharing limits, solution checker.`,
    'Enroll remaining environments in Managed Environments via PPAC.'
  );
}

// F4 — Share with everyone
if (ts('disableShareWithEveryone') === true || ts('disableShareWithEveryone') === 'true') {
  finding(healthy, 'Share With Everyone disabled', 'Apps cannot be shared with all tenant users, preventing over-sharing.');
} else {
  finding(warnings,
    'Share With Everyone is enabled',
    'Users can share apps with the entire organization, potentially granting broad unintended access.',
    'Tenant Settings → disableShareWithEveryone = true.'
  );
}

// F5 — Copilot settings
if (ts('disableCopilotFeedback') === true || ts('disableCopilotFeedback') === 'true') {
  finding(healthy, 'Copilot feedback collection disabled', 'User interaction data is not sent to Microsoft for model training — good for data privacy.');
}
if (ts('enableDefaultEnvironmentRouting') === true || ts('enableDefaultEnvironmentRouting') === 'true') {
  finding(healthy, 'Default environment routing enabled', 'New makers are redirected to personal developer environments, keeping the default environment clean.');
}
if (ts('enableOpenAiBotPublishing') === true || ts('enableOpenAiBotPublishing') === 'true') {
  finding(warnings,
    'External AI bot publishing is enabled',
    'Copilot Studio bots can be published externally. Bots may expose sensitive data or business processes to the public.',
    'Tenant Settings → enableOpenAiBotPublishing = false if external publishing is not required.'
  );
}

// F6 — Trial environments
const trialEnvs = envList.filter(e => (e.type || '').toLowerCase().includes('trial'));
if (trialEnvs.length > 0) {
  finding(warnings,
    `${trialEnvs.length} trial environment(s) at risk of expiry`,
    `Trial environments expire and permanently delete all data: ${trialEnvs.map(e => e.name).join(', ')}.`,
    'PPAC → convert each trial to Sandbox or Developer environment before expiry date.'
  );
}

// F7 — Per-env settings
let ipFlaggedOnce = false, sensitivityFlaggedOnce = false;
for (const [envId, rawSettings] of Object.entries(envSettingsMap)) {
  const env = envList.find(e => e.id === envId);
  if (!env) continue;

  const asList = Array.isArray(rawSettings)
    ? rawSettings
    : Object.entries(rawSettings.settings || rawSettings.Settings || rawSettings).map(([k, v]) => ({ name: k, value: v }));

  const getSetting = (key) => {
    if (Array.isArray(asList)) {
      const s = asList.find(s => (s.name || s.Name || '').toLowerCase() === key.toLowerCase());
      return s ? (s.value ?? s.Value) : undefined;
    }
    return rawSettings[key];
  };

  const ip = getSetting('enableipbasedfirewallrule');
  if (!ipFlaggedOnce && (ip === false || ip === 'false' || ip === 'No' || ip === 'no')) {
    finding(warnings,
      `IP-based firewall not enabled (checked in "${env.name}")`,
      'Dataverse is accessible from any IP address. IP firewall restricts access to approved corporate IP ranges.',
      `Requires Managed Environment. PPAC → ${env.name} → Security → IP Firewall.`
    );
    ipFlaggedOnce = true;
  }

  const sens = getSetting('enablesensitivitylabels');
  if (!sensitivityFlaggedOnce && (sens === false || sens === 'false' || sens === 'No' || sens === 'no')) {
    finding(warnings,
      `Sensitivity labels not enabled (checked in "${env.name}")`,
      'Without sensitivity labels, Dataverse data cannot be classified per Microsoft Purview policies.',
      'Enable Microsoft Purview integration in PPAC → Environment → Settings → Features.'
    );
    sensitivityFlaggedOnce = true;
  }
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
const pBadge = (priority) => {
  const map = { Critical: 'critical', High: 'warning', Info: 'info' };
  return `<span class="badge badge-${map[priority] || 'info'}">${esc(priority)}</span>`;
};

const envTypeBadge = (type) => {
  const t = (type || '').toLowerCase();
  const cls = t.includes('default') ? 'default'
    : t.includes('trial')     ? 'trial'
    : t.includes('developer') ? 'developer'
    : t.includes('production')? 'production'
    : 'sandbox';
  const label = t.includes('default') ? 'Default'
    : t.includes('trial')     ? 'Trial'
    : t.includes('developer') ? 'Developer'
    : t.includes('production')? 'Production'
    : type || 'Sandbox';
  return `<span class="env-type env-type-${cls}">${esc(label)}</span>`;
};

const findingHtml = (items, cssClass) => items.map(f => `
  <div class="finding finding-${cssClass}">
    <h3>${esc(f.title)}</h3>
    <p>${esc(f.detail)}</p>
    ${f.fix ? `<div class="fix">${esc(f.fix)}</div>` : ''}
  </div>`).join('');

const settingRow = (icon, label, rawKey, goodFn, goodText, badText) => {
  const val = ts(rawKey);
  const valStr = val === undefined ? 'Not configured' : String(val);
  const isGood = val === undefined ? false : goodFn(val);
  const statusIcon = isGood ? '🟢' : (val === undefined ? '⚪' : '🔴');
  const statusText = isGood ? goodText : badText;
  const statusColor = isGood ? 'var(--success)' : (val === undefined ? 'var(--text-muted)' : 'var(--critical)');
  return `
    <div class="setting-item">
      <div class="setting-icon">${statusIcon}</div>
      <div>
        <div class="setting-label">${esc(label)}</div>
        <div class="setting-value">${esc(rawKey)}: <strong>${esc(valStr)}</strong></div>
        <div class="setting-value" style="color:${statusColor};margin-top:4px;">${esc(statusText)}</div>
      </div>
    </div>`;
};

// Resource bar rows
const resourceBarRows = sortedResources.length > 0
  ? sortedResources.map(([type, count]) => {
      const pct = totalResources > 0 ? Math.round((count / totalResources) * 100) : 0;
      const info = typeLabels[type] || { icon: '📦', label: type };
      return `<tr>
        <td>${esc(info.icon + ' ' + info.label)}</td>
        <td class="num">${count}</td>
        <td><div class="bar-container"><div class="bar" style="width:${pct}%"></div></div></td>
        <td class="num">${pct}%</td>
      </tr>`;
    }).join('')
  : `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;">
      No inventory data — install Azure CLI and configure AZURE_CREDENTIALS secret to enable resource graph queries.
     </td></tr>`;

// Recent resources rows
const recentRows = recentItems.length > 0
  ? recentItems.map(i => {
      const type = (i.type || i.resourceType || '').toLowerCase();
      const info = typeLabels[type] || { icon: '📦', label: type };
      const created = (i.createdTime || i.properties?.createdTime || i.createdAt || '—').slice(0, 10);
      return `<tr>
        <td>${esc(info.icon + ' ' + (i.name || i.displayName || 'Unknown'))}</td>
        <td><span class="resource-type-pill">${esc(info.label)}</span></td>
        <td>${esc(i.environmentName || i.environment || '—')}</td>
        <td>${esc(created)}</td>
      </tr>`;
    }).join('')
  : `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;">No inventory data (az CLI not configured)</td></tr>`;

// Environment table rows
const envRows = envList.length > 0
  ? envList.map(e => `<tr>
      <td class="env-name">${esc(e.name)}</td>
      <td>${envTypeBadge(e.type)}</td>
      <td>${esc(e.region)}</td>
      <td>${e.groupName ? `<span class="resource-type-pill">${esc(e.groupName)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td>${e.isManaged
        ? '<span class="badge badge-success">Managed</span>'
        : '<span class="badge badge-warning">Not Managed</span>'}</td>
    </tr>`).join('')
  : `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:24px;">No environment data collected</td></tr>`;

// DLP policy rows
const dlpRows = dlpPolicies.length > 0
  ? dlpPolicies.map(p => {
      const pid = p.policyName || p.PolicyName || p.name || '';
      const a   = analyzeDlp(pid);
      const status = a.hasDetails && a.blocked > 0 ? 'success' : a.hasDetails ? 'critical' : 'warning';
      const statusLabel = a.hasDetails && a.blocked > 0 ? 'Configured' : a.hasDetails ? 'No Blocked' : 'Details Missing';
      return `<tr>
        <td class="env-name">${esc(p.displayName || p.DisplayName || p.name || pid)}</td>
        <td style="font-family:monospace;font-size:0.78rem;">${esc(pid.slice(0,8))}…</td>
        <td>${esc(a.scope)}</td>
        <td>${esc(a.defaultCls)}</td>
        <td class="num" style="${a.blocked === 0 && a.hasDetails ? 'color:var(--critical)' : ''}">${a.hasDetails ? a.blocked : '—'}</td>
        <td class="num">${a.hasDetails ? a.confidential : '—'}</td>
        <td class="num">${a.hasDetails ? a.general.toLocaleString() : '—'}</td>
        <td><span class="badge badge-${status}">${statusLabel}</span></td>
      </tr>`;
    }).join('')
  : `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:24px;">No DLP data collected</td></tr>`;

// Env settings grid (first env with data)
const firstEnvId   = Object.keys(envSettingsMap)[0];
const firstEnvName = firstEnvId ? (envList.find(e => e.id === firstEnvId)?.name || firstEnvId) : null;

const envSettingsGrid = firstEnvId ? (() => {
  const raw = envSettingsMap[firstEnvId];
  const asList = Array.isArray(raw) ? raw
    : Object.entries(raw.settings || raw.Settings || raw).map(([k, v]) => ({ name: k, value: v }));
  const getSetting = (key) => {
    const s = Array.isArray(asList)
      ? asList.find(s => (s.name || '').toLowerCase() === key.toLowerCase())
      : null;
    return s ? (s.value ?? s.Value) : raw[key];
  };
  const rows = [
    { key: 'enableipbasedfirewallrule',    label: 'IP-based Firewall',    good: v => v===true||v==='Yes'||v==='true', goodTxt: 'Network restriction active', badTxt: 'No IP restrictions — accessible from any network' },
    { key: 'enablesensitivitylabels',      label: 'Sensitivity Labels',   good: v => v===true||v==='Yes'||v==='true', goodTxt: 'Data classification labels enforced', badTxt: 'Sensitivity labels not enforced' },
    { key: 'inactivitytimeoutenabled',     label: 'Inactivity Timeout',   good: v => v===true||v==='Yes'||v==='true', goodTxt: 'Sessions expire on inactivity', badTxt: 'Sessions never time out automatically' },
    { key: 'auditretentionperiod',         label: 'Audit Retention (days)',good: v => parseInt(v)>=90, goodTxt: 'Retention adequate (≥90 days)', badTxt: 'Low retention — increase to 90+ days for compliance' },
    { key: 'plugintracelogsetting',        label: 'Plugin Trace Logging', good: v => v!=='Off'&&v!==false&&v!=='false', goodTxt: 'Trace logging active', badTxt: 'Logging off — difficult to diagnose issues' },
    { key: 'sharedcomponentscapacitystrategy', label: 'Shared Capacity Strategy', good: v => v===true||v==='Yes'||v==='true', goodTxt: 'Configured', badTxt: 'Not configured' },
  ];
  return rows.map(r => {
    const val = getSetting(r.key);
    const valStr = val === undefined ? 'Not found' : String(val);
    const isGood = val !== undefined && r.good(val);
    const icon = isGood ? '🟢' : (val === undefined ? '⚪' : '🔴');
    const color = isGood ? 'var(--success)' : (val === undefined ? 'var(--text-muted)' : 'var(--critical)');
    const text  = isGood ? r.goodTxt : r.badTxt;
    return `<div class="setting-item">
      <div class="setting-icon">${icon}</div>
      <div>
        <div class="setting-label">${esc(r.label)}</div>
        <div class="setting-value">${esc(r.key)}: <strong>${esc(valStr)}</strong></div>
        <div class="setting-value" style="color:${color};margin-top:4px;">${esc(text)}</div>
      </div>
    </div>`;
  }).join('');
})() : '<p class="text-muted" style="padding:16px;">No environment settings collected.</p>';

// Governance settings grid
const govSettings = [
  { key: 'disableShareWithEveryone',                      label: 'Share With Everyone Disabled',    good: v=>v===true||v==='true', goodTxt: 'Apps cannot be shared broadly', badTxt: 'Users can share with entire org' },
  { key: 'disableEnvironmentCreationByNonAdminUsers',     label: 'Env Creation Restricted to Admins', good: v=>v===true||v==='true', goodTxt: 'Only admins can create environments', badTxt: 'Any user can create environments' },
  { key: 'disableDeveloperEnvironmentCreationByNonAdminUsers', label: 'Dev Env Creation Restricted', good: v=>v===true||v==='true', goodTxt: 'Only admins can create developer envs', badTxt: 'Any user can create developer envs' },
  { key: 'enableOpenAiBotPublishing',                     label: 'External Bot Publishing',         good: v=>v===false||v==='false', goodTxt: 'External bot publishing disabled', badTxt: 'Bots can be published externally' },
  { key: 'disableCopilotFeedback',                        label: 'Copilot Feedback Collection',     good: v=>v===true||v==='true', goodTxt: 'Feedback data not sent to Microsoft', badTxt: 'Interaction data shared with Microsoft' },
  { key: 'enableDefaultEnvironmentRouting',               label: 'Default Environment Routing',     good: v=>v===true||v==='true', goodTxt: 'New makers routed to personal dev envs', badTxt: 'Makers land in default environment' },
  { key: 'disableDocsSearch',                             label: 'Docs Search Disabled',            good: v=>v===false||v==='false', goodTxt: 'Docs search available to makers', badTxt: 'Makers cannot search MS docs from studio' },
  { key: 'disableFlowRunResubmission',                    label: 'Flow Run Resubmission',           good: v=>v===false||v==='false', goodTxt: 'Users can retry failed flow runs', badTxt: 'Failed flow runs cannot be retried' },
].map(r => {
  const val = ts(r.key);
  const valStr = val === undefined ? 'Not configured' : String(val);
  const isGood = val !== undefined && r.good(val);
  const icon  = isGood ? '🟢' : (val === undefined ? '⚪' : '🔴');
  const color = isGood ? 'var(--success)' : (val === undefined ? 'var(--text-muted)' : 'var(--critical)');
  return `<div class="setting-item">
    <div class="setting-icon">${icon}</div>
    <div>
      <div class="setting-label">${esc(r.label)}</div>
      <div class="setting-value">${esc(r.key)}: <strong>${esc(valStr)}</strong></div>
      <div class="setting-value" style="color:${color};margin-top:4px;">${esc(isGood ? r.goodTxt : r.badTxt)}</div>
    </div>
  </div>`;
}).join('');

// Recommendations table
const allRecs = [
  ...criticals.map(f => ({ ...f, priority: 'Critical' })),
  ...warnings.map(f  => ({ ...f, priority: 'High' })),
  ...healthy.map(f   => ({ ...f, priority: 'Info' })),
];
const recsRows = allRecs.map((r, i) => `<tr>
  <td class="num">${i + 1}</td>
  <td>${pBadge(r.priority)}</td>
  <td><strong>${esc(r.title)}</strong></td>
  <td style="font-size:0.85rem;color:var(--text-secondary);">${esc(r.detail)}</td>
  <td style="font-size:0.83rem;">${r.fix ? esc(r.fix) : '—'}</td>
</tr>`).join('');

// ── Final HTML ─────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Power Platform Inventory — ${esc(tenantDomain)}</title>
<script>
  (function() {
    var saved = localStorage.getItem('pp-report-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  })();
<\/script>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,500;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;600&display=swap');
:root{--bg-primary:#0a0e17;--bg-secondary:#111827;--bg-card:#1a2233;--bg-card-hover:#1f2a3d;--bg-input:#0d1321;--border-color:#1e2d44;--text-primary:#e8ecf4;--text-secondary:#8b97b0;--text-muted:#5b6782;--accent:#3b82f6;--accent-glow:rgba(59,130,246,0.15);--success:#22c55e;--success-bg:rgba(34,197,94,0.1);--warning:#f59e0b;--warning-bg:rgba(245,158,11,0.1);--critical:#ef4444;--critical-bg:rgba(239,68,68,0.1);--info:#06b6d4;--info-bg:rgba(6,182,212,0.1);--hero-gradient:linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%);--card-shadow:0 4px 24px rgba(0,0,0,0.3);--table-stripe:rgba(255,255,255,0.02);--toggle-bg:#1e2d44;--toggle-fg:#e8ecf4;--bar-bg:#1e2d44;--bar-fill:#3b82f6;--pill-bg:rgba(59,130,246,0.15);--pill-text:#60a5fa;}
[data-theme="light"]{--bg-primary:#f8fafc;--bg-secondary:#fff;--bg-card:#fff;--bg-card-hover:#f1f5f9;--bg-input:#f1f5f9;--border-color:#e2e8f0;--text-primary:#0f172a;--text-secondary:#475569;--text-muted:#94a3b8;--accent:#2563eb;--accent-glow:rgba(37,99,235,0.08);--success:#16a34a;--success-bg:rgba(22,163,74,0.08);--warning:#d97706;--warning-bg:rgba(217,119,6,0.08);--critical:#dc2626;--critical-bg:rgba(220,38,38,0.06);--info:#0891b2;--info-bg:rgba(8,145,178,0.06);--hero-gradient:linear-gradient(135deg,#eff6ff 0%,#e0e7ff 50%,#f0f9ff 100%);--card-shadow:0 1px 12px rgba(0,0,0,0.06);--table-stripe:rgba(0,0,0,0.02);--toggle-bg:#e2e8f0;--toggle-fg:#0f172a;--bar-bg:#e2e8f0;--bar-fill:#2563eb;--pill-bg:rgba(37,99,235,0.08);--pill-text:#2563eb;}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html{scroll-behavior:smooth;}
body{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;min-height:100vh;}
.theme-toggle{position:fixed;top:20px;right:20px;z-index:1000;width:48px;height:48px;border-radius:50%;border:1px solid var(--border-color);background:var(--toggle-bg);color:var(--toggle-fg);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .3s ease;backdrop-filter:blur(10px);box-shadow:0 4px 12px rgba(0,0,0,0.15);}
.theme-toggle:hover{transform:scale(1.1);border-color:var(--accent);box-shadow:0 4px 20px var(--accent-glow);}
.hero{background:var(--hero-gradient);padding:60px 40px 50px;border-bottom:1px solid var(--border-color);position:relative;overflow:hidden;}
.hero::before{content:'';position:absolute;top:-50%;right:-20%;width:600px;height:600px;background:radial-gradient(circle,var(--accent-glow) 0%,transparent 70%);pointer-events:none;}
.hero h1{font-size:2.2rem;font-weight:700;letter-spacing:-.5px;margin-bottom:8px;position:relative;}
.hero .subtitle{color:var(--text-secondary);font-size:.95rem;margin-bottom:32px;position:relative;}
.hero .tenant-name{color:var(--accent);font-weight:600;}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;position:relative;}
.stat-card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:20px;text-align:center;transition:all .25s ease;}
.stat-card:hover{border-color:var(--accent);box-shadow:0 0 20px var(--accent-glow);transform:translateY(-2px);}
.stat-card .stat-value{font-size:2rem;font-weight:700;font-family:'JetBrains Mono',monospace;color:var(--text-primary);}
.stat-card .stat-label{font-size:.8rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:1px;margin-top:4px;}
.health-bar{display:flex;gap:16px;margin:24px 0;flex-wrap:wrap;}
.health-item{display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;font-weight:600;font-size:.95rem;}
.health-critical{background:var(--critical-bg);color:var(--critical);border:1px solid var(--critical);}
.health-warning{background:var(--warning-bg);color:var(--warning);border:1px solid var(--warning);}
.health-success{background:var(--success-bg);color:var(--success);border:1px solid var(--success);}
.container{max-width:1400px;margin:0 auto;padding:32px 40px;}
.section{margin-bottom:48px;}
.section-header{display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border-color);}
.section-header h2{font-size:1.35rem;font-weight:700;letter-spacing:-.3px;}
.section-header .icon{font-size:1.4rem;}
.card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:24px;margin-bottom:16px;transition:all .2s ease;}
.card:hover{background:var(--bg-card-hover);box-shadow:var(--card-shadow);}
table{width:100%;border-collapse:collapse;font-size:.9rem;}
thead th{text-align:left;padding:12px 16px;color:var(--text-secondary);font-weight:600;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid var(--border-color);white-space:nowrap;}
tbody td{padding:12px 16px;border-bottom:1px solid var(--border-color);vertical-align:middle;}
tbody tr:nth-child(even){background:var(--table-stripe);}
tbody tr:hover{background:var(--bg-card-hover);}
.num{font-family:'JetBrains Mono',monospace;text-align:right;font-weight:600;}
.text-muted{color:var(--text-muted);font-style:italic;}
.badge{display:inline-block;padding:4px 10px;border-radius:6px;font-size:.75rem;font-weight:600;white-space:nowrap;}
.badge-success{background:var(--success-bg);color:var(--success);border:1px solid var(--success);}
.badge-warning{background:var(--warning-bg);color:var(--warning);border:1px solid var(--warning);}
.badge-critical{background:var(--critical-bg);color:var(--critical);border:1px solid var(--critical);}
.badge-info{background:var(--info-bg);color:var(--info);border:1px solid var(--info);}
.env-type{display:inline-block;padding:3px 10px;border-radius:6px;font-size:.75rem;font-weight:600;}
.env-type-default{background:var(--warning-bg);color:var(--warning);border:1px solid var(--warning);}
.env-type-trial{background:var(--info-bg);color:var(--info);border:1px solid var(--info);}
.env-type-developer{background:var(--success-bg);color:var(--success);border:1px solid var(--success);}
.env-type-production{background:var(--critical-bg);color:var(--critical);border:1px solid var(--critical);}
.env-type-sandbox{background:var(--info-bg);color:var(--info);border:1px solid var(--info);}
.resource-type-pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:500;background:var(--pill-bg);color:var(--pill-text);}
.env-name{font-weight:600;}
.bar-container{background:var(--bar-bg);border-radius:4px;height:8px;width:100%;min-width:100px;}
.bar{background:var(--bar-fill);border-radius:4px;height:100%;transition:width .6s ease;}
.finding{padding:20px 24px;border-radius:10px;margin-bottom:12px;border-left:4px solid;}
.finding-critical{background:var(--critical-bg);border-color:var(--critical);}
.finding-warning{background:var(--warning-bg);border-color:var(--warning);}
.finding-info{background:var(--info-bg);border-color:var(--info);}
.finding h3{font-size:1rem;margin-bottom:6px;}
.finding p{font-size:.88rem;color:var(--text-secondary);margin-bottom:8px;line-height:1.6;}
.finding .fix{font-size:.85rem;padding:8px 12px;background:var(--bg-input);border-radius:6px;font-family:'JetBrains Mono',monospace;color:var(--text-primary);margin-top:8px;word-break:break-all;}
.nav-tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--border-color);overflow-x:auto;}
.nav-tab{padding:10px 18px;font-size:.85rem;font-weight:500;color:var(--text-secondary);background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;transition:all .2s ease;}
.nav-tab:hover{color:var(--text-primary);}
.nav-tab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:700;}
.tab-content{display:none;}
.tab-content.active{display:block;}
.settings-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;}
.setting-item{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:8px;background:var(--bg-card);border:1px solid var(--border-color);}
.setting-icon{font-size:1.2rem;flex-shrink:0;margin-top:2px;}
.setting-label{font-size:.82rem;font-weight:600;color:var(--text-primary);}
.setting-value{font-size:.78rem;color:var(--text-secondary);margin-top:2px;font-family:'JetBrains Mono',monospace;}
.footer{text-align:center;padding:32px;color:var(--text-muted);font-size:.8rem;border-top:1px solid var(--border-color);}
@media(max-width:768px){.hero{padding:40px 20px 30px;}.container{padding:20px;}.stat-grid{grid-template-columns:repeat(2,1fr);}}
</style>
</head>
<body>
<button class="theme-toggle" id="themeToggle" title="Toggle dark/light mode" aria-label="Toggle theme">🌙</button>

<div class="hero">
  <h1>⚡ Power Platform Inventory Report</h1>
  <p class="subtitle">
    Tenant: <span class="tenant-name">${esc(tenantDomain)}</span> &nbsp;·&nbsp;
    Tenant ID: <span class="tenant-name">${esc(tenantId)}</span> &nbsp;·&nbsp;
    Generated: <span class="tenant-name">${esc(formattedTs)}</span>
  </p>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-value">${envList.length}</div><div class="stat-label">Environments</div></div>
    <div class="stat-card"><div class="stat-value">${totalResources > 0 ? totalResources.toLocaleString() : '—'}</div><div class="stat-label">Resources</div></div>
    <div class="stat-card"><div class="stat-value">${dlpPolicies.length}</div><div class="stat-label">DLP Policies</div></div>
    <div class="stat-card"><div class="stat-value">${managedCount}</div><div class="stat-label">Managed Envs</div></div>
    <div class="stat-card"><div class="stat-value">${criticals.length}</div><div class="stat-label">Critical Issues</div></div>
    <div class="stat-card"><div class="stat-value">${warnings.length}</div><div class="stat-label">Warnings</div></div>
  </div>
  <div class="health-bar">
    ${criticals.length > 0 ? `<div class="health-item health-critical">🔴 ${criticals.length} Critical</div>` : ''}
    ${warnings.length  > 0 ? `<div class="health-item health-warning">🟡 ${warnings.length} Warning${warnings.length !== 1 ? 's' : ''}</div>` : ''}
    ${healthy.length   > 0 ? `<div class="health-item health-success">🟢 ${healthy.length} Healthy</div>` : ''}
    ${criticals.length === 0 && warnings.length === 0 ? '<div class="health-item health-success">🟢 No issues found</div>' : ''}
  </div>
</div>

<div class="container">
  <div class="nav-tabs">
    <button class="nav-tab active" onclick="showTab('overview',this)">Overview</button>
    <button class="nav-tab" onclick="showTab('environments',this)">Environments</button>
    <button class="nav-tab" onclick="showTab('governance',this)">Tenant Governance</button>
    <button class="nav-tab" onclick="showTab('dlp',this)">DLP Policies</button>
    <button class="nav-tab" onclick="showTab('env-settings',this)">Environment Settings</button>
    <button class="nav-tab" onclick="showTab('recommendations',this)">Recommendations</button>
  </div>

  <!-- Overview -->
  <div id="tab-overview" class="tab-content active">
    <div class="section">
      <div class="section-header"><span class="icon">🔴</span><h2>Critical Findings (${criticals.length})</h2></div>
      ${criticals.length > 0 ? findingHtml(criticals, 'critical') : '<div class="finding finding-info"><h3>No critical issues found</h3><p>All critical governance checks passed.</p></div>'}
    </div>
    <div class="section">
      <div class="section-header"><span class="icon">🟡</span><h2>Warnings (${warnings.length})</h2></div>
      ${warnings.length > 0 ? findingHtml(warnings, 'warning') : '<div class="finding finding-info"><h3>No warnings</h3><p>All warning checks passed.</p></div>'}
    </div>
    <div class="section">
      <div class="section-header"><span class="icon">📊</span><h2>Resource Breakdown</h2></div>
      <div class="card">
        <table>
          <thead><tr><th>Resource Type</th><th>Count</th><th>Distribution</th><th>Share</th></tr></thead>
          <tbody>${resourceBarRows}</tbody>
        </table>
      </div>
    </div>
    ${recentItems.length > 0 ? `
    <div class="section">
      <div class="section-header"><span class="icon">🕐</span><h2>Recently Created Resources</h2></div>
      <div class="card">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Environment</th><th>Created</th></tr></thead>
          <tbody>${recentRows}</tbody>
        </table>
      </div>
    </div>` : ''}
  </div>

  <!-- Environments -->
  <div id="tab-environments" class="tab-content">
    <div class="section">
      <div class="section-header"><span class="icon">🌐</span><h2>Environment Inventory (${envList.length})</h2></div>
      <p style="color:var(--text-secondary);margin-bottom:16px;">
        ${managedCount} managed · ${envList.length - managedCount} not managed ·
        ${trialEnvs.length} trial · ${envList.filter(e=>e.groupId).length} in environment groups
      </p>
      <div class="card" style="overflow-x:auto;">
        <table>
          <thead><tr><th>Environment</th><th>Type</th><th>Region</th><th>Group</th><th>Managed</th></tr></thead>
          <tbody>${envRows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Governance -->
  <div id="tab-governance" class="tab-content">
    <div class="section">
      <div class="section-header"><span class="icon">🏛️</span><h2>Tenant Governance Settings</h2></div>
      <p style="color:var(--text-secondary);margin-bottom:20px;">Collected via <code>pac admin list-tenant-settings</code> on ${esc(formattedTs)}.</p>
      <div class="settings-grid">${govSettings}</div>
    </div>
  </div>

  <!-- DLP -->
  <div id="tab-dlp" class="tab-content">
    <div class="section">
      <div class="section-header"><span class="icon">🔒</span><h2>DLP Policies (${dlpPolicies.length})</h2></div>
      <div class="card" style="overflow-x:auto;">
        <table>
          <thead><tr><th>Policy Name</th><th>ID</th><th>Scope</th><th>Default Cls.</th><th>Blocked</th><th>Confidential</th><th>General</th><th>Status</th></tr></thead>
          <tbody>${dlpRows}</tbody>
        </table>
      </div>
      ${findingHtml(criticals.filter(f => f.title.toLowerCase().includes('dlp')), 'critical')}
      ${findingHtml(warnings.filter(f => f.title.toLowerCase().includes('dlp') || f.title.toLowerCase().includes('connector')), 'warning')}
    </div>
  </div>

  <!-- Env Settings -->
  <div id="tab-env-settings" class="tab-content">
    <div class="section">
      <div class="section-header"><span class="icon">⚙️</span><h2>Environment Settings${firstEnvName ? ` — ${esc(firstEnvName)}` : ''}</h2></div>
      <p style="color:var(--text-secondary);margin-bottom:20px;">Collected via <code>pac env list-settings</code>. Settings for the first accessible environment shown.</p>
      <div class="settings-grid">${envSettingsGrid}</div>
    </div>
  </div>

  <!-- Recommendations -->
  <div id="tab-recommendations" class="tab-content">
    <div class="section">
      <div class="section-header"><span class="icon">✅</span><h2>Prioritized Recommendations (${allRecs.length})</h2></div>
      <div class="card" style="overflow-x:auto;">
        <table>
          <thead><tr><th>#</th><th>Priority</th><th>Issue</th><th>Why It Matters</th><th>How to Fix</th></tr></thead>
          <tbody>${recsRows || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:24px;">No recommendations — tenant is fully configured!</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<div class="footer">
  Power Platform Inventory Report · ${esc(tenantDomain)} · ${esc(formattedTs)} ·
  Data: pac admin list-tenant-settings, pac admin dlp-policy list/show, pac admin list, pac env list-settings, az rest (PowerPlatformResources)
</div>

<script>
function showTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
}
const toggle = document.getElementById('themeToggle');
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  toggle.textContent = t === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('pp-report-theme', t);
}
toggle.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
applyTheme(document.documentElement.dataset.theme || 'dark');
<\/script>
</body>
</html>`;

// ── Write output ───────────────────────────────────────────────────────────────
const outDir = dirname(output);
mkdirSync(outDir, { recursive: true });
writeFileSync(output, html, 'utf-8');

console.log(`✅ Report generated: ${output}`);
console.log(`   Tenant:      ${tenantDomain}`);
console.log(`   Environments: ${envList.length}`);
console.log(`   DLP Policies: ${dlpPolicies.length}`);
console.log(`   Resources:    ${totalResources}`);
console.log(`   Critical:     ${criticals.length}  Warning: ${warnings.length}  Healthy: ${healthy.length}`);

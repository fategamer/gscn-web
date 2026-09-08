const GSCN_DATA = {
  countries: [
    { code: 'KEN', name: 'Kenya' },
    { code: 'NGA', name: 'Nigeria' },
    { code: 'ZAF', name: 'South Africa' },
    { code: 'EGY', name: 'Egypt' }
  ],
  indicators: [
    { code: 'NY.GDP.MKTP.KD.ZG', key: 'growth', label: 'GDP growth', unit: '%' },
    { code: 'FP.CPI.TOTL.ZG', key: 'inflation', label: 'Inflation', unit: '%' },
    { code: 'NE.TRD.GNFS.ZS', key: 'trade', label: 'Trade / GDP', unit: '%' },
    { code: 'IS.SHP.GOOD.TU.K6', key: 'containers', label: 'Container port traffic', unit: 'TEU' }
  ],
  cacheTtlMs: 6 * 60 * 60 * 1000,
  alertThresholds: { growth: 1.0, inflation: 1.5, trade: 5, containers: 10 }
};

const dashboardState = {
  country: 'KEN', data: {}, history: {}, comparison: {}, loaded: false,
  charts: {}, source: 'live', refreshedAt: null
};

function formatValue(value, unit) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (unit === 'TEU') return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}${unit}`;
}

function setStatus(message, type = '') {
  const el = document.getElementById('data-status');
  if (!el) return;
  el.textContent = message;
  el.dataset.state = type;
}

function cacheKey(country, indicator) { return `gscn-data-v3-${country}-${indicator.key}`; }

function readCache(country, indicator) {
  try {
    const raw = localStorage.getItem(cacheKey(country, indicator));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached.savedAt || Date.now() - cached.savedAt > GSCN_DATA.cacheTtlMs) return null;
    return cached.rows || null;
  } catch (_) { return null; }
}

function writeCache(country, indicator, rows) {
  try { localStorage.setItem(cacheKey(country, indicator), JSON.stringify({ savedAt: Date.now(), rows })); } catch (_) {}
}

async function fetchIndicator(country, indicator, perPage = 20, force = false) {
  if (!force) {
    const cached = readCache(country, indicator);
    if (cached?.length) return cached;
  }
  const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator.code}?format=json&per_page=${perPage}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`World Bank request failed: ${response.status}`);
  const json = await response.json();
  const rows = Array.isArray(json) ? json[1] : [];
  const cleaned = rows?.filter(item => item.value !== null).map(item => ({ value: Number(item.value), year: item.date })) || [];
  if (cleaned.length) writeCache(country, indicator, cleaned);
  return cleaned;
}

function latest(history) { return history?.[0] || null; }

function calculateComponents(data) {
  const growth = Number(data.growth?.value);
  const inflation = Number(data.inflation?.value);
  const trade = Number(data.trade?.value);
  const containers = Number(data.containers?.value);
  if (![growth, inflation, trade, containers].every(Number.isFinite)) return null;
  return {
    growth: Math.max(0, Math.min(100, 50 - growth * 8)),
    inflation: Math.max(0, Math.min(100, inflation * 5)),
    trade: Math.max(0, Math.min(100, 70 - trade)),
    logistics: containers > 0 ? Math.max(0, Math.min(100, 70 - Math.log10(containers) * 12)) : 50
  };
}

function calculateRisk(data) {
  const c = calculateComponents(data);
  if (!c) return null;
  return Math.max(0, Math.min(100, Math.round(c.growth * 0.30 + c.inflation * 0.30 + c.trade * 0.20 + c.logistics * 0.20)));
}

function riskLabel(score) {
  if (score === null) return 'Awaiting data';
  if (score >= 67) return 'Higher screening exposure';
  if (score >= 34) return 'Moderate screening exposure';
  return 'Lower screening exposure';
}

function updateRisk(data) {
  const score = calculateRisk(data), components = calculateComponents(data);
  const scoreEl = document.getElementById('risk-score'), fillEl = document.getElementById('risk-fill');
  const levelEl = document.getElementById('risk-level'), explainEl = document.getElementById('risk-explain');
  if (!scoreEl || !fillEl || !levelEl || !explainEl) return;
  if (score === null) {
    scoreEl.textContent = '—'; fillEl.style.width = '0%'; levelEl.textContent = 'Awaiting data';
    explainEl.textContent = 'The model requires all four verified indicators before calculating a screening score.';
    return;
  }
  scoreEl.textContent = score; fillEl.style.width = `${score}%`; levelEl.textContent = riskLabel(score);
  explainEl.textContent = `Components — growth: ${Math.round(components.growth)}, inflation: ${Math.round(components.inflation)}, trade: ${Math.round(components.trade)}, logistics: ${Math.round(components.logistics)}. This is an experimental screening model, not a formal risk rating.`;
}

function trend(rows) {
  if (!rows || rows.length < 2) return null;
  const newest = Number(rows[0].value), previous = Number(rows[1].value);
  if (!Number.isFinite(newest) || !Number.isFinite(previous)) return null;
  return { newest, previous, delta: newest - previous, pct: previous !== 0 ? ((newest - previous) / Math.abs(previous)) * 100 : null };
}

function buildAlerts(data, history) {
  const alerts = [];
  const growth = trend(history.growth), inflation = trend(history.inflation), trade = trend(history.trade), containers = trend(history.containers);
  if (growth && growth.delta <= -GSCN_DATA.alertThresholds.growth) alerts.push(['Macro pressure', `GDP growth fell ${Math.abs(growth.delta).toFixed(1)} percentage points between ${history.growth[1].year} and ${history.growth[0].year}.`, 'Watch']);
  if (inflation && inflation.delta >= GSCN_DATA.alertThresholds.inflation) alerts.push(['Cost pressure', `Inflation increased ${inflation.delta.toFixed(1)} percentage points to ${formatValue(data.inflation?.value, '%')}.`, 'Watch']);
  if (trade && Math.abs(trade.pct || 0) >= GSCN_DATA.alertThresholds.trade) alerts.push(['Trade intensity', `Trade / GDP changed ${trade.delta >= 0 ? '+' : ''}${trade.delta.toFixed(1)} percentage points year over year.`, 'Signal']);
  if (containers && Math.abs(containers.pct || 0) >= GSCN_DATA.alertThresholds.containers) alerts.push(['Logistics activity', `Container throughput changed ${containers.pct >= 0 ? '+' : ''}${containers.pct.toFixed(1)}% year over year.`, 'Signal']);
  return alerts;
}

function renderAlerts(data, history) {
  const host = document.getElementById('alert-list');
  if (!host) return;
  const alerts = buildAlerts(data, history);
  host.innerHTML = alerts.length ? alerts.map(([title, text, tag]) => `<article class="alert-item"><span>${tag}</span><div><strong>${title}</strong><p>${text}</p></div></article>`).join('') : '<div class="alert-empty">No threshold-based signals detected in the available latest year-over-year observations.</div>';
}

function destroyCharts() { Object.values(dashboardState.charts).forEach(chart => chart?.destroy()); dashboardState.charts = {}; }

function renderChart(key, history) {
  const canvas = document.getElementById(`${key}-chart`);
  if (!canvas || typeof Chart === 'undefined') return;
  const indicator = GSCN_DATA.indicators.find(item => item.key === key);
  const rows = [...(history || [])].reverse().slice(-10);
  dashboardState.charts[key] = new Chart(canvas, {
    type: 'line', data: { labels: rows.map(item => item.year), datasets: [{ label: indicator.label, data: rows.map(item => item.value), tension: 0.25, borderWidth: 2, pointRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatValue(ctx.parsed.y, indicator.unit) } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: key !== 'growth' && key !== 'inflation', ticks: { callback: value => key === 'containers' ? Number(value).toLocaleString() : `${value}%` } } } }
  });
}

function renderCharts() {
  if (typeof Chart === 'undefined') { window.setTimeout(renderCharts, 250); return; }
  destroyCharts(); GSCN_DATA.indicators.forEach(indicator => renderChart(indicator.key, dashboardState.history[indicator.key]));
}

function renderComparison() {
  const tbody = document.getElementById('comparison-body'); if (!tbody) return;
  tbody.innerHTML = '';
  GSCN_DATA.countries.forEach(country => {
    const rowData = dashboardState.comparison[country.code], tr = document.createElement('tr');
    if (!rowData) { tr.innerHTML = `<td>${country.name}</td><td colspan="5">Data unavailable</td>`; tbody.appendChild(tr); return; }
    const risk = calculateRisk(rowData);
    tr.innerHTML = `<td>${country.name}</td><td>${formatValue(rowData.growth?.value, '%')}</td><td>${formatValue(rowData.inflation?.value, '%')}</td><td>${formatValue(rowData.trade?.value, '%')}</td><td>${formatValue(rowData.containers?.value, 'TEU')}</td><td class="${risk >= 67 ? 'risk-high' : risk >= 34 ? 'risk-medium' : 'risk-low'}">${risk === null ? '—' : `${risk}/100`}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadComparison(force = false) {
  const marketResults = await Promise.all(GSCN_DATA.countries.map(async country => {
    const entries = await Promise.allSettled(GSCN_DATA.indicators.map(indicator => fetchIndicator(country.code, indicator, 5, force)));
    const row = {}; GSCN_DATA.indicators.forEach((indicator, index) => row[indicator.key] = entries[index].status === 'fulfilled' ? latest(entries[index].value) : null);
    return [country.code, row];
  }));
  dashboardState.comparison = Object.fromEntries(marketResults); renderComparison();
}

async function loadDashboard(countryCode = dashboardState.country, force = false) {
  dashboardState.country = countryCode; dashboardState.loaded = false; dashboardState.source = force ? 'live' : 'live/cache';
  setStatus(force ? 'Refreshing verified indicators…' : 'Loading verified indicators…');
  const country = GSCN_DATA.countries.find(item => item.code === countryCode);
  document.querySelectorAll('[data-country-name]').forEach(el => { el.textContent = country?.name || countryCode; });
  const results = await Promise.allSettled(GSCN_DATA.indicators.map(indicator => fetchIndicator(countryCode, indicator, 20, force)));
  dashboardState.data = {}; dashboardState.history = {};
  results.forEach((entry, index) => { const indicator = GSCN_DATA.indicators[index]; const rows = entry.status === 'fulfilled' ? entry.value : []; dashboardState.history[indicator.key] = rows; dashboardState.data[indicator.key] = latest(rows); });
  GSCN_DATA.indicators.forEach(indicator => {
    const result = dashboardState.data[indicator.key];
    const valueEl = document.querySelector(`[data-indicator-value="${indicator.key}"]`), yearEl = document.querySelector(`[data-indicator-year="${indicator.key}"]`);
    if (valueEl) valueEl.textContent = formatValue(result?.value, indicator.unit);
    if (yearEl) yearEl.textContent = result?.year ? `Source year: ${result.year}` : 'No value returned';
  });
  const successful = Object.values(dashboardState.data).filter(Boolean).length;
  dashboardState.loaded = true; dashboardState.refreshedAt = new Date();
  setStatus(`${successful}/${GSCN_DATA.indicators.length} indicators loaded · World Bank`, successful ? 'ok' : 'error');
  updateRisk(dashboardState.data); renderAlerts(dashboardState.data, dashboardState.history); renderCharts();
  const refreshEl = document.getElementById('last-refreshed'); if (refreshEl) refreshEl.textContent = `Last refreshed: ${dashboardState.refreshedAt.toLocaleString()}`;
  loadComparison(force).catch(() => renderComparison());
}

function initDashboard() {
  const select = document.getElementById('country-select'); if (!select) return;
  GSCN_DATA.countries.forEach(country => { const option = document.createElement('option'); option.value = country.code; option.textContent = country.name; select.appendChild(option); });
  select.value = dashboardState.country; select.addEventListener('change', event => loadDashboard(event.target.value));
  const refresh = document.getElementById('refresh-data'); if (refresh) refresh.addEventListener('click', () => loadDashboard(dashboardState.country, true));
  loadDashboard();
}

document.addEventListener('DOMContentLoaded', initDashboard);

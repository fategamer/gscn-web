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
  ]
};

const dashboardState = {
  country: 'KEN',
  data: {},
  history: {},
  comparison: {},
  loaded: false,
  charts: {}
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

async function fetchIndicator(country, indicator, perPage = 20) {
  const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator.code}?format=json&per_page=${perPage}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`World Bank request failed: ${response.status}`);
  const json = await response.json();
  const rows = Array.isArray(json) ? json[1] : [];
  return rows?.filter(item => item.value !== null).map(item => ({ value: Number(item.value), year: item.date })) || [];
}

function latest(history) {
  return history?.[0] || null;
}

function calculateRisk(data) {
  const growth = Number(data.growth?.value);
  const inflation = Number(data.inflation?.value);
  const trade = Number(data.trade?.value);
  const containers = Number(data.containers?.value);
  if (![growth, inflation, trade, containers].every(Number.isFinite)) return null;

  // Transparent screening model. Inputs are normalized heuristically for cross-market comparison;
  // it is not a forecast or formal risk rating.
  const growthRisk = Math.max(0, Math.min(100, 50 - growth * 8));
  const inflationRisk = Math.max(0, Math.min(100, inflation * 5));
  const tradeRisk = Math.max(0, Math.min(100, 70 - trade));
  const logisticsRisk = containers > 0 ? Math.max(0, Math.min(100, 70 - Math.log10(containers) * 12)) : 50;
  const score = Math.round((growthRisk * 0.30) + (inflationRisk * 0.30) + (tradeRisk * 0.20) + (logisticsRisk * 0.20));
  return Math.max(0, Math.min(100, score));
}

function riskLabel(score) {
  if (score === null) return 'Awaiting data';
  if (score >= 67) return 'Higher screening exposure';
  if (score >= 34) return 'Moderate screening exposure';
  return 'Lower screening exposure';
}

function updateRisk(data) {
  const score = calculateRisk(data);
  const scoreEl = document.getElementById('risk-score');
  const fillEl = document.getElementById('risk-fill');
  const levelEl = document.getElementById('risk-level');
  const explainEl = document.getElementById('risk-explain');
  if (!scoreEl || !fillEl || !levelEl || !explainEl) return;
  if (score === null) {
    scoreEl.textContent = '—';
    fillEl.style.width = '0%';
    levelEl.textContent = 'Awaiting data';
    explainEl.textContent = 'The model requires all four verified indicators before calculating a screening score.';
    return;
  }
  scoreEl.textContent = score;
  fillEl.style.width = `${score}%`;
  levelEl.textContent = riskLabel(score);
  explainEl.textContent = 'Screening model weights GDP growth (30%), inflation (30%), trade intensity (20%) and container throughput (20%). Review the underlying indicators before acting.';
}

function destroyCharts() {
  Object.values(dashboardState.charts).forEach(chart => chart?.destroy());
  dashboardState.charts = {};
}

function renderChart(key, history) {
  const canvas = document.getElementById(`${key}-chart`);
  if (!canvas || typeof Chart === 'undefined') return;
  const indicator = GSCN_DATA.indicators.find(item => item.key === key);
  const rows = [...(history || [])].reverse().slice(-10);
  const labels = rows.map(item => item.year);
  const values = rows.map(item => item.value);
  dashboardState.charts[key] = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [{ label: indicator.label, data: values, tension: 0.25, borderWidth: 2, pointRadius: 3 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatValue(ctx.parsed.y, indicator.unit) } } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: key !== 'growth' && key !== 'inflation', ticks: { callback: value => key === 'containers' ? Number(value).toLocaleString() : `${value}%` } }
      }
    }
  });
}

function renderCharts() {
  if (typeof Chart === 'undefined') {
    window.setTimeout(renderCharts, 250);
    return;
  }
  destroyCharts();
  GSCN_DATA.indicators.forEach(indicator => renderChart(indicator.key, dashboardState.history[indicator.key]));
}

function renderComparison() {
  const tbody = document.getElementById('comparison-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  GSCN_DATA.countries.forEach(country => {
    const rowData = dashboardState.comparison[country.code];
    const tr = document.createElement('tr');
    if (!rowData) {
      tr.innerHTML = `<td>${country.name}</td><td colspan="5">Data unavailable</td>`;
      tbody.appendChild(tr);
      return;
    }
    const risk = calculateRisk(rowData);
    tr.innerHTML = `<td>${country.name}</td><td>${formatValue(rowData.growth?.value, '%')}</td><td>${formatValue(rowData.inflation?.value, '%')}</td><td>${formatValue(rowData.trade?.value, '%')}</td><td>${formatValue(rowData.containers?.value, 'TEU')}</td><td class="${risk >= 67 ? 'risk-high' : risk >= 34 ? 'risk-medium' : 'risk-low'}">${risk === null ? '—' : `${risk}/100`}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadComparison() {
  const marketResults = await Promise.all(GSCN_DATA.countries.map(async country => {
    const entries = await Promise.allSettled(GSCN_DATA.indicators.map(indicator => fetchIndicator(country.code, indicator, 5)));
    const row = {};
    GSCN_DATA.indicators.forEach((indicator, index) => {
      const result = entries[index];
      row[indicator.key] = result.status === 'fulfilled' ? latest(result.value) : null;
    });
    return [country.code, row];
  }));
  dashboardState.comparison = Object.fromEntries(marketResults);
  renderComparison();
}

async function loadDashboard(countryCode = dashboardState.country) {
  dashboardState.country = countryCode;
  dashboardState.loaded = false;
  setStatus('Loading verified indicators…');
  const country = GSCN_DATA.countries.find(item => item.code === countryCode);
  document.querySelectorAll('[data-country-name]').forEach(el => { el.textContent = country?.name || countryCode; });

  const results = await Promise.allSettled(GSCN_DATA.indicators.map(indicator => fetchIndicator(countryCode, indicator, 20)));
  dashboardState.data = {};
  dashboardState.history = {};

  results.forEach((entry, index) => {
    const indicator = GSCN_DATA.indicators[index];
    const rows = entry.status === 'fulfilled' ? entry.value : [];
    dashboardState.history[indicator.key] = rows;
    dashboardState.data[indicator.key] = latest(rows);
  });

  GSCN_DATA.indicators.forEach(indicator => {
    const result = dashboardState.data[indicator.key];
    const valueEl = document.querySelector(`[data-indicator-value="${indicator.key}"]`);
    const yearEl = document.querySelector(`[data-indicator-year="${indicator.key}"]`);
    if (valueEl) valueEl.textContent = formatValue(result?.value, indicator.unit);
    if (yearEl) yearEl.textContent = result?.year ? `Source year: ${result.year}` : 'No value returned';
  });

  const successful = Object.values(dashboardState.data).filter(Boolean).length;
  dashboardState.loaded = true;
  setStatus(`${successful}/${GSCN_DATA.indicators.length} indicators loaded · World Bank`, successful ? 'ok' : 'error');
  updateRisk(dashboardState.data);
  renderCharts();
  loadComparison().catch(() => renderComparison());
}

function initDashboard() {
  const select = document.getElementById('country-select');
  if (!select) return;
  GSCN_DATA.countries.forEach(country => {
    const option = document.createElement('option');
    option.value = country.code;
    option.textContent = country.name;
    select.appendChild(option);
  });
  select.value = dashboardState.country;
  select.addEventListener('change', event => loadDashboard(event.target.value));
  loadDashboard();
}

document.addEventListener('DOMContentLoaded', initDashboard);

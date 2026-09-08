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

const dashboardState = { country: 'KEN', data: {}, loaded: false };

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

async function fetchIndicator(country, indicator) {
  const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator.code}?format=json&per_page=20`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`World Bank request failed: ${response.status}`);
  const json = await response.json();
  const rows = Array.isArray(json) ? json[1] : [];
  const row = rows?.find(item => item.value !== null);
  return row ? { value: row.value, year: row.date } : null;
}

async function loadDashboard(countryCode = dashboardState.country) {
  dashboardState.country = countryCode;
  dashboardState.loaded = false;
  setStatus('Loading verified indicators…');
  const country = GSCN_DATA.countries.find(item => item.code === countryCode);
  document.querySelectorAll('[data-country-name]').forEach(el => { el.textContent = country?.name || countryCode; });

  const results = await Promise.allSettled(
    GSCN_DATA.indicators.map(async indicator => ({ indicator, result: await fetchIndicator(countryCode, indicator) }))
  );

  dashboardState.data = {};
  results.forEach((entry, index) => {
    const indicator = GSCN_DATA.indicators[index];
    dashboardState.data[indicator.key] = entry.status === 'fulfilled' ? entry.value.result : null;
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

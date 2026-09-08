(() => {
  const state = { records: [], query: '', category: 'All categories', market: 'All markets' };
  const search = document.getElementById('supplier-search');
  const category = document.getElementById('supplier-category');
  const market = document.getElementById('supplier-market');
  const results = document.getElementById('supplier-results');
  const count = document.getElementById('supplier-count');
  const status = document.getElementById('supplier-status');

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function matches(record) {
    const q = state.query.toLowerCase();
    const haystack = [record.supplier_name, record.legal_name, record.country, record.region, record.category, record.subcategory, record.industry].join(' ').toLowerCase();
    return (!q || haystack.includes(q)) &&
      (state.category === 'All categories' || record.category === state.category) &&
      (state.market === 'All markets' || record.market_scope === state.market);
  }

  function render() {
    const filtered = state.records.filter(matches);
    count.textContent = `${filtered.length} record${filtered.length === 1 ? '' : 's'}`;
    if (!filtered.length) {
      results.innerHTML = `<div class="empty"><strong>No matching verified supplier records.</strong><br>GSCN will only publish records supported by attributable evidence and a defined verification status.</div>`;
      return;
    }
    results.innerHTML = filtered.map(r => `
      <article class="supplier-result">
        <div><span class="si-pill">${esc(r.verification_status || 'Unverified')}</span><h3>${esc(r.supplier_name)}</h3><p>${esc(r.category || '—')} · ${esc(r.country || '—')}</p></div>
        <div><strong>Evidence</strong><span>${esc(r.source || 'Not provided')}</span></div>
        <div><strong>Updated</strong><span>${esc(r.last_verified_at || '—')}</span></div>
      </article>`).join('');
  }

  async function load() {
    status.textContent = 'Loading supplier intelligence…';
    try {
      const response = await fetch('suppliers.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.records = Array.isArray(payload.records) ? payload.records : [];
      status.textContent = `${state.records.length} verified record${state.records.length === 1 ? '' : 's'} available`;
      render();
    } catch (error) {
      state.records = [];
      status.textContent = 'Supplier data unavailable';
      results.innerHTML = '<div class="empty"><strong>Supplier data could not be loaded.</strong><br>Please try again later.</div>';
      console.error('GSCN supplier intelligence:', error);
    }
  }

  search.addEventListener('input', e => { state.query = e.target.value; render(); });
  category.addEventListener('change', e => { state.category = e.target.value; render(); });
  market.addEventListener('change', e => { state.market = e.target.value; render(); });
  load();
})();

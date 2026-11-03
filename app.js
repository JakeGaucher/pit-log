/* Pit Log v0.1 — personal vehicle maintenance tracker (PWA, on-device storage) */
(() => {
  'use strict';

  const APP_VERSION = '0.1.0';
  const STORE_KEY = 'pitlog.data';
  const UI_KEY = 'pitlog.ui';
  const SCHEMA = 1;

  // ---------- reference data ----------
  const MAKES = [
    'Acura','Alfa Romeo','Audi','BMW','Buick','Cadillac','Can-Am','Chevrolet','Chrysler','Dodge','Fiat','Ford',
    'Genesis','GMC','Harley-Davidson','Honda','Hyundai','Infiniti','Jaguar','Jeep','Kawasaki','Kia','Land Rover',
    'Lexus','Lincoln','Mazda','Mercedes-Benz','Mini','Mitsubishi','Nissan','Oldsmobile','Polaris','Pontiac',
    'Porsche','Ram','Saab','Saturn','Scion','Ski-Doo','Subaru','Suzuki','Tesla','Toyota','Volkswagen','Volvo','Yamaha'
  ];

  const SERVICE_TYPES = [
    { id: 'oil', label: 'Oil & filter change' },
    { id: 'tire-rotation', label: 'Tire rotation' },
    { id: 'tire-swap', label: 'Seasonal tire swap' },
    { id: 'tires-new', label: 'New tires' },
    { id: 'brakes', label: 'Brakes' },
    { id: 'air-filter', label: 'Engine air filter' },
    { id: 'cabin-filter', label: 'Cabin air filter' },
    { id: 'coolant', label: 'Coolant' },
    { id: 'trans-fluid', label: 'Transmission fluid' },
    { id: 'diff-fluid', label: 'Differential / transfer case' },
    { id: 'spark-plugs', label: 'Spark plugs' },
    { id: 'battery', label: 'Battery' },
    { id: 'wipers', label: 'Wipers' },
    { id: 'alignment', label: 'Alignment' },
    { id: 'inspection', label: 'Inspection' },
    { id: 'repair', label: 'Repair' },
    { id: 'other', label: 'Other' },
  ];
  const typeLabel = id => (SERVICE_TYPES.find(t => t.id === id) || { label: id }).label;

  const LIVERY = ['#e8392b', '#f28a1c', '#f6c431', '#19b5a5', '#2f6fe4', '#8e5cf0', '#f4efe2'];

  // ---------- storage ----------
  function blank() { return { schemaVersion: SCHEMA, vehicles: [], services: [] }; }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return blank();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.error('load failed', e);
      return blank();
    }
  }
  function migrate(d) {
    if (!d || typeof d !== 'object') return blank();
    d.vehicles = Array.isArray(d.vehicles) ? d.vehicles : [];
    d.services = Array.isArray(d.services) ? d.services : [];
    d.schemaVersion = SCHEMA;
    return d;
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
    } catch (e) {
      toast('Could not save — storage full?');
    }
  }

  let db = load();
  let ui = Object.assign({ view: 'home', garageId: null, q: '', fVehicle: 'all', fType: 'all' },
    (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } })());
  ui.q = ''; // don't persist search text between launches
  const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {} };

  // Ask iOS/Chrome not to evict our storage
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = n => (n == null || n === '' || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString('en-CA');
  const fmtMoney = n => (n == null || n === '' || isNaN(n)) ? '—' : '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const parseDate = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => isoDate(new Date());
  const fmtDate = s => { const d = parseDate(s); return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : '—'; };
  const addMonths = (s, m) => {
    const d = parseDate(s); if (!d) return null;
    const day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + Number(m));
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return isoDate(d);
  };
  const shortDate = s => { const d = parseDate(s); return d ? `${MONTHS[d.getMonth()]} ${d.getDate()} '${String(d.getFullYear()).slice(2)}` : '—'; };
  const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
  const vName = v => v.nickname || `${v.year} ${v.make} ${v.model}`;
  const vYMM = v => [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
  const pad2 = n => String(n).padStart(2, '0');
  const vehicle = id => db.vehicles.find(v => v.id === id);
  const servicesFor = id => db.services.filter(s => s.vehicleId === id);
  const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.odometer) || 0) - (Number(a.odometer) || 0);

  function currentOdo(v) {
    const logged = servicesFor(v.id).map(s => Number(s.odometer) || 0);
    return Math.max(Number(v.odometer) || 0, ...logged, 0);
  }

  // ---------- oil sticker logic ----------
  function oilStatus(v) {
    const last = servicesFor(v.id).filter(s => s.type === 'oil').sort(byDateDesc)[0];
    if (!last) return null;
    const intDist = Number(v.oilIntervalDist) || 8000;
    const intMo = Number(v.oilIntervalMonths) || 6;
    const dueOdo = (Number(last.odometer) || 0) + intDist;
    const dueDate = addMonths(last.date, intMo);
    const odoNow = currentOdo(v);
    const distUsed = last.odometer ? (odoNow - Number(last.odometer)) / intDist : 0;
    const totalDays = daysBetween(last.date, dueDate) || 1;
    const timeUsed = daysBetween(last.date, today()) / totalDays;
    const used = Math.max(distUsed, timeUsed);
    const kmLeft = dueOdo - odoNow;
    const daysLeft = daysBetween(today(), dueDate);
    let state = 'ok';
    if (used >= 1) state = 'overdue';
    else if (used >= 0.85) state = 'soon';
    return { last, dueOdo, dueDate, odoNow, used, kmLeft, daysLeft, state };
  }

  function stickerHTML(v) {
    const st = oilStatus(v);
    const unit = v.unit || 'km';
    const top = `
      <div class="sticker-top">
        <div class="checker"></div>
        <div class="label">Oil Service</div>
        <div class="stripes"><i></i><i></i><i></i></div>
      </div>`;
    if (!st) {
      return `<div class="sticker empty">${top}
        <div class="sticker-body">
          <div class="k">Next change due</div>
          <div class="empty-msg">No oil service logged yet.</div>
          <button class="btn sm" data-action="add-service" data-vehicle="${v.id}" data-type="oil">Log oil change</button>
        </div></div>`;
    }
    const stampTxt = { ok: 'Good', soon: 'Due soon', overdue: 'Overdue' }[st.state];
    const leftTxt = st.state === 'overdue'
      ? (st.kmLeft < 0 ? `${fmtNum(-st.kmLeft)} ${unit} over` : `${Math.abs(st.daysLeft)} days over`)
      : `${fmtNum(Math.max(st.kmLeft, 0))} ${unit} · ${Math.max(st.daysLeft, 0)} d left`;
    return `<div class="sticker ${st.state}">${top}
      <div class="sticker-body">
        <div class="k-row"><div class="k">Next change due</div><div class="stamp">${stampTxt}</div></div>
        <div class="due-row">
          <div class="due-val num">${fmtNum(st.dueOdo)}<small>${unit}</small></div>
          <div class="or">OR</div>
          <div class="due-val due-date num">${fmtDate(st.dueDate).replace(/,.*$/, '')}<small>${parseDate(st.dueDate).getFullYear()}</small></div>
        </div>
        <div class="meter"><span style="width:${Math.min(100, Math.max(3, st.used * 100)).toFixed(0)}%"></span></div>
        <div class="meta">
          <span>Last: ${fmtNum(st.last.odometer)} · ${shortDate(st.last.date)}</span>
          <span class="left">${leftTxt}</span>
        </div>
      </div></div>`;
  }

  // ---------- icons ----------
  const ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  };
  const stripes = '<div class="stripes"><i></i><i></i><i></i></div>';

  // ---------- views ----------
  function render() {
    $('#topdate').textContent = fmtDate(today()).replace(',', '');
    $$('.tab[data-nav]').forEach(t => t.classList.toggle('active', t.dataset.nav === ui.view));
    const el = $('#view');
    if (ui.view === 'garage') el.innerHTML = viewGarage();
    else if (ui.view === 'log') el.innerHTML = viewLog();
    else el.innerHTML = viewHome();
    const g = $('.gtab.active'); if (g) g.scrollIntoView({ inline: 'center', block: 'nearest' });
    saveUI();
  }

  function emptyGarage() {
    return `<div class="empty">
      ${stripes}
      <h3 class="racing">Empty garage</h3>
      <p>Roll your first vehicle in to start logging.</p>
      <button class="btn primary" data-action="add-vehicle">${ICON.plus} Add vehicle</button>
    </div>`;
  }

  function viewHome() {
    const vs = db.vehicles;
    let html = `<div class="view-title"><h1 class="racing">Pit <em>Wall</em></h1>
      <span class="eyebrow">${vs.length} ${vs.length === 1 ? 'vehicle' : 'vehicles'}</span></div>`;
    if (!vs.length) return html + emptyGarage();

    // Sort stickers: most urgent first
    const rank = v => { const s = oilStatus(v); return s ? s.used : -1; };
    const sorted = [...vs].sort((a, b) => rank(b) - rank(a));
    html += `<div class="rail">${sorted.map(v => `
      <div class="card car-card" style="--c:${v.color}">
        <div class="livery">${stripes}</div>
        <button class="head" data-action="open-garage" data-vehicle="${v.id}" style="all:unset;display:flex;align-items:center;gap:12px;margin-bottom:12px;cursor:pointer">
          <div class="roundel" style="--c:${v.color}">${esc(v.number)}</div>
          <div><div class="name racing">${esc(vName(v))}</div>
          <div class="sub">${esc(vYMM(v))} · <span class="num">${fmtNum(currentOdo(v))} ${v.unit}</span></div></div>
        </button>
        ${stickerHTML(v)}
      </div>`).join('')}</div>`;

    const recent = [...db.services].sort(byDateDesc).slice(0, 5);
    html += `<div class="section-head"><h2 class="racing">Recent stops</h2><div class="rule"></div>
      ${db.services.length > 5 ? '<button class="linkish" data-nav="log">See all</button>' : ''}</div>`;
    html += recent.length
      ? `<div class="list">${recent.map(s => entryHTML(s)).join('')}</div>`
      : `<p class="muted" style="margin:4px 4px">No services logged yet. Tap <b style="color:var(--red)">+</b> to log one.</p>`;
    return html;
  }

  function viewGarage() {
    const vs = db.vehicles;
    let html = `<div class="view-title"><h1 class="racing">The <em>Garage</em></h1></div>`;
    if (!vs.length) return html + emptyGarage();
    if (!vehicle(ui.garageId)) ui.garageId = vs[0].id;
    const v = vehicle(ui.garageId);

    html += `<div class="garage-tabs">${vs.map(x => `
      <button class="gtab ${x.id === v.id ? 'active' : ''}" data-action="garage-tab" data-vehicle="${x.id}">
        <span class="roundel sm" style="--c:${x.color}">${esc(x.number)}</span>${esc(x.nickname || x.model || x.make)}
      </button>`).join('')}
      <button class="gtab add" data-action="add-vehicle">+ Add</button>
    </div>`;

    const list = servicesFor(v.id).sort(byDateDesc);
    const spent = list.reduce((a, s) => a + (Number(s.cost) || 0), 0);
    html += `<div class="card hero" style="--c:${v.color}">
      <div class="livery-band"></div>
      <div class="row">
        <div class="roundel lg" style="--c:${v.color}">${esc(v.number)}</div>
        <div><h2 class="racing">${esc(v.nickname || v.model)}</h2><div class="ymm">${esc(vYMM(v))}</div></div>
        <button class="btn sm ghost edit" data-action="edit-vehicle" data-vehicle="${v.id}">${ICON.edit} Edit</button>
      </div>
      <div class="stats">
        <button class="stat tap" data-action="update-odo" data-vehicle="${v.id}"><div class="v">${fmtNum(currentOdo(v))}</div><div class="l">Odo ${v.unit} ${ICON.edit}</div></button>
        <div class="stat"><div class="v">${list.length}</div><div class="l">Services</div></div>
        <div class="stat"><div class="v">${spent ? fmtMoney(spent) : '—'}</div><div class="l">Logged spend</div></div>
      </div>
    </div>`;

    html += `<div class="section-head"><h2 class="racing">Oil sticker</h2><div class="rule"></div>
      <span class="eyebrow">every ${fmtNum(v.oilIntervalDist)} ${v.unit} / ${v.oilIntervalMonths} mo</span></div>
      ${stickerHTML(v)}`;

    html += `<div class="section-head"><h2 class="racing">Service history</h2><div class="rule"></div>
      <button class="btn sm primary" data-action="add-service" data-vehicle="${v.id}">${ICON.plus} Log</button></div>`;
    html += list.length
      ? `<div class="list">${groupByMonth(list, s => entryHTML(s, { hideVehicle: true }))}</div>`
      : `<p class="muted" style="margin:4px">Nothing logged for this vehicle yet.</p>`;
    return html;
  }

  function filteredServices() {
    const q = ui.q.trim().toLowerCase();
    return db.services.filter(s => {
      if (ui.fVehicle !== 'all' && s.vehicleId !== ui.fVehicle) return false;
      if (ui.fType !== 'all' && s.type !== ui.fType) return false;
      if (q) {
        const hay = [
          ...(s.parts || []).flatMap(p => [p.name, p.partNo]),
          s.notes, s.shop, typeLabel(s.type)
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort(byDateDesc);
  }

  function viewLog() {
    let html = `<div class="view-title"><h1 class="racing">Service <em>Log</em></h1>
      <span class="eyebrow">${db.services.length} total</span></div>`;
    if (!db.vehicles.length) return html + emptyGarage();
    if (ui.fVehicle !== 'all' && !vehicle(ui.fVehicle)) ui.fVehicle = 'all';

    html += `<div class="search">${ICON.search}
      <input type="search" id="log-q" placeholder="Search parts, part #, notes…" value="${esc(ui.q)}" autocomplete="off"></div>
      <div class="chips">
        <button class="chip ${ui.fVehicle === 'all' ? 'active' : ''}" data-action="f-vehicle" data-vehicle="all">All</button>
        ${db.vehicles.map(v => `<button class="chip ${ui.fVehicle === v.id ? 'active' : ''}" data-action="f-vehicle" data-vehicle="${v.id}" style="--c:${v.color}">
          <span class="dot"></span>${esc(v.nickname || v.model)}</button>`).join('')}
      </div>
      <div class="filter-row">
        <select id="log-type">
          <option value="all">All service types</option>
          ${SERVICE_TYPES.map(t => `<option value="${t.id}" ${ui.fType === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
      </div>
      <div id="log-results">${logResults()}</div>`;
    return html;
  }

  function logResults() {
    const list = filteredServices();
    const q = ui.q.trim();
    return `<div class="result-count">${list.length} ${list.length === 1 ? 'entry' : 'entries'}</div>` +
      (list.length ? `<div class="list">${groupByMonth(list, s => entryHTML(s, { highlight: q }))}</div>`
                   : `<p class="muted" style="margin:4px">No matches.</p>`);
  }

  function groupByMonth(list, fn) {
    let out = '', cur = '';
    for (const s of list) {
      const d = parseDate(s.date);
      const key = d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'Undated';
      if (key !== cur) { out += `<div class="month-head">${key}</div>`; cur = key; }
      out += fn(s);
    }
    return out;
  }

  function hl(text, q) {
    const t = esc(text);
    if (!q) return t;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[&<>"']/g, c => esc(c)), 'ig');
    return t.replace(re, m => `<mark>${m}</mark>`);
  }

  function entryHTML(s, opts = {}) {
    const v = vehicle(s.vehicleId) || { color: '#555', number: '?', unit: 'km' };
    const d = parseDate(s.date);
    const parts = (s.parts || []).filter(p => p.name || p.partNo);
    const partsTxt = parts.map(p => hl(p.name || p.partNo, opts.highlight) +
      (p.partNo && p.name ? ` <span class="muted">${hl(p.partNo, opts.highlight)}</span>` : '')).join(' · ');
    return `<button class="entry" data-action="view-service" data-id="${s.id}" style="--c:${v.color}">
      <div class="date"><div class="d num">${d ? pad2(d.getDate()) : '--'}</div><div class="m">${d ? MONTHS[d.getMonth()] : ''}</div></div>
      <div>
        <div class="title">${esc(typeLabel(s.type))}</div>
        <div class="info">${opts.hideVehicle ? '' : esc(vName(v)) + ' · '}${esc(s.shop || 'DIY')}${s.cost ? ' · ' + fmtMoney(s.cost) : ''}</div>
        ${partsTxt ? `<div class="parts">${partsTxt}</div>` : ''}
      </div>
      <div class="odo">${fmtNum(s.odometer)}<br><span style="font-size:10px">${v.unit}</span></div>
    </button>`;
  }

  // ---------- sheets ----------
  function openSheet(title, body, foot, onMount) {
    $('#sheet-root').innerHTML = `<div class="sheet-wrap" data-action="sheet-bg">
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-head">${stripes}<h3 class="racing">${title}</h3>
          <button class="icon-btn" data-action="close-sheet" aria-label="Close">${ICON.close}</button></div>
        <div class="sheet-body">${body}</div>
        ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
      </div></div>`;
    document.body.style.overflow = 'hidden';
    if (onMount) onMount($('#sheet-root .sheet'));
  }
  function closeSheet() { $('#sheet-root').innerHTML = ''; document.body.style.overflow = ''; }

  // --- vehicle form ---
  function vehicleForm(v) {
    const isNew = !v;
    const nextNum = pad2((db.vehicles.reduce((m, x) => Math.max(m, parseInt(x.number) || 0), 0) + 1) % 100 || 1);
    v = v || { year: '', make: '', model: '', trim: '', nickname: '', unit: 'km', odometer: '',
               oilIntervalDist: 8000, oilIntervalMonths: 6, number: nextNum, color: LIVERY[db.vehicles.length % LIVERY.length] };
    const yNow = new Date().getFullYear() + 1;
    const years = Array.from({ length: yNow - 1959 }, (_, i) => yNow - i);
    const makeKnown = !v.make || MAKES.includes(v.make);
    const body = `
      <div class="grid2">
        <div class="field"><label>Year</label>
          <select id="vf-year"><option value="">Year</option>${years.map(y => `<option ${String(v.year) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div class="field"><label>Make</label>
          <select id="vf-make"><option value="">Make</option>
            ${MAKES.map(m => `<option ${v.make === m ? 'selected' : ''}>${m}</option>`).join('')}
            <option value="__other" ${!makeKnown ? 'selected' : ''}>Other…</option></select></div>
      </div>
      <div class="field" id="vf-make-other-wrap" ${makeKnown ? 'hidden' : ''}><label>Make (type it)</label>
        <input type="text" id="vf-make-other" value="${!makeKnown ? esc(v.make) : ''}" autocapitalize="words"></div>
      <div class="field"><label>Model</label>
        <select id="vf-model" ${v.model ? '' : 'disabled'}>${v.model ? `<option selected>${esc(v.model)}</option>` : '<option value="">Pick year &amp; make first</option>'}</select>
        <input type="text" id="vf-model-text" placeholder="Type model" value="${esc(v.model)}" hidden autocapitalize="words">
        <div class="hint" id="vf-model-hint"></div>
      </div>
      <div class="field"><label>Trim / engine <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
        <input type="text" id="vf-trim" value="${esc(v.trim)}" placeholder="e.g. SR5 4.0L V6"></div>
      <div class="field"><label>Nickname <span style="text-transform:none;letter-spacing:0">(optional)</span></label>
        <input type="text" id="vf-nick" value="${esc(v.nickname)}" placeholder="e.g. The Tacoma"></div>

      <div class="grid2">
        <div class="field"><label>Odometer</label><input type="number" inputmode="numeric" id="vf-odo" value="${esc(v.odometer)}"></div>
        <div class="field"><label>Units</label>
          <div class="seg" id="vf-unit"><button type="button" data-u="km" class="${v.unit === 'km' ? 'active' : ''}">km</button><button type="button" data-u="mi" class="${v.unit === 'mi' ? 'active' : ''}">mi</button></div></div>
      </div>
      <div class="label" style="margin-bottom:6px">Oil change interval</div>
      <div class="grid2">
        <div class="field"><input type="number" inputmode="numeric" id="vf-int-d" value="${esc(v.oilIntervalDist)}"><span class="hint">distance</span></div>
        <div class="field"><input type="number" inputmode="numeric" id="vf-int-m" value="${esc(v.oilIntervalMonths)}"><span class="hint">months</span></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Race number</label><input type="text" id="vf-num" maxlength="3" value="${esc(v.number)}" inputmode="numeric"></div>
        <div class="field"><label>Livery</label>
          <div class="swatches" id="vf-color">${LIVERY.map(c => `<button type="button" class="swatch ${v.color === c ? 'active' : ''}" data-c="${c}" style="--c:${c}"></button>`).join('')}</div></div>
      </div>
      ${isNew ? '' : `<button class="btn danger block" data-action="delete-vehicle" data-vehicle="${v.id}" style="margin-top:8px">Delete vehicle &amp; its history</button>`}
    `;
    const foot = `<button class="btn ghost" data-action="close-sheet">Cancel</button>
      <button class="btn primary" data-action="save-vehicle" data-vehicle="${isNew ? '' : v.id}">${isNew ? 'Add to garage' : 'Save'}</button>`;

    openSheet(isNew ? 'Add vehicle' : 'Edit vehicle', body, foot, sheet => {
      const year = $('#vf-year', sheet), make = $('#vf-make', sheet), makeOther = $('#vf-make-other', sheet);
      const modelSel = $('#vf-model', sheet), modelTxt = $('#vf-model-text', sheet), hint = $('#vf-model-hint', sheet);
      const curMake = () => make.value === '__other' ? makeOther.value.trim() : make.value;
      let reqId = 0;

      const manualModel = (msg) => {
        modelSel.hidden = true; modelTxt.hidden = false;
        hint.innerHTML = msg || '';
      };
      async function loadModels() {
        const y = year.value, m = curMake();
        if (!y || !m) { modelSel.disabled = true; modelSel.innerHTML = '<option value="">Pick year &amp; make first</option>'; return; }
        if (make.value === '__other') { manualModel(''); return; }
        modelSel.hidden = false; modelTxt.hidden = true; modelSel.disabled = true;
        modelSel.innerHTML = '<option>Loading models…</option>'; hint.textContent = '';
        const my = ++reqId;
        try {
          const models = await fetchModels(m, y);
          if (my !== reqId) return;
          if (!models.length) { manualModel('No models found for that year. Type it in.'); return; }
          const prev = modelTxt.value;
          modelSel.innerHTML = '<option value="">Model</option>' +
            models.map(x => `<option ${x === prev ? 'selected' : ''}>${esc(x)}</option>`).join('') +
            '<option value="__other">Not listed — type it…</option>';
          modelSel.disabled = false;
        } catch (e) {
          if (my !== reqId) return;
          manualModel('<span class="warn">Offline or lookup failed — type the model.</span>');
        }
      }
      year.addEventListener('change', loadModels);
      make.addEventListener('change', () => {
        $('#vf-make-other-wrap', sheet).hidden = make.value !== '__other';
        loadModels();
      });
      makeOther.addEventListener('change', loadModels);
      modelSel.addEventListener('change', () => {
        if (modelSel.value === '__other') { manualModel(`<button class="linkish" type="button" id="vf-back">Back to list</button>`); modelTxt.value = ''; modelTxt.focus(); }
        else modelTxt.value = modelSel.value;
      });
      sheet.addEventListener('click', e => {
        if (e.target.id === 'vf-back') { modelSel.hidden = false; modelTxt.hidden = true; modelSel.value = ''; hint.textContent = ''; }
        const u = e.target.closest('#vf-unit button');
        if (u) { $$('#vf-unit button', sheet).forEach(b => b.classList.toggle('active', b === u));
          const d = $('#vf-int-d', sheet);
          if (u.dataset.u === 'mi' && d.value === '8000') d.value = 5000;
          if (u.dataset.u === 'km' && d.value === '5000') d.value = 8000; }
        const sw = e.target.closest('.swatch');
        if (sw) $$('.swatch', sheet).forEach(b => b.classList.toggle('active', b === sw));
      });
      // Editing: populate full model list in the background so it can be changed
      if (!isNew && v.make && v.year) { modelTxt.value = v.model; loadModels(); }
    });
  }

  async function fetchModels(make, year) {
    const key = `pitlog.vpic.${make}.${year}`;
    try { const c = JSON.parse(localStorage.getItem(key)); if (c && c.length) return c; } catch {}
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    const res = await fetch(url, { signal: ctl.signal }); clearTimeout(t);
    if (!res.ok) throw new Error('vpic ' + res.status);
    const json = await res.json();
    const models = [...new Set((json.Results || []).map(r => (r.Model_Name || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    try { localStorage.setItem(key, JSON.stringify(models)); } catch {}
    return models;
  }

  function saveVehicle(id) {
    const s = $('#sheet-root .sheet');
    const make = $('#vf-make', s).value === '__other' ? $('#vf-make-other', s).value.trim() : $('#vf-make', s).value;
    const model = !$('#vf-model-text', s).hidden ? $('#vf-model-text', s).value.trim()
                : ($('#vf-model', s).value || $('#vf-model-text', s).value.trim());
    const data = {
      year: $('#vf-year', s).value, make, model: model === '__other' ? '' : model,
      trim: $('#vf-trim', s).value.trim(), nickname: $('#vf-nick', s).value.trim(),
      odometer: Number($('#vf-odo', s).value) || 0,
      unit: ($('#vf-unit button.active', s) || {}).dataset?.u || 'km',
      oilIntervalDist: Number($('#vf-int-d', s).value) || 8000,
      oilIntervalMonths: Number($('#vf-int-m', s).value) || 6,
      number: $('#vf-num', s).value.trim() || '00',
      color: ($('.swatch.active', s) || {}).dataset?.c || LIVERY[0],
    };
    if (!data.year || !data.make || !data.model) { toast('Year, make and model are required'); return; }
    if (id) Object.assign(vehicle(id), data);
    else { const v = { id: uid(), createdAt: new Date().toISOString(), ...data }; db.vehicles.push(v); ui.garageId = v.id; }
    save(); closeSheet();
    if (!id) ui.view = 'garage';
    render(); toast(id ? 'Vehicle updated' : 'Rolled into the garage');
  }

  // --- service form ---
  function serviceForm(s, preset = {}) {
    if (!db.vehicles.length) { toast('Add a vehicle first'); vehicleForm(); return; }
    const isNew = !s;
    const vid = s?.vehicleId || preset.vehicleId || (ui.view === 'garage' && ui.garageId) || (ui.fVehicle !== 'all' && ui.fVehicle) || db.vehicles[0].id;
    s = s || { vehicleId: vid, date: today(), odometer: '', type: preset.type || 'oil', parts: [{ name: '', partNo: '', qty: 1 }], cost: '', shop: '', notes: '' };
    const partRow = p => `<div class="part-row">
        <input type="text" class="p-name" placeholder="Part" value="${esc(p.name)}">
        <input type="text" class="p-no" placeholder="Part #" value="${esc(p.partNo)}" autocapitalize="characters">
        <input type="number" class="p-qty" inputmode="decimal" placeholder="Qty" value="${esc(p.qty)}">
        <button type="button" class="rm" data-action="rm-part" aria-label="Remove">×</button></div>`;
    const body = `
      <div class="field"><label>Vehicle</label>
        <select id="sf-vehicle">${db.vehicles.map(v => `<option value="${v.id}" ${v.id === s.vehicleId ? 'selected' : ''}>#${esc(v.number)} · ${esc(vName(v))}</option>`).join('')}</select></div>
      <div class="field"><label>Service type</label>
        <select id="sf-type">${SERVICE_TYPES.map(t => `<option value="${t.id}" ${t.id === s.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
      <div class="grid2">
        <div class="field"><label>Date</label><input type="date" id="sf-date" value="${esc(s.date)}"></div>
        <div class="field"><label>Odometer</label>
          <input type="number" inputmode="numeric" id="sf-odo" value="${esc(s.odometer)}"><span class="hint" id="sf-unit"></span></div>
      </div>
      <div class="field"><label>Parts</label>
        <div id="sf-parts">${(s.parts?.length ? s.parts : [{ name: '', partNo: '', qty: 1 }]).map(partRow).join('')}</div>
        <button type="button" class="btn sm ghost" data-action="add-part" style="align-self:flex-start">${ICON.plus} Add part</button></div>
      <div class="grid2">
        <div class="field"><label>Cost</label><input type="number" inputmode="decimal" id="sf-cost" value="${esc(s.cost)}" placeholder="$"></div>
        <div class="field"><label>Shop</label><input type="text" id="sf-shop" value="${esc(s.shop)}" placeholder="DIY"></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="sf-notes" placeholder="Oil spec, torque, observations…">${esc(s.notes)}</textarea></div>
      ${isNew ? '' : `<button class="btn danger block" data-action="delete-service" data-id="${s.id}">Delete entry</button>`}
    `;
    const foot = `<button class="btn ghost" data-action="close-sheet">Cancel</button>
      <button class="btn primary" data-action="save-service" data-id="${isNew ? '' : s.id}">${isNew ? 'Log it' : 'Save'}</button>`;
    openSheet(isNew ? 'Log service' : 'Edit service', body, foot, sheet => {
      const syncUnit = () => {
        const v = vehicle($('#sf-vehicle', sheet).value);
        $('#sf-unit', sheet).textContent = `${v.unit} · last known ${fmtNum(currentOdo(v))}`;
      };
      $('#sf-vehicle', sheet).addEventListener('change', syncUnit); syncUnit();
      sheet.addEventListener('click', e => {
        if (e.target.closest('[data-action="add-part"]')) {
          $('#sf-parts', sheet).insertAdjacentHTML('beforeend', partRow({ name: '', partNo: '', qty: 1 }));
          $('#sf-parts .part-row:last-child .p-name', sheet).focus();
        }
        if (e.target.closest('[data-action="rm-part"]')) {
          const rows = $$('#sf-parts .part-row', sheet);
          const row = e.target.closest('.part-row');
          if (rows.length > 1) row.remove(); else $$('input', row).forEach(i => i.value = i.classList.contains('p-qty') ? 1 : '');
        }
      });
    });
  }

  function saveService(id) {
    const s = $('#sheet-root .sheet');
    const parts = $$('#sf-parts .part-row', s).map(r => ({
      name: $('.p-name', r).value.trim(), partNo: $('.p-no', r).value.trim(), qty: Number($('.p-qty', r).value) || 1
    })).filter(p => p.name || p.partNo);
    const data = {
      vehicleId: $('#sf-vehicle', s).value, type: $('#sf-type', s).value, date: $('#sf-date', s).value,
      odometer: $('#sf-odo', s).value === '' ? '' : Number($('#sf-odo', s).value),
      parts, cost: $('#sf-cost', s).value === '' ? '' : Number($('#sf-cost', s).value),
      shop: $('#sf-shop', s).value.trim(), notes: $('#sf-notes', s).value.trim(),
    };
    if (!data.date) { toast('Date is required'); return; }
    if (data.type === 'oil' && data.odometer === '') { toast('Odometer is needed for the oil sticker'); return; }
    if (id) Object.assign(db.services.find(x => x.id === id), data);
    else db.services.push({ id: uid(), createdAt: new Date().toISOString(), ...data });
    save(); closeSheet(); render(); toast(id ? 'Entry updated' : 'Logged ✓');
  }

  function serviceDetail(id) {
    const s = db.services.find(x => x.id === id); if (!s) return;
    const v = vehicle(s.vehicleId) || { unit: 'km', color: '#555', number: '?' };
    const parts = (s.parts || []);
    const body = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div class="roundel" style="--c:${v.color}">${esc(v.number)}</div>
        <div><div class="racing" style="font-size:17px">${esc(typeLabel(s.type))}</div><div class="muted" style="font-size:13px">${esc(vName(v))}</div></div>
      </div>
      <div class="card" style="padding:4px 14px;margin-bottom:14px">
        <div class="detail-row"><span class="l">Date</span><span class="v">${fmtDate(s.date)}</span></div>
        <div class="detail-row"><span class="l">Odometer</span><span class="v num">${fmtNum(s.odometer)} ${v.unit}</span></div>
        <div class="detail-row"><span class="l">Shop</span><span class="v">${esc(s.shop || 'DIY')}</span></div>
        <div class="detail-row"><span class="l">Cost</span><span class="v">${fmtMoney(s.cost)}</span></div>
      </div>
      ${parts.length ? `<div class="label" style="margin-bottom:4px">Parts</div>
        <table class="parts-table">${parts.map(p => `<tr><td>${esc(p.name)}</td><td class="pn">${esc(p.partNo)}</td><td class="q">×${esc(p.qty)}</td></tr>`).join('')}</table>` : ''}
      ${s.notes ? `<div class="label" style="margin:16px 0 4px">Notes</div><div style="white-space:pre-wrap">${esc(s.notes)}</div>` : ''}
    `;
    openSheet('Pit stop', body, `<button class="btn ghost" data-action="close-sheet">Close</button>
      <button class="btn primary" data-action="edit-service" data-id="${s.id}">${ICON.edit} Edit</button>`);
  }

  function odoForm(id) {
    const v = vehicle(id);
    openSheet('Update odometer', `
      <div class="field"><label>Current reading (${v.unit})</label>
        <input type="number" inputmode="numeric" id="of-odo" value="${currentOdo(v)}"></div>
      <p class="hint">Keeps the oil sticker accurate between services.</p>`,
      `<button class="btn ghost" data-action="close-sheet">Cancel</button>
       <button class="btn primary" data-action="save-odo" data-vehicle="${id}">Save</button>`,
      s => { const i = $('#of-odo', s); setTimeout(() => { i.focus(); i.select(); }, 250); });
  }

  function settingsSheet() {
    const size = new Blob([localStorage.getItem(STORE_KEY) || '']).size;
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    openSheet('Setup', `
      <div class="settings-group">
        <div class="label" style="margin-bottom:8px">Backup</div>
        <button class="btn block" data-action="export">Export backup (.json)</button>
        <button class="btn ghost block" data-action="import">Import backup…</button>
        <p class="hint">Your data lives only on this phone. Export now and then and save it to Files or iCloud Drive.</p>
      </div>
      ${standalone ? '' : `<div class="settings-group">
        <div class="label" style="margin-bottom:8px">Install</div>
        <p class="hint warn" style="margin-top:0">Running in the browser. In Safari tap Share → <b>Add to Home Screen</b> so it opens like an app and iOS keeps your data.</p>
      </div>`}
      <div class="settings-group">
        <div class="label" style="margin-bottom:8px">Danger zone</div>
        <button class="btn danger block" data-action="wipe">Erase all data</button>
      </div>
      <p class="hint">Pit Log v${APP_VERSION} · ${db.vehicles.length} vehicles · ${db.services.length} entries · ${(size / 1024).toFixed(1)} KB</p>
    `, '');
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const name = `pitlog-backup-${today()}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  }

  function importData(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = migrate(JSON.parse(r.result));
        if (!confirm(`Replace current data with backup (${d.vehicles.length} vehicles, ${d.services.length} entries)?`)) return;
        db = d; save(); closeSheet(); render(); toast('Backup restored');
      } catch { toast('That file isn’t a Pit Log backup'); }
    };
    r.readAsText(file);
  }

  // ---------- toast ----------
  let toastT;
  function toast(msg) {
    $$('.toast').forEach(t => t.remove());
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 2200);
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { ui.view = nav.dataset.nav; closeSheet(); render(); window.scrollTo(0, 0); return; }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action, vid = a.dataset.vehicle, id = a.dataset.id;
    switch (act) {
      case 'sheet-bg': if (e.target === a) closeSheet(); break;
      case 'close-sheet': closeSheet(); break;
      case 'settings': settingsSheet(); break;
      case 'add-vehicle': vehicleForm(); break;
      case 'edit-vehicle': vehicleForm(vehicle(vid)); break;
      case 'save-vehicle': saveVehicle(vid); break;
      case 'delete-vehicle': {
        const v = vehicle(vid);
        if (confirm(`Delete ${vName(v)} and all ${servicesFor(vid).length} of its entries?`)) {
          db.vehicles = db.vehicles.filter(x => x.id !== vid);
          db.services = db.services.filter(x => x.vehicleId !== vid);
          save(); closeSheet(); render(); toast('Vehicle removed');
        }
        break;
      }
      case 'garage-tab': ui.garageId = vid; render(); break;
      case 'open-garage': ui.garageId = vid; ui.view = 'garage'; render(); window.scrollTo(0, 0); break;
      case 'update-odo': odoForm(vid); break;
      case 'save-odo': {
        const v = vehicle(vid); v.odometer = Number($('#of-odo').value) || v.odometer;
        save(); closeSheet(); render(); toast('Odometer updated'); break;
      }
      case 'add-service': serviceForm(null, { vehicleId: vid, type: a.dataset.type }); break;
      case 'view-service': serviceDetail(id); break;
      case 'edit-service': serviceForm(db.services.find(x => x.id === id)); break;
      case 'save-service': saveService(id); break;
      case 'delete-service':
        if (confirm('Delete this entry?')) { db.services = db.services.filter(x => x.id !== id); save(); closeSheet(); render(); toast('Entry deleted'); }
        break;
      case 'f-vehicle': ui.fVehicle = vid; render(); break;
      case 'export': exportData(); break;
      case 'import': $('#import-file').click(); break;
      case 'wipe':
        if (confirm('Erase ALL vehicles and service history from this phone?') && confirm('Really? Export a backup first if unsure.')) {
          db = blank(); save(); closeSheet(); render(); toast('All data erased');
        }
        break;
    }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'log-q') { ui.q = e.target.value; $('#log-results').innerHTML = logResults(); }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'log-type') { ui.fType = e.target.value; $('#log-results').innerHTML = logResults(); saveUI(); }
    if (e.target.id === 'import-file' && e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; }
  });

  // ---------- boot ----------
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW failed', err));
  }
  window.__pitlog = { get db() { return db; } }; // debug handle
})();

/* Pit Log v0.2 — personal vehicle maintenance tracker (PWA, on-device storage). Data logic lives in core.js. */
(() => {
  'use strict';

  const APP_VERSION = '0.2.0';
  const C = window.PitCore;
  const UI_KEY = 'pitlog.ui';

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
    { id: 'upgrade', label: 'Upgrade / mod' },
    { id: 'repair', label: 'Repair' },
    { id: 'other', label: 'Other' },
  ];
  const typeLabel = id => (SERVICE_TYPES.find(t => t.id === id) || { label: id }).label;
  const LIVERY = ['#e8392b', '#f28a1c', '#f6c431', '#19b5a5', '#2f6fe4', '#8e5cf0', '#f4efe2'];

  // F-04: features that could be Pro. All open by default; the dev panel can gate them to try it out.
  const PRO_CANDIDATES = [
    { id: 'vehicleLimit', label: 'More than 2 vehicles' },
    { id: 'buildSheet', label: 'Build sheet' },
    { id: 'mileage', label: 'Mileage log' },
    { id: 'ownershipPdf', label: 'Ownership record (PDF)' },
  ];

  // ---------- storage (R-01) ----------
  let loadError = null;
  function load() {
    try {
      const v2 = localStorage.getItem(C.KEY_V2);
      if (v2) return C.migrate(JSON.parse(v2));
      const v1 = localStorage.getItem(C.KEY_V1);
      if (v1) {
        const d = C.migrate(JSON.parse(v1));
        localStorage.setItem(C.KEY_V2, JSON.stringify(d)); // v1 key is left untouched as a rollback copy
        return d;
      }
      return C.blank();
    } catch (e) {
      console.error('load failed', e);
      loadError = e.message || String(e);
      return C.blank();
    }
  }
  function save() {
    if (loadError) { toast('Not saved — stored data could not be read'); return; }
    try { localStorage.setItem(C.KEY_V2, JSON.stringify(db)); }
    catch (e) { toast('Could not save — storage full?'); }
  }

  let db = load();
  let ui = Object.assign({ view: 'home', garageId: null, q: '', fVehicle: 'all', fType: 'all', vTab: 'build', mMode: 'month' },
    (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } })());
  ui.q = '';
  const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {} };

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // F-06: test date lives in memory only — cleared on reload, never exported.
  let fakeToday = null;

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = n => (n == null || n === '' || isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString('en-CA');
  const fmtMoney = n => (n == null || n === '' || isNaN(n)) ? '—' : '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const { parseDate, isoDate, addMonths, daysBetween } = C;
  const realToday = () => isoDate(new Date());
  const today = () => fakeToday || realToday();
  const fmtDate = s => { const d = parseDate(s); return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : '—'; };
  const shortDate = s => { const d = parseDate(s); return d ? `${MONTHS[d.getMonth()]} ${d.getDate()} '${String(d.getFullYear()).slice(2)}` : '—'; };
  const vName = v => v.nickname || `${v.year} ${v.make} ${v.model}`;
  const vShort = v => v.nickname || v.model || v.make;
  const vYMM = v => [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
  const pad2 = n => String(n).padStart(2, '0');
  const vehicle = id => db.vehicles.find(v => v.id === id);
  const servicesFor = id => C.servicesFor(db, id);
  const currentOdo = v => C.currentOdo(db, v);
  const oilStatus = v => C.oilStatus(db, v, today());
  const entryTitle = s => C.entryTitle(s, typeLabel);
  const ago = iso => {
    if (!iso) return null;
    const d = daysBetween(iso.slice(0, 10), today());
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  };

  // ---------- F-04 entitlement ----------
  const isPro = () => db.settings.entitlement === 'pro';
  const gated = f => !!(db.settings.proGates && db.settings.proGates[f]);
  const canUse = f => !gated(f) || isPro();
  const proBadge = '<span class="pro-badge">PRO</span>';
  function requirePro(f) {
    if (canUse(f)) return true;
    const label = (PRO_CANDIDATES.find(x => x.id === f) || {}).label || 'This feature';
    openSheet('Pit Log Pro', `
      <div class="upsell">${stripes}<h3 class="racing">${esc(label)} is a ${proBadge} feature</h3>
      <p class="muted">Pro isn't for sale yet; this screen is part of the free-vs-paid test. Switch to Pro in the dev panel to unlock it.</p></div>`,
      `<button class="btn ghost" data-action="close-sheet">OK</button>`);
    return false;
  }

  // ---------- oil sticker ----------
  function stickerHTML(v) {
    const st = oilStatus(v);
    const unit = v.unit || 'km';
    const top = `<div class="sticker-top"><div class="checker"></div><div class="label">Oil Service</div>${stripes}</div>`;
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
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
  };
  const stripes = '<div class="stripes"><i></i><i></i><i></i></div>';

  // ---------- render ----------
  function render() {
    $('#topdate').textContent = fmtDate(today()).replace(',', '');
    $('#pro-flag').hidden = !isPro();
    $('#fake-banner').hidden = !fakeToday;
    if (fakeToday) $('#fake-banner-date').textContent = fmtDate(fakeToday);
    const navView = ui.view === 'vehicle' ? 'garage' : ui.view;
    $$('.tab[data-nav]').forEach(t => t.classList.toggle('active', t.dataset.nav === navView));
    const el = $('#view');
    if (loadError) el.innerHTML = viewLoadError();
    else if (ui.view === 'garage') el.innerHTML = viewGarage();
    else if (ui.view === 'vehicle') el.innerHTML = viewVehicle();
    else if (ui.view === 'log') el.innerHTML = viewLog();
    else el.innerHTML = viewHome();
    const g = $('.gtab.active'); if (g) g.scrollIntoView({ inline: 'center', block: 'nearest' });
    saveUI();
  }

  function viewLoadError() {
    return `<div class="empty">${stripes}<h3 class="racing">Can't read your data</h3>
      <p>${esc(loadError)}</p><p>Nothing has been changed or saved. If this is an old copy of the app, update it.</p></div>`;
  }

  function emptyGarage() {
    return `<div class="empty">${stripes}
      <h3 class="racing">Empty garage</h3>
      <p>Roll your first vehicle in to start logging.</p>
      <button class="btn primary" data-action="add-vehicle">${ICON.plus} Add vehicle</button></div>`;
  }

  // F-03: backup button in the Pit Wall header
  function backupButton() {
    const last = db.settings.lastBackupAt;
    const days = last ? daysBetween(last.slice(0, 10), today()) : null;
    const stale = days == null || days > 14;
    return `<button class="backup-btn ${stale ? 'stale' : ''}" data-action="export">
      ${ICON.save}<span><b>Back up</b><small>${last ? 'Last: ' + ago(last) : 'Never backed up'}</small></span></button>`;
  }

  function viewHome() {
    const vs = db.vehicles;
    let html = `<div class="view-title"><h1 class="racing">Pit <em>Wall</em></h1>${vs.length ? backupButton() : ''}</div>`;
    if (!vs.length) return html + emptyGarage();
    const rank = v => { const s = oilStatus(v); return s ? s.used : -1; };
    const sorted = [...vs].sort((a, b) => rank(b) - rank(a));
    html += `<div class="rail">${sorted.map(v => `
      <div class="card car-card" style="--c:${v.color}">
        <div class="livery">${stripes}</div>
        <button class="head" data-action="open-garage" data-vehicle="${v.id}">
          <div class="roundel" style="--c:${v.color}">${esc(v.number)}</div>
          <div><div class="name racing">${esc(vName(v))}</div>
          <div class="sub">${esc(vYMM(v))} · <span class="num">${fmtNum(currentOdo(v))} ${v.unit}</span></div></div>
        </button>
        ${stickerHTML(v)}
      </div>`).join('')}</div>`;
    const recent = [...db.services].sort(C.byDateDesc).slice(0, 5);
    html += `<div class="section-head"><h2 class="racing">Recent stops</h2><div class="rule"></div>
      ${db.services.length > 5 ? '<button class="linkish" data-nav="log">See all</button>' : ''}</div>`;
    html += recent.length
      ? `<div class="list">${recent.map(s => entryHTML(s)).join('')}</div>`
      : `<p class="muted" style="margin:4px 4px">No services logged yet. Tap <b style="color:var(--red)">+</b> to log one.</p>`;
    return html;
  }

  function garageTabs(activeId) {
    return `<div class="garage-tabs">${db.vehicles.map(x => `
      <button class="gtab ${x.id === activeId ? 'active' : ''}" data-action="garage-tab" data-vehicle="${x.id}">
        <span class="roundel sm" style="--c:${x.color}">${esc(x.number)}</span>${esc(vShort(x))}
      </button>`).join('')}
      <button class="gtab add" data-action="add-vehicle">+ Add</button></div>`;
  }

  function viewGarage() {
    const vs = db.vehicles;
    let html = `<div class="view-title"><h1 class="racing">The <em>Garage</em></h1></div>`;
    if (!vs.length) return html + emptyGarage();
    if (!vehicle(ui.garageId)) ui.garageId = vs[0].id;
    const v = vehicle(ui.garageId);
    html += garageTabs(v.id);
    const list = servicesFor(v.id).sort(C.byDateDesc);
    const spent = list.reduce((a, s) => a + (Number(s.cost) || 0), 0);
    html += `<div class="card hero" style="--c:${v.color}">
      <div class="livery-band"></div>
      <div class="row">
        <button class="hero-open" data-action="open-vehicle" data-vehicle="${v.id}" aria-label="Open vehicle details">
          <div class="roundel lg" style="--c:${v.color}">${esc(v.number)}</div>
          <div><h2 class="racing">${esc(v.nickname || v.model)}</h2><div class="ymm">${esc(vYMM(v))}</div>
          <div class="details-link">Build sheet &amp; details ${ICON.chev}</div></div>
        </button>
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

  // ---------- vehicle screen (F-02, F-25, F-26, F-24) ----------
  function viewVehicle() {
    const v = vehicle(ui.garageId);
    if (!v) { ui.view = 'garage'; return viewGarage(); }
    const tabs = [['build', 'Build sheet'], ['mileage', 'Mileage'], ['purchase', 'Purchase']];
    let html = `<div class="view-title"><button class="back-btn" data-nav="garage">${ICON.back} Garage</button></div>
      <div class="card hero" style="--c:${v.color}">
        <div class="livery-band"></div>
        <div class="row">
          <div class="roundel lg" style="--c:${v.color}">${esc(v.number)}</div>
          <div><h2 class="racing">${esc(v.nickname || v.model)}</h2><div class="ymm">${esc(vYMM(v))}</div></div>
        </div>
        <button class="btn block ghost" style="margin-top:14px" data-action="ownership-pdf" data-vehicle="${v.id}">${ICON.doc} Ownership record (PDF)${gated('ownershipPdf') ? ' ' + proBadge : ''}</button>
      </div>
      <div class="seg vtabs">${tabs.map(([id, l]) => `<button data-action="vtab" data-tab="${id}" class="${ui.vTab === id ? 'active' : ''}">${l}</button>`).join('')}</div>`;
    if (ui.vTab === 'mileage') html += vMileage(v);
    else if (ui.vTab === 'purchase') html += vPurchase(v);
    else html += vBuild(v);
    return html;
  }

  function lockedPanel(f) {
    const label = PRO_CANDIDATES.find(x => x.id === f).label;
    return `<div class="empty" style="margin-top:14px">${stripes}<h3 class="racing">${esc(label)} ${proBadge}</h3>
      <p>Part of Pit Log Pro in this test.</p><button class="btn primary" data-action="pro-info" data-feature="${f}">What's Pro?</button></div>`;
  }

  function buildRowHTML(r) {
    const v = vehicle(r.vehicleId) || { unit: 'km' };
    const src = r.sourceServiceId && db.services.find(s => s.id === r.sourceServiceId);
    const installed = [r.installedDate ? shortDate(r.installedDate) : null, r.installedOdo != null && r.installedOdo !== '' ? `${fmtNum(r.installedOdo)} ${v.unit}` : null].filter(Boolean).join(' @ ');
    return `<button class="build-row ${r.removedDate ? 'removed' : ''}" data-action="edit-build" data-id="${r.id}">
      <div class="b-main">
        <div class="b-name">${esc(r.name || r.partNo || 'Unnamed part')}</div>
        <div class="b-sub">${[r.brand && esc(r.brand), r.partNo && `<span class="mono">${esc(r.partNo)}</span>`].filter(Boolean).join(' · ') || '<span class="muted">No brand / part #</span>'}</div>
        ${r.notes ? `<div class="b-notes">${esc(r.notes)}</div>` : ''}
      </div>
      <div class="b-meta">
        ${r.removedDate ? `<div>Off ${shortDate(r.removedDate)}</div>` : ''}
        <div>${installed ? 'On ' + installed : 'Came with it'}</div>
        ${src ? `<div class="b-link">from log</div>` : ''}
      </div></button>`;
  }

  function vBuild(v) {
    if (!canUse('buildSheet')) return lockedPanel('buildSheet');
    const rows = db.buildSheet.filter(r => r.vehicleId === v.id);
    const sortRows = (a, b) => (b.installedDate || '').localeCompare(a.installedDate || '') || (a.name || '').localeCompare(b.name || '');
    const fitted = rows.filter(r => !r.removedDate).sort(sortRows);
    const prev = rows.filter(r => r.removedDate).sort((a, b) => b.removedDate.localeCompare(a.removedDate));
    let html = `<div class="section-head"><h2 class="racing">Fitted</h2><div class="rule"></div>
      <button class="btn sm primary" data-action="add-build" data-vehicle="${v.id}">${ICON.plus} Part</button></div>`;
    html += fitted.length ? `<div class="list">${fitted.map(buildRowHTML).join('')}</div>`
      : `<p class="muted hint-block">No parts yet. Add parts the vehicle came with here, or tick <b>Build sheet</b> on a part when you log a service.</p>`;
    if (prev.length) html += `<div class="section-head"><h2 class="racing">Previously fitted</h2><div class="rule"></div></div>
      <div class="list">${prev.map(buildRowHTML).join('')}</div>`;
    return html;
  }

  function vPurchase(v) {
    const p = v.purchase;
    const spent = servicesFor(v.id).reduce((a, s) => a + (Number(s.cost) || 0), 0);
    if (!p) return `<div class="empty" style="margin-top:14px">${stripes}<h3 class="racing">No purchase details</h3>
      <p>Add when and how you bought it to see total cost of ownership and distance since purchase.</p>
      <button class="btn primary" data-action="edit-purchase" data-vehicle="${v.id}">${ICON.plus} Add purchase details</button></div>`;
    const tco = (Number(p.price) || 0) + spent;
    const since = p.odometer !== '' && p.odometer != null ? currentOdo(v) - Number(p.odometer) : null;
    const owned = p.date ? daysBetween(p.date, today()) : null;
    const ownedTxt = owned == null ? '—' : owned >= 365 ? `${(owned / 365.25).toFixed(1)} yr` : `${owned} d`;
    return `<div class="stats" style="margin-top:14px">
        <div class="stat"><div class="v">${fmtMoney(tco)}</div><div class="l">Cost of ownership</div></div>
        <div class="stat"><div class="v">${since == null ? '—' : fmtNum(since)}</div><div class="l">${v.unit} since purchase</div></div>
        <div class="stat"><div class="v">${ownedTxt}</div><div class="l">Owned</div></div>
      </div>
      <div class="card" style="padding:4px 14px;margin-top:12px">
        <div class="detail-row"><span class="l">Purchased</span><span class="v">${fmtDate(p.date)}</span></div>
        <div class="detail-row"><span class="l">Price</span><span class="v">${fmtMoney(p.price)}</span></div>
        <div class="detail-row"><span class="l">Odometer at purchase</span><span class="v num">${p.odometer === '' || p.odometer == null ? '—' : fmtNum(p.odometer) + ' ' + v.unit}</span></div>
        <div class="detail-row"><span class="l">Bought from</span><span class="v">${esc(p.seller || '—')}</span></div>
        <div class="detail-row"><span class="l">Logged service spend</span><span class="v">${fmtMoney(spent)}</span></div>
        ${p.notes ? `<div class="detail-row" style="display:block"><span class="l">Notes</span><div style="white-space:pre-wrap;margin-top:4px">${esc(p.notes)}</div></div>` : ''}
      </div>
      <button class="btn ghost block" style="margin-top:12px" data-action="edit-purchase" data-vehicle="${v.id}">${ICON.edit} Edit purchase details</button>`;
  }

  function vMileage(v) {
    if (!canUse('mileage')) return lockedPanel('mileage');
    const readings = C.odometerReadings(db, v);
    const avg = C.avgPerDay(readings, today());
    const t = today();
    const yb = C.mileageBuckets(readings, 'year');
    const thisYear = yb[t.slice(0, 4)] || 0;
    let est = '';
    const st = oilStatus(v);
    if (avg && st && st.kmLeft > 0) {
      const days = Math.round(st.kmLeft / avg);
      const hitDate = C.addDays(t, days);
      const first = hitDate < st.dueDate ? 'distance' : 'date';
      est = `<div class="est-card"><div class="eyebrow">Oil change forecast</div>
        At ${fmtNum(avg * 30.44)} ${v.unit}/month you'll reach ${fmtNum(st.dueOdo)} ${v.unit} around <b>${fmtDate(hitDate)}</b>.
        The <b>${first}</b> limit comes first.</div>`;
    }
    let html = `<div class="stats" style="margin-top:14px">
        <div class="stat"><div class="v">${avg ? fmtNum(avg * 30.44) : '—'}</div><div class="l">${v.unit} / month avg</div></div>
        <div class="stat"><div class="v">${fmtNum(thisYear)}</div><div class="l">${v.unit} in ${t.slice(0, 4)}</div></div>
        <div class="stat"><div class="v">${readings.length}</div><div class="l">Readings</div></div>
      </div>${est}
      <div class="section-head"><h2 class="racing">Distance</h2><div class="rule"></div>
        <div class="seg mini">${[['month', 'Month'], ['year', 'Year']].map(([m, l]) => `<button data-action="m-mode" data-mode="${m}" class="${ui.mMode === m ? 'active' : ''}">${l}</button>`).join('')}</div></div>`;
    html += readings.length >= 2 ? mileageChart(readings, v) :
      `<p class="muted hint-block">Needs at least two odometer readings. Service entries count, or tap <b>Log odometer</b> after a drive.</p>`;
    html += `<div class="section-head"><h2 class="racing">Readings</h2><div class="rule"></div>
      <button class="btn sm primary" data-action="update-odo" data-vehicle="${v.id}">${ICON.gauge} Log odometer</button></div>`;
    const srcLabel = { service: 'Service', log: 'Odometer log', purchase: 'Purchase' };
    html += readings.length ? `<div class="card readings">${[...readings].reverse().slice(0, 15).map(r => `
      <div class="detail-row"><span class="l">${shortDate(r.date)} · ${srcLabel[r.src]}</span>
        <span class="v num">${fmtNum(r.odo)} ${v.unit}${r.src === 'log' ? ` <button class="rm-inline" data-action="del-odo" data-id="${r.id}" aria-label="Delete reading">×</button>` : ''}</span></div>`).join('')}</div>` : '';
    return html;
  }

  function mileageChart(readings, v) {
    const mode = ui.mMode === 'year' ? 'year' : 'month';
    const b = C.mileageBuckets(readings, mode);
    const t = parseDate(today());
    let keys;
    if (mode === 'month') {
      keys = Array.from({ length: 12 }, (_, i) => { const d = new Date(t.getFullYear(), t.getMonth() - 11 + i, 1); return isoDate(d).slice(0, 7); });
    } else {
      const first = Number(readings[0].date.slice(0, 4));
      keys = []; for (let y = Math.max(first, t.getFullYear() - 9); y <= t.getFullYear(); y++) keys.push(String(y));
    }
    const vals = keys.map(k => b[k] || 0);
    const max = Math.max(...vals, 1);
    const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
    const W = 340, H = 170, padL = 4, padB = 22, padT = 18, n = keys.length;
    const gap = 2, bw = (W - padL) / n - gap;
    const y = val => padT + (H - padT - padB) * (1 - val / nice);
    const label = k => mode === 'month' ? MONTHS[Number(k.slice(5)) - 1].slice(0, 1) : `'${k.slice(2)}`;
    const peak = vals.indexOf(Math.max(...vals));
    const bars = keys.map((k, i) => {
      const x = padL + i * (bw + gap), h = Math.max(0, H - padB - y(vals[i]));
      const title = mode === 'month' ? `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}` : k;
      const r = Math.min(4, bw / 2, h);
      const path = h > 0 ? `M${x},${H - padB} V${H - padB - h + r} Q${x},${H - padB - h} ${x + r},${H - padB - h} H${x + bw - r} Q${x + bw},${H - padB - h} ${x + bw},${H - padB - h + r} V${H - padB} Z` : '';
      return `<g class="bar" data-tip="${title}: ${fmtNum(vals[i])} ${v.unit}">
        <rect class="hit" x="${x - gap / 2}" y="${padT - 14}" width="${bw + gap}" height="${H - padT + 14}"/>
        ${path ? `<path d="${path}"/>` : ''}
        <text class="xl" x="${x + bw / 2}" y="${H - 6}">${label(k)}</text>
        ${i === peak && vals[i] > 0 ? `<text class="vl" x="${x + bw / 2}" y="${y(vals[i]) - 5}">${fmtNum(vals[i])}</text>` : ''}
      </g>`;
    }).join('');
    return `<div class="card chart-card">
      <div class="chart-tip" id="chart-tip">Tap a bar for its distance</div>
      <svg viewBox="0 0 ${W} ${H}" class="mchart" role="img" aria-label="Distance per ${mode}">
        <line class="axis" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>
        <line class="grid" x1="0" x2="${W}" y1="${y(nice / 2)}" y2="${y(nice / 2)}"/>
        <text class="yl" x="${W}" y="${y(nice / 2) - 4}">${fmtNum(nice / 2)}</text>
        ${bars}
      </svg>
      <div class="hint" style="margin-top:4px">Spread evenly between readings: more readings make this more accurate.</div></div>`;
  }

  // ---------- log ----------
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
          <span class="dot"></span>${esc(vShort(v))}</button>`).join('')}
      </div>
      <div class="filter-row"><select id="log-type">
          <option value="all">All service types</option>
          ${SERVICE_TYPES.map(t => `<option value="${t.id}" ${ui.fType === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select></div>
      <div id="log-results">${logResults()}</div>`;
    return html;
  }
  function logResults() {
    const list = C.filterServices(db, { q: ui.q, vehicle: ui.fVehicle, type: ui.fType }, typeLabel);
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
    const re = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    return t.replace(re, m => `<mark>${m}</mark>`);
  }
  function entryHTML(s, opts = {}) {
    const v = vehicle(s.vehicleId) || { color: '#555', number: '?', unit: 'km' };
    const d = parseDate(s.date);
    const parts = (s.parts || []).filter(p => p.name || p.partNo);
    const partsTxt = parts.map(p => hl(p.name || p.partNo, opts.highlight) +
      (p.partNo && p.name ? ` <span class="muted">${hl(p.partNo, opts.highlight)}</span>` : '') +
      (p.showOnBuild ? ' <span class="build-dot" title="On build sheet"></span>' : '')).join(' · ');
    const title = entryTitle(s);
    const typeNote = title !== typeLabel(s.type) ? `${esc(typeLabel(s.type))} · ` : '';
    return `<button class="entry" data-action="view-service" data-id="${s.id}" style="--c:${v.color}">
      <div class="date"><div class="d num">${d ? pad2(d.getDate()) : '--'}</div><div class="m">${d ? MONTHS[d.getMonth()] : ''}</div></div>
      <div>
        <div class="title">${hl(title, opts.highlight)}</div>
        <div class="info">${typeNote}${opts.hideVehicle ? '' : esc(vName(v)) + ' · '}${esc(s.shop || 'DIY')}${s.cost ? ' · ' + fmtMoney(s.cost) : ''}</div>
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
  const optional = '<span class="opt">(optional)</span>';

  // --- vehicle form ---
  function vehicleForm(v) {
    const isNew = !v;
    if (isNew && gated('vehicleLimit') && !isPro() && db.vehicles.length >= 2) { requirePro('vehicleLimit'); return; }
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
      <div class="field"><label>Trim / engine ${optional}</label>
        <input type="text" id="vf-trim" value="${esc(v.trim)}" placeholder="e.g. SR5 4.0L V6"></div>
      <div class="field"><label>Nickname ${optional}</label>
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
      ${isNew ? '' : `<button class="btn danger block" data-action="delete-vehicle" data-vehicle="${v.id}" style="margin-top:8px">Delete vehicle &amp; its history</button>`}`;
    const foot = `<button class="btn ghost" data-action="close-sheet">Cancel</button>
      <button class="btn primary" data-action="save-vehicle" data-vehicle="${isNew ? '' : v.id}">${isNew ? 'Add to garage' : 'Save'}</button>`;

    openSheet(isNew ? 'Add vehicle' : 'Edit vehicle', body, foot, sheet => {
      const year = $('#vf-year', sheet), make = $('#vf-make', sheet), makeOther = $('#vf-make-other', sheet);
      const modelSel = $('#vf-model', sheet), modelTxt = $('#vf-model-text', sheet), hint = $('#vf-model-hint', sheet);
      const curMake = () => make.value === '__other' ? makeOther.value.trim() : make.value;
      let reqId = 0;
      const manualModel = msg => { modelSel.hidden = true; modelTxt.hidden = false; hint.innerHTML = msg || ''; };
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
          if (prev && !models.includes(prev)) { modelSel.insertAdjacentHTML('afterbegin', `<option selected>${esc(prev)}</option>`); }
          modelSel.disabled = false;
        } catch (e) {
          if (my !== reqId) return;
          manualModel('<span class="warn">Offline or lookup failed — type the model.</span>');
        }
      }
      year.addEventListener('change', loadModels);
      make.addEventListener('change', () => { $('#vf-make-other-wrap', sheet).hidden = make.value !== '__other'; loadModels(); });
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
    const models = [...new Set((json.Results || []).map(r => (r.Model_Name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
    else { const v = { id: uid(), createdAt: new Date().toISOString(), ...data, purchase: null }; db.vehicles.push(v); ui.garageId = v.id; }
    save(); closeSheet();
    if (!id) ui.view = 'garage';
    render(); toast(id ? 'Vehicle updated' : 'Rolled into the garage');
  }

  // --- service form (F-01 title, F-02 build-sheet checkboxes) ---
  function partRow(p, defaultBuild) {
    const on = p.showOnBuild ?? defaultBuild;
    return `<div class="part-block" data-pid="${esc(p.id || '')}">
      <div class="part-row">
        <input type="text" class="p-name" placeholder="Part / description" value="${esc(p.name)}">
        <input type="text" class="p-no" placeholder="Part #" value="${esc(p.partNo)}" autocapitalize="characters">
        <input type="number" class="p-qty" inputmode="decimal" placeholder="Qty" value="${esc(p.qty)}">
        <button type="button" class="rm" data-action="rm-part" aria-label="Remove">×</button>
      </div>
      <label class="build-check ${canUse('buildSheet') ? '' : 'locked'}"><input type="checkbox" class="p-build" ${on ? 'checked' : ''} ${canUse('buildSheet') ? '' : 'disabled'}>
        <span>Show on build sheet${canUse('buildSheet') ? '' : ' ' + proBadge}</span></label>
    </div>`;
  }

  function serviceForm(s, preset = {}) {
    if (!db.vehicles.length) { toast('Add a vehicle first'); vehicleForm(); return; }
    const isNew = !s;
    const vid = s?.vehicleId || preset.vehicleId || ((ui.view === 'garage' || ui.view === 'vehicle') && ui.garageId) || (ui.fVehicle !== 'all' && ui.fVehicle) || db.vehicles[0].id;
    s = s || { vehicleId: vid, date: today(), odometer: '', type: preset.type || 'oil', title: null, parts: [], cost: '', shop: '', notes: '' };
    const parts = s.parts?.length ? s.parts : [{ name: '', partNo: '', qty: 1 }];
    const body = `
      <div class="field"><label>Vehicle</label>
        <select id="sf-vehicle">${db.vehicles.map(v => `<option value="${v.id}" ${v.id === s.vehicleId ? 'selected' : ''}>#${esc(v.number)} · ${esc(vName(v))}</option>`).join('')}</select></div>
      <div class="field"><label>Service type</label>
        <select id="sf-type">${SERVICE_TYPES.map(t => `<option value="${t.id}" ${t.id === s.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
      <div class="field"><label>Title ${optional}</label>
        <input type="text" id="sf-title" value="${esc(s.title || '')}" autocapitalize="sentences">
        <span class="hint" id="sf-title-hint"></span></div>
      <div class="grid2">
        <div class="field"><label>Date</label><input type="date" id="sf-date" value="${esc(s.date)}"></div>
        <div class="field"><label>Odometer</label>
          <input type="number" inputmode="numeric" id="sf-odo" value="${esc(s.odometer)}"><span class="hint" id="sf-unit"></span></div>
      </div>
      <div class="field"><label>Parts</label>
        <div id="sf-parts">${parts.map(p => partRow(p, s.type === 'upgrade')).join('')}</div>
        <button type="button" class="btn sm ghost" data-action="add-part" style="align-self:flex-start">${ICON.plus} Add part</button></div>
      <div class="grid2">
        <div class="field"><label>Cost</label><input type="number" inputmode="decimal" id="sf-cost" value="${esc(s.cost)}" placeholder="$"></div>
        <div class="field"><label>Shop</label><input type="text" id="sf-shop" value="${esc(s.shop)}" placeholder="DIY"></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="sf-notes" placeholder="Oil spec, torque, observations…">${esc(s.notes)}</textarea></div>
      ${isNew ? '' : `<button class="btn danger block" data-action="delete-service" data-id="${s.id}">Delete entry</button>`}`;
    const foot = `<button class="btn ghost" data-action="close-sheet">Cancel</button>
      <button class="btn primary" data-action="save-service" data-id="${isNew ? '' : s.id}">${isNew ? 'Log it' : 'Save'}</button>`;
    openSheet(isNew ? 'Log service' : 'Edit service', body, foot, sheet => {
      const syncUnit = () => {
        const v = vehicle($('#sf-vehicle', sheet).value);
        $('#sf-unit', sheet).textContent = `${v.unit} · last known ${fmtNum(currentOdo(v))}`;
      };
      const syncTitle = () => {
        const draft = { type: $('#sf-type', sheet).value, title: null, parts: readParts(sheet) };
        const auto = entryTitle(draft);
        $('#sf-title', sheet).placeholder = auto;
        $('#sf-title-hint', sheet).textContent = ['repair', 'other', 'upgrade'].includes(draft.type)
          ? 'Blank = named after the first part.' : 'Blank = the service type.';
      };
      $('#sf-vehicle', sheet).addEventListener('change', syncUnit); syncUnit();
      $('#sf-type', sheet).addEventListener('change', () => {
        // On new entries, untouched build-sheet boxes follow the type (Upgrade = on by default).
        if (isNew) $$('.p-build:not([data-touched]):not([disabled])', sheet).forEach(c => c.checked = $('#sf-type', sheet).value === 'upgrade');
        syncTitle();
      });
      $('#sf-parts', sheet).addEventListener('change', e => { if (e.target.classList.contains('p-build')) e.target.dataset.touched = '1'; });
      $('#sf-parts', sheet).addEventListener('input', syncTitle);
      syncTitle();
      sheet.addEventListener('click', e => {
        if (e.target.closest('[data-action="add-part"]')) {
          $('#sf-parts', sheet).insertAdjacentHTML('beforeend', partRow({ name: '', partNo: '', qty: 1 }, $('#sf-type', sheet).value === 'upgrade'));
          $('#sf-parts .part-block:last-child .p-name', sheet).focus();
        }
        if (e.target.closest('[data-action="rm-part"]')) {
          const blocks = $$('#sf-parts .part-block', sheet);
          const block = e.target.closest('.part-block');
          if (blocks.length > 1) block.remove();
          else { $$('input[type=text],input[type=number]', block).forEach(i => i.value = i.classList.contains('p-qty') ? 1 : ''); block.dataset.pid = ''; }
          syncTitle();
        }
      });
    });
  }

  function readParts(sheet) {
    return $$('#sf-parts .part-block', sheet).map(b => ({
      id: b.dataset.pid || null,
      name: $('.p-name', b).value.trim(), partNo: $('.p-no', b).value.trim(), qty: Number($('.p-qty', b).value) || 1,
      showOnBuild: $('.p-build', b).checked,
    })).filter(p => p.name || p.partNo);
  }

  function saveService(id) {
    const sh = $('#sheet-root .sheet');
    const parts = readParts(sh).map(p => ({ ...p, id: p.id || uid() }));
    const prior = id ? db.services.find(x => x.id === id) : null;
    const data = {
      vehicleId: $('#sf-vehicle', sh).value, type: $('#sf-type', sh).value, date: $('#sf-date', sh).value,
      title: $('#sf-title', sh).value.trim() || null,
      odometer: $('#sf-odo', sh).value === '' ? '' : Number($('#sf-odo', sh).value),
      parts, cost: $('#sf-cost', sh).value === '' ? '' : Number($('#sf-cost', sh).value),
      shop: $('#sf-shop', sh).value.trim(), notes: $('#sf-notes', sh).value.trim(),
    };
    if (!data.date) { toast('Date is required'); return; }
    if (data.type === 'oil' && data.odometer === '') { toast('Odometer is needed for the oil sticker'); return; }
    // keep any unknown per-part fields from the stored entry
    if (prior) data.parts = data.parts.map(p => ({ ...((prior.parts || []).find(o => o.id && o.id === p.id) || {}), ...p }));
    let s;
    if (prior) s = Object.assign(prior, data);
    else { s = { id: uid(), createdAt: new Date().toISOString(), ...data }; db.services.push(s); }
    C.syncBuildFromService(db, s, uid, new Date().toISOString());
    save(); closeSheet(); render();
    const nb = parts.filter(p => p.showOnBuild).length;
    toast((id ? 'Entry updated' : 'Logged ✓') + (nb ? ` · ${nb} on build sheet` : ''));
  }

  function serviceDetail(id) {
    const s = db.services.find(x => x.id === id); if (!s) return;
    const v = vehicle(s.vehicleId) || { unit: 'km', color: '#555', number: '?' };
    const parts = s.parts || [];
    const body = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div class="roundel" style="--c:${v.color}">${esc(v.number)}</div>
        <div><div class="racing" style="font-size:17px">${esc(entryTitle(s))}</div><div class="muted" style="font-size:13px">${esc(typeLabel(s.type))} · ${esc(vName(v))}</div></div>
      </div>
      <div class="card" style="padding:4px 14px;margin-bottom:14px">
        <div class="detail-row"><span class="l">Date</span><span class="v">${fmtDate(s.date)}</span></div>
        <div class="detail-row"><span class="l">Odometer</span><span class="v num">${fmtNum(s.odometer)} ${v.unit}</span></div>
        <div class="detail-row"><span class="l">Shop</span><span class="v">${esc(s.shop || 'DIY')}</span></div>
        <div class="detail-row"><span class="l">Cost</span><span class="v">${fmtMoney(s.cost)}</span></div>
      </div>
      ${parts.length ? `<div class="label" style="margin-bottom:4px">Parts</div>
        <table class="parts-table">${parts.map(p => `<tr><td>${esc(p.name)}${p.showOnBuild ? ' <span class="build-dot" title="On build sheet"></span>' : ''}</td><td class="pn">${esc(p.partNo)}</td><td class="q">×${esc(p.qty)}</td></tr>`).join('')}</table>
        ${parts.some(p => p.showOnBuild) ? '<p class="hint"><span class="build-dot"></span> On the build sheet</p>' : ''}` : ''}
      ${s.notes ? `<div class="label" style="margin:16px 0 4px">Notes</div><div style="white-space:pre-wrap">${esc(s.notes)}</div>` : ''}`;
    openSheet('Pit stop', body, `<button class="btn ghost" data-action="close-sheet">Close</button>
      <button class="btn primary" data-action="edit-service" data-id="${s.id}">${ICON.edit} Edit</button>`);
  }

  // --- odometer reading (F-26 "Log odometer") ---
  function odoForm(id) {
    const v = vehicle(id);
    openSheet('Log odometer', `
      <div class="grid2">
        <div class="field"><label>Reading (${v.unit})</label><input type="number" inputmode="numeric" id="of-odo" value="${currentOdo(v)}"></div>
        <div class="field"><label>Date</label><input type="date" id="of-date" value="${today()}"></div>
      </div>
      <p class="hint">Keeps the oil sticker accurate between services and feeds the mileage chart.</p>`,
      `<button class="btn ghost" data-action="close-sheet">Cancel</button>
       <button class="btn primary" data-action="save-odo" data-vehicle="${id}">Save</button>`,
      s => { const i = $('#of-odo', s); setTimeout(() => { i.focus(); i.select(); }, 250); });
  }
  function saveOdo(vid) {
    const v = vehicle(vid);
    const odo = Number($('#of-odo').value), date = $('#of-date').value || today();
    if (!odo) { toast('Enter a reading'); return; }
    db.odometerLogs.push({ id: uid(), vehicleId: vid, date, odometer: odo, createdAt: new Date().toISOString() });
    if (odo > (Number(v.odometer) || 0)) v.odometer = odo;
    save(); closeSheet(); render(); toast('Odometer logged');
  }

  // --- build sheet row (F-02) ---
  function buildForm(rowId, vid) {
    const r = rowId ? db.buildSheet.find(x => x.id === rowId) : { vehicleId: vid, name: '', brand: '', partNo: '', installedDate: '', installedOdo: '', removedDate: null, notes: '', sourceServiceId: null };
    const src = r.sourceServiceId && db.services.find(s => s.id === r.sourceServiceId);
    const lock = src ? 'disabled' : '';
    const body = `
      ${src ? `<div class="linked-note">Linked to <button class="linkish" data-action="view-service" data-id="${src.id}">${esc(entryTitle(src))} · ${shortDate(src.date)}</button>.
        Name, part # and install date/odometer come from that log entry; edit them there.</div>` : ''}
      <div class="field"><label>Part</label><input type="text" id="bf-name" value="${esc(r.name)}" ${lock} placeholder="e.g. Bilstein 5100 front struts"></div>
      <div class="grid2">
        <div class="field"><label>Brand ${optional}</label><input type="text" id="bf-brand" value="${esc(r.brand)}"></div>
        <div class="field"><label>Part # ${optional}</label><input type="text" id="bf-pn" value="${esc(r.partNo)}" ${lock} autocapitalize="characters"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Installed ${optional}</label><input type="date" id="bf-date" value="${esc(r.installedDate || '')}" ${lock}></div>
        <div class="field"><label>At odometer ${optional}</label><input type="number" inputmode="numeric" id="bf-odo" value="${esc(r.installedOdo ?? '')}" ${lock}></div>
      </div>
      <div class="field"><label>Notes ${optional}</label><textarea id="bf-notes" placeholder="Spec, settings, where it came from…">${esc(r.notes)}</textarea></div>
      <div class="field"><label>Removed on ${optional}</label><input type="date" id="bf-removed" value="${esc(r.removedDate || '')}">
        <span class="hint">Set a date to move it to "Previously fitted". Clear it to refit.</span></div>
      ${rowId ? `<button class="btn danger block" data-action="delete-build" data-id="${r.id}">${src ? 'Take off build sheet' : 'Delete part'}</button>` : ''}`;
    openSheet(rowId ? 'Build sheet part' : 'Add part', body, `<button class="btn ghost" data-action="close-sheet">Cancel</button>
      <button class="btn primary" data-action="save-build" data-id="${rowId || ''}" data-vehicle="${r.vehicleId}">Save</button>`);
  }
  function saveBuild(rowId, vid) {
    const g = id => $(id).value.trim();
    const data = { brand: g('#bf-brand'), notes: g('#bf-notes'), removedDate: g('#bf-removed') || null };
    const row = rowId && db.buildSheet.find(x => x.id === rowId);
    if (!row || !row.sourceServiceId) Object.assign(data, {
      name: g('#bf-name'), partNo: g('#bf-pn'), installedDate: g('#bf-date') || null,
      installedOdo: g('#bf-odo') === '' ? null : Number(g('#bf-odo')),
    });
    if (!row && !data.name && !data.partNo) { toast('Give the part a name'); return; }
    if (row) Object.assign(row, data);
    else db.buildSheet.push({ id: uid(), vehicleId: vid, sourceServiceId: null, createdAt: new Date().toISOString(), ...data });
    save(); closeSheet(); render(); toast('Build sheet updated');
  }
  function deleteBuild(rowId) {
    const row = db.buildSheet.find(x => x.id === rowId); if (!row) return;
    if (row.sourceServiceId) {
      const s = db.services.find(x => x.id === row.sourceServiceId);
      const p = s && (s.parts || []).find(p => p.id === row.sourcePartId);
      if (p) p.showOnBuild = false;
    } else if (!confirm(`Delete ${row.name || 'this part'} from the build sheet?`)) return;
    db.buildSheet = db.buildSheet.filter(x => x.id !== rowId);
    save(); closeSheet(); render(); toast('Removed from build sheet');
  }

  // --- purchase details (F-25) ---
  function purchaseForm(vid) {
    const v = vehicle(vid), p = v.purchase || {};
    openSheet('Purchase details', `
      <div class="grid2">
        <div class="field"><label>Purchase date</label><input type="date" id="pf-date" value="${esc(p.date || '')}"></div>
        <div class="field"><label>Price</label><input type="number" inputmode="decimal" id="pf-price" value="${esc(p.price ?? '')}" placeholder="$"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Odometer (${v.unit})</label><input type="number" inputmode="numeric" id="pf-odo" value="${esc(p.odometer ?? '')}"></div>
        <div class="field"><label>Bought from</label>
          <input type="text" id="pf-seller" list="pf-seller-list" value="${esc(p.seller || '')}" placeholder="Dealer / private">
          <datalist id="pf-seller-list"><option value="Dealer"><option value="Private sale"><option value="Auction"></datalist></div>
      </div>
      <div class="field"><label>Notes ${optional}</label><textarea id="pf-notes" placeholder="Condition, what came with it, history…">${esc(p.notes || '')}</textarea></div>
      ${v.purchase ? `<button class="btn danger block" data-action="clear-purchase" data-vehicle="${vid}">Clear purchase details</button>` : ''}`,
      `<button class="btn ghost" data-action="close-sheet">Cancel</button><button class="btn primary" data-action="save-purchase" data-vehicle="${vid}">Save</button>`);
  }
  function savePurchase(vid) {
    const g = id => $(id).value.trim();
    const num = id => g(id) === '' ? null : Number(g(id));
    const v = vehicle(vid);
    v.purchase = { ...(v.purchase || {}), date: g('#pf-date') || null, price: num('#pf-price'), odometer: num('#pf-odo'), seller: g('#pf-seller'), notes: g('#pf-notes') };
    save(); closeSheet(); render(); toast('Purchase details saved');
  }

  // --- ownership record PDF (F-24) ---
  function ownershipForm(vid) {
    if (!requirePro('ownershipPdf')) return;
    const v = vehicle(vid);
    const nBuild = db.buildSheet.filter(r => r.vehicleId === vid).length;
    openSheet('Ownership record', `
      <p class="muted" style="margin-top:0">A printable service history for ${esc(vName(v))}: for a buyer, insurer or your own records.</p>
      <label class="check-row"><input type="checkbox" id="of-build" ${nBuild ? 'checked' : 'disabled'}> Include build sheet ${nBuild ? `(${nBuild})` : '<span class="muted">(empty)</span>'}</label>
      <label class="check-row"><input type="checkbox" id="of-purchase" ${v.purchase ? 'checked' : 'disabled'}> Include purchase details ${v.purchase ? '' : '<span class="muted">(none)</span>'}</label>
      <label class="check-row"><input type="checkbox" id="of-costs" checked> Show costs</label>
      <p class="hint">Next: in the print screen, tap <b>Share → Save to Files</b> to keep it as a PDF.</p>`,
      `<button class="btn ghost" data-action="close-sheet">Cancel</button><button class="btn primary" data-action="make-pdf" data-vehicle="${vid}">${ICON.doc} Create PDF</button>`);
  }
  function makePdf(vid) {
    const v = vehicle(vid);
    const opt = { build: $('#of-build').checked, purchase: $('#of-purchase').checked, costs: $('#of-costs').checked };
    const list = servicesFor(vid).sort(C.byDateDesc);
    const spent = list.reduce((a, s) => a + (Number(s.cost) || 0), 0);
    const rows = db.buildSheet.filter(r => r.vehicleId === vid);
    const p = v.purchase;
    const partsTxt = s => (s.parts || []).filter(x => x.name || x.partNo).map(x => esc(x.name || '') + (x.partNo ? ` <span class="pn">${esc(x.partNo)}</span>` : '') + (x.qty && x.qty !== 1 ? ` ×${esc(x.qty)}` : '')).join('<br>');
    const html = `
      <header class="pr-head"><div class="pr-stripes"><i></i><i></i><i></i></div>
        <div><div class="pr-kicker">Maintenance record</div><h1>${esc(vYMM(v))}</h1>
        ${v.nickname ? `<div class="pr-sub">“${esc(v.nickname)}”</div>` : ''}</div>
        <div class="pr-gen">Generated ${fmtDate(realToday())}<br>Pit Log v${APP_VERSION}</div></header>
      <section class="pr-facts">
        <div><span>Current odometer</span><b>${fmtNum(currentOdo(v))} ${v.unit}</b></div>
        <div><span>Service entries</span><b>${list.length}</b></div>
        ${list.length ? `<div><span>History spans</span><b>${shortDate(list[list.length - 1].date)} – ${shortDate(list[0].date)}</b></div>` : ''}
        ${opt.costs ? `<div><span>Total logged spend</span><b>${fmtMoney(spent)}</b></div>` : ''}
      </section>
      ${opt.purchase && p ? `<h2>Purchase</h2><table class="pr-kv">
        <tr><th>Date</th><td>${fmtDate(p.date)}</td><th>Odometer</th><td>${p.odometer == null ? '—' : fmtNum(p.odometer) + ' ' + v.unit}</td></tr>
        <tr><th>From</th><td>${esc(p.seller || '—')}</td>${opt.costs ? `<th>Price</th><td>${fmtMoney(p.price)}</td>` : '<th></th><td></td>'}</tr>
        ${p.notes ? `<tr><th>Notes</th><td colspan="3">${esc(p.notes)}</td></tr>` : ''}</table>` : ''}
      <h2>Service history</h2>
      ${list.length ? `<table class="pr-table"><thead><tr><th>Date</th><th>Odometer</th><th>Service</th><th>Parts</th><th>By</th>${opt.costs ? '<th class="r">Cost</th>' : ''}</tr></thead><tbody>
        ${list.map(s => `<tr><td class="nw">${fmtDate(s.date)}</td><td class="nw r">${s.odometer === '' ? '—' : fmtNum(s.odometer)}</td>
          <td><b>${esc(entryTitle(s))}</b>${entryTitle(s) !== typeLabel(s.type) ? `<div class="pn">${esc(typeLabel(s.type))}</div>` : ''}${s.notes ? `<div class="pr-note">${esc(s.notes)}</div>` : ''}</td>
          <td>${partsTxt(s)}</td><td>${esc(s.shop || 'DIY')}</td>${opt.costs ? `<td class="r nw">${s.cost === '' || s.cost == null ? '' : fmtMoney(s.cost)}</td>` : ''}</tr>`).join('')}
      </tbody></table>` : '<p>No services logged.</p>'}
      ${opt.build && rows.length ? `<h2>Build sheet</h2><table class="pr-table"><thead><tr><th>Part</th><th>Brand</th><th>Part #</th><th>Installed</th><th>Removed</th></tr></thead><tbody>
        ${[...rows].sort((a, b) => (!!a.removedDate - !!b.removedDate) || (b.installedDate || '').localeCompare(a.installedDate || '')).map(r => `<tr class="${r.removedDate ? 'pr-removed' : ''}">
          <td><b>${esc(r.name)}</b>${r.notes ? `<div class="pr-note">${esc(r.notes)}</div>` : ''}</td><td>${esc(r.brand)}</td><td class="pn">${esc(r.partNo)}</td>
          <td class="nw">${r.installedDate ? fmtDate(r.installedDate) : 'Original / unknown'}${r.installedOdo != null && r.installedOdo !== '' ? `<br>${fmtNum(r.installedOdo)} ${v.unit}` : ''}</td>
          <td class="nw">${r.removedDate ? fmtDate(r.removedDate) : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
      <footer class="pr-foot">Owner-kept record from Pit Log. Entries are as logged by the owner.</footer>`;
    $('#print-root').innerHTML = html;
    closeSheet();
    const prevTitle = document.title;
    document.title = `${vYMM(v)} maintenance record`.replace(/[\\/:*?"<>|]/g, '');
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); document.title = prevTitle; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 500); }, 50);
  }

  // ---------- settings / backup (F-03, F-05, F-06) ----------
  let versionTaps = 0, versionTapT;
  function settingsSheet() {
    const size = new Blob([localStorage.getItem(C.KEY_V2) || '']).size;
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    const last = db.settings.lastBackupAt;
    openSheet('Setup', `
      <div class="settings-group">
        <div class="label" style="margin-bottom:8px">Backup</div>
        <button class="btn block" data-action="export">${ICON.save} Back up now</button>
        <button class="btn ghost block" data-action="import">Restore from backup…</button>
        <p class="hint">${last ? `Last backup ${ago(last)} (${fmtDate(last.slice(0, 10))}).` : 'Never backed up.'}
          Backups are always called <b>pitlog-backup.json</b>. In the share sheet pick <b>Save to Files</b>, choose the same folder each time, and replace the old copy.</p>
      </div>
      ${standalone ? '' : `<div class="settings-group">
        <div class="label" style="margin-bottom:8px">Install</div>
        <p class="hint warn" style="margin-top:0">Running in the browser. In Safari tap Share → <b>Add to Home Screen</b> so it opens like an app and iOS keeps your data.</p>
      </div>`}
      <div class="settings-group">
        <div class="label" style="margin-bottom:8px">Danger zone</div>
        <button class="btn danger block" data-action="wipe">Erase all data</button>
      </div>
      <button class="version-row" data-action="version-tap">
        <span>Pit Log <b>v${APP_VERSION}</b>${isPro() ? ' ' + proBadge : ''}</span>
        <span class="muted">${db.vehicles.length} vehicles · ${db.services.length} entries · ${(size / 1024).toFixed(1)} KB · data v${db.schemaVersion}</span>
      </button>`, '');
  }

  function devPanel() {
    const gates = db.settings.proGates || {};
    openSheet('Dev panel', `
      <div class="settings-group">
        <div class="label" style="margin-bottom:8px">Entitlement (F-04)</div>
        <div class="seg" id="dv-ent">${['free', 'pro'].map(e => `<button data-action="dv-ent" data-ent="${e}" class="${db.settings.entitlement === e ? 'active' : ''}">${e === 'pro' ? 'Pro' : 'Free'}</button>`).join('')}</div>
        <div class="label" style="margin:14px 0 6px">Gate behind Pro (when Free)</div>
        ${PRO_CANDIDATES.map(f => `<label class="check-row"><input type="checkbox" data-gate="${f.id}" ${gates[f.id] ? 'checked' : ''}> ${f.label}</label>`).join('')}
        <p class="hint">Nothing is gated by default. These switches only change this phone.</p>
      </div>
      <div class="settings-group">
        <div class="label" style="margin-bottom:8px">Test date (F-06)</div>
        <div class="grid2"><input type="date" id="dv-date" value="${fakeToday || realToday()}">
          <button class="btn" data-action="dv-date-set">Use this date</button></div>
        ${fakeToday ? `<button class="btn ghost block" style="margin-top:8px" data-action="dv-date-clear">Back to real date</button>` : ''}
        <p class="hint">Drives the oil sticker, "days ago" and default dates. Not saved; reloading the app clears it.</p>
      </div>
      <div class="settings-group">
        <div class="label" style="margin-bottom:8px">Sample data</div>
        <button class="btn block" data-action="dv-seed">Add sample vehicles</button>
        <button class="btn ghost block" data-action="dv-unseed">Remove sample vehicles</button>
      </div>`, '', sheet => {
      sheet.addEventListener('change', e => {
        const g = e.target.dataset.gate; if (!g) return;
        db.settings.proGates = { ...(db.settings.proGates || {}), [g]: e.target.checked };
        save(); render();
      });
    });
  }

  function seedSample() {
    if (db.vehicles.some(v => v.id.startsWith('demo-'))) { toast('Sample vehicles already added'); return; }
    const t = today();
    const d = n => C.addDays(t, -n);
    const mk = (id, o) => ({ id, createdAt: new Date().toISOString(), trim: '', nickname: '', unit: 'km', oilIntervalDist: 8000, oilIntervalMonths: 6, purchase: null, ...o });
    db.vehicles.push(
      mk('demo-1', { year: '1994', make: 'Mazda', model: 'MX-5 Miata', nickname: 'Demo Miata', odometer: 154200, number: '88', color: '#f6c431',
        purchase: { date: d(900), price: 7500, odometer: 131000, seller: 'Private sale', notes: 'Came with hardtop' } }),
      mk('demo-2', { year: '2019', make: 'Subaru', model: 'WRX', nickname: 'Demo WRX', odometer: 61000, number: '22', color: '#2f6fe4', unit: 'mi', oilIntervalDist: 5000 }),
    );
    let i = 0; const sid = () => 'demo-s' + (++i), pid = () => 'demo-p' + i + Math.random().toString(36).slice(2, 5);
    const add = (vehicleId, daysAgo, odometer, type, parts, extra = {}) => {
      const s = { id: sid(), vehicleId, date: d(daysAgo), odometer, type, title: null, cost: '', shop: '', notes: '', createdAt: new Date().toISOString(), ...extra,
        parts: parts.map(([name, partNo, b]) => ({ id: pid(), name, partNo: partNo || '', qty: 1, showOnBuild: !!b })) };
      db.services.push(s); C.syncBuildFromService(db, s, uid, s.createdAt);
    };
    add('demo-1', 420, 146000, 'upgrade', [['Flyin Miata coilovers', 'FM-CO-NA', true], ['End links', '']], { cost: 1450, shop: 'DIY' });
    add('demo-1', 210, 150400, 'oil', [['Castrol 10W-30', ''], ['Oil filter', 'B6Y1-14-302']], { cost: 48 });
    add('demo-1', 160, 151200, 'repair', [['Clutch master cylinder', 'NA01-41-400'], ['DOT 4 fluid', '']], { cost: 120 });
    add('demo-1', 30, 153900, 'upgrade', [['Sparco seat', 'SPA-008', true]], { cost: 680 });
    add('demo-2', 100, 57400, 'oil', [['Motul 5W-30', ''], ['Oil filter', '15208AA170']], { cost: 92.5 });
    add('demo-2', 20, 60100, 'tire-swap', [['Winter tires', '']], { shop: 'Kal Tire', cost: 120 });
    db.buildSheet.push({ id: uid(), vehicleId: 'demo-1', name: 'Hardtop', brand: 'Mazda OEM', partNo: '', installedDate: null, installedOdo: null,
      removedDate: null, notes: 'Came with the car', sourceServiceId: null, createdAt: new Date().toISOString() });
    [[700, 136500], [500, 141000], [300, 148200], [90, 152600], [5, 154200]].forEach(([n, o]) =>
      db.odometerLogs.push({ id: uid(), vehicleId: 'demo-1', date: d(n), odometer: o, createdAt: new Date().toISOString() }));
    [[60, 58800], [3, 61000]].forEach(([n, o]) => db.odometerLogs.push({ id: uid(), vehicleId: 'demo-2', date: d(n), odometer: o, createdAt: new Date().toISOString() }));
    save(); closeSheet(); render(); toast('Sample vehicles added');
  }
  function unseedSample() {
    const demo = id => String(id).startsWith('demo-');
    db.vehicles = db.vehicles.filter(v => !demo(v.id));
    for (const k of ['services', 'buildSheet', 'odometerLogs']) db[k] = db[k].filter(x => !demo(x.vehicleId));
    save(); closeSheet(); render(); toast('Sample vehicles removed');
  }

  async function exportData() {
    const nowIso = new Date().toISOString();
    const payload = C.exportPayload({ ...db, settings: { ...db.settings, lastBackupAt: nowIso } }, nowIso);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const name = 'pitlog-backup.json';
    const file = new File([blob], name, { type: 'application/json' });
    const mark = () => { db.settings.lastBackupAt = nowIso; save(); render(); };
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); mark(); toast('Backup shared'); }
      catch (e) { if (e && e.name !== 'AbortError') toast('Share failed: ' + e.message); }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      mark(); toast('Backup downloaded');
    }
  }

  function importData(file) {
    const r = new FileReader();
    r.onload = () => {
      let incoming;
      try { incoming = C.migrate(JSON.parse(r.result)); }
      catch (e) {
        openSheet("Can't restore", `<p>${esc(e instanceof C.SchemaError ? e.message : 'That file isn’t a Pit Log backup.')}</p>`,
          `<button class="btn ghost" data-action="close-sheet">OK</button>`);
        return;
      }
      pendingImport = incoming;
      const { added } = C.mergeData(db, incoming);
      const count = d => `${d.vehicles.length} vehicles · ${d.services.length} entries · ${d.buildSheet.length} build parts`;
      openSheet('Restore backup', `
        <div class="card" style="padding:4px 14px;margin-bottom:14px">
          <div class="detail-row"><span class="l">Backup file</span><span class="v">${count(incoming)}</span></div>
          ${incoming.exportedAt ? `<div class="detail-row"><span class="l">Made</span><span class="v">${fmtDate(incoming.exportedAt.slice(0, 10))}</span></div>` : ''}
          <div class="detail-row"><span class="l">On this phone</span><span class="v">${count(db)}</span></div>
        </div>
        <p><b>Merge</b> adds the ${added.vehicles} vehicles and ${added.services} entries this phone doesn't have. Nothing here changes.</p>
        <p><b>Replace</b> makes this phone match the backup exactly. Anything not in the backup is lost.</p>`,
        `<button class="btn ghost" data-action="import-merge">Merge</button><button class="btn primary" data-action="import-replace">Replace</button>`);
    };
    r.readAsText(file);
  }
  let pendingImport = null;

  // ---------- F-05 update prompt ----------
  let waitingSW = null;
  function showUpdate(sw) { waitingSW = sw; $('#update-banner').hidden = false; }
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
        });
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(err => console.warn('SW failed', err));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && waitingSW) { reloading = true; location.reload(); } });
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
    const bar = e.target.closest('.mchart .bar');
    if (bar) { $$('.mchart .bar').forEach(b => b.classList.toggle('on', b === bar)); $('#chart-tip').textContent = bar.dataset.tip; return; }
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
          for (const k of ['services', 'buildSheet', 'odometerLogs']) db[k] = db[k].filter(x => x.vehicleId !== vid);
          save(); closeSheet(); ui.view = 'garage'; render(); toast('Vehicle removed');
        }
        break;
      }
      case 'garage-tab': ui.garageId = vid; render(); break;
      case 'open-garage': ui.garageId = vid; ui.view = 'garage'; render(); window.scrollTo(0, 0); break;
      case 'open-vehicle': ui.garageId = vid; ui.view = 'vehicle'; render(); window.scrollTo(0, 0); break;
      case 'vtab': ui.vTab = a.dataset.tab; render(); break;
      case 'm-mode': ui.mMode = a.dataset.mode; render(); break;
      case 'update-odo': odoForm(vid); break;
      case 'save-odo': saveOdo(vid); break;
      case 'del-odo': if (confirm('Delete this odometer reading?')) { db.odometerLogs = db.odometerLogs.filter(l => l.id !== id); save(); render(); } break;
      case 'add-service': serviceForm(null, { vehicleId: vid, type: a.dataset.type }); break;
      case 'view-service': serviceDetail(id); break;
      case 'edit-service': serviceForm(db.services.find(x => x.id === id)); break;
      case 'save-service': saveService(id); break;
      case 'delete-service': {
        const linked = db.buildSheet.filter(r => r.sourceServiceId === id).length;
        if (confirm('Delete this entry?' + (linked ? ` Its ${linked} build sheet part(s) will be removed too.` : ''))) {
          db.services = db.services.filter(x => x.id !== id);
          db.buildSheet = db.buildSheet.filter(r => r.sourceServiceId !== id);
          save(); closeSheet(); render(); toast('Entry deleted');
        }
        break;
      }
      case 'add-build': buildForm(null, vid); break;
      case 'edit-build': buildForm(id); break;
      case 'save-build': saveBuild(id, vid); break;
      case 'delete-build': deleteBuild(id); break;
      case 'edit-purchase': purchaseForm(vid); break;
      case 'save-purchase': savePurchase(vid); break;
      case 'clear-purchase': if (confirm('Clear purchase details?')) { vehicle(vid).purchase = null; save(); closeSheet(); render(); } break;
      case 'ownership-pdf': ownershipForm(vid); break;
      case 'make-pdf': makePdf(vid); break;
      case 'pro-info': requirePro(a.dataset.feature); break;
      case 'f-vehicle': ui.fVehicle = vid; render(); break;
      case 'export': exportData(); break;
      case 'import': $('#import-file').click(); break;
      case 'import-merge': {
        const { data, added } = C.mergeData(db, pendingImport);
        db = data; pendingImport = null; save(); closeSheet(); render();
        toast(`Merged: +${added.vehicles} vehicles, +${added.services} entries`); break;
      }
      case 'import-replace':
        if (confirm('Replace everything on this phone with the backup?')) {
          db = C.replaceData(db, pendingImport); pendingImport = null; save(); closeSheet(); render(); toast('Backup restored');
        }
        break;
      case 'wipe':
        if (confirm('Erase ALL vehicles and service history from this phone?') && confirm('Really? Back up first if unsure.')) {
          db = { ...C.blank(), settings: db.settings }; save(); closeSheet(); render(); toast('All data erased');
        }
        break;
      case 'version-tap':
        clearTimeout(versionTapT); versionTapT = setTimeout(() => versionTaps = 0, 1500);
        if (++versionTaps >= 5) { versionTaps = 0; devPanel(); }
        break;
      case 'dv-ent': db.settings.entitlement = a.dataset.ent; save(); render(); devPanel(); break;
      case 'dv-date-set': { const v = $('#dv-date').value; if (v) { fakeToday = v; closeSheet(); render(); } break; }
      case 'dv-date-clear': fakeToday = null; closeSheet(); render(); break;
      case 'dv-seed': seedSample(); break;
      case 'dv-unseed': unseedSample(); break;
      case 'apply-update': if (waitingSW) waitingSW.postMessage({ type: 'SKIP_WAITING' }); else location.reload(); break;
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
  window.__pitlog = { get db() { return db; }, version: APP_VERSION, setToday: d => { fakeToday = d; render(); } };
})();

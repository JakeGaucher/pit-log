/* Pit Log core — pure data logic shared by the app and the Node test script.
 * No DOM access in this file. Every function that depends on "today" takes it as a parameter. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PitCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 2;
  const KEY_V1 = 'pitlog.data';   // written by v0.1 only; v0.2+ never writes it
  const KEY_V2 = 'pitlog.v2';

  class SchemaError extends Error {
    constructor(msg, code) { super(msg); this.name = 'SchemaError'; this.code = code; }
  }

  // ---------- dates ----------
  const parseDate = s => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function addMonths(s, m) {
    const d = parseDate(s); if (!d) return null;
    const day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + Number(m));
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return isoDate(d);
  }
  // Calendar-day difference; uses UTC so DST changes don't produce fractional days.
  const dayNum = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);
  const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };

  // ---------- schema / migration (R-01) ----------
  function blank() {
    return { schemaVersion: SCHEMA, settings: { entitlement: 'free' }, vehicles: [], services: [], buildSheet: [], odometerLogs: [] };
  }

  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);

  // v1 → v2: additive only. Existing objects are spread, so unknown fields survive.
  function step1to2(d) {
    const settings = isObj(d.settings) ? d.settings : {};
    return {
      ...d,
      schemaVersion: 2,
      settings: { ...settings, entitlement: settings.entitlement === 'pro' ? 'pro' : (settings.entitlement || 'free') },
      vehicles: (Array.isArray(d.vehicles) ? d.vehicles : []).map(v => ({ ...v, purchase: v.purchase === undefined ? null : v.purchase })),
      services: (Array.isArray(d.services) ? d.services : []).map(s => ({
        ...s,
        title: s.title === undefined ? null : s.title,
        parts: (Array.isArray(s.parts) ? s.parts : []).map(p => ({ ...p, showOnBuild: p.showOnBuild === undefined ? false : p.showOnBuild })),
      })),
      buildSheet: Array.isArray(d.buildSheet) ? d.buildSheet : [],
      odometerLogs: Array.isArray(d.odometerLogs) ? d.odometerLogs : [],
    };
  }

  /** Upgrade any known data shape to the current schema. Throws SchemaError on unusable or newer files. */
  function migrate(data) {
    if (!isObj(data)) throw new SchemaError('Not a Pit Log backup (expected a JSON object).', 'invalid');
    if (!('vehicles' in data) && !('services' in data)) throw new SchemaError('Not a Pit Log backup (no vehicles or services).', 'invalid');
    let v = data.schemaVersion == null ? 1 : Number(data.schemaVersion);
    if (!Number.isFinite(v) || v < 1) throw new SchemaError(`Unknown schemaVersion "${data.schemaVersion}".`, 'invalid');
    if (v > SCHEMA) throw new SchemaError(`This backup was made by a newer version of Pit Log (data v${v}; this app reads up to v${SCHEMA}). Update the app first.`, 'newer');
    let d = data;
    if (v === 1) { d = step1to2(d); v = 2; }
    // future: if (v === 2) { d = step2to3(d); v = 3; }
    if (v === 2 && d === data) d = step1to2(d); // v2 input: fill any missing defaults (no-op when complete)
    return d;
  }

  // ---------- queries ----------
  const servicesFor = (db, id) => db.services.filter(s => s.vehicleId === id);
  const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.odometer) || 0) - (Number(a.odometer) || 0);

  function currentOdo(db, v) {
    const vals = [Number(v.odometer) || 0];
    for (const s of db.services) if (s.vehicleId === v.id) vals.push(Number(s.odometer) || 0);
    for (const l of db.odometerLogs || []) if (l.vehicleId === v.id) vals.push(Number(l.odometer) || 0);
    return Math.max(0, ...vals);
  }

  function oilStatus(db, v, today) {
    const last = servicesFor(db, v.id).filter(s => s.type === 'oil').sort(byDateDesc)[0];
    if (!last) return null;
    const intDist = Number(v.oilIntervalDist) || 8000;
    const intMo = Number(v.oilIntervalMonths) || 6;
    const dueOdo = (Number(last.odometer) || 0) + intDist;
    const dueDate = addMonths(last.date, intMo);
    const odoNow = currentOdo(db, v);
    const distUsed = last.odometer ? (odoNow - Number(last.odometer)) / intDist : 0;
    const totalDays = daysBetween(last.date, dueDate) || 1;
    const timeUsed = daysBetween(last.date, today) / totalDays;
    const used = Math.max(distUsed, timeUsed);
    const kmLeft = dueOdo - odoNow;
    const daysLeft = daysBetween(today, dueDate);
    let state = 'ok';
    if (used >= 1) state = 'overdue';
    else if (used >= 0.85) state = 'soon';
    return { last, dueOdo, dueDate, odoNow, used, kmLeft, daysLeft, state };
  }

  // F-01: Repair / Other / Upgrade entries are named after their parts unless a title is set.
  const NAMED_BY_PARTS = ['repair', 'other', 'upgrade'];
  function entryTitle(s, typeLabel) {
    if (s.title && String(s.title).trim()) return String(s.title).trim();
    if (NAMED_BY_PARTS.includes(s.type)) {
      const named = (s.parts || []).map(p => (p.name || p.partNo || '').trim()).filter(Boolean);
      if (named.length) return named[0] + (named.length > 1 ? ` +${named.length - 1} more` : '');
    }
    return typeLabel(s.type);
  }

  function filterServices(db, f, typeLabel) {
    const q = (f.q || '').trim().toLowerCase();
    return db.services.filter(s => {
      if (f.vehicle && f.vehicle !== 'all' && s.vehicleId !== f.vehicle) return false;
      if (f.type && f.type !== 'all' && s.type !== f.type) return false;
      if (q) {
        const hay = [...(s.parts || []).flatMap(p => [p.name, p.partNo]), s.notes, s.shop, typeLabel(s.type), s.title]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort(byDateDesc);
  }

  // ---------- mileage (F-26) ----------
  /** All dated odometer readings for a vehicle: services, odometer logs, purchase. One per date (highest). */
  function odometerReadings(db, v) {
    const raw = [];
    for (const s of db.services) if (s.vehicleId === v.id && s.date && s.odometer !== '' && s.odometer != null && !isNaN(s.odometer))
      raw.push({ date: s.date, odo: Number(s.odometer), src: 'service', id: s.id });
    for (const l of db.odometerLogs || []) if (l.vehicleId === v.id && l.date && l.odometer !== '' && l.odometer != null)
      raw.push({ date: l.date, odo: Number(l.odometer), src: 'log', id: l.id });
    if (v.purchase && v.purchase.date && v.purchase.odometer !== '' && v.purchase.odometer != null)
      raw.push({ date: v.purchase.date, odo: Number(v.purchase.odometer), src: 'purchase' });
    const byDate = new Map();
    for (const r of raw) if (!byDate.has(r.date) || byDate.get(r.date).odo < r.odo) byDate.set(r.date, r);
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Distance per month ("YYYY-MM") or year ("YYYY"), spread linearly across days between readings.
   *  Segments where the odometer goes backwards are ignored. */
  function mileageBuckets(readings, mode) {
    const out = {};
    const keyOf = iso => mode === 'year' ? iso.slice(0, 4) : iso.slice(0, 7);
    for (let i = 1; i < readings.length; i++) {
      const a = readings[i - 1], b = readings[i];
      const days = daysBetween(a.date, b.date), dist = b.odo - a.odo;
      if (days <= 0 || dist < 0) continue;
      const rate = dist / days;
      let cur = a.date;
      while (daysBetween(cur, b.date) > 0) {
        const d = parseDate(cur);
        const nextMonth = isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 1));
        const segEnd = daysBetween(nextMonth, b.date) > 0 ? nextMonth : b.date;
        const k = keyOf(cur);
        out[k] = (out[k] || 0) + rate * daysBetween(cur, segEnd);
        cur = segEnd;
      }
    }
    return out;
  }

  /** Average distance/day over readings within the last `windowDays` (needs ≥2 readings spanning ≥14 days). */
  function avgPerDay(readings, today, windowDays = 365) {
    const from = addDays(today, -windowDays);
    let r = readings.filter(x => x.date >= from && x.date <= today);
    if (r.length < 2) r = readings.slice(-2);
    if (r.length < 2) return null;
    const a = r[0], b = r[r.length - 1];
    const days = daysBetween(a.date, b.date);
    if (days < 14 || b.odo < a.odo) return null;
    return (b.odo - a.odo) / days;
  }

  // ---------- build sheet (F-02) ----------
  /** Make build-sheet rows match the service's ticked parts. User-entered brand / notes / removedDate are kept. */
  function syncBuildFromService(db, s, uid, nowIso) {
    const ticked = (s.parts || []).filter(p => p.showOnBuild && p.id && (p.name || p.partNo));
    const keep = new Set();
    for (const p of ticked) {
      let row = db.buildSheet.find(r => r.sourceServiceId === s.id && r.sourcePartId === p.id);
      if (!row) {
        row = { id: uid(), vehicleId: s.vehicleId, name: '', brand: '', partNo: '', installedDate: null, installedOdo: null,
                removedDate: null, notes: '', sourceServiceId: s.id, sourcePartId: p.id, createdAt: nowIso };
        db.buildSheet.push(row);
      }
      Object.assign(row, { vehicleId: s.vehicleId, name: p.name || p.partNo, partNo: p.partNo || '',
        installedDate: s.date || null, installedOdo: s.odometer === '' ? null : s.odometer });
      keep.add(row.id);
    }
    db.buildSheet = db.buildSheet.filter(r => r.sourceServiceId !== s.id || keep.has(r.id));
  }

  // ---------- import / export ----------
  const DATA_LISTS = ['vehicles', 'services', 'buildSheet', 'odometerLogs'];

  /** Replace: incoming data wins; this device's settings (entitlement, last backup) are kept. */
  function replaceData(local, incoming) {
    return { ...incoming, settings: { ...incoming.settings, ...local.settings } };
  }
  /** Merge: add records whose id isn't on this device; existing records are left untouched. */
  function mergeData(local, incoming) {
    const out = { ...local };
    const added = {};
    for (const k of DATA_LISTS) {
      const have = new Set((local[k] || []).map(x => x.id));
      const extra = (incoming[k] || []).filter(x => !have.has(x.id));
      out[k] = [...(local[k] || []), ...extra];
      added[k] = extra.length;
    }
    return { data: out, added };
  }
  function exportPayload(db, nowIso) {
    const { exportedAt, ...rest } = db;
    return { ...rest, exportedAt: nowIso };
  }

  return {
    SCHEMA, KEY_V1, KEY_V2, SchemaError,
    parseDate, isoDate, addMonths, addDays, daysBetween,
    blank, migrate, servicesFor, byDateDesc, currentOdo, oilStatus, entryTitle, filterServices,
    odometerReadings, mileageBuckets, avgPerDay, syncBuildFromService, replaceData, mergeData, exportPayload,
  };
});

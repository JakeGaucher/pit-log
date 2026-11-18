// Verbatim logic from Pit Log v0.1 app.js (oil sticker, sort, log filter), parameterised by data and "today".
// Used to prove v0.2 behaves identically on migrated data.
const parseDate = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addMonths = (s, m) => {
  const d = parseDate(s); if (!d) return null;
  const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + Number(m));
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoDate(d);
};
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.odometer) || 0) - (Number(a.odometer) || 0);
const servicesFor = (db, id) => db.services.filter(s => s.vehicleId === id);
function currentOdo(db, v) {
  const logged = servicesFor(db, v.id).map(s => Number(s.odometer) || 0);
  return Math.max(Number(v.odometer) || 0, ...logged, 0);
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
  return { lastId: last.id, dueOdo, dueDate, odoNow, used, kmLeft, daysLeft, state };
}
function filteredServices(db, ui, typeLabel) {
  const q = ui.q.trim().toLowerCase();
  return db.services.filter(s => {
    if (ui.fVehicle !== 'all' && s.vehicleId !== ui.fVehicle) return false;
    if (ui.fType !== 'all' && s.type !== ui.fType) return false;
    if (q) {
      const hay = [...(s.parts || []).flatMap(p => [p.name, p.partNo]), s.notes, s.shop, typeLabel(s.type)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort(byDateDesc);
}
module.exports = { oilStatus, filteredServices, byDateDesc };

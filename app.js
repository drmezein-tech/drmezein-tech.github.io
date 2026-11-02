'use strict';
const app = document.getElementById('app');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => v == null ? '' : String(v).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- dates ----------
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const toUTC = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const addDays = (s, n) => new Date(toUTC(s) + n * 86400000).toISOString().slice(0, 10);
const fmtDate = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
const fmtShort = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '';
const fmtNum = v => v == null || v === '' ? '' : String(Number(v));

// ---------- Kuwait Civil ID: [century][YYMMDD][5 digits] ----------
function cidBirth(cid) {
  if (!/^\d{12}$/.test(cid || '')) return null;
  const cent = { '2': 1900, '3': 2000 }[cid[0]];
  if (!cent) return null;
  const y = cent + Number(cid.slice(1, 3)), m = Number(cid.slice(3, 5)), d = Number(cid.slice(5, 7));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const iso = dt.toISOString().slice(0, 10);
  return iso > todayISO() ? null : iso;
}
function ageFrom(birth, on = todayISO()) {
  if (!birth) return null;
  let a = Number(on.slice(0, 4)) - Number(birth.slice(0, 4));
  if (on.slice(5) < birth.slice(5)) a--;
  return a;
}
const patientAge = p => ageFrom(cidBirth(p.cid));

// ---------- settings ----------
const getSetting = (k, def) => { const r = DB.one('SELECT value FROM settings WHERE key=?', [k]); return r ? r.value : def; };
const setSetting = (k, v) => DB.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, String(v)]);

// ---------- fields & reference ranges (SI) ----------
// BP is stored as two columns but entered as one "120/80" field.
const BP = [
  { k: 'bp_sys', l: 'SBP', u: 'mmHg', r: [90, 140] },
  { k: 'bp_dia', l: 'DBP', u: 'mmHg', r: [60, 90] },
];
const VITALS = [
  { k: 'hr', l: 'HR', u: 'bpm', r: [60, 100] },
  { k: 'temp', l: 'Temp', u: '°C', r: [36, 37.9] },
  { k: 'weight', l: 'Weight', u: 'kg' },
];
const FLUIDS = [
  { k: 'oral_in', l: 'Oral in', u: 'mL' },
  { k: 'iv_in', l: 'IV in', u: 'mL' },
  { k: 'uop', l: 'UOP', u: 'mL' },
];
const LABS = [
  { k: 'wbc', l: 'WBC', u: '×10⁹/L', r: [4, 11] },
  { k: 'hb', l: 'Hb', u: 'g/L', r: [120, 170] },
  { k: 'plt', l: 'Plt', u: '×10⁹/L', r: [150, 400] },
  { k: 'k', l: 'K', u: 'mmol/L', r: [3.5, 5.0] },
  { k: 'pct', l: 'PCT', u: 'ng/mL', r: [0, 0.5] },
  { k: 'crp', l: 'CRP', u: 'mg/L', r: [0, 5] },
  { k: 'creat', l: 'Creat', u: 'µmol/L', r: [60, 110] },
  { k: 'tac', l: 'Tac', u: 'ng/mL' },
];
const FIELD = Object.fromEntries([...BP, ...VITALS, ...FLUIDS, ...LABS].map(f => [f.k, f]));
const TEXT_FIELDS = ['clinical_notes', 'free_notes'];

function range(f) {
  if (f.k === 'tac') return [Number(getSetting('tac_low', 8)), Number(getSetting('tac_high', 10))];
  return f.r;
}
function flag(f, v) {
  const r = range(f);
  if (v == null || v === '' || !r) return 0;
  v = Number(v);
  return v < r[0] ? -1 : v > r[1] ? 1 : 0;
}

const INDUCTION = ['Thymoglobulin', 'Simulect', 'None'];
const MAINTENANCE = ['Tacrolimus', 'MMF', 'Myfortic', 'Prednisolone', 'Everolimus', 'Sirolimus', 'Azathioprine', 'Cyclosporine'];
const INF_TYPES = ['UTI', 'Wound', 'Chest / Pneumonia', 'Bloodstream', 'Line-related', 'Intra-abdominal', 'CMV', 'BK virus', 'Fungal'];
const SAMPLES = ['Urine', 'Blood', 'Wound swab', 'Sputum', 'Drain fluid', 'Line tip', 'BAL'];
const RAD_TYPES = ['US Doppler graft', 'CXR', 'CT abdomen', 'CT chest', 'MRI', 'Renogram (DTPA/MAG3)'];
const ABX = ['Meropenem', 'Piperacillin-tazobactam', 'Ceftriaxone', 'Cefepime', 'Ceftazidime', 'Vancomycin', 'Linezolid',
  'Ciprofloxacin', 'Levofloxacin', 'Amikacin', 'Gentamicin', 'Colistin', 'Tigecycline', 'Ertapenem', 'Nitrofurantoin',
  'Co-trimoxazole', 'Metronidazole', 'Amoxicillin-clavulanate', 'Fluconazole', 'Caspofungin', 'Ganciclovir', 'Valganciclovir'];

// ---------- patient helpers ----------
const getPatient = id => DB.one('SELECT * FROM patients WHERE id=?', [id]);
const maintList = p => { try { return JSON.parse(p.maintenance || '[]'); } catch { return []; } };
const isOnWard = p => !p.discharge_date || p.discharge_date > todayISO();
const endDate = p => { const t = todayISO(); return p.discharge_date && p.discharge_date < t ? p.discharge_date : t; };
function dayLabel(p, date) {
  if (p.op_date && date >= p.op_date) return 'POD ' + diffDays(p.op_date, date);
  if (p.admit_date) return 'Pre-op D' + (diffDays(p.admit_date, date) + 1);
  return '';
}
function prevVal(pid, date, k) {
  return DB.one(`SELECT date, ${k} AS v FROM days WHERE patient_id=? AND date<? AND ${k} IS NOT NULL ORDER BY date DESC LIMIT 1`, [pid, date]);
}
function latestVal(pid, date, k) {
  return DB.one(`SELECT date, ${k} AS v FROM days WHERE patient_id=? AND date<=? AND ${k} IS NOT NULL ORDER BY date DESC LIMIT 1`, [pid, date]);
}
function infectionsFor(pid) {
  const inf = DB.all('SELECT * FROM infections WHERE patient_id=? ORDER BY culture_date DESC, id DESC', [pid]);
  inf.forEach(i => { i.abx = DB.all('SELECT * FROM antibiotics WHERE infection_id=? ORDER BY start_date, id', [i.id]); });
  return inf;
}
const infActiveOn = (i, d) => (!i.culture_date || i.culture_date <= d) && (!i.resolved_date || i.resolved_date >= d);
function abxLabel(a, d) {
  if (!a.start_date) return a.name;
  if (d < a.start_date) return `${a.name} (from ${fmtShort(a.start_date)})`;
  if (a.stop_date && d > a.stop_date) return `${a.name} (stopped ${fmtShort(a.stop_date)})`;
  return `${a.name} D${diffDays(a.start_date, d) + 1}`;
}
const radiologyFor = pid => DB.all('SELECT * FROM radiology WHERE patient_id=? ORDER BY date DESC, id DESC', [pid]);

function ensureDay(pid, date) {
  DB.run('INSERT OR IGNORE INTO days(patient_id,date) VALUES(?,?)', [pid, date]);
}
function saveDayField(pid, date, k, v) {
  if (!FIELD[k] && !TEXT_FIELDS.includes(k)) return;
  DB.run(`INSERT INTO days(patient_id,date,${k}) VALUES(?,?,?) ON CONFLICT(patient_id,date) DO UPDATE SET ${k}=excluded.${k}`, [pid, date, v]);
}

// ---------- debounced saves (flushed on navigation / backgrounding) ----------
const pending = new Map();
function queueSave(key, fn) {
  const old = pending.get(key);
  if (old) clearTimeout(old.t);
  pending.set(key, { fn, t: setTimeout(() => { pending.delete(key); fn(); }, 400) });
}
function flushSaves() {
  for (const { t, fn } of pending.values()) { clearTimeout(t); fn(); }
  pending.clear();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flushSaves(); DB.saveNow(); }
});
window.addEventListener('pagehide', () => { flushSaves(); DB.saveNow(); });

// ---------- UI helpers ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}
const header = (title, left = '', right = '') =>
  `<header class="top"><div class="hside">${left}</div><h1>${title}</h1><div class="hside right">${right}</div></header>`;
const back = href => `<a class="hbtn" href="${href}">‹ Back</a>`;

function modal(html) {
  const ov = document.createElement('div');
  ov.className = 'ovl';
  ov.innerHTML = `<div class="sheet">${html}</div>`;
  document.body.appendChild(ov);
  document.body.classList.add('noscroll');
  const close = () => { ov.remove(); document.body.classList.remove('noscroll'); };
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  $$('[data-close]', ov).forEach(b => b.addEventListener('click', close));
  return { el: ov, close };
}

function selOther(name, opts, val) {
  const inList = !val || opts.includes(val);
  return `<div class="selother"><select name="${name}">
    <option value="">—</option>
    ${opts.map(o => `<option ${inList && o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    <option value="__other" ${inList ? '' : 'selected'}>Other…</option></select>
    <input name="${name}_other" placeholder="Specify" value="${inList ? '' : esc(val)}" class="${inList ? 'hide' : ''}"></div>`;
}
function bindSelOther(root) {
  $$('.selother select', root).forEach(s => s.addEventListener('change', () => {
    const inp = s.nextElementSibling;
    inp.classList.toggle('hide', s.value !== '__other');
    if (s.value === '__other') inp.focus();
  }));
}
function readSel(form, name) {
  const v = form.elements[name].value;
  return v === '__other' ? form.elements[name + '_other'].value.trim() || null : v || null;
}
const val = (form, name) => (form.elements[name].value || '').trim() || null;

function shareOrDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file], title: file.name });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return Promise.resolve();
}

// ---------- router ----------
function go(h) { location.hash = h; }
function route() {
  flushSaves();
  $$('.ovl').forEach(o => o.remove());
  document.body.classList.remove('noscroll');
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'p': return renderDay(Number(parts[1]), parts[2]);
    case 'new': return renderProfile(null, parts[1] ? Number(parts[1]) : null);
    case 'edit': return renderProfile(Number(parts[1]));
    case 'archive': return renderArchive();
    case 'settings': return renderSettings();
    default: return renderWard();
  }
}

// ---------- ward list ----------
function wardAlerts(p, t) {
  const out = [];
  for (const f of LABS) {
    const lv = latestVal(p.id, t, f.k);
    const fl = lv ? flag(f, lv.v) : 0;
    if (fl) out.push(`<span class="chip red">${f.l}${fl > 0 ? '↑' : '↓'}</span>`);
  }
  infectionsFor(p.id).filter(i => infActiveOn(i, t))
    .forEach(i => out.push(`<span class="chip inf">🦠 ${esc(i.type || 'Infection')}</span>`));
  return out.join('');
}
function backupBanner() {
  const last = getSetting('last_backup', '');
  if (last === todayISO()) return '';
  return `<div class="banner"><div><b>Today's backup isn't saved.</b><br><span>Last backup: ${last ? fmtDate(last) : 'never'}</span></div>
    <button class="btn small" data-act="backup">Save backup</button></div>`;
}
function renderWard() {
  const t = todayISO();
  const pts = DB.all('SELECT * FROM patients WHERE discharge_date IS NULL OR discharge_date>?', [t])
    .sort((a, b) => (a.room || '').localeCompare(b.room || '', undefined, { numeric: true }));
  const rows = pts.map(p => {
    const age = patientAge(p), alerts = wardAlerts(p, t);
    return `<a class="prow" href="#/p/${p.id}">
      <div class="room">${esc(p.room || '–')}</div>
      <div class="pmain">
        <div class="pname">${esc(p.name)}${age != null ? `<span class="muted"> · ${age}y</span>` : ''}</div>
        <div class="psub"><b>${esc(dayLabel(p, t))}</b>${p.diagnosis ? ' · ' + esc(p.diagnosis) : ''}</div>
        ${alerts ? `<div class="alerts">${alerts}</div>` : ''}
      </div><div class="chev">›</div></a>`;
  }).join('');
  app.innerHTML = header('The Ward', `<a class="hbtn" href="#/archive">Archive</a>`, `<a class="hbtn" href="#/settings" aria-label="Settings">Settings</a>`) +
    `<main>${backupBanner()}
      <div class="count">${pts.length} patient${pts.length === 1 ? '' : 's'} · ${fmtDate(t)}</div>
      <div class="list">${rows || '<div class="empty">No patients on the ward.<br>Tap <b>+</b> to admit one.</div>'}</div>
    </main><a class="fab" href="#/new" aria-label="Admit patient">+</a>`;
  const b = $('[data-act=backup]');
  if (b) b.onclick = () => saveBackup().then(ok => ok && renderWard());
}

// ---------- patient profile (admit / edit) ----------
function renderProfile(id, fromId) {
  const t = todayISO();
  let p;
  if (id) { p = getPatient(id); if (!p) return go('#/'); }
  else if (fromId) { const o = getPatient(fromId) || {}; p = { name: o.name, cid: o.cid, diagnosis: o.diagnosis, admit_date: t, maintenance: '[]' }; }
  else p = { admit_date: t, maintenance: '[]' };
  const m = maintList(p);
  app.innerHTML = header(id ? 'Edit patient' : 'Admit patient', back(id ? `#/p/${id}` : '#/')) + `<main>
    <form class="form" id="pf" autocomplete="off">
      <div class="row2">
        <label>Room No.<input name="room" value="${esc(p.room)}" inputmode="text"></label>
        <label>Admission date<input type="date" name="admit_date" value="${esc(p.admit_date)}" required></label>
      </div>
      <label>Patient name<input name="name" value="${esc(p.name)}" required></label>
      <label>CID (12 digits)<input name="cid" value="${esc(p.cid)}" inputmode="numeric" maxlength="12"></label>
      <div class="hint" id="cidinfo"></div>
      <label>Diagnosis<input name="diagnosis" value="${esc(p.diagnosis)}"></label>
      <div class="row2">
        <label>Operative date<input type="date" name="op_date" value="${esc(p.op_date)}"></label>
        <label>Operation<input name="operation" value="${esc(p.operation)}"></label>
      </div>
      <fieldset><legend>Induction</legend><div class="pills">
        ${INDUCTION.map(o => `<label class="pill"><input type="radio" name="induction" value="${o}" ${p.induction === o ? 'checked' : ''}><span>${o}</span></label>`).join('')}
      </div></fieldset>
      <fieldset><legend>Maintenance <span class="muted">(2–3)</span></legend><div class="pills">
        ${MAINTENANCE.map(o => `<label class="pill"><input type="checkbox" name="maint" value="${o}" ${m.includes(o) ? 'checked' : ''}><span>${o}</span></label>`).join('')}
      </div></fieldset>
      ${id ? `<label>Discharge date<input type="date" name="discharge_date" value="${esc(p.discharge_date)}"></label>` : ''}
      <div class="err" id="perr"></div>
      <button class="btn primary block" type="submit">${id ? 'Save' : 'Admit'}</button>
      ${id ? `<button class="btn danger block" type="button" id="pdel">Delete patient permanently</button>` : ''}
    </form></main>`;

  const f = $('#pf'), info = $('#cidinfo');
  const showCid = () => {
    const c = f.elements.cid.value.trim();
    if (!c) { info.textContent = ''; info.className = 'hint'; return; }
    const b = cidBirth(c);
    info.className = b ? 'hint ok' : 'hint bad';
    info.textContent = b ? `Age ${ageFrom(b)} · born ${fmtDate(b)}` : (c.length < 12 ? `${c.length}/12 digits` : 'Invalid CID');
  };
  f.elements.cid.addEventListener('input', showCid);
  showCid();

  f.onsubmit = e => {
    e.preventDefault();
    const err = $('#perr');
    const d = {
      room: val(f, 'room'), name: val(f, 'name'), cid: val(f, 'cid'), admit_date: val(f, 'admit_date'),
      diagnosis: val(f, 'diagnosis'), op_date: val(f, 'op_date'), operation: val(f, 'operation'),
      induction: (f.querySelector('[name=induction]:checked') || {}).value || null,
      maintenance: JSON.stringify($$('[name=maint]:checked', f).map(x => x.value)),
      discharge_date: id ? val(f, 'discharge_date') : null,
    };
    if (!d.name) return (err.textContent = 'Name is required.');
    if (!d.admit_date) return (err.textContent = 'Admission date is required.');
    if (d.cid && !cidBirth(d.cid)) return (err.textContent = 'CID must be a valid 12-digit Kuwait Civil ID.');
    if (d.discharge_date && d.discharge_date < d.admit_date) return (err.textContent = 'Discharge date is before admission.');
    if (!id && d.cid) {
      const dup = DB.one('SELECT name, room FROM patients WHERE cid=? AND (discharge_date IS NULL OR discharge_date>?)', [d.cid, todayISO()]);
      if (dup && !confirm(`${dup.name} (room ${dup.room || '–'}) with this CID is already on the ward. Admit anyway?`)) return;
    }
    const cols = Object.keys(d);
    if (id) {
      DB.run(`UPDATE patients SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`, [...cols.map(c => d[c]), id]);
      toast('Saved');
      go(d.discharge_date && d.discharge_date <= todayISO() ? '#/' : `#/p/${id}`);
    } else {
      const nid = DB.run(`INSERT INTO patients(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, cols.map(c => d[c]));
      toast('Patient admitted');
      go(`#/p/${nid}`);
    }
  };
  if (id) $('#pdel').onclick = () => {
    if (!confirm(`Permanently delete ${p.name} and all their day pages? This cannot be undone.`)) return;
    DB.run('DELETE FROM antibiotics WHERE infection_id IN (SELECT id FROM infections WHERE patient_id=?)', [id]);
    ['days', 'infections', 'radiology'].forEach(tb => DB.run(`DELETE FROM ${tb} WHERE patient_id=?`, [id]));
    DB.run('DELETE FROM patients WHERE id=?', [id]);
    toast('Patient deleted');
    go('#/');
  };
}

// ---------- day page ----------
function arrow(v, prev) {
  if (v == null || v === '' || !prev) return '';
  const n = Number(v);
  return n > prev ? '↑' : n < prev ? '↓' : '→';
}
const agoText = (d, on) => { const n = diffDays(d, on); return n === 1 ? 'yest' : `${n}d ago`; };
const flagCls = (f, v) => ({ 1: 'hi', '-1': 'lo' }[flag(f, v)] || '');

function cell(f, day, pid, date) {
  const v = day[f.k], prev = prevVal(pid, date, f.k);
  const r = range(f);
  return `<label class="cell ${flagCls(f, v)}">
    <span class="cl">${f.l} <em>${f.u}</em></span>
    <span class="cv"><input inputmode="decimal" data-field="${f.k}" data-prev="${prev ? prev.v : ''}" value="${fmtNum(v)}"><i class="arrow">${arrow(v, prev && prev.v)}</i></span>
    <span class="prev">${prev ? `${fmtNum(prev.v)} · ${agoText(prev.date, date)}` : (r ? `${r[0]}–${r[1]}` : '&nbsp;')}</span>
  </label>`;
}
const bpText = (s, d) => `${fmtNum(s)}/${fmtNum(d)}`;
const bpFlag = (s, d) => flag(FIELD.bp_sys, s) || flag(FIELD.bp_dia, d);
// Accepts 120/80, 120.80, 120,80 or "120 80" (the phone number pad has no slash).
function parseBP(str) {
  const s = str.trim();
  if (!s) return { s: null, d: null };
  const m = s.match(/^(\d{2,3})\s*[\/.,\s-]\s*(\d{2,3})$/);
  return m ? { s: Number(m[1]), d: Number(m[2]) } : null;
}
function bpCell(day, pid, date) {
  const s = day.bp_sys, d = day.bp_dia, fl = bpFlag(s, d);
  const prev = DB.one(`SELECT date, bp_sys, bp_dia FROM days WHERE patient_id=? AND date<?
    AND (bp_sys IS NOT NULL OR bp_dia IS NOT NULL) ORDER BY date DESC LIMIT 1`, [pid, date]);
  return `<label class="cell ${fl > 0 ? 'hi' : fl < 0 ? 'lo' : ''}">
    <span class="cl">BP <em>mmHg</em></span>
    <span class="cv"><input inputmode="decimal" data-bp data-prev="${prev && prev.bp_sys != null ? prev.bp_sys : ''}" placeholder="120/80"
      value="${s == null && d == null ? '' : bpText(s, d)}"><i class="arrow">${arrow(s, prev && prev.bp_sys)}</i></span>
    <span class="prev">${prev ? `${bpText(prev.bp_sys, prev.bp_dia)} · ${agoText(prev.date, date)}` : '90–140/60–90'}</span>
  </label>`;
}
function bindBP(pid, date) {
  const inp = $('[data-bp]'), c = inp.closest('.cell');
  const prev = inp.dataset.prev === '' ? null : Number(inp.dataset.prev);
  inp.addEventListener('input', () => {
    const bp = parseBP(inp.value);
    if (!bp) return;
    c.classList.remove('hi', 'lo', 'invalid');
    const fl = bpFlag(bp.s, bp.d);
    if (fl) c.classList.add(fl > 0 ? 'hi' : 'lo');
    $('.arrow', c).textContent = arrow(bp.s, prev);
    queueSave('bp', () => { saveDayField(pid, date, 'bp_sys', bp.s); saveDayField(pid, date, 'bp_dia', bp.d); });
  });
  inp.addEventListener('blur', () => {
    const bp = parseBP(inp.value);
    c.classList.toggle('invalid', !bp);
    if (bp && bp.s != null) inp.value = bpText(bp.s, bp.d);
  });
}
function balanceHtml(day) {
  const has = ['oral_in', 'iv_in', 'uop'].some(k => day[k] != null && day[k] !== '');
  if (!has) return '<span class="muted">—</span>';
  const inn = (Number(day.oral_in) || 0) + (Number(day.iv_in) || 0), b = inn - (Number(day.uop) || 0);
  return `In ${inn} · Out ${Number(day.uop) || 0} · <b class="${b < 0 ? 'neg' : 'pos'}">Bal ${b > 0 ? '+' : ''}${b} mL</b>`;
}
function infCard(i, date) {
  const active = infActiveOn(i, date);
  return `<button class="card inf ${active ? '' : 'resolved'}" data-inf="${i.id}">
    <div class="ct"><b>${esc(i.type || 'Infection')}</b>${i.resolved_date ? `<span class="chip">resolved ${fmtShort(i.resolved_date)}</span>` : ''}</div>
    <div>${esc(i.sample || '')}${i.culture_date ? ` · sent ${fmtShort(i.culture_date)}` : ''}${i.organism ? ` → <b>${esc(i.organism)}</b>` : ''}</div>
    ${i.sensitivity ? `<div class="muted">Sens: ${esc(i.sensitivity)}</div>` : ''}
    ${i.abx.length ? `<div class="abxl">${i.abx.map(a => `<span class="chip ${active && a.start_date && date >= a.start_date && (!a.stop_date || date <= a.stop_date) ? 'abx' : ''}">${esc(abxLabel(a, date))}</span>`).join('')}</div>` : ''}
  </button>`;
}

function renderDay(pid, date) {
  const p = getPatient(pid);
  if (!p) return go('#/');
  const end = endDate(p);
  let start = p.admit_date || end;
  if (start > end) start = end;
  if (!date || date > end) date = end;
  if (date < start) date = start;
  if (isOnWard(p) && date === todayISO()) ensureDay(pid, date);

  const day = DB.one('SELECT * FROM days WHERE patient_id=? AND date=?', [pid, date]) || {};
  const recorded = new Set(DB.all('SELECT date FROM days WHERE patient_id=?', [pid]).map(r => r.date));
  let chips = '';
  for (let d = start; d <= end; d = addDays(d, 1)) {
    chips += `<a class="dchip ${d === date ? 'on' : ''} ${recorded.has(d) ? '' : 'gap'}" href="#/p/${pid}/${d}">
      <b>${esc(dayLabel(p, d))}</b><span>${fmtShort(d)}</span></a>`;
  }
  const age = patientAge(p), m = maintList(p);
  const infs = infectionsFor(pid), act = infs.filter(i => infActiveOn(i, date)), rest = infs.filter(i => !infActiveOn(i, date));
  const rads = radiologyFor(pid);

  app.innerHTML = header(esc(p.name), back(isOnWard(p) ? '#/' : '#/archive'), `<a class="hbtn" href="#/edit/${pid}">Edit</a>`) + `
  <div class="strip" id="strip">${chips}</div>
  <main id="daymain">
    <section class="profile">
      <div class="prof1"><span class="room">${esc(p.room || '–')}</span>
        <div><b>${esc(dayLabel(p, date))}</b> · ${fmtDate(date)}${p.discharge_date ? ` <span class="chip">${p.discharge_date <= todayISO() ? 'Discharged' : 'Discharge'} ${fmtShort(p.discharge_date)}</span>` : ''}<br>
        <span class="muted">${age != null ? age + 'y · ' : ''}CID ${esc(p.cid || '—')} · Adm ${fmtShort(p.admit_date)}</span></div></div>
      <div class="kv"><span>Dx</span>${esc(p.diagnosis || '—')}</div>
      <div class="kv"><span>Op</span>${esc(p.operation || '—')}${p.op_date ? ` <span class="muted">(${fmtDate(p.op_date)})</span>` : ''}</div>
      <div class="kv"><span>IS</span>${esc(p.induction || '—')} <span class="muted">→</span> ${m.length ? esc(m.join(', ')) : '—'}</div>
    </section>

    <section><h2>Vital signs</h2><div class="grid">${bpCell(day, pid, date)}${VITALS.map(f => cell(f, day, pid, date)).join('')}</div></section>
    <section><h2>Fluids</h2><div class="grid g3">${FLUIDS.map(f => cell(f, day, pid, date)).join('')}</div>
      <div class="balance" id="bal">${balanceHtml(day)}</div></section>
    <section><h2>Labs</h2><div class="grid">${LABS.map(f => cell(f, day, pid, date)).join('')}</div></section>
    <section><h2>Clinical notes</h2><textarea data-field="clinical_notes" rows="4" placeholder="Examination, plan…">${esc(day.clinical_notes)}</textarea></section>

    <section><div class="sh"><h2>Infection</h2><button class="btn small" id="addinf">+ Add</button></div>
      ${act.length ? act.map(i => infCard(i, date)).join('') : '<div class="muted pad">No active infection on this day.</div>'}
      ${rest.length ? `<details><summary>Other episodes (${rest.length})</summary>${rest.map(i => infCard(i, date)).join('')}</details>` : ''}
    </section>

    <section><div class="sh"><h2>Radiology</h2><button class="btn small" id="addrad">+ Add</button></div>
      ${rads.length ? rads.map(r => `<button class="card rad ${r.date === date ? 'today' : ''}" data-rad="${r.id}">
        <div class="ct"><b>${esc(r.type || 'Study')}</b><span class="muted">${fmtDate(r.date)}</span></div>
        <div>${esc(r.finding || '')}</div></button>`).join('') : '<div class="muted pad">No studies yet.</div>'}
    </section>

    <section><h2>Notes</h2><textarea data-field="free_notes" rows="3" placeholder="Free notes">${esc(day.free_notes)}</textarea></section>

    <div class="actions">
      <button class="btn" id="share">Share text</button>
      <button class="btn" id="pdf">PDF of stay</button>
      ${isOnWard(p) ? '<button class="btn danger" id="dc">Discharge</button>' : `<a class="btn" href="#/new/${pid}">Re-admit</a>`}
    </div>
  </main>`;

  const on = $('.dchip.on');
  if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });

  // autosave inputs
  const cur = { ...day };
  $$('[data-field]').forEach(inp => inp.addEventListener('input', () => {
    const k = inp.dataset.field;
    if (TEXT_FIELDS.includes(k)) {
      const v = inp.value.trim() ? inp.value : null;
      return queueSave(k, () => saveDayField(pid, date, k, v));
    }
    const s = inp.value.trim().replace(',', '.'), n = s === '' ? null : Number(s);
    const c = inp.closest('.cell');
    c.classList.toggle('invalid', s !== '' && !isFinite(n));
    if (s !== '' && !isFinite(n)) return;
    const f = FIELD[k], prev = inp.dataset.prev === '' ? null : Number(inp.dataset.prev);
    c.classList.remove('hi', 'lo');
    const fc = flagCls(f, n);
    if (fc) c.classList.add(fc);
    $('.arrow', c).textContent = arrow(n, prev);
    cur[k] = n;
    if (FLUIDS.includes(f)) $('#bal').innerHTML = balanceHtml(cur);
    queueSave(k, () => saveDayField(pid, date, k, n));
  }));

  bindBP(pid, date);

  // swipe between days
  const dates = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  const idx = dates.indexOf(date);
  attachSwipe($('#daymain'),
    () => idx < dates.length - 1 && location.replace(`#/p/${pid}/${dates[idx + 1]}`),
    () => idx > 0 && location.replace(`#/p/${pid}/${dates[idx - 1]}`));

  $('#addinf').onclick = () => infectionModal(pid, null, date);
  $$('[data-inf]').forEach(b => b.onclick = () => infectionModal(pid, Number(b.dataset.inf), date));
  $('#addrad').onclick = () => radiologyModal(pid, null, date);
  $$('[data-rad]').forEach(b => b.onclick = () => radiologyModal(pid, Number(b.dataset.rad), date));
  $('#share').onclick = () => { flushSaves(); shareText(pid, date); };
  $('#pdf').onclick = () => { flushSaves(); exportPdf(pid); };
  const dc = $('#dc');
  if (dc) dc.onclick = () => dischargeModal(p);
}

function attachSwipe(el, onLeft, onRight) {
  let x0 = null, y0 = 0, t0 = 0;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('textarea, .ovl')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Date.now() - t0 < 700 && Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) (dx < 0 ? onLeft : onRight)();
  });
}

// ---------- infection episode ----------
function abxRow(a = {}) {
  return `<div class="abxrow">
    <input class="an" list="abxlist" placeholder="Antibiotic" value="${esc(a.name)}">
    <label>Start<input type="date" class="as" value="${esc(a.start_date)}"></label>
    <label>Stop<input type="date" class="ae" value="${esc(a.stop_date)}"></label>
    <button type="button" class="x" aria-label="Remove">×</button></div>`;
}
function infectionModal(pid, id, date) {
  const i = id ? infectionsFor(pid).find(x => x.id === id) : { culture_date: date, abx: [] };
  const md = modal(`<form class="form" id="inff" autocomplete="off">
    <h2>${id ? 'Infection episode' : 'New infection'}</h2>
    <label>Type${selOther('type', INF_TYPES, i.type)}</label>
    <div class="row2"><label>Culture sample${selOther('sample', SAMPLES, i.sample)}</label>
      <label>Culture date<input type="date" name="culture_date" value="${esc(i.culture_date)}"></label></div>
    <label>Organism<input name="organism" value="${esc(i.organism)}" placeholder="Pending / No growth / E. coli ESBL…" list="orglist"></label>
    <label>Sensitivity<textarea name="sensitivity" rows="2" placeholder="S: Mero, Amikacin · R: Cipro">${esc(i.sensitivity)}</textarea></label>
    <fieldset><legend>Antibiotics</legend><div id="abxs">${i.abx.map(abxRow).join('')}</div>
      <button type="button" class="btn small" id="addabx">+ Antibiotic</button></fieldset>
    <label>Resolved on <span class="muted">(leave empty while active)</span><input type="date" name="resolved_date" value="${esc(i.resolved_date)}"></label>
    <datalist id="abxlist">${ABX.map(a => `<option value="${a}">`).join('')}</datalist>
    <datalist id="orglist">${['Pending', 'No growth', 'E. coli', 'E. coli ESBL', 'Klebsiella pneumoniae', 'Klebsiella CRE', 'Pseudomonas aeruginosa', 'Enterococcus faecalis', 'Enterococcus VRE', 'Staph aureus', 'MRSA', 'Acinetobacter baumannii', 'Candida'].map(a => `<option value="${a}">`).join('')}</datalist>
    <div class="mbtns">${id ? '<button type="button" class="btn danger" id="infdel">Delete</button>' : ''}
      <button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>
  </form>`);
  const f = $('#inff', md.el);
  bindSelOther(f);
  const abxs = $('#abxs', f);
  abxs.addEventListener('click', e => { if (e.target.classList.contains('x')) e.target.closest('.abxrow').remove(); });
  $('#addabx', f).onclick = () => { abxs.insertAdjacentHTML('beforeend', abxRow({ start_date: date })); $('.abxrow:last-child .an', abxs).focus(); };
  f.onsubmit = e => {
    e.preventDefault();
    const d = [readSel(f, 'type'), readSel(f, 'sample'), val(f, 'organism'), val(f, 'sensitivity'), val(f, 'culture_date'), val(f, 'resolved_date')];
    let iid = id;
    if (id) DB.run('UPDATE infections SET type=?, sample=?, organism=?, sensitivity=?, culture_date=?, resolved_date=? WHERE id=?', [...d, id]);
    else iid = DB.run('INSERT INTO infections(type,sample,organism,sensitivity,culture_date,resolved_date,patient_id) VALUES(?,?,?,?,?,?,?)', [...d, pid]);
    DB.run('DELETE FROM antibiotics WHERE infection_id=?', [iid]);
    $$('.abxrow', f).forEach(r => {
      const n = $('.an', r).value.trim();
      if (n) DB.run('INSERT INTO antibiotics(infection_id,name,start_date,stop_date) VALUES(?,?,?,?)', [iid, n, $('.as', r).value || null, $('.ae', r).value || null]);
    });
    md.close();
    renderDay(pid, date);
  };
  const del = $('#infdel', f);
  if (del) del.onclick = () => {
    if (!confirm('Delete this infection episode?')) return;
    DB.run('DELETE FROM antibiotics WHERE infection_id=?', [id]);
    DB.run('DELETE FROM infections WHERE id=?', [id]);
    md.close();
    renderDay(pid, date);
  };
}

// ---------- radiology ----------
function radiologyModal(pid, id, date) {
  const r = id ? DB.one('SELECT * FROM radiology WHERE id=?', [id]) : { date };
  const md = modal(`<form class="form" id="radf" autocomplete="off">
    <h2>${id ? 'Radiology' : 'New study'}</h2>
    <div class="row2"><label>Date<input type="date" name="date" value="${esc(r.date)}" required></label>
      <label>Type${selOther('type', RAD_TYPES, r.type)}</label></div>
    <label>Finding<textarea name="finding" rows="4">${esc(r.finding)}</textarea></label>
    <div class="mbtns">${id ? '<button type="button" class="btn danger" id="raddel">Delete</button>' : ''}
      <button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>
  </form>`);
  const f = $('#radf', md.el);
  bindSelOther(f);
  f.onsubmit = e => {
    e.preventDefault();
    const d = [val(f, 'date'), readSel(f, 'type'), val(f, 'finding')];
    if (id) DB.run('UPDATE radiology SET date=?, type=?, finding=? WHERE id=?', [...d, id]);
    else DB.run('INSERT INTO radiology(date,type,finding,patient_id) VALUES(?,?,?,?)', [...d, pid]);
    md.close();
    renderDay(pid, date);
  };
  const del = $('#raddel', f);
  if (del) del.onclick = () => {
    if (!confirm('Delete this study?')) return;
    DB.run('DELETE FROM radiology WHERE id=?', [id]);
    md.close();
    renderDay(pid, date);
  };
}

// ---------- discharge ----------
function dischargeModal(p) {
  const md = modal(`<form class="form" id="dcf"><h2>Discharge ${esc(p.name)}</h2>
    <label>Discharge date<input type="date" name="d" value="${todayISO()}" required></label>
    <p class="muted">The patient leaves the ward list after this date and moves to the Archive. All pages are kept.</p>
    <div class="mbtns"><button type="button" class="btn" data-close>Cancel</button><button class="btn danger" type="submit">Discharge</button></div></form>`);
  const f = $('#dcf', md.el);
  f.onsubmit = e => {
    e.preventDefault();
    const d = f.elements.d.value;
    if (p.admit_date && d < p.admit_date) return alert('Discharge date is before admission.');
    DB.run('UPDATE patients SET discharge_date=? WHERE id=?', [d, p.id]);
    md.close();
    toast(`${p.name} discharged`);
    go('#/');
  };
}

// ---------- archive ----------
function renderArchive() {
  const t = todayISO();
  const pts = DB.all('SELECT * FROM patients WHERE discharge_date IS NOT NULL AND discharge_date<=? ORDER BY discharge_date DESC', [t]);
  app.innerHTML = header('Archive', back('#/')) + `<main>
    <input class="search" id="q" type="search" placeholder="Search name, CID, diagnosis, room">
    <div class="list" id="alist"></div></main>`;
  const draw = q => {
    q = q.trim().toLowerCase();
    const rows = pts.filter(p => !q || [p.name, p.cid, p.diagnosis, p.room, p.operation].some(x => (x || '').toLowerCase().includes(q)));
    $('#alist').innerHTML = rows.map(p => `<div class="prow arch">
      <a class="pmain" href="#/p/${p.id}">
        <div class="pname">${esc(p.name)}<span class="muted"> · CID ${esc(p.cid || '—')}</span></div>
        <div class="psub">${fmtDate(p.admit_date)} → ${fmtDate(p.discharge_date)} · ${diffDays(p.admit_date || p.discharge_date, p.discharge_date) + 1} days</div>
        <div class="psub muted">${esc(p.diagnosis || '')}${p.operation ? ' · ' + esc(p.operation) : ''}</div></a>
      <a class="btn small" href="#/new/${p.id}">Re-admit</a></div>`).join('') ||
      `<div class="empty">${pts.length ? 'No matches.' : 'No discharged patients yet.'}</div>`;
  };
  $('#q').addEventListener('input', e => draw(e.target.value));
  draw('');
}

// ---------- settings & backup ----------
function backupFile() {
  return new File([DB.exportBytes()], `the-ward-backup-${todayISO()}.sqlite`, { type: 'application/octet-stream' });
}
// Must run straight from a tap: phones only allow sharing/downloading in response to one.
async function saveBackup() {
  flushSaves();
  try {
    await shareOrDownload(backupFile());
    setSetting('last_backup', todayISO());
    toast('Backup saved');
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') toast('Backup failed: ' + e.message);
    return false;
  }
}
function renderSettings() {
  const counts = DB.one(`SELECT (SELECT COUNT(*) FROM patients WHERE discharge_date IS NULL OR discharge_date>?) AS ward,
    (SELECT COUNT(*) FROM patients) AS total, (SELECT COUNT(*) FROM days) AS days`, [todayISO()]);
  const last = getSetting('last_backup', '');
  const theme = document.documentElement.dataset.theme || 'light';
  app.innerHTML = header('Settings', back('#/')) + `<main>
    <section><h2>Appearance</h2><div class="pills">
      ${[['light', 'Light'], ['dark', 'Dark'], ['auto', 'Follow phone']].map(([v, l]) =>
        `<label class="pill"><input type="radio" name="theme" value="${v}" ${theme === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </div></section>
    <section><h2>Tacrolimus target</h2><div class="row2">
      <label>Low (ng/mL)<input inputmode="decimal" id="tl" value="${esc(getSetting('tac_low', 8))}"></label>
      <label>High (ng/mL)<input inputmode="decimal" id="th" value="${esc(getSetting('tac_high', 10))}"></label></div></section>
    <section><h2>Backup</h2>
      <p class="muted">Data lives only on this phone. Last backup: <b>${last ? fmtDate(last) : 'never'}</b>.</p>
      <button class="btn primary block" id="bk">Save backup now</button>
      <button class="btn block" id="im">Import backup (replaces all data)</button>
      <input type="file" id="imf" class="hide">
      <p class="muted small">To move data to your other phone: save a backup here, send the file to that phone, then import it there. Backup files are not encrypted, so send them only to yourself.</p></section>
    <section><h2>Data</h2><p class="muted">${counts.ward} on ward · ${counts.total} patients total · ${counts.days} day pages</p></section>
    <p class="muted small center">The Ward · v1.0</p></main>`;
  const saveTac = () => {
    const lo = Number($('#tl').value.replace(',', '.')), hi = Number($('#th').value.replace(',', '.'));
    if (isFinite(lo) && isFinite(hi) && lo < hi) { setSetting('tac_low', lo); setSetting('tac_high', hi); toast('Tac target saved'); }
    else toast('Enter a valid range (low < high)');
  };
  $$('[name=theme]').forEach(r => r.onchange = () => {
    document.documentElement.dataset.theme = r.value;
    try { localStorage.setItem('ward_theme', r.value); } catch {}
  });
  $('#tl').onchange = saveTac;
  $('#th').onchange = saveTac;
  $('#bk').onclick = () => saveBackup().then(ok => ok && renderSettings());
  $('#im').onclick = () => $('#imf').click();
  $('#imf').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm(`Replace ALL data on this phone with "${file.name}"? Current data will be lost.`)) return;
    try {
      await DB.importBytes(new Uint8Array(await file.arrayBuffer()));
      toast('Backup imported');
      go('#/');
    } catch (err) { alert('Import failed: ' + err.message); }
  };
}

function dailyBackupPrompt() {
  const t = todayISO();
  if (getSetting('last_backup', '') === t || sessionStorage.getItem('bk_skip') === t) return;
  if (!DB.one('SELECT 1 AS x FROM patients LIMIT 1')) return;
  const md = modal(`<h2>Daily backup</h2><p>Save today's backup of The Ward to Files, WhatsApp or email.</p>
    <div class="mbtns"><button class="btn" data-close id="bklater">Later</button><button class="btn primary" id="bknow">Save backup</button></div>`);
  $('#bklater', md.el).addEventListener('click', () => { try { sessionStorage.setItem('bk_skip', t); } catch {} });
  $('#bknow', md.el).onclick = () => { saveBackup().then(ok => { if (ok) { md.close(); route(); } }); };
}

// ---------- share text ----------
function summaryText(pid, date) {
  const p = getPatient(pid), day = DB.one('SELECT * FROM days WHERE patient_id=? AND date=?', [pid, date]) || {};
  const age = patientAge(p), m = maintList(p);
  const L = [];
  L.push(`🏥 Room ${p.room || '–'} · ${p.name}${age != null ? ` (${age}y)` : ''}`);
  L.push(`${dayLabel(p, date)} · ${fmtDate(date)}`);
  if (p.diagnosis) L.push(`Dx: ${p.diagnosis}`);
  if (p.operation) L.push(`Op: ${p.operation}${p.op_date ? ` (${fmtDate(p.op_date)})` : ''}`);
  L.push(`IS: ${p.induction || '—'} → ${m.join(', ') || '—'}`);
  const fmt = f => {
    const v = day[f.k];
    if (v == null) return null;
    const pr = prevVal(pid, date, f.k), fl = flag(f, v);
    return `${f.l} ${fmtNum(v)}${pr ? arrow(v, pr.v) + `(${fmtNum(pr.v)})` : ''}${fl ? ' ⚠️' : ''}`;
  };
  const vit = [];
  if (day.bp_sys != null || day.bp_dia != null) vit.push(`BP ${fmtNum(day.bp_sys) || '?'}/${fmtNum(day.bp_dia) || '?'}`);
  ['hr', 'temp', 'weight'].forEach(k => { const s = fmt(FIELD[k]); if (s) vit.push(s); });
  if (vit.length) L.push(`\nVitals: ${vit.join(' · ')}`);
  if (['oral_in', 'iv_in', 'uop'].some(k => day[k] != null)) {
    const inn = (day.oral_in || 0) + (day.iv_in || 0), b = inn - (day.uop || 0);
    L.push(`Fluids: In ${inn} (PO ${fmtNum(day.oral_in) || 0} / IV ${fmtNum(day.iv_in) || 0}) · UOP ${fmtNum(day.uop) || 0} · Bal ${b > 0 ? '+' : ''}${b}`);
  }
  const labs = LABS.map(fmt).filter(Boolean);
  if (labs.length) L.push(`Labs: ${labs.join(' · ')}`);
  const inf = infectionsFor(pid).filter(i => infActiveOn(i, date));
  inf.forEach(i => L.push(`🦠 ${i.type || 'Infection'}: ${i.sample || ''}${i.organism ? ' → ' + i.organism : ''}${i.sensitivity ? ` (${i.sensitivity})` : ''}${i.abx.length ? ' · ' + i.abx.map(a => abxLabel(a, date)).join(', ') : ''}`));
  const rads = radiologyFor(pid);
  if (rads.length) L.push('Imaging:\n' + rads.map(r => `• ${fmtShort(r.date)} ${r.type || ''}: ${r.finding || ''}`).join('\n'));
  if (day.clinical_notes) L.push(`\nNotes: ${day.clinical_notes}`);
  if (day.free_notes) L.push(day.free_notes);
  return L.join('\n');
}
function shareText(pid, date) {
  const text = summaryText(pid, date);
  if (navigator.share) {
    navigator.share({ text }).catch(e => { if (e.name !== 'AbortError') toast(e.message); });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Summary copied'), () => toast('Copy failed'));
  } else toast('Sharing not supported');
}

// ---------- PDF of the whole stay ----------
// Built-in PDF fonts are Latin-1 only, so other characters are replaced.
const pdfSafe = s => s == null ? '' : String(s).replace(/[↑]/g, '^').replace(/[↓]/g, 'v').replace(/[^\x00-\xFF]/g, '?');
function exportPdf(pid) {
  const p = getPatient(pid), { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const days = DB.all('SELECT * FROM days WHERE patient_id=? ORDER BY date', [pid]);
  const age = patientAge(p), m = maintList(p);
  doc.setFontSize(16);
  doc.text(pdfSafe(`${p.name}  ·  Room ${p.room || '-'}`), 14, 15);
  doc.setFontSize(9.5);
  [
    `CID ${p.cid || '-'}${age != null ? `   Age ${age}` : ''}   Admitted ${fmtDate(p.admit_date)}${p.discharge_date ? `   Discharged ${fmtDate(p.discharge_date)}` : ''}`,
    `Diagnosis: ${p.diagnosis || '-'}`,
    `Operation: ${p.operation || '-'}${p.op_date ? ` (${fmtDate(p.op_date)})` : ''}`,
    `Induction: ${p.induction || '-'}    Maintenance: ${m.join(', ') || '-'}`,
  ].forEach((l, i) => doc.text(pdfSafe(l), 14, 22 + i * 5));

  const cols = ['date', 'day', 'bp', 'hr', 'temp', 'weight', 'oral_in', 'iv_in', 'uop', 'bal', ...LABS.map(f => f.k)];
  const head = ['Date', 'Day', 'BP', 'HR', 'T', 'Wt', 'PO', 'IV', 'UOP', 'Bal', ...LABS.map(f => f.l)];
  const body = days.map(d => {
    const hasF = ['oral_in', 'iv_in', 'uop'].some(k => d[k] != null);
    const r = {
      date: fmtShort(d.date), day: dayLabel(p, d.date),
      bp: d.bp_sys != null || d.bp_dia != null ? `${fmtNum(d.bp_sys) || '?'}/${fmtNum(d.bp_dia) || '?'}` : '',
      bal: hasF ? String((d.oral_in || 0) + (d.iv_in || 0) - (d.uop || 0)) : '',
    };
    ['hr', 'temp', 'weight', 'oral_in', 'iv_in', 'uop', ...LABS.map(f => f.k)].forEach(k => { r[k] = fmtNum(d[k]); });
    return cols.map(c => r[c]);
  });
  doc.autoTable({
    startY: 44, head: [head], body, theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.2, halign: 'center' },
    headStyles: { fillColor: [15, 118, 110] },
    didParseCell: c => {
      if (c.section !== 'body') return;
      const k = cols[c.column.index], d = days[c.row.index];
      const fl = k === 'bp' ? (flag(FIELD.bp_sys, d.bp_sys) || flag(FIELD.bp_dia, d.bp_dia)) : FIELD[k] ? flag(FIELD[k], d[k]) : 0;
      if (fl) { c.cell.styles.textColor = [200, 30, 30]; c.cell.styles.fontStyle = 'bold'; }
    },
  });

  const section = (title, head2, rows, widths) => {
    if (!rows.length) return;
    let y = doc.lastAutoTable.finalY + 8;
    if (y > 185) { doc.addPage(); y = 15; }
    doc.setFontSize(11);
    doc.text(title, 14, y);
    doc.autoTable({ startY: y + 2, head: [head2], body: rows.map(r => r.map(pdfSafe)), theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.5, valign: 'top' }, headStyles: { fillColor: [15, 118, 110] }, columnStyles: widths || {} });
  };
  const infs = infectionsFor(pid).reverse();
  section('Infections', ['Type', 'Culture date', 'Sample', 'Organism', 'Sensitivity', 'Antibiotics', 'Resolved'],
    infs.map(i => [i.type, fmtDate(i.culture_date), i.sample, i.organism, i.sensitivity,
      i.abx.map(a => `${a.name} ${fmtShort(a.start_date)}-${a.stop_date ? fmtShort(a.stop_date) : 'ongoing'}`).join('\n'), fmtDate(i.resolved_date)]));
  section('Radiology', ['Date', 'Type', 'Finding'], radiologyFor(pid).reverse().map(r => [fmtDate(r.date), r.type, r.finding]),
    { 0: { cellWidth: 24 }, 1: { cellWidth: 45 } });
  section('Daily notes', ['Date', 'Day', 'Clinical notes', 'Notes'],
    days.filter(d => d.clinical_notes || d.free_notes).map(d => [fmtShort(d.date), dayLabel(p, d.date), d.clinical_notes, d.free_notes]),
    { 0: { cellWidth: 16 }, 1: { cellWidth: 20 } });

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(`The Ward · generated ${fmtDate(todayISO())} · page ${i}/${n}`, 14, 203);
  }
  const name = `${(p.name || 'patient').replace(/[^\w؀-ۿ -]/g, '').trim().replace(/\s+/g, '_')}_stay.pdf`;
  shareOrDownload(new File([doc.output('blob')], name, { type: 'application/pdf' }))
    .catch(e => { if (e.name !== 'AbortError') toast(e.message); });
}

// ---------- start ----------
(async () => {
  try {
    await DB.init();
  } catch (e) {
    app.innerHTML = `<div class="empty">Could not open the database.<br>${esc(e.message)}</div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
  dailyBackupPrompt();
})();

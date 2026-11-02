'use strict';
// SQLite (sql.js / WASM) database, persisted as a single file in IndexedDB.
const DB = (() => {
  let SQL = null, db = null, saveTimer = null;
  const IDB_NAME = 'the-ward', STORE = 'files', KEY = 'db';

  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS patients(
      id INTEGER PRIMARY KEY, room TEXT, name TEXT NOT NULL, cid TEXT,
      admit_date TEXT, diagnosis TEXT, op_date TEXT, operation TEXT,
      induction TEXT, maintenance TEXT DEFAULT '[]', discharge_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS days(
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      bp_sys REAL, bp_dia REAL, hr REAL, temp REAL, weight REAL,
      oral_in REAL, iv_in REAL, uop REAL,
      wbc REAL, hb REAL, plt REAL, k REAL, pct REAL, crp REAL, creat REAL, tac REAL,
      clinical_notes TEXT, free_notes TEXT,
      UNIQUE(patient_id, date));
    CREATE TABLE IF NOT EXISTS infections(
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      type TEXT, sample TEXT, organism TEXT, sensitivity TEXT,
      culture_date TEXT, resolved_date TEXT);
    CREATE TABLE IF NOT EXISTS antibiotics(
      id INTEGER PRIMARY KEY,
      infection_id INTEGER NOT NULL REFERENCES infections(id) ON DELETE CASCADE,
      name TEXT, start_date TEXT, stop_date TEXT);
    CREATE TABLE IF NOT EXISTS radiology(
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      date TEXT, type TEXT, finding TEXT);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX IF NOT EXISTS days_patient ON days(patient_id, date);`;

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet() {
    const d = await idb();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE).objectStore(STORE).get(KEY);
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
  }
  async function idbPut(v) {
    const d = await idb();
    return new Promise((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(v, KEY);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  // export() reopens the database and resets pragmas, so re-apply them after.
  function pragmas() { db.run('PRAGMA foreign_keys = ON'); }
  function open(bytes) {
    db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    pragmas();
    db.exec(SCHEMA);
  }

  async function init() {
    SQL = await initSqlJs({ locateFile: f => 'vendor/' + f });
    open(await idbGet());
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  const clean = p => p.map(v => (v === undefined ? null : v));

  function all(sql, params = []) {
    const st = db.prepare(sql);
    st.bind(clean(params));
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    st.free();
    return out;
  }
  const one = (sql, params) => all(sql, params)[0] || null;

  function run(sql, params = []) {
    db.run(sql, clean(params));
    const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    scheduleSave();
    return id;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const bytes = db.export();
    pragmas();
    await idbPut(bytes);
  }

  function exportBytes() {
    const bytes = db.export();
    pragmas();
    return bytes;
  }

  // Replace the whole database with an imported file (after validating it).
  async function importBytes(bytes) {
    const test = new SQL.Database(bytes);
    try {
      const t = test.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='patients'");
      if (!t.length) throw new Error('This file is not a Ward backup.');
    } finally { test.close(); }
    db.close();
    open(bytes);
    await saveNow();
  }

  return { init, all, one, run, saveNow, exportBytes, importBytes };
})();

import { useState, useEffect, useReducer, useMemo, useRef, useCallback } from "react";
const FIREBASE_URL = "https://vibefit-studio-a0f2d-default-rtdb.firebaseio.com";

// ─── Helpers ───
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const fmt = (n) => `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();
const dayNames = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const dayName = (d) => dayNames[new Date(d + "T12:00:00").getDay()];
const shortDate = (d) => { const dt = new Date(d+"T12:00:00"); return `${dt.getDate()} ${monthNames[dt.getMonth()].slice(0,3)}`; };
const fullDate = (d) => { const dt = new Date(d+"T12:00:00"); return `${dt.getDate()} de ${monthNames[dt.getMonth()]} ${dt.getFullYear()}`; };

function getMonday(date) {
  const d = new Date(date + "T12:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toISOString().slice(0, 10);
}
function getSunday(mon) {
  const d = new Date(mon + "T12:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

const SCHEDULES = [
  { id: "7pm", label: "7:00 PM", short: "7PM", color: "#E85D75" },
  { id: "8pm", label: "8:00 PM", short: "8PM", color: "#4A90D9" },
  { id: "9pm", label: "9:00 PM", short: "9PM", color: "#9B6BC5" },
];

const PLAN_TYPES = [
  { id: "monthly", name: "Mensualidad", price: 680, cycle: "monthly", icon: "📅", color: "#4A90D9" },
  { id: "weekly", name: "Semanal", price: 200, cycle: "weekly", icon: "📋", color: "#E85D75" },
  { id: "separo", name: "Separo", price: 100, cycle: "weekly", icon: "🔖", color: "#F5A623" },
  { id: "inscription", name: "Inscripción", price: 100, cycle: "once", icon: "⭐", color: "#7ED6A8" },
];

// ─── Calendario 2026 — datos del calendario VibeFit ───
// Azul = fechas de cobro mensualidad, Rojo = fechas de cobro semanal, Gris = estudio cerrado
const CALENDAR_DATA = {
  1:  { monthly: [5,12,19,26],    weekly: [5,12,19,26],   closed: [] },
  2:  { monthly: [2,9,16,23],     weekly: [3,9,16,23],    closed: [3,4] },
  3:  { monthly: [2,9,16,23,30],  weekly: [3,9,16,23,30], closed: [3,17,30,31] },
  4:  { monthly: [6,13,20,27],    weekly: [1,6,13,20,27], closed: [1,2,3,29,30] },
  5:  { monthly: [4,11,18,25],    weekly: [1,4,11,18,25], closed: [1,29] },
  6:  { monthly: [1,8,15,22,29],  weekly: [2,8,15,22,29], closed: [2,29,30] },
  7:  { monthly: [6,13,20,27],    weekly: [1,6,13,20,27], closed: [1,2,30,31] },
  8:  { monthly: [3,10,17,24,31], weekly: [3,10,17,24,31],closed: [31] },
  9:  { monthly: [7,14,21,28],    weekly: [1,7,14,21,28], closed: [1,2,29,30] },
  10: { monthly: [5,12,19,26],    weekly: [1,5,12,19,26], closed: [1,2,30] },
  11: { monthly: [2,9,16,23,30],  weekly: [2,9,16,23,30], closed: [3,17,30] },
  12: { monthly: [7,14,21],       weekly: [1,7,14,21],    closed: [1,2,21,22,23,24,25,26,27,28,29,30,31] },
};

// ─── Firebase REST API Service ───
const db = {
  ok: () => FIREBASE_URL && !FIREBASE_URL.includes("TU-PROYECTO"),
  async get(path) {
    if (!this.ok()) return null;
    try { const r = await fetch(`${FIREBASE_URL}/${path}.json`); return await r.json(); }
    catch (e) { return null; }
  },
  async set(path, data) {
    if (!this.ok()) return;
    try { await fetch(`${FIREBASE_URL}/${path}.json`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) }); }
    catch (e) {}
  },
  async update(path, data) {
    if (!this.ok()) return;
    try { await fetch(`${FIREBASE_URL}/${path}.json`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) }); }
    catch (e) {}
  },
  async remove(path) {
    if (!this.ok()) return;
    try { await fetch(`${FIREBASE_URL}/${path}.json`, { method:"DELETE" }); }
    catch (e) {}
  },
  listen(path, callback) {
    if (!this.ok()) return () => {};
    const es = new EventSource(`${FIREBASE_URL}/${path}.json`);
    es.addEventListener("put", (e) => { try { callback(JSON.parse(e.data)); } catch (err) {} });
    es.addEventListener("patch", (e) => { try { callback(JSON.parse(e.data)); } catch (err) {} });
    return () => es.close();
  },
};

// ─── State ───
const init = { members: {}, payments: {}, counters: { "7pm": 0, "8pm": 0, "9pm": 0 }, loaded: false };

function reducer(state, action) {
  switch (action.type) {
    case "LOAD": return { ...state, ...action.payload, loaded: true };
    case "SET_MEMBERS": return { ...state, members: action.payload || {} };
    case "SET_PAYMENTS": return { ...state, payments: action.payload || {} };
    case "ADD_MEMBER": return { ...state, members: { ...state.members, [action.payload.id]: action.payload }, counters: action.counters || state.counters };
    case "EDIT_MEMBER": return { ...state, members: { ...state.members, [action.payload.id]: { ...state.members[action.payload.id], ...action.payload } } };
    case "DEL_MEMBER": {
      const m = { ...state.members }; delete m[action.payload];
      const p = { ...state.payments };
      Object.keys(p).forEach(k => { if (p[k].memberId === action.payload) delete p[k]; });
      return { ...state, members: m, payments: p };
    }
    case "ADD_PAY": return { ...state, payments: { ...state.payments, [action.payload.id]: action.payload } };
    case "EDIT_PAY": return { ...state, payments: { ...state.payments, [action.payload.id]: { ...state.payments[action.payload.id], ...action.payload } } };
    case "DEL_PAY": { const p = { ...state.payments }; delete p[action.payload]; return { ...state, payments: p }; }
    default: return state;
  }
}

// ─── Icons ───
const I = ({ name, size = 18, color }) => {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color || "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  const d = {
    home: <><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    users: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>,
    dollar: <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,
    bell: <><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    check: <><polyline points="20 6 9 17 4 12"/></>,
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    edit: <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash: <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,
    back: <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,
    eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    wifi: <><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></>,
    noWifi: <><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/><path d="M5 12.55a10.94 10.94 0 015.17-2.39"/><path d="M10.71 5.05A16 16 0 0122.56 9"/><path d="M1.42 9a15.91 15.91 0 014.7-2.88"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></>,
    chev: <><polyline points="6 9 12 15 18 9"/></>,
  };
  return <svg {...p}>{d[name]}</svg>;
};

// ─── CSS ───
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&family=Fredoka:wght@400;500;600;700&display=swap');
:root{--bg:#FFF5F7;--sf:#FFF;--sf2:#FFF0F3;--sf3:#FFE4EA;--bd:#FFD1DC;--tx:#3D2B35;--tx2:#8B6B7D;--tx3:#BFA0B0;--pk:#FF6B8A;--pk2:#FF8FA8;--pk3:#FFB3C6;--pks:#FFE0E8;--rs:#E85D75;--mt:#5CBF8A;--mtb:#E8FFF1;--bl:#5B9FE6;--blb:#E8F2FF;--gd:#E6A830;--gdb:#FFF6E0;--rd:#E85D75;--rdb:#FFE8EC;--pr:#9B6BC5;--prb:#F3E8FF;--r:16px;--rs2:10px;--sh:0 2px 16px rgba(255,107,138,.07)}
*{box-sizing:border-box;margin:0;padding:0}
.app{font-family:'Nunito',sans-serif;background:var(--bg);color:var(--tx);min-height:100vh;max-width:480px;margin:0 auto;padding-bottom:100px;-webkit-font-smoothing:antialiased}
.hdr{padding:16px 20px 13px;position:sticky;top:0;z-index:50;background:linear-gradient(135deg,#FF6B8A,#FF8FA8 40%,#FFB3C6);box-shadow:0 4px 24px rgba(255,107,138,.22)}
.hdr h1{font-family:'Fredoka',sans-serif;font-size:21px;font-weight:700;color:#fff;letter-spacing:.5px}
.hdr-sub{font-size:11px;color:rgba(255,255,255,.8);margin-top:1px;font-weight:500}
.hdr-row{display:flex;justify-content:space-between;align-items:center}
.sync{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;font-size:9px;font-weight:700;color:#fff;background:rgba(255,255,255,.2)}
.sync.on{background:rgba(92,191,138,.4)}
.nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;display:flex;background:#fff;border-top:2px solid var(--pks);padding:8px 0 max(10px,env(safe-area-inset-bottom));z-index:100;box-shadow:0 -4px 20px rgba(255,107,138,.06)}
.nb{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 0 2px;border:none;background:none;color:var(--tx3);font-size:11px;font-family:'Nunito';font-weight:700;cursor:pointer;position:relative}
.nb.on{color:var(--pk)}
.nb.on::before{content:'';position:absolute;top:-2px;left:28%;right:28%;height:3px;background:var(--pk);border-radius:0 0 3px 3px}
.nbdg{position:absolute;top:1px;right:calc(50% - 16px);min-width:15px;height:15px;border-radius:8px;background:var(--rs);color:#fff;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 3px}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);padding:14px;margin:8px 16px;box-shadow:var(--sh)}
.stats{display:grid;gap:8px;padding:12px 16px 4px}.stats2{grid-template-columns:1fr 1fr}
.stat{background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);padding:14px;box-shadow:var(--sh);position:relative;overflow:hidden}
.sv{font-family:'Fredoka';font-size:22px;font-weight:700}
.sl{font-size:9px;color:var(--tx2);margin-top:1px;text-transform:uppercase;letter-spacing:.8px;font-weight:700}
.si{position:absolute;top:10px;right:10px;font-size:18px}
.bdg{display:inline-flex;align-items:center;gap:3px;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700}
.bg{background:var(--mtb);color:var(--mt)}.br{background:var(--rdb);color:var(--rd)}.bo{background:var(--gdb);color:var(--gd)}.bb{background:var(--blb);color:var(--bl)}.bp{background:var(--prb);color:var(--pr)}.bpk{background:var(--pks);color:var(--pk)}
.sb{display:inline-flex;align-items:center;gap:2px;padding:1px 7px;border-radius:10px;font-size:9px;font-weight:800;font-family:'Fredoka'}
.s7{background:#FFE0E8;color:#E85D75}.s8{background:#E8F2FF;color:#4A90D9}.s9{background:#F3E8FF;color:#9B6BC5}
.btn{display:inline-flex;align-items:center;gap:5px;padding:10px 16px;border-radius:var(--rs2);border:none;font-family:'Nunito';font-size:13px;font-weight:700;cursor:pointer;transition:all .12s}
.btn:active{transform:scale(.96)}
.bp1{background:linear-gradient(135deg,var(--pk),var(--rs));color:#fff;box-shadow:0 3px 12px rgba(255,107,138,.28)}
.bg1{background:var(--sf2);color:var(--tx);border:1px solid var(--bd)}
.bd1{background:var(--rdb);color:var(--rd)}
.bwa{background:#25D366;color:#fff;box-shadow:0 2px 8px rgba(37,211,102,.25)}
.bwab{background:#128C7E;color:#fff;box-shadow:0 2px 8px rgba(18,140,126,.25)}
.bsm{padding:6px 11px;font-size:11px}.bfull{width:100%;justify-content:center}
.fab{position:fixed;bottom:82px;right:max(16px,calc(50% - 224px));width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--pk),var(--rs));color:#fff;border:none;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(255,107,138,.4);cursor:pointer;z-index:90}
.fab:active{transform:scale(.88) rotate(-90deg)}
.fg{margin-bottom:13px}
.fl{display:block;font-size:10px;color:var(--tx2);margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px;font-weight:700}
.fi{width:100%;padding:10px 13px;background:var(--sf2);border:1.5px solid var(--bd);border-radius:var(--rs2);color:var(--tx);font-size:14px;font-family:'Nunito';outline:none;transition:border .2s;-webkit-appearance:none}
.fi:focus{border-color:var(--pk);box-shadow:0 0 0 3px rgba(255,107,138,.12)}
select.fi{cursor:pointer}
.mo{position:fixed;inset:0;background:rgba(61,43,53,.45);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:flex-end;justify-content:center;animation:fi .2s}
.mob{background:var(--sf);border-radius:22px 22px 0 0;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;padding:20px;animation:su .28s cubic-bezier(.34,1.4,.64,1)}
.moh{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.mot{font-family:'Fredoka';font-size:17px;font-weight:700;color:var(--pk)}
.mox{width:30px;height:30px;border-radius:50%;background:var(--sf2);border:1px solid var(--bd);color:var(--tx2);display:flex;align-items:center;justify-content:center;cursor:pointer}
.moha{width:36px;height:4px;background:var(--bd);border-radius:2px;margin:0 auto 14px}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes pu{0%,100%{opacity:1}50%{opacity:.5}}
.srch{margin:10px 16px;position:relative}
.srch svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--tx3)}
.srch input{width:100%;padding:10px 13px 10px 38px;background:var(--sf);border:1.5px solid var(--bd);border-radius:var(--r);color:var(--tx);font-size:13px;font-family:'Nunito';font-weight:600;outline:none;box-shadow:var(--sh)}
.srch input:focus{border-color:var(--pk)}
.li{display:flex;align-items:center;gap:11px;padding:11px 16px;border-bottom:1px solid var(--sf3);cursor:pointer;transition:background .1s}
.li:active{background:var(--sf2)}
.la{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;flex-shrink:0;font-family:'Fredoka'}
.lc{flex:1;min-width:0}.ln{font-size:15px;font-weight:700}.ls{font-size:12px;color:var(--tx2);margin-top:2px;font-weight:500}
.lr{text-align:right;flex-shrink:0}.lam{font-family:'Fredoka';font-size:14px;font-weight:700}
.sec{padding:14px 16px 6px;font-size:12px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:1px;font-family:'Fredoka'}
.dr{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--sf3)}
.dr:last-child{border-bottom:none}
.dl{font-size:13px;color:var(--tx2);font-weight:600}.dv{font-size:14px;font-weight:700}
.tabs{display:flex;gap:3px;padding:3px;margin:10px 16px 6px;background:var(--sf2);border-radius:var(--r);border:1px solid var(--bd)}
.tab{flex:1;padding:9px;border:none;border-radius:13px;background:none;color:var(--tx2);font-size:14px;font-family:'Nunito';font-weight:700;cursor:pointer}
.tab.on{background:linear-gradient(135deg,var(--pk),var(--rs));color:#fff;box-shadow:0 2px 8px rgba(255,107,138,.25)}
.chips{display:flex;gap:5px;padding:0 16px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}
.chip{padding:6px 13px;border-radius:18px;border:1.5px solid var(--bd);background:var(--sf);color:var(--tx2);font-size:11px;font-family:'Nunito';font-weight:700;white-space:nowrap;cursor:pointer}
.chip.on{background:linear-gradient(135deg,var(--pk),var(--rs));color:#fff;border-color:var(--pk)}
.empty{text-align:center;padding:36px 20px;color:var(--tx3)}.empty p{margin-top:6px;font-size:13px;font-weight:600}
.acts{display:flex;gap:7px;margin-top:12px}.acts .btn{flex:1}
.sg{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}
.so{padding:11px 6px;border:2px solid var(--bd);border-radius:var(--rs2);text-align:center;cursor:pointer;background:var(--sf)}
.so.on{border-color:var(--pk);background:var(--pks)}
.sot{font-family:'Fredoka';font-size:15px;font-weight:700}
.pg{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.po{padding:10px 8px;border:2px solid var(--bd);border-radius:var(--rs2);text-align:center;cursor:pointer;background:var(--sf)}
.po.on{border-color:var(--pk);background:var(--pks)}
.pon{font-size:11px;font-weight:700}.pop{font-family:'Fredoka';font-size:15px;font-weight:700;color:var(--pk);margin-top:1px}.poi{font-size:16px}
.br2{display:flex;align-items:center;gap:6px;margin-bottom:5px}
.bl2{font-size:9px;font-weight:800;color:var(--tx3);width:28px;text-align:right;font-family:'Fredoka'}
.bbg{flex:1;height:22px;background:var(--sf2);border-radius:11px;overflow:hidden}
.bf{height:100%;border-radius:11px;display:flex;align-items:center;justify-content:flex-end;padding-right:7px;transition:width .5s cubic-bezier(.34,1.4,.64,1)}
.bv{font-size:9px;font-weight:800;color:#fff;font-family:'Fredoka'}
.cfm{position:fixed;inset:0;background:rgba(61,43,53,.55);backdrop-filter:blur(4px);z-index:300;display:flex;align-items:center;justify-content:center}
.cfmb{background:#fff;border-radius:var(--r);padding:22px;max-width:300px;width:88%;text-align:center;box-shadow:0 4px 24px rgba(255,107,138,.1)}
.cfmb h3{font-family:'Fredoka';font-size:15px;margin-bottom:6px}.cfmb p{font-size:12px;color:var(--tx2);margin-bottom:14px;line-height:1.4}
.cfa{display:flex;gap:7px}.cfa .btn{flex:1}
.mid{font-family:'Fredoka';font-size:10px;font-weight:700;color:var(--tx3);letter-spacing:1px}
.setup{margin:12px 16px;padding:14px;background:linear-gradient(135deg,var(--gdb),#FFF0E0);border:1.5px solid #F0D090;border-radius:var(--r);font-size:12px;line-height:1.5}
.setup strong{color:var(--gd)}
.setup code{display:block;margin:6px 0;padding:6px 10px;background:rgba(0,0,0,.05);border-radius:6px;font-size:11px;word-break:break-all}

/* Calendario — full width */
.cal-wrap{padding:0 4px 12px}
.cal-month{background:var(--sf);border-left:none;border-right:none;border-top:1px solid var(--bd);border-bottom:1px solid var(--bd);margin-bottom:10px;overflow:hidden;box-shadow:var(--sh)}
.cal-hdr{background:linear-gradient(135deg,var(--pk),var(--rs));padding:10px 16px;display:flex;justify-content:space-between;align-items:center}
.cal-hdr-title{font-family:'Fredoka';font-size:17px;font-weight:700;color:#fff;letter-spacing:.5px}
.cal-hdr-stats{display:flex;gap:8px}
.cal-stat-pill{background:rgba(255,255,255,.22);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;font-family:'Fredoka'}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;padding:8px 12px 10px}
.cal-dow{font-size:10px;font-weight:800;color:var(--tx3);text-align:center;padding:2px 0 6px;letter-spacing:.5px;font-family:'Fredoka';text-transform:uppercase}
.cal-day{width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:13px;font-weight:700;font-family:'Fredoka';position:relative;cursor:default}
.cal-day.empty{}
.cal-day.today-hl{box-shadow:0 0 0 2px var(--pk)}
.cal-day.d-monthly{background:#4A90D9;color:#fff}
.cal-day.d-weekly{background:#E85D75;color:#fff}
.cal-day.d-closed{background:#D0C8CC;color:#9B8FA0}
.cal-day.d-both{background:linear-gradient(135deg,#4A90D9 50%,#E85D75 50%);color:#fff}
.cal-legend{display:flex;gap:12px;padding:6px 16px 10px;flex-wrap:wrap}
.cal-leg-item{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--tx2)}
.cal-leg-dot{width:11px;height:11px;border-radius:50%;flex-shrink:0}
.cal-nav{display:flex;align-items:center;gap:8px;padding:10px 16px 4px}
.cal-nav-btn{width:36px;height:36px;border-radius:50%;border:1.5px solid var(--bd);background:var(--sf);display:flex;align-items:center;justify-content:center;cursor:pointer}
.cal-nav-lbl{flex:1;text-align:center;font-family:'Fredoka';font-size:16px;font-weight:700;color:var(--tx)}

/* WA modal styles */
.wa-msg{background:var(--sf2);border:1.5px solid var(--bd);border-radius:var(--rs2);padding:11px;font-size:13px;line-height:1.6;color:var(--tx);margin-bottom:12px;white-space:pre-wrap;font-family:'Nunito';min-height:80px}
.wa-tpl{padding:8px 10px;border:1.5px solid var(--bd);border-radius:var(--rs2);background:var(--sf);cursor:pointer;margin-bottom:7px;transition:border .15s}
.wa-tpl.on{border-color:var(--pk);background:var(--pks)}
.wa-tpl-title{font-size:13px;font-weight:700;color:var(--tx)}
.wa-tpl-sub{font-size:11px;color:var(--tx2);margin-top:2px}

/* Alta toggle */
.alta-toggle{display:flex;gap:0;margin-bottom:14px;border:1.5px solid var(--bd);border-radius:var(--rs2);overflow:hidden}
.alta-opt{flex:1;padding:10px 6px;border:none;background:var(--sf);font-family:'Nunito';font-size:13px;font-weight:700;color:var(--tx2);cursor:pointer;text-align:center;transition:all .15s}
.alta-opt.on{background:linear-gradient(135deg,var(--pk),var(--rs));color:#fff}

::-webkit-scrollbar{width:0}
`;

// ─── Modal ───
const Modal = ({ title, onClose, children }) => (
  <div className="mo" onClick={onClose}>
    <div className="mob" onClick={e => e.stopPropagation()}>
      <div className="moha" />
      <div className="moh"><span className="mot">{title}</span><button className="mox" onClick={onClose}><I name="x" size={13}/></button></div>
      {children}
    </div>
  </div>
);

const Confirm = ({ title, msg, onOk, onNo }) => (
  <div className="cfm" onClick={onNo}>
    <div className="cfmb" onClick={e => e.stopPropagation()}>
      <h3>{title}</h3><p>{msg}</p>
      <div className="cfa"><button className="btn bg1" onClick={onNo}>Cancelar</button><button className="btn bd1" onClick={onOk}>Eliminar</button></div>
    </div>
  </div>
);

// ─── Helpers ───
function isPaid(m, payments, d) {
  const mp = Object.values(payments).filter(p => p.memberId === m.id);
  const dt = new Date(d + "T12:00:00");
  const mo = dt.getMonth(), yr = dt.getFullYear();
  const mon = getMonday(d), sun = getSunday(mon);
  const ms = `${yr}-${String(mo+1).padStart(2,"0")}-01`, me = `${yr}-${String(mo+1).padStart(2,"0")}-31`;
  if (m.planType === "monthly") return mp.some(p => p.planType === "monthly" && p.date >= ms && p.date <= me);
  return mp.some(p => p.planType === "weekly" && p.date >= mon && p.date <= sun);
}

function getStatus(m, payments) {
  const mp = Object.values(payments).filter(p => p.memberId === m.id);
  const d = today(), dt = new Date(d + "T12:00:00");
  const mo = dt.getMonth(), yr = dt.getFullYear();
  const mon = getMonday(d), sun = getSunday(mon);
  const ms = `${yr}-${String(mo+1).padStart(2,"0")}-01`, me = `${yr}-${String(mo+1).padStart(2,"0")}-31`;
  return {
    hasInscription: mp.some(p => p.planType === "inscription"),
    monthlyPaid: mp.some(p => p.planType === "monthly" && p.date >= ms && p.date <= me),
    weeklyPaid: mp.some(p => p.planType === "weekly" && p.date >= mon && p.date <= sun),
    payments: mp,
    total: mp.reduce((s, p) => s + p.amount, 0),
  };
}

// ─── WA Business message builder ───
function buildWAMessage(m, state, tplId) {
  const pl = PLAN_TYPES.find(p => p.id === m.planType);
  const st = getStatus(m, state.payments);
  const nombre = m.name;

  const templates = {
    pago_pendiente: `Hola ${nombre} 💕

Te recordamos que tu pago de *${pl?.name}* (*${fmt(pl?.price||0)}*) en Vibefit Studio está pendiente.

📅 Puedes realizar tu pago en efectivo o por transferencia.

¡Te esperamos con mucha energía! 💪✨`,

    primer_aviso: `Hola ${nombre} 🌸

Soy Vibefit Studio. Queremos recordarte amablemente que tu *${pl?.name}* de este ${pl?.cycle==="monthly"?"mes":"período"} aún no ha sido registrada.

💰 Monto: *${fmt(pl?.price||0)}*

Cualquier duda, con gusto te ayudamos. ¡Gracias por ser parte de nuestra comunidad! 🏋️‍♀️`,

    ultimo_aviso: `Hola ${nombre} ⏰

Te hacemos un último recordatorio sobre tu pago pendiente de *${pl?.name}* (*${fmt(pl?.price||0)}*) en Vibefit Studio.

Para continuar disfrutando tus clases, te pedimos regularizar tu situación a la brevedad posible.

¡Contamos contigo! 💪🩷`,

    bienvenida: `¡Hola ${nombre}! 🎉

Bienvenida a Vibefit Studio. Estamos muy contentas de tenerte con nosotras.

Recuerda que tu horario es *${SCHEDULES.find(s=>s.id===m.schedule)?.label}*.

Cualquier duda o cambio, escríbenos aquí. ¡Nos vemos en clase! 🔥✨`,

    inscripcion: `Hola ${nombre} 💕

Tu inscripción en Vibefit Studio está lista. Solo falta registrar el pago de *inscripción* (*${fmt(100)}*) para activar tu lugar.

¡Te esperamos con todo! 🏋️‍♀️✨`,
  };

  return templates[tplId] || templates.pago_pendiente;
}

// ─── DASHBOARD ───
function Home({ state, go }) {
  const members = Object.values(state.members);
  const payments = Object.values(state.payments);
  const td = today(), dt = new Date(td+"T12:00:00");
  const mo = dt.getMonth(), yr = dt.getFullYear();
  const mon = getMonday(td), sun = getSunday(mon);
  const ms = `${yr}-${String(mo+1).padStart(2,"0")}-01`, me = `${yr}-${String(mo+1).padStart(2,"0")}-31`;

  const mRev = payments.filter(p => p.date >= ms && p.date <= me).reduce((s, p) => s + p.amount, 0);
  const wRev = payments.filter(p => p.date >= mon && p.date <= sun).reduce((s, p) => s + p.amount, 0);
  const pending = members.filter(m => !isPaid(m, state.payments, td));
  const bySched = SCHEDULES.map(s => ({ ...s, n: members.filter(m => m.schedule === s.id).length }));

  const chart = useMemo(() => {
    const d = [];
    for (let i = 0; i < 12; i++) {
      const s = `${yr}-${String(i+1).padStart(2,"0")}-01`, e = `${yr}-${String(i+1).padStart(2,"0")}-31`;
      d.push({ l: monthNames[i].slice(0,3), v: payments.filter(p => p.date >= s && p.date <= e).reduce((sum, p) => sum + p.amount, 0) });
    }
    return d;
  }, [payments, yr]);
  const maxR = Math.max(...chart.map(d => d.v), 1);

  const recent = [...payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return (<div>
    <div className="stats"><div className="stat">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
        <div><div className="sl">Ingresos del mes</div><div className="sv" style={{color:"var(--pk)",fontSize:26}}>{fmt(mRev)}</div></div>
        <div style={{textAlign:"right"}}><div className="sl">Esta semana</div><div className="sv" style={{color:"var(--mt)",fontSize:18}}>{fmt(wRev)}</div></div>
      </div>
    </div></div>
    <div className="stats stats2">
      <div className="stat"><div className="si">👩‍🦰</div><div className="sv" style={{color:"var(--pk)"}}>{members.length}</div><div className="sl">Alumnas</div></div>
      <div className="stat"><div className="si">⏰</div><div className="sv" style={{color:"var(--rs)"}}>{pending.length}</div><div className="sl">Pendientes</div></div>
    </div>

    <div className="sec">Por Horario</div>
    <div style={{display:"flex",gap:7,padding:"0 16px"}}>
      {bySched.map(s => (<div key={s.id} className="card" style={{flex:1,margin:0,textAlign:"center",padding:10}}>
        <div className={`sb s${s.id.replace("pm","")}`} style={{justifyContent:"center",marginBottom:4}}>{s.label}</div>
        <div style={{fontFamily:"Fredoka",fontSize:20,fontWeight:700}}>{s.n}</div>
      </div>))}
    </div>

    <div className="sec">Ingresos {yr}</div>
    <div className="card" style={{margin:"0 16px 6px"}}>
      {chart.map((d,i) => (<div key={i} className="br2">
        <span className="bl2" style={i===mo?{color:"var(--pk)"}:{}}>{d.l}</span>
        <div className="bbg"><div className="bf" style={{
          width:`${Math.max((d.v/maxR)*100,0)}%`,
          background:i===mo?"linear-gradient(90deg,var(--pk3),var(--pk))":"linear-gradient(90deg,var(--bd),var(--pk3))",
          minWidth:d.v>0?36:0,
        }}>{d.v>0&&<span className="bv">{fmt(d.v)}</span>}</div></div>
      </div>))}
    </div>

    {pending.length>0&&<>
      <div className="sec" style={{color:"var(--rs)"}}>🔔 Pendientes</div>
      {pending.slice(0,5).map(m=>{const pl=PLAN_TYPES.find(p=>p.id===m.planType);return(
        <div key={m.id} className="li" onClick={()=>go("detail",m)}>
          <div className="la" style={{background:"var(--pks)",color:"var(--pk)"}}>{(m.name||"?")[0]}</div>
          <div className="lc"><div className="ln">{m.name} {m.lastName||""}</div><div className="ls"><span className="mid">{m.memberId}</span> · {pl?.name}</div></div>
          <span className="bdg br">Pendiente</span>
        </div>
      );})}
      {pending.length>5&&<div style={{padding:"6px 16px",textAlign:"center"}}><button className="btn bg1 bsm" onClick={()=>go("cobros")}>Ver todos ({pending.length})</button></div>}
    </>}

    {recent.length>0&&<><div className="sec">Últimos Pagos</div>
      {recent.map(p=>{const mb=state.members[p.memberId];const pt=PLAN_TYPES.find(pl=>pl.id===p.planType);return(
        <div key={p.id} className="li"><div className="la" style={{background:"var(--mtb)",color:"var(--mt)",width:36,height:36}}><I name="check" size={14}/></div>
        <div className="lc"><div className="ln">{mb?.name||"—"} {mb?.lastName||""}</div><div className="ls">{pt?.icon} {pt?.name} · {shortDate(p.date)} · {p.method==="transfer"?"📲":"💵"}</div></div>
        <div className="lr"><div className="lam" style={{color:"var(--mt)"}}>+{fmt(p.amount)}</div></div></div>
      );})}
    </>}

    {members.length===0&&<div className="empty" style={{marginTop:16}}>
      <div style={{fontSize:44}}>💪</div><p style={{fontWeight:700,fontSize:15,marginTop:10}}>¡Bienvenida a Vibefit!</p><p>Agrega tu primera alumna</p>
      <button className="btn bp1" style={{marginTop:14}} onClick={()=>go("members")}><I name="plus" size={14}/> Agregar Alumna</button>
    </div>}
  </div>);
}

// ─── MEMBERS ───
function Members({ state, dispatch, go }) {
  const [q, setQ] = useState("");
  const [sf, setSf] = useState("all");
  const [show, setShow] = useState(false);
  // altaTipo: "nueva" = cobrar inscripción | "existente" = ya pagó inscripción
  const [altaTipo, setAltaTipo] = useState("nueva");
  const [f, setF] = useState({name:"",lastName:"",phone:"",schedule:"7pm",planType:"monthly"});

  const ms = Object.values(state.members);
  const fl = ms.filter(m => {
    const t = `${m.name} ${m.lastName||""} ${m.phone||""} ${m.memberId}`.toLowerCase();
    return t.includes(q.toLowerCase()) && (sf==="all" || m.schedule===sf);
  }).sort((a,b)=>(a.name||"").localeCompare(b.name||""));

  const add = async () => {
    if (!f.name.trim()) return;
    const sch = f.schedule, cnt = (state.counters[sch]||0)+1;
    const num = sch.replace("pm","");
    const memberId = `${num}-${String(cnt).padStart(3,"0")}`;
    const id = uid();
    const member = {id,memberId,...f,name:f.name.trim(),lastName:(f.lastName||"").trim(),createdAt:today(),createdFull:nowISO()};
    const newCounters = {...state.counters,[sch]:cnt};
    dispatch({type:"ADD_MEMBER",payload:member,counters:newCounters});
    await db.set(`members/${id}`,member);
    await db.set(`counters/${sch}`,cnt);

    // Si es alumna "existente", registrar inscripción automáticamente como ya pagada (histórica)
    if (altaTipo === "existente") {
      const pid = uid();
      const inscPay = {id:pid,memberId:id,amount:100,method:"cash",date:today(),planType:"inscription",note:"Inscripción previa al sistema",createdAt:nowISO()};
      dispatch({type:"ADD_PAY",payload:inscPay});
      await db.set(`payments/${pid}`,inscPay);
    }

    setF({name:"",lastName:"",phone:"",schedule:"7pm",planType:"monthly"});
    setAltaTipo("nueva");
    setShow(false);
  };

  return (<div>
    <div className="srch"><I name="search" size={14}/><input placeholder="Buscar alumna o ID..." value={q} onChange={e=>setQ(e.target.value)}/></div>
    <div className="chips">
      {[{id:"all",l:"Todas"},...SCHEDULES.map(s=>({id:s.id,l:s.label}))].map(x=>(<button key={x.id} className={`chip ${sf===x.id?"on":""}`} onClick={()=>setSf(x.id)}>{x.l}</button>))}
    </div>
    <div className="sec">{fl.length} Alumnas</div>
    {fl.length===0&&<div className="empty"><div style={{fontSize:32}}>🔍</div><p>{q?"Sin resultados":"No hay alumnas"}</p></div>}
    {fl.map(m=>{const pl=PLAN_TYPES.find(p=>p.id===m.planType);const pd=isPaid(m,state.payments,today());return(
      <div key={m.id} className="li" onClick={()=>go("detail",m)}>
        <div className="la" style={{background:pd?"var(--mtb)":"var(--pks)",color:pd?"var(--mt)":"var(--pk)"}}>{(m.name||"?")[0]}</div>
        <div className="lc">
          <div style={{display:"flex",alignItems:"center",gap:5}}><span className="ln">{m.name} {m.lastName||""}</span><span className={`sb s${m.schedule.replace("pm","")}`}>{SCHEDULES.find(s=>s.id===m.schedule)?.short}</span></div>
          <div className="ls"><span className="mid">{m.memberId}</span> · {pl?.name} · {m.phone||"Sin tel."}</div>
        </div>
        <div className="lr">{pd?<span className="bdg bg">✓</span>:<span className="bdg br">Debe</span>}</div>
      </div>
    );})}
    <button className="fab" onClick={()=>setShow(true)}><I name="plus" size={22}/></button>
    {show&&<Modal title="✨ Nueva Alumna" onClose={()=>setShow(false)}>
      <div className="fg">
        <label className="fl">Tipo de alta</label>
        <div className="alta-toggle">
          <button className={`alta-opt ${altaTipo==="nueva"?"on":""}`} onClick={()=>setAltaTipo("nueva")}>⭐ Nueva (cobra inscripción)</button>
          <button className={`alta-opt ${altaTipo==="existente"?"on":""}`} onClick={()=>setAltaTipo("existente")}>📋 Existente (ya pagó)</button>
        </div>
        {altaTipo==="nueva"&&<div style={{fontSize:11,color:"var(--gd)",background:"var(--gdb)",padding:"7px 10px",borderRadius:8,fontWeight:600}}>⭐ Se cobrará inscripción de {fmt(100)} al registrar el pago.</div>}
        {altaTipo==="existente"&&<div style={{fontSize:11,color:"var(--bl)",background:"var(--blb)",padding:"7px 10px",borderRadius:8,fontWeight:600}}>📋 La inscripción se marcará como pagada automáticamente (alumna previa al sistema).</div>}
      </div>
      <div className="fg"><label className="fl">Nombre</label><input className="fi" placeholder="Nombre" value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></div>
      <div className="fg"><label className="fl">Apellido</label><input className="fi" placeholder="Apellido" value={f.lastName} onChange={e=>setF({...f,lastName:e.target.value})}/></div>
      <div className="fg"><label className="fl">Teléfono (WhatsApp)</label><input className="fi" type="tel" placeholder="10 dígitos" value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/></div>
      <div className="fg"><label className="fl">Horario</label><div className="sg">{SCHEDULES.map(s=>(<div key={s.id} className={`so ${f.schedule===s.id?"on":""}`} onClick={()=>setF({...f,schedule:s.id})}><div className="sot">{s.label}</div></div>))}</div></div>
      <div className="fg"><label className="fl">Plan</label><div className="pg">{PLAN_TYPES.filter(p=>p.id!=="inscription"&&p.id!=="separo").map(p=>(<div key={p.id} className={`po ${f.planType===p.id?"on":""}`} onClick={()=>setF({...f,planType:p.id})}><div className="poi">{p.icon}</div><div className="pon">{p.name}</div><div className="pop">{fmt(p.price)}</div></div>))}</div></div>
      <button className="btn bp1 bfull" style={{marginTop:4}} onClick={add}><I name="check" size={14}/> Registrar Alumna</button>
    </Modal>}
  </div>);
}

// ─── DETAIL con WA Business ───
function Detail({ member:init, state, dispatch, go }) {
  const m = state.members[init.id] || init;
  const [showPay,setShowPay] = useState(false);
  const [showEdit,setShowEdit] = useState(false);
  const [showDel,setShowDel] = useState(false);
  const [delPay,setDelPay] = useState(null);
  const [editPay,setEditPay] = useState(null);
  const [showWA,setShowWA] = useState(false);
  const [waTpl,setWaTpl] = useState("pago_pendiente");
  const pl = PLAN_TYPES.find(p=>p.id===m.planType);
  const st = getStatus(m, state.payments);
  const pd = m.planType==="monthly"?st.monthlyPaid:st.weeklyPaid;
  const mps = st.payments.sort((a,b)=>b.date.localeCompare(a.date));

  const [pf,setPf] = useState({planType:m.planType,method:"cash",amount:String(pl?.price||0),date:today(),note:""});
  const [ef,setEf] = useState({name:m.name,lastName:m.lastName||"",phone:m.phone||"",schedule:m.schedule,planType:m.planType});

  const pay = async()=>{
    const pt=PLAN_TYPES.find(p=>p.id===pf.planType);
    const amt=parseFloat(pf.amount)||pt?.price||0;
    const id=uid();
    const payment={id,memberId:m.id,amount:amt,method:pf.method,date:pf.date,planType:pf.planType,note:pf.note,createdAt:nowISO()};
    dispatch({type:"ADD_PAY",payload:payment});
    await db.set(`payments/${id}`,payment);
    setShowPay(false);
    setPf({planType:m.planType,method:"cash",amount:String(pl?.price||0),date:today(),note:""});
  };

  const savePay = async()=>{
    if(!editPay)return;
    dispatch({type:"EDIT_PAY",payload:editPay});
    await db.set(`payments/${editPay.id}`,editPay);
    setEditPay(null);
  };

  const rmPay = async(id)=>{
    dispatch({type:"DEL_PAY",payload:id});
    await db.remove(`payments/${id}`);
    setDelPay(null);
  };

  const save = async()=>{
    dispatch({type:"EDIT_MEMBER",payload:{id:m.id,...ef}});
    await db.update(`members/${m.id}`,ef);
    setShowEdit(false);
  };

  const rm = async()=>{
    for(const p of mps) await db.remove(`payments/${p.id}`);
    await db.remove(`members/${m.id}`);
    dispatch({type:"DEL_MEMBER",payload:m.id});
    go("members");
  };

  const waMsg = buildWAMessage(m, state, waTpl);
  const waLink = (msg) => `https://wa.me/52${m.phone}?text=${encodeURIComponent(msg)}`;

  const waTpls = [
    {id:"pago_pendiente", title:"Recordatorio de pago", sub:"Para alumnas con pago pendiente"},
    {id:"primer_aviso", title:"Primer aviso amable", sub:"Tono suave, primera notificación"},
    {id:"ultimo_aviso", title:"Último aviso", sub:"Cuando ya hay varios recordatorios"},
    {id:"bienvenida", title:"Bienvenida", sub:"Al registrar una alumna nueva"},
    {id:"inscripcion", title:"Cobro de inscripción", sub:"Para alumnas nuevas sin inscripción"},
  ];

  const byType = PLAN_TYPES.map(pt=>({...pt,n:mps.filter(p=>p.planType===pt.id).length,t:mps.filter(p=>p.planType===pt.id).reduce((s,p)=>s+p.amount,0)})).filter(pt=>pt.n>0);

  return (<div>
    <div style={{padding:"7px 16px"}}><button className="btn bg1 bsm" onClick={()=>go("members")}><I name="back" size={12}/> Alumnas</button></div>

    <div className="card">
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div className="la" style={{width:52,height:52,fontSize:20,background:"var(--pks)",color:"var(--pk)"}}>{(m.name||"?")[0]}</div>
        <div style={{flex:1}}>
          <div style={{fontSize:17,fontWeight:800,fontFamily:"Fredoka"}}>{m.name} {m.lastName||""}</div>
          <div className="mid" style={{fontSize:11}}>{m.memberId}</div>
          <div style={{display:"flex",gap:5,marginTop:3}}>
            <span className={`sb s${m.schedule.replace("pm","")}`}>{SCHEDULES.find(s=>s.id===m.schedule)?.label}</span>
            {pd?<span className="bdg bg">✓ Al día</span>:<span className="bdg br">Pendiente</span>}
          </div>
        </div>
      </div>
      <div style={{marginTop:12}}>
        <div className="dr"><span className="dl">📋 Plan</span><span className="dv">{pl?.name} — {fmt(pl?.price||0)}</span></div>
        <div className="dr"><span className="dl">📱 Teléfono</span><span className="dv">{m.phone||"No registrado"}</span></div>
        <div className="dr"><span className="dl">⭐ Inscripción</span><span>{st.hasInscription?<span className="bdg bg">Pagada ✓</span>:<span className="bdg bo">Sin pagar</span>}</span></div>
        <div className="dr"><span className="dl">💰 Total pagado</span><span className="dv" style={{color:"var(--mt)"}}>{fmt(st.total)}</span></div>
        <div className="dr"><span className="dl">📆 Alta</span><span className="dv">{fullDate(m.createdAt)}</span></div>
      </div>
      <div className="acts">
        <button className="btn bp1" onClick={()=>setShowPay(true)}>💰 Cobrar</button>
        <button className="btn bg1 bsm" onClick={()=>setShowEdit(true)}><I name="edit" size={13}/></button>
        <button className="btn bd1 bsm" onClick={()=>setShowDel(true)}><I name="trash" size={13}/></button>
      </div>
      {m.phone&&<div style={{marginTop:8}}>
        <button className="btn bwab bfull bsm" onClick={()=>setShowWA(true)}>💬 Mensaje WhatsApp Business</button>
      </div>}
    </div>

    {byType.length>0&&<><div className="sec">Resumen de Pagos</div>
      <div style={{display:"flex",gap:6,padding:"0 16px",overflow:"auto"}}>
        {byType.map(pt=>(<div key={pt.id} className="card" style={{margin:0,minWidth:95,textAlign:"center",padding:10,flex:"0 0 auto"}}>
          <div style={{fontSize:18}}>{pt.icon}</div><div style={{fontSize:10,fontWeight:700,color:"var(--tx2)",marginTop:2}}>{pt.name}</div>
          <div style={{fontFamily:"Fredoka",fontSize:14,fontWeight:700,color:"var(--pk)"}}>{fmt(pt.t)}</div>
          <div style={{fontSize:9,color:"var(--tx3)"}}>{pt.n} pagos</div>
        </div>))}
      </div>
    </>}

    <div className="sec">Historial ({mps.length})</div>
    {mps.length===0&&<div className="empty"><p>Sin pagos</p></div>}
    {mps.map(p=>{const pt=PLAN_TYPES.find(pl=>pl.id===p.planType);return(
      <div key={p.id} className="li" style={{cursor:"default"}}>
        <div className="la" style={{background:"var(--mtb)",color:"var(--mt)",width:34,height:34}}><I name="check" size={12}/></div>
        <div className="lc"><div className="ln">{pt?.icon} {pt?.name}</div><div className="ls">{dayName(p.date)} {fullDate(p.date)} · {p.method==="transfer"?"📲":"💵"}{p.note?` · ${p.note}`:""}</div></div>
        <div className="lr" style={{display:"flex",alignItems:"center",gap:5}}>
          <div className="lam" style={{color:"var(--mt)"}}>{fmt(p.amount)}</div>
          <button className="btn bg1 bsm" style={{padding:4}} onClick={()=>setEditPay({...p})}><I name="edit" size={11}/></button>
          <button className="btn bd1 bsm" style={{padding:4}} onClick={()=>setDelPay(p.id)}><I name="trash" size={11}/></button>
        </div>
      </div>
    );})}

    {showPay&&<Modal title="💰 Registrar Pago" onClose={()=>setShowPay(false)}>
      <div className="fg"><label className="fl">Tipo de pago</label><div className="pg">{PLAN_TYPES.map(p=>(<div key={p.id} className={`po ${pf.planType===p.id?"on":""}`} onClick={()=>setPf({...pf,planType:p.id,amount:String(p.price)})}><div className="poi">{p.icon}</div><div className="pon">{p.name}</div><div className="pop">{fmt(p.price)}</div></div>))}</div></div>
      <div className="fg"><label className="fl">Monto</label><input className="fi" type="number" inputMode="decimal" value={pf.amount} onChange={e=>setPf({...pf,amount:e.target.value})}/></div>
      <div className="fg"><label className="fl">Método</label><div style={{display:"flex",gap:7}}>{[{id:"cash",i:"💵",l:"Efectivo"},{id:"transfer",i:"📲",l:"Transferencia"}].map(x=>(<div key={x.id} className={`po ${pf.method===x.id?"on":""}`} style={{flex:1}} onClick={()=>setPf({...pf,method:x.id})}><div style={{fontSize:20}}>{x.i}</div><div className="pon">{x.l}</div></div>))}</div></div>
      <div className="fg"><label className="fl">Fecha</label><input className="fi" type="date" value={pf.date} onChange={e=>setPf({...pf,date:e.target.value})}/></div>
      <div className="fg"><label className="fl">Nota (opcional)</label><input className="fi" placeholder="Referencia..." value={pf.note} onChange={e=>setPf({...pf,note:e.target.value})}/></div>
      <button className="btn bp1 bfull" onClick={pay}><I name="check" size={14}/> Confirmar Pago</button>
    </Modal>}

    {editPay&&<Modal title="✏️ Editar Pago" onClose={()=>setEditPay(null)}>
      <div className="fg"><label className="fl">Tipo</label><select className="fi" value={editPay.planType} onChange={e=>setEditPay({...editPay,planType:e.target.value})}>{PLAN_TYPES.map(p=><option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}</select></div>
      <div className="fg"><label className="fl">Monto</label><input className="fi" type="number" inputMode="decimal" value={editPay.amount} onChange={e=>setEditPay({...editPay,amount:parseFloat(e.target.value)||0})}/></div>
      <div className="fg"><label className="fl">Método</label><select className="fi" value={editPay.method} onChange={e=>setEditPay({...editPay,method:e.target.value})}><option value="cash">💵 Efectivo</option><option value="transfer">📲 Transferencia</option></select></div>
      <div className="fg"><label className="fl">Fecha</label><input className="fi" type="date" value={editPay.date} onChange={e=>setEditPay({...editPay,date:e.target.value})}/></div>
      <div className="fg"><label className="fl">Nota</label><input className="fi" value={editPay.note||""} onChange={e=>setEditPay({...editPay,note:e.target.value})}/></div>
      <button className="btn bp1 bfull" onClick={savePay}><I name="check" size={14}/> Guardar</button>
    </Modal>}

    {showEdit&&<Modal title="✏️ Editar Alumna" onClose={()=>setShowEdit(false)}>
      <div className="fg"><label className="fl">Nombre</label><input className="fi" value={ef.name} onChange={e=>setEf({...ef,name:e.target.value})}/></div>
      <div className="fg"><label className="fl">Apellido</label><input className="fi" value={ef.lastName} onChange={e=>setEf({...ef,lastName:e.target.value})}/></div>
      <div className="fg"><label className="fl">Teléfono</label><input className="fi" type="tel" value={ef.phone} onChange={e=>setEf({...ef,phone:e.target.value})}/></div>
      <div className="fg"><label className="fl">Horario</label><div className="sg">{SCHEDULES.map(s=>(<div key={s.id} className={`so ${ef.schedule===s.id?"on":""}`} onClick={()=>setEf({...ef,schedule:s.id})}><div className="sot">{s.label}</div></div>))}</div></div>
      <div className="fg"><label className="fl">Plan</label><div className="pg">{PLAN_TYPES.filter(p=>p.id!=="inscription"&&p.id!=="separo").map(p=>(<div key={p.id} className={`po ${ef.planType===p.id?"on":""}`} onClick={()=>setEf({...ef,planType:p.id})}><div className="poi">{p.icon}</div><div className="pon">{p.name}</div><div className="pop">{fmt(p.price)}</div></div>))}</div></div>
      <button className="btn bp1 bfull" onClick={save}><I name="check" size={14}/> Guardar</button>
    </Modal>}

    {/* WA Business Modal */}
    {showWA&&<Modal title="💬 WhatsApp Business" onClose={()=>setShowWA(false)}>
      <div style={{fontSize:11,color:"var(--tx2)",marginBottom:10,fontWeight:600}}>Elige el tipo de mensaje para {m.name}:</div>
      {waTpls.map(t=>(<div key={t.id} className={`wa-tpl ${waTpl===t.id?"on":""}`} onClick={()=>setWaTpl(t.id)}>
        <div className="wa-tpl-title">{t.title}</div>
        <div className="wa-tpl-sub">{t.sub}</div>
      </div>))}
      <div className="fg" style={{marginTop:10}}>
        <label className="fl">Vista previa del mensaje</label>
        <div className="wa-msg">{waMsg}</div>
      </div>
      <a href={waLink(waMsg)} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}>
        <button className="btn bwab bfull">💬 Abrir en WhatsApp Business</button>
      </a>
      <div style={{fontSize:10,color:"var(--tx3)",textAlign:"center",marginTop:8}}>Se abrirá WhatsApp con el mensaje prellenado</div>
    </Modal>}

    {showDel&&<Confirm title="¿Eliminar alumna?" msg={`Se eliminará a ${m.name} y todo su historial.`} onOk={()=>{setShowDel(false);rm();}} onNo={()=>setShowDel(false)}/>}
    {delPay&&<Confirm title="¿Eliminar pago?" msg="Este pago se eliminará permanentemente." onOk={()=>rmPay(delPay)} onNo={()=>setDelPay(null)}/>}
  </div>);
}

// ─── PAYMENTS ───
function PayList({ state, go }) {
  const [fl,setFl]=useState("all");
  const [pr,setPr]=useState("week");
  const [tf,setTf]=useState("all");
  const td=today(),dt=new Date(td+"T12:00:00");
  const mon=getMonday(td),sun=getSunday(mon);
  const mo=dt.getMonth(),yr=dt.getFullYear();
  const ms=`${yr}-${String(mo+1).padStart(2,"0")}-01`,me=`${yr}-${String(mo+1).padStart(2,"0")}-31`;

  let list=Object.values(state.payments).sort((a,b)=>b.date.localeCompare(a.date));
  if(fl==="cash")list=list.filter(p=>p.method==="cash");
  if(fl==="transfer")list=list.filter(p=>p.method==="transfer");
  if(tf!=="all")list=list.filter(p=>p.planType===tf);
  if(pr==="week")list=list.filter(p=>p.date>=mon&&p.date<=sun);
  if(pr==="month")list=list.filter(p=>p.date>=ms&&p.date<=me);
  const tot=list.reduce((s,p)=>s+p.amount,0);
  const cT=list.filter(p=>p.method==="cash").reduce((s,p)=>s+p.amount,0);
  const tT=list.filter(p=>p.method==="transfer").reduce((s,p)=>s+p.amount,0);

  return (<div>
    <div className="tabs">{[["week","Semana"],["month","Mes"],["all","Todo"]].map(([k,l])=>(<button key={k} className={`tab ${pr===k?"on":""}`} onClick={()=>setPr(k)}>{l}</button>))}</div>
    <div className="chips" style={{marginBottom:3}}>{[["all","Todos"],["cash","💵 Efectivo"],["transfer","📲 Transf."]].map(([k,l])=>(<button key={k} className={`chip ${fl===k?"on":""}`} onClick={()=>setFl(k)}>{l}</button>))}</div>
    <div className="chips" style={{marginBottom:6}}>{[{id:"all",l:"Todos"},...PLAN_TYPES.map(p=>({id:p.id,l:`${p.icon} ${p.name}`}))].map(x=>(<button key={x.id} className={`chip ${tf===x.id?"on":""}`} onClick={()=>setTf(x.id)}>{x.l}</button>))}</div>
    <div className="card" style={{textAlign:"center"}}>
      <div style={{fontSize:10,color:"var(--tx2)",fontWeight:700,textTransform:"uppercase",letterSpacing:1}}>{pr==="week"?`${shortDate(mon)} — ${shortDate(sun)}`:pr==="month"?monthNames[mo]:"Total Acumulado"}</div>
      <div style={{fontFamily:"Fredoka",fontSize:30,fontWeight:700,color:"var(--pk)",marginTop:3}}>{fmt(tot)}</div>
      <div style={{display:"flex",justifyContent:"center",gap:14,marginTop:6,fontSize:11,fontWeight:700}}><span style={{color:"var(--mt)"}}>💵 {fmt(cT)}</span><span style={{color:"var(--bl)"}}>📲 {fmt(tT)}</span></div>
      <div style={{fontSize:10,color:"var(--tx3)",marginTop:3,fontWeight:600}}>{list.length} pagos</div>
    </div>
    <div className="sec">Movimientos</div>
    {list.length===0&&<div className="empty"><p>Sin pagos</p></div>}
    {list.map(p=>{const mb=state.members[p.memberId];const pt=PLAN_TYPES.find(pl=>pl.id===p.planType);return(
      <div key={p.id} className="li" onClick={()=>{if(mb)go("detail",mb);}}>
        <div className="la" style={{background:p.method==="transfer"?"var(--blb)":"var(--mtb)",color:p.method==="transfer"?"var(--bl)":"var(--mt)",width:36,height:36}}>{p.method==="transfer"?"📲":"💵"}</div>
        <div className="lc"><div className="ln">{mb?.name||"—"} {mb?.lastName||""}</div><div className="ls">{pt?.icon} {pt?.name} · {dayName(p.date)} {shortDate(p.date)}{p.note?` · ${p.note}`:""}</div></div>
        <div className="lr"><div className="lam" style={{color:"var(--mt)"}}>{fmt(p.amount)}</div></div>
      </div>
    );})}
  </div>);
}

// ─── COBROS con WA Business ───
function Cobros({ state, go }) {
  const td=today(),dt=new Date(td+"T12:00:00"),mo=dt.getMonth(),yr=dt.getFullYear();
  const mon=getMonday(td),sun=getSunday(mon);
  const ms=`${yr}-${String(mo+1).padStart(2,"0")}-01`,me=`${yr}-${String(mo+1).padStart(2,"0")}-31`;
  const all=Object.values(state.members),pays=Object.values(state.payments);
  const pM=all.filter(m=>m.planType==="monthly"&&!pays.some(p=>p.memberId===m.id&&p.planType==="monthly"&&p.date>=ms&&p.date<=me));
  const pW=all.filter(m=>m.planType==="weekly"&&!pays.some(p=>p.memberId===m.id&&p.planType==="weekly"&&p.date>=mon&&p.date<=sun));
  const pI=all.filter(m=>!pays.some(p=>p.memberId===m.id&&p.planType==="inscription"));
  const pending=[...new Set([...pM,...pW].map(m=>m.id))];

  const [showWA,setShowWA]=useState(null); // memberId
  const [waTpl,setWaTpl]=useState("pago_pendiente");

  const waTpls=[
    {id:"pago_pendiente",title:"Recordatorio estándar",sub:"Pago pendiente general"},
    {id:"primer_aviso",title:"Primer aviso amable",sub:"Tono suave"},
    {id:"ultimo_aviso",title:"Último aviso",sub:"Urgente pero respetuoso"},
  ];

  const Sec=({title,icon,color,list,pid})=>list.length>0&&<>
    <div className="sec" style={{color}}>{icon} {title} ({list.length})</div>
    {list.map(m=>{const pl=PLAN_TYPES.find(p=>p.id===(pid||m.planType));return(
      <div key={m.id} className="card" style={{display:"flex",alignItems:"center",gap:10,padding:11}}>
        <div className="la" style={{background:"var(--pks)",color:"var(--pk)",width:36,height:36}}>{(m.name||"?")[0]}</div>
        <div style={{flex:1,minWidth:0}}><div className="ln">{m.name} {m.lastName||""}</div><div className="ls"><span className="mid">{m.memberId}</span> · {fmt(pl?.price||0)}</div></div>
        {m.phone?<button className="btn bwab bsm" onClick={()=>{setShowWA(m);setWaTpl("pago_pendiente");}}>💬</button>:<span className="bdg bo" style={{fontSize:9}}>Sin tel.</span>}
        <button className="btn bg1 bsm" onClick={()=>go("detail",m)}><I name="eye" size={12}/></button>
      </div>
    );})}
  </>;

  const waM = showWA ? buildWAMessage(showWA, state, waTpl) : "";
  const waLink = showWA&&showWA.phone ? `https://wa.me/52${showWA.phone}?text=${encodeURIComponent(waM)}` : "#";

  return (<div>
    <div className="card" style={{background:"linear-gradient(135deg,var(--pks),var(--prb))"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{fontSize:30}}>🔔</div><div><div style={{fontFamily:"Fredoka",fontWeight:700,fontSize:15}}>Recordatorios</div><div style={{fontSize:11,color:"var(--tx2)",fontWeight:600}}>{pending.length} alumnas pendientes</div></div></div>
    </div>
    {pending.length===0&&pI.length===0&&<div className="empty" style={{marginTop:16}}><div style={{fontSize:44}}>🎉</div><p style={{fontWeight:700}}>¡Todo al día!</p></div>}
    <Sec title="Mensualidades" icon="📅" color="var(--bl)" list={pM}/>
    <Sec title="Semanales" icon="📋" color="var(--rs)" list={pW}/>
    <Sec title="Inscripciones" icon="⭐" color="var(--gd)" list={pI} pid="inscription"/>

    {showWA&&<Modal title={`💬 WA Business — ${showWA.name}`} onClose={()=>setShowWA(null)}>
      {waTpls.map(t=>(<div key={t.id} className={`wa-tpl ${waTpl===t.id?"on":""}`} onClick={()=>setWaTpl(t.id)}>
        <div className="wa-tpl-title">{t.title}</div>
        <div className="wa-tpl-sub">{t.sub}</div>
      </div>))}
      <div style={{marginTop:10}}><label className="fl">Vista previa</label><div className="wa-msg">{waM}</div></div>
      <a href={waLink} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}>
        <button className="btn bwab bfull">💬 Abrir en WhatsApp Business</button>
      </a>
    </Modal>}
  </div>);
}

// ─── CALENDARIO ───
function Calendario({ state }) {
  const td = today();
  const curYear = new Date(td+"T12:00:00").getFullYear();
  const curMonth = new Date(td+"T12:00:00").getMonth() + 1; // 1-12
  const [viewMonth, setViewMonth] = useState(curMonth);

  const payments = Object.values(state.payments);

  function getDaysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }
  function getFirstDayOfWeek(y, m) {
    // 0=Sun, adjust to Mon-first
    const fd = new Date(y, m-1, 1).getDay();
    return fd === 0 ? 6 : fd - 1;
  }

  const calData = CALENDAR_DATA[viewMonth] || {monthly:[],weekly:[],closed:[]};
  const daysInMonth = getDaysInMonth(curYear, viewMonth);
  const firstDow = getFirstDayOfWeek(curYear, viewMonth);

  // Payments made this month
  const monthStr = `${curYear}-${String(viewMonth).padStart(2,"0")}`;
  const monthPayments = payments.filter(p => p.date.startsWith(monthStr));
  const paidDays = {};
  monthPayments.forEach(p => {
    const d = parseInt(p.date.slice(8,10));
    if (!paidDays[d]) paidDays[d] = {amount:0,count:0};
    paidDays[d].amount += p.amount;
    paidDays[d].count += 1;
  });

  const totalMonthRev = monthPayments.reduce((s,p)=>s+p.amount,0);
  const cobrosCount = [...new Set([...calData.monthly,...calData.weekly])].length;

  const cells = [];
  for (let i=0;i<firstDow;i++) cells.push(null);
  for (let d=1;d<=daysInMonth;d++) cells.push(d);

  const isToday = (d) => viewMonth===curMonth && `${curYear}-${String(viewMonth).padStart(2,"0")}-${String(d).padStart(2,"0")}` === td;
  const isMonthly = (d) => calData.monthly.includes(d);
  const isWeekly = (d) => calData.weekly.includes(d);
  const isClosed = (d) => calData.closed.includes(d);

  const getDayClass = (d) => {
    if (d===null) return "cal-day empty";
    let cls = "cal-day";
    if (isToday(d)) cls += " today-hl";
    if (isClosed(d)) return cls + " d-closed";
    if (isMonthly(d) && isWeekly(d)) return cls + " d-both";
    if (isMonthly(d)) return cls + " d-monthly";
    if (isWeekly(d)) return cls + " d-weekly";
    return cls;
  };

  const prevMonth = () => setViewMonth(m => m===1?12:m-1);
  const nextMonth = () => setViewMonth(m => m===12?1:m+1);

  // All months summary
  const allMonths = Object.keys(CALENDAR_DATA).map(Number);

  return (<div>
    <div className="cal-nav">
      <button className="cal-nav-btn" onClick={prevMonth}><I name="back" size={13}/></button>
      <span className="cal-nav-lbl">{monthNames[viewMonth-1]} {curYear}</span>
      <button className="cal-nav-btn" style={{transform:"rotate(180deg)"}} onClick={nextMonth}><I name="back" size={13}/></button>
    </div>

    <div className="cal-wrap">
      <div className="cal-month">
        <div className="cal-hdr">
          <span className="cal-hdr-title">{monthNames[viewMonth-1].toUpperCase()}</span>
          <div className="cal-hdr-stats">
            <span className="cal-stat-pill">📅 {calData.monthly.length} cobros men.</span>
            <span className="cal-stat-pill">📋 {calData.weekly.length} cobros sem.</span>
          </div>
        </div>
        <div className="cal-legend">
          <div className="cal-leg-item"><div className="cal-leg-dot" style={{background:"#4A90D9"}}/> Cobro mensualidad</div>
          <div className="cal-leg-item"><div className="cal-leg-dot" style={{background:"#E85D75"}}/> Cobro semanal</div>
          <div className="cal-leg-item"><div className="cal-leg-dot" style={{background:"#D0C8CC"}}/> Estudio cerrado</div>
          {totalMonthRev>0&&<div className="cal-leg-item" style={{marginLeft:"auto",color:"var(--mt)",fontWeight:800}}>💰 {fmt(totalMonthRev)} registrados</div>}
        </div>
        <div className="cal-grid">
          {["L","M","X","J","V","S","D"].map((d,i)=>(<div key={i} className="cal-dow">{d}</div>))}
          {cells.map((d, i) => {
            const hasPay = d && paidDays[d];
            return (<div key={i} className={getDayClass(d)} style={{position:"relative"}}>
              {d||""}
              {hasPay&&<div style={{position:"absolute",bottom:1,left:"50%",transform:"translateX(-50%)",width:4,height:4,borderRadius:"50%",background:"#5CBF8A"}}/>}
            </div>);
          })}
        </div>
        {/* Cobros del mes detalle */}
        <div style={{padding:"0 10px 10px"}}>
          {calData.monthly.length>0&&<div style={{fontSize:10,color:"var(--bl)",fontWeight:700,marginBottom:3}}>
            📅 Cobros mensualidad: días {calData.monthly.join(", ")}
          </div>}
          {calData.weekly.length>0&&<div style={{fontSize:10,color:"var(--rs)",fontWeight:700,marginBottom:3}}>
            📋 Cobros semanal: días {calData.weekly.join(", ")}
          </div>}
          {calData.closed.length>0&&<div style={{fontSize:10,color:"var(--tx3)",fontWeight:700}}>
            🔒 Estudio cerrado: días {calData.closed.join(", ")}
          </div>}
        </div>
      </div>

      {/* Pagos registrados este mes */}
      {Object.keys(paidDays).length>0&&<>
        <div className="sec" style={{padding:"10px 0 6px"}}>Pagos registrados en {monthNames[viewMonth-1]}</div>
        {Object.entries(paidDays).sort((a,b)=>Number(a[0])-Number(b[0])).map(([day,info])=>(
          <div key={day} style={{display:"flex",alignItems:"center",padding:"6px 4px",borderBottom:"1px solid var(--sf3)"}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:"var(--mtb)",color:"var(--mt)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Fredoka",fontWeight:700,fontSize:12,flexShrink:0}}>{day}</div>
            <div style={{flex:1,paddingLeft:8,fontSize:11,fontWeight:600,color:"var(--tx2)"}}>{info.count} pago{info.count>1?"s":""}</div>
            <div style={{fontFamily:"Fredoka",fontSize:13,fontWeight:700,color:"var(--mt)"}}>{fmt(info.amount)}</div>
          </div>
        ))}
      </>}
    </div>
  </div>);
}

// ─── APP ───
export default function App() {
  const [state,dispatch] = useReducer(reducer,init);
  const [tab,setTab] = useState("home");
  const [member,setMember] = useState(null);
  const [loaded,setLoaded] = useState(false);

  const go = useCallback((t,m)=>{if(m)setMember(m);setTab(t);},[]);

  useEffect(()=>{
    (async()=>{
      if(db.ok()){
        try{
          const[members,payments,counters]=await Promise.all([db.get("members"),db.get("payments"),db.get("counters")]);
          dispatch({type:"LOAD",payload:{members:members||{},payments:payments||{},counters:counters||{"7pm":0,"8pm":0,"9pm":0}}});
        }catch(e){dispatch({type:"LOAD",payload:init});}
      }else{
        try{const r=await window.storage.get("vibefit-v3");if(r?.value)dispatch({type:"LOAD",payload:JSON.parse(r.value)});else dispatch({type:"LOAD",payload:init});}
        catch(e){dispatch({type:"LOAD",payload:init});}
      }
      setLoaded(true);
    })();
  },[]);

  useEffect(()=>{
    if(!db.ok())return;
    const u1=db.listen("members",d=>{if(d.path==="/")dispatch({type:"SET_MEMBERS",payload:d.data||{}});});
    const u2=db.listen("payments",d=>{if(d.path==="/")dispatch({type:"SET_PAYMENTS",payload:d.data||{}});});
    return()=>{u1();u2();};
  },[loaded]);

  useEffect(()=>{
    if(!loaded||db.ok())return;
    (async()=>{try{await window.storage.set("vibefit-v3",JSON.stringify(state));}catch(e){}})();
  },[state,loaded]);

  const pending=useMemo(()=>{
    const td=today();return Object.values(state.members).filter(m=>!isPaid(m,state.payments,td)).length;
  },[state.members,state.payments]);

  if(!loaded)return(<><style>{CSS}</style><div className="app" style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}>
    <div style={{textAlign:"center"}}><div style={{fontSize:40,animation:"pu 1.5s infinite"}}>💪</div><div style={{color:"var(--tx2)",fontFamily:"Fredoka",fontWeight:600,marginTop:8}}>Cargando Vibefit...</div></div>
  </div></>);

  const fbOk=db.ok();

  return (<><style>{CSS}</style><div className="app">
    <div className="hdr"><div className="hdr-row"><div>
      <h1>✨ VIBEFIT STUDIO</h1>
      <div className="hdr-sub">{dayName(today())} {shortDate(today())} · {Object.keys(state.members).length} alumnas</div>
    </div><div className={`sync ${fbOk?"on":""}`}><I name={fbOk?"wifi":"noWifi"} size={10} color="white"/>{fbOk?"Sync":"Local"}</div></div></div>

    {!fbOk&&tab==="home"&&<div className="setup"><strong>⚠️ Modo local</strong> — Para sincronizar 2 iPhones, configura Firebase.<code>const FIREBASE_URL = "https://tu-proyecto.firebaseio.com";</code>Ver instrucciones al inicio del código.</div>}

    {tab==="home"&&<Home state={state} go={go}/>}
    {tab==="members"&&<Members state={state} dispatch={dispatch} go={go}/>}
    {tab==="detail"&&member&&<Detail member={member} state={state} dispatch={dispatch} go={go}/>}
    {tab==="payments"&&<PayList state={state} go={go}/>}
    {tab==="cobros"&&<Cobros state={state} go={go}/>}
    {tab==="calendario"&&<Calendario state={state}/>}

    <nav className="nav">
      {[
        {id:"home",icon:"home",l:"Inicio"},
        {id:"members",icon:"users",l:"Alumnas"},
        {id:"payments",icon:"dollar",l:"Pagos"},
        {id:"cobros",icon:"bell",l:"Cobros",badge:pending},
        {id:"calendario",icon:"calendar",l:"Calendario"},
      ].map(n=>(
        <button key={n.id} className={`nb ${tab===n.id||(n.id==="members"&&tab==="detail")?"on":""}`} onClick={()=>setTab(n.id)} style={{position:"relative"}}>
          <I name={n.icon} size={18}/>{n.l}
          {n.badge>0&&<span className="nbdg">{n.badge}</span>}
        </button>
      ))}
    </nav>
  </div></>);
}

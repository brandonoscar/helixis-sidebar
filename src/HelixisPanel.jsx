import { useState, useEffect, useRef } from "react";
import './panel.css';

// ─── Gemini ───────────────────────────────────────────────────────────────────
const GEMINI_API_KEY = "AIzaSyC9Vo6i2baOv9L2aqdmrqSV1o53bbbtRxg";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// CSS is now in src/panel.css — imported above.
const _css_REMOVED = `
  @import url('REMOVED');
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
  :root {
    --bg0:#080810; --bg1:#0f0f18; --bg2:#14141e; --bg3:#1a1a26; --bg4:#20202e;
    --bd:rgba(255,255,255,0.055); --bdhi:rgba(139,92,246,0.35); --bdhov:rgba(255,255,255,0.1);
    --p:#8b5cf6; --phi:#a78bfa; --plo:rgba(139,92,246,0.12); --pglow:rgba(139,92,246,0.22);
    --g:#22c55e; --glo:rgba(34,197,94,0.1);
    --a:#f59e0b; --alo:rgba(245,158,11,0.1);
    --r:#f87171; --rlo:rgba(248,113,113,0.1);
    --b:#60a5fa; --blo:rgba(96,165,250,0.1);
    --t1:#eeeef8; --t2:#9090b0; --t3:#50506a; --t4:#2a2a3a;
    --rad:10px; --rads:6px;
    --font:'DM Sans',sans-serif; --mono:'DM Mono',monospace;
  }
  html, body { height:100%; overflow:hidden; }
  body { font-family:var(--font); background:#06060e; display:flex; flex-direction:column; height:100vh; }

  /* Panel */
  .panel {
    width:100%; height:100vh; background:var(--bg1); border-radius:0;
    border:none; display:flex; flex-direction:column; overflow:hidden;
  }

  /* Header */
  .hdr {
    display:flex; align-items:center; justify-content:space-between;
    padding:13px 15px 11px; border-bottom:1px solid var(--bd); flex-shrink:0;
    background:linear-gradient(160deg,rgba(139,92,246,0.055) 0%,transparent 60%);
  }
  .hdr-l { display:flex; align-items:center; gap:9px; }
  .logo {
    width:28px; height:28px; border-radius:7px; flex-shrink:0;
    background:linear-gradient(140deg,#6d28d9,#9333ea);
    display:flex; align-items:center; justify-content:center;
    font-size:13px; font-weight:700; color:#fff;
    box-shadow:0 0 18px rgba(139,92,246,0.45),inset 0 1px 0 rgba(255,255,255,0.15);
  }
  .hdr-name { font-size:13.5px; font-weight:600; color:var(--t1); letter-spacing:-0.3px; }
  .demo-chip {
    background:var(--plo); border:1px solid var(--bdhi); border-radius:4px;
    padding:1.5px 5px; font-size:9.5px; font-weight:600; color:var(--phi);
    font-family:var(--mono); letter-spacing:0.6px; text-transform:uppercase;
  }
  .hdr-r { display:flex; align-items:center; gap:6px; }
  .ready-pill {
    display:flex; align-items:center; gap:4px; background:var(--glo);
    border:1px solid rgba(34,197,94,0.18); border-radius:20px; padding:3px 8px;
    font-size:10.5px; font-weight:500; color:var(--g); font-family:var(--mono);
  }
  .pdot { width:5px; height:5px; border-radius:50%; background:var(--g); box-shadow:0 0 6px var(--g); animation:beat 2.2s ease-in-out infinite; }
  @keyframes beat{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.45;transform:scale(0.85)}}
  .ico { width:26px; height:26px; border-radius:6px; background:none; border:none; cursor:pointer; color:var(--t3); display:flex; align-items:center; justify-content:center; font-size:13px; transition:color .12s,background .12s; }
  .ico:hover { color:var(--t2); background:var(--bg3); }

  /* Tabs */
  .tabs { display:flex; padding:0 12px; border-bottom:1px solid var(--bd); flex-shrink:0; background:var(--bg1); }
  .tab {
    position:relative; padding:9px 13px 10px; background:none; border:none;
    font-family:var(--font); font-size:12.5px; font-weight:500; color:var(--t3);
    cursor:pointer; border-radius:8px 8px 0 0; transition:color .15s;
    display:flex; align-items:center; gap:5px;
  }
  .tab:hover { color:var(--t2); }
  .tab.on { color:var(--t1); }
  .tab.on::after { content:''; position:absolute; bottom:-1px; left:0; right:0; height:2px; background:linear-gradient(90deg,#7c3aed,#c084fc); border-radius:2px 2px 0 0; }
  .tbadge { min-width:16px; height:16px; border-radius:8px; padding:0 4px; background:var(--plo); border:1px solid var(--bdhi); font-size:9.5px; font-weight:600; color:var(--phi); font-family:var(--mono); display:flex; align-items:center; justify-content:center; }

  /* Body */
  .body { flex:1; overflow-y:auto; padding:11px 11px 8px; scrollbar-width:thin; scrollbar-color:var(--bg4) transparent; }
  .body::-webkit-scrollbar { width:3px; }
  .body::-webkit-scrollbar-thumb { background:var(--bg4); border-radius:2px; }

  /* Section label */
  .slbl { font-size:9.5px; font-weight:600; color:var(--t3); letter-spacing:0.9px; text-transform:uppercase; font-family:var(--mono); margin:4px 2px 8px; display:flex; align-items:center; justify-content:space-between; }
  .slbl span { color:var(--phi); }

  /* ── Context bar ── */
  .ctx-wrap { margin-bottom:10px; }
  .ctx-bar {
    background:var(--bg2); border:1px solid var(--bd); border-radius:var(--rads);
    padding:9px 11px; display:flex; align-items:center; gap:9px;
    transition:border-color .2s;
  }
  .ctx-bar.live-border { border-color:rgba(34,197,94,0.2); }
  .ctx-page-icon { font-size:15px; flex-shrink:0; line-height:1; }
  .ctx-detail { flex:1; min-width:0; }
  .ctx-domain { font-size:11.5px; font-weight:500; color:var(--t1); font-family:var(--mono); }
  .ctx-sub2 { font-size:10px; color:var(--t3); margin-top:1.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .live-chip { background:var(--glo); border:1px solid rgba(34,197,94,0.18); border-radius:4px; padding:1.5px 5px; font-size:9px; font-weight:600; color:var(--g); font-family:var(--mono); text-transform:uppercase; flex-shrink:0; }

  /* Scanning state */
  .ctx-scanning {
    display:flex; align-items:center; gap:7px;
    padding:5px 0 2px;
    font-size:10px; color:var(--t3); font-family:var(--mono);
    animation:fadeUp .2s ease;
  }
  .scan-dots { display:flex; gap:3px; align-items:center; }
  .scan-dots span { width:3px; height:3px; border-radius:50%; background:var(--p); animation:sdot 1.1s ease-in-out infinite; }
  .scan-dots span:nth-child(2){animation-delay:.15s}
  .scan-dots span:nth-child(3){animation-delay:.3s}
  @keyframes sdot{0%,60%,100%{opacity:0.2}30%{opacity:1}}

  /* Detected label */
  .ctx-detected-row {
    display:flex; align-items:center; gap:5px;
    padding:5px 1px 2px;
    font-size:10px; color:var(--t3); font-family:var(--mono);
    animation:fadeUp .25s ease;
  }
  @keyframes fadeUp{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}
  .ctx-detected-label { color:var(--phi); font-weight:500; }
  .ctx-demo-cycle { margin-left:auto; background:none; border:none; cursor:pointer; font-family:var(--mono); font-size:9px; color:var(--t4); padding:2px 5px; border-radius:4px; border:1px solid var(--bd); transition:all .12s; }
  .ctx-demo-cycle:hover { color:var(--t3); border-color:var(--bdhov); }

  /* Suggestions grid */
  .sg-lbl { font-size:9.5px; font-weight:600; color:var(--t3); letter-spacing:0.8px; text-transform:uppercase; font-family:var(--mono); margin-bottom:6px; }
  .sg-grid { display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-bottom:11px; }
  .sg-card { background:var(--bg2); border:1px solid var(--bd); border-radius:var(--rad); padding:10px 10px 9px; cursor:pointer; transition:all .14s; animation:fadeUp .2s ease both; }
  .sg-card:hover { background:var(--bg3); border-color:var(--bdhi); transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,0.3); }
  .sg-card:active { transform:translateY(0); }
  .sg-top { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
  .sg-ico { width:21px; height:21px; border-radius:5px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:11px; }
  .sg-ico.purple{background:var(--plo)} .sg-ico.green{background:var(--glo)} .sg-ico.blue{background:var(--blo)} .sg-ico.amber{background:var(--alo)}
  .sg-lbl2 { font-size:11.5px; font-weight:600; color:var(--t1); }
  .sg-sub { font-size:10px; color:var(--t3); line-height:1.3; }

  /* Divider */
  .divider { height:1px; background:var(--bd); margin:4px 0 10px; }

  /* Chat */
  .chat-area { display:flex; flex-direction:column; gap:5px; }
  .brow { display:flex; }
  .brow.user { justify-content:flex-end; }
  .bubble { max-width:84%; font-size:12px; line-height:1.55; padding:8px 12px; border-radius:12px; white-space:pre-wrap; word-break:break-word; }
  .bubble.user { background:linear-gradient(135deg,#6d28d9,#9333ea); color:#fff; border-radius:12px 12px 3px 12px; box-shadow:0 2px 10px rgba(139,92,246,0.25); }
  .bubble.ai { background:var(--bg2); border:1px solid var(--bd); color:var(--t1); border-radius:3px 12px 12px 12px; }
  .btime { font-size:9.5px; color:var(--t3); margin-top:2px; font-family:var(--mono); }
  .brow.user .btime { text-align:right; }
  .typing { display:flex; align-items:center; gap:3px; padding:9px 12px; background:var(--bg2); border:1px solid var(--bd); border-radius:3px 12px 12px 12px; width:44px; }
  .typing span { width:4px; height:4px; border-radius:50%; background:var(--t3); animation:tdot 1.4s ease-in-out infinite; }
  .typing span:nth-child(2){animation-delay:.15s} .typing span:nth-child(3){animation-delay:.3s}
  @keyframes tdot{0%,60%,100%{transform:translateY(0);opacity:0.4}30%{transform:translateY(-3px);opacity:1}}

  /* Chat footer */
  .chat-foot { padding:8px 11px 10px; border-top:1px solid var(--bd); background:var(--bg1); flex-shrink:0; }
  .chat-row { display:flex; align-items:center; gap:7px; background:var(--bg0); border:1px solid var(--bd); border-radius:10px; padding:7px 10px; transition:border-color .15s; }
  .chat-row:focus-within { border-color:var(--bdhi); box-shadow:0 0 0 3px rgba(139,92,246,0.07); }
  .chat-inp { flex:1; background:none; border:none; outline:none; font-family:var(--font); font-size:12.5px; color:var(--t1); }
  .chat-inp::placeholder { color:var(--t4); }
  .send-btn { width:24px; height:24px; border-radius:6px; background:linear-gradient(135deg,#6d28d9,#9333ea); border:none; cursor:pointer; color:#fff; font-size:11px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(139,92,246,0.3); transition:all .13s; flex-shrink:0; }
  .send-btn:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(139,92,246,0.45); }
  .send-btn:disabled { opacity:0.4; cursor:default; transform:none; }

  /* Task cards */
  .tcard { background:var(--bg2); border:1px solid var(--bd); border-radius:var(--rad); margin-bottom:7px; position:relative; overflow:hidden; transition:border-color .15s,background .15s,opacity .25s,transform .25s; animation:slideIn .2s ease both; }
  @keyframes slideIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  .tcard:hover { background:var(--bg3); border-color:var(--bdhov); }
  .tcard.leaving { opacity:0; transform:translateX(10px) scale(0.97); }
  .tcard-accent { position:absolute; left:0; top:0; bottom:0; width:2.5px; }
  .tcard-accent.webhook { background:var(--p); box-shadow:2px 0 8px var(--pglow); }
  .tcard-accent.demo    { background:var(--a); box-shadow:2px 0 8px rgba(245,158,11,0.2); }
  .tcard-inner { padding:11px 12px 10px 14px; }
  .tcard-top { display:flex; align-items:flex-start; gap:8px; margin-bottom:6px; }
  .tcard-icon { font-size:14px; flex-shrink:0; margin-top:1px; }
  .tcard-title { font-size:12px; font-weight:500; color:var(--t1); line-height:1.45; flex:1; }
  .tcard-chips { display:flex; flex-direction:column; align-items:flex-end; gap:3px; flex-shrink:0; }
  .chip { font-size:9.5px; font-weight:600; font-family:var(--mono); padding:2px 5px; border-radius:4px; letter-spacing:0.2px; text-transform:uppercase; }
  .chip-webhook { background:var(--plo); color:var(--phi); border:1px solid rgba(139,92,246,0.18); }
  .chip-demo    { background:var(--alo); color:var(--a);   border:1px solid rgba(245,158,11,0.18); }
  .chip-conf    { background:var(--bg3); color:var(--t2); border:1px solid var(--bd); }
  .tcard-src { font-size:10px; color:var(--t3); font-family:var(--mono); margin-bottom:8px; padding-left:22px; display:flex; align-items:center; gap:4px; }
  .src-arr { color:var(--t4); }
  .conf-track { height:2px; background:var(--bg4); border-radius:2px; margin:0 0 9px; overflow:hidden; }
  .conf-fill  { height:100%; border-radius:2px; background:linear-gradient(90deg,#6d28d9,#c084fc); }
  .tcard-foot { display:flex; align-items:center; justify-content:space-between; gap:6px; }
  .tcard-actions { display:flex; gap:3px; }

  /* Buttons */
  .btn { font-family:var(--font); font-size:11px; font-weight:500; border:none; cursor:pointer; border-radius:var(--rads); padding:4.5px 9px; transition:all .13s; display:flex; align-items:center; gap:3px; }
  .btn-approve { background:linear-gradient(135deg,#6d28d9,#9333ea); color:#fff; box-shadow:0 2px 10px rgba(139,92,246,0.3); }
  .btn-approve:hover { box-shadow:0 4px 16px rgba(139,92,246,0.5); transform:translateY(-1px); }
  .btn-ghost { background:rgba(255,255,255,0.04); color:var(--t2); border:1px solid var(--bd); }
  .btn-ghost:hover { background:rgba(255,255,255,0.08); color:var(--t1); border-color:var(--bdhov); }
  .btn-red { background:var(--rlo); color:var(--r); border:1px solid rgba(248,113,113,0.15); }
  .btn-red:hover { background:rgba(248,113,113,0.18); }
  .btn-sm { padding:3.5px 8px; font-size:10.5px; }

  /* Activity */
  .aentry { background:var(--bg2); border:1px solid var(--bd); border-radius:var(--rad); padding:10px 12px; margin-bottom:6px; display:flex; align-items:flex-start; gap:9px; transition:background .12s; animation:slideIn .2s ease both; }
  .aentry:hover { background:var(--bg3); }
  .a-orb { width:27px; height:27px; border-radius:7px; flex-shrink:0; margin-top:1px; display:flex; align-items:center; justify-content:center; font-size:12px; }
  .a-orb.done{background:var(--glo)} .a-orb.auto{background:var(--blo)} .a-orb.ai{background:var(--plo)} .a-orb.manual{background:var(--bg3)}
  .a-body { flex:1; }
  .a-title { font-size:12px; font-weight:500; color:var(--t1); line-height:1.38; margin-bottom:5px; }
  .a-meta { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
  .stag { font-size:9.5px; font-weight:600; font-family:var(--mono); padding:1.5px 5px; border-radius:4px; text-transform:uppercase; letter-spacing:0.3px; }
  .stag-done{background:var(--glo);color:var(--g)} .stag-auto{background:var(--blo);color:var(--b)} .stag-ai{background:var(--plo);color:var(--phi)} .stag-manual{background:var(--bg3);color:var(--t2);border:1px solid var(--bd)}
  .a-time { font-size:9.5px; color:var(--t3); font-family:var(--mono); }
  .a-src { font-size:9.5px; color:var(--t3); background:var(--bg3); border:1px solid var(--bd); border-radius:3px; padding:1px 5px; font-family:var(--mono); }

  /* Settings */
  .sg-grp { margin-bottom:16px; }
  .sg-grp-title { font-size:9.5px; font-weight:600; color:var(--t3); letter-spacing:0.9px; text-transform:uppercase; font-family:var(--mono); margin-bottom:8px; }
  .srow { background:var(--bg2); border:1px solid var(--bd); border-radius:var(--rad); padding:10px 12px; margin-bottom:5px; display:flex; align-items:center; gap:10px; }
  .srow-info { flex:1; }
  .srow-lbl { font-size:12.5px; font-weight:500; color:var(--t1); }
  .srow-sub { font-size:10.5px; color:var(--t3); margin-top:2px; }
  .sinput { width:100%; background:var(--bg0); border:1px solid var(--bd); border-radius:var(--rads); padding:7px 10px; font-family:var(--mono); font-size:11.5px; color:var(--t1); outline:none; transition:border-color .15s; }
  .sinput:focus { border-color:var(--bdhi); }
  .sinput::placeholder { color:var(--t4); }
  .toggle { width:34px; height:19px; border-radius:10px; cursor:pointer; border:none; position:relative; transition:background .2s; flex-shrink:0; }
  .toggle::after { content:''; position:absolute; top:2px; left:2px; width:15px; height:15px; border-radius:50%; background:#fff; transition:transform .2s; box-shadow:0 1px 3px rgba(0,0,0,0.3); }
  .toggle.on{background:var(--p)} .toggle.on::after{transform:translateX(15px)} .toggle.off{background:var(--bg4)}
  .cdot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
  .cdot.on{background:var(--g);box-shadow:0 0 5px var(--g)} .cdot.off{background:var(--t4)}
  .notice { background:rgba(139,92,246,0.07); border:1px solid rgba(139,92,246,0.15); border-radius:var(--rads); padding:8px 10px; margin-top:7px; font-size:10.5px; color:var(--t3); line-height:1.5; }
  .notice code { color:var(--phi); font-family:var(--mono); background:rgba(139,92,246,0.1); padding:0 3px; border-radius:3px; }
  .save-row { display:flex; gap:6px; margin-top:14px; }
  .btn-save { flex:1; background:linear-gradient(135deg,#6d28d9,#9333ea); color:#fff; font-family:var(--font); font-size:12.5px; font-weight:600; border:none; border-radius:var(--rad); padding:9px; cursor:pointer; box-shadow:0 2px 10px rgba(139,92,246,0.25); transition:all .13s; }
  .btn-save:hover { box-shadow:0 4px 16px rgba(139,92,246,0.4); transform:translateY(-1px); }
  .btn-test { flex:1; background:var(--bg2); color:var(--t2); font-family:var(--font); font-size:12.5px; font-weight:500; border:1px solid var(--bd); border-radius:var(--rad); padding:9px; cursor:pointer; transition:all .13s; }
  .btn-test:hover { background:var(--bg3); color:var(--t1); }

  /* Footer */
  .foot { display:flex; align-items:center; justify-content:space-between; padding:5px 13px 7px; border-top:1px solid var(--bd); flex-shrink:0; background:rgba(0,0,0,0.2); }
  .foot-l { display:flex; align-items:center; gap:5px; font-size:9.5px; color:var(--g); font-family:var(--mono); }
  .foot-dot { width:4px; height:4px; border-radius:50%; background:var(--g); }
  .foot-r { font-size:9.5px; color:var(--t4); font-family:var(--mono); }

  /* Empty */
  .empty { display:flex; flex-direction:column; align-items:center; justify-content:center; height:180px; color:var(--t4); text-align:center; gap:10px; }
  .empty-ico { font-size:26px; opacity:0.35; }
  .empty-txt { font-size:11.5px; }
`;

// ── Data ───────────────────────────────────────────────────────────────────

const DETECTED_PAGES = [
  {
    key: "buildium",
    icon: "🏢",
    domain: "app.buildium.com",
    detail: "Lease Overview · 12 properties",
    live: true,
    suggestions: [
      { icon:"📋", color:"purple", label:"Draft lease renewal",  sub:"123 Spruce St · due in 30d" },
      { icon:"💸", color:"green",  label:"Post payment",         sub:"Record tenant payment" },
      { icon:"🔧", color:"blue",   label:"New work order",       sub:"Create maintenance task" },
      { icon:"📧", color:"amber",  label:"Email tenant",         sub:"Compose from page context" },
    ],
  },
  {
    key: "gmail",
    icon: "📧",
    domain: "mail.google.com",
    detail: "Inbox · 3 property-related emails",
    live: true,
    suggestions: [
      { icon:"✦",  color:"purple", label:"Summarize thread",   sub:"AI summary of conversation" },
      { icon:"📌", color:"blue",   label:"Save to Helixis",    sub:"Capture as a task" },
      { icon:"↩",  color:"green",  label:"Draft reply",        sub:"AI-assisted response" },
      { icon:"🔗", color:"amber",  label:"Link to property",   sub:"Tag to a unit or owner" },
    ],
  },
  {
    key: "calendar",
    icon: "📅",
    domain: "calendar.google.com",
    detail: "4 property events this week",
    live: false,
    suggestions: [
      { icon:"🔔", color:"amber",  label:"Set lease reminder",  sub:"Upcoming expirations" },
      { icon:"📋", color:"purple", label:"Summarize event",     sub:"AI notes for inspection" },
      { icon:"🏠", color:"blue",   label:"Assign to property",  sub:"Link to unit or owner" },
      { icon:"📧", color:"green",  label:"Invite owner",        sub:"Send calendar invite" },
    ],
  },
];

const TASKS = [
  { id:1, type:"webhook", icon:"🧾", title:"New vendor invoice received - ABC Plumbing",       source:["Gmail","Buildium"],          confidence:94, actions:["Start","Complete"] },
  { id:2, type:"demo",    icon:"📋", title:"Lease renewal due in 30 days - 123 Spruce St",     source:["Buildium","Google Calendar"], confidence:87, actions:["Start","Complete"] },
  { id:3, type:"webhook", icon:"🔧", title:"Maintenance request marked complete - Unit 4B",    source:["Buildium","Webhook"],         confidence:99, actions:["Complete"] },
  { id:4, type:"demo",    icon:"📊", title:"Owner statement ready - Q1 2025",                  source:["Buildium","Report Engine"],   confidence:91, actions:["Start","Complete"] },
];

const ACTIVITY = [
  { id:1, orb:"done",   icon:"✓", title:"Invoice entered into Buildium",             status:"Completed",     stag:"done",   time:"2m ago",    src:"Webhook" },
  { id:2, orb:"auto",   icon:"⚡", title:"Tenant payment recorded - Unit 12A",        status:"Auto-executed", stag:"auto",   time:"18m ago",   src:"Buildium" },
  { id:3, orb:"ai",     icon:"✦", title:"Lease renewal email drafted - 123 Spruce St",status:"AI-assisted",   stag:"ai",     time:"1h ago",    src:"Demo" },
  { id:4, orb:"done",   icon:"✓", title:"Maintenance ticket closed - Unit 4B",        status:"Completed",     stag:"done",   time:"2h ago",    src:"Manual" },
  { id:5, orb:"auto",   icon:"⚡", title:"Vendor payment queued - ABC Plumbing $480",  status:"Auto-executed", stag:"auto",   time:"3h ago",    src:"Webhook" },
  { id:6, orb:"done",   icon:"✓", title:"Owner statement delivered - Q1 2025",        status:"Completed",     stag:"done",   time:"Yesterday", src:"Buildium" },
];

const INIT_CHAT = [
  { role:"user", text:"What leases expire next month?", time:"2m ago" },
  { role:"ai",   text:"Found 3 leases expiring in April: 123 Spruce St (Apr 8), 45 Oak Ave (Apr 15), and 7 Pine Rd (Apr 29). Want me to draft renewal notices for all three?", time:"2m ago" },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function HelixisPanel() {
  const [tab, setTab]               = useState("copilot");
  const [dismissed, setDismissed]   = useState([]);
  const [leaving, setLeaving]       = useState([]);
  const [chatInput, setChatInput]   = useState("");
  const [messages, setMessages]     = useState(INIT_CHAT);
  const [typing, setTyping]         = useState(false);
  const [demoMode, setDemoMode]     = useState(true);
  const [cloudOn, setCloudOn]       = useState(false);
  const [apiKey, setApiKey]         = useState("");
  const [pageIdx, setPageIdx]       = useState(0);
  const [scanning, setScanning]     = useState(true);
  const [geminiHistory, setGeminiHistory] = useState([]);
  const chatRef = useRef(null);

  useEffect(() => {
    setScanning(true);
    const t = setTimeout(() => setScanning(false), 1100);
    return () => clearTimeout(t);
  }, [pageIdx]);

  const page = DETECTED_PAGES[pageIdx];
  const activeTasks = TASKS.filter(t => !dismissed.includes(t.id));

  const dismiss = (id) => {
    setLeaving(p => [...p, id]);
    setTimeout(() => {
      setDismissed(p => [...p, id]);
      setLeaving(p => p.filter(x => x !== id));
    }, 280);
  };

  const approve = (id) => dismiss(id);

  // ── Gemini chat ────────────────────────────────────────────────────────────
  const send = async () => {
    if (!chatInput.trim()) return;
    const txt = chatInput.trim();
    setChatInput("");
    setMessages(p => [...p, { role:"user", text:txt, time:"just now" }]);
    setTyping(true);

    const updatedHistory = [...geminiHistory, { role:"user", parts:[{ text:txt }] }];

    try {
      const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: `You are Helixis Copilot, an AI assistant for property managers. The user is currently on ${page.domain} — ${page.detail}. Be concise and helpful.` }],
          },
          contents: updatedHistory,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "(No response)";

      setGeminiHistory([...updatedHistory, { role:"model", parts:[{ text:reply }] }]);
      setMessages(p => [...p, { role:"ai", text:reply, time:"just now" }]);
    } catch (e) {
      setMessages(p => [...p, { role:"ai", text:`Error: ${e.message}`, time:"just now" }]);
    } finally {
      setTyping(false);
    }
  };

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, typing]);

  return (
    <div className="panel">

        {/* ── Header ── */}
        <div className="hdr">
          <div className="hdr-l">
            <div className="logo">H</div>
            <span className="hdr-name">Helixis Copilot</span>
            {demoMode && <span className="demo-chip">Demo</span>}
          </div>
          <div className="hdr-r">
            <div className="ready-pill"><div className="pdot" />Ready</div>
            <button className="ico" onClick={() => setTab("settings")}>⚙</button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="tabs">
          {[
            { id:"copilot",  label:"Copilot" },
            { id:"tasks",    label:"Tasks", count: activeTasks.length },
            { id:"activity", label:"Activity" },
            { id:"settings", label:"Settings" },
          ].map(t => (
            <button key={t.id} className={`tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.count !== undefined && <span className="tbadge">{t.count}</span>}
            </button>
          ))}
        </div>

        {/* ════════ COPILOT TAB ════════ */}
        {tab === "copilot" && <>
          <div className="body" ref={chatRef}>

            <div className="ctx-wrap">
              <div className={`ctx-bar ${page.live ? "live-border" : ""}`}>
                <span className="ctx-page-icon">{page.icon}</span>
                <div className="ctx-detail">
                  <div className="ctx-domain">{page.domain}</div>
                  {!scanning && <div className="ctx-sub2">{page.detail}</div>}
                  {scanning && <div className="ctx-sub2" style={{color:"var(--t4)"}}>Reading page...</div>}
                </div>
                {!scanning && page.live && <span className="live-chip">Live</span>}
              </div>

              {scanning ? (
                <div className="ctx-scanning">
                  <div className="scan-dots"><span/><span/><span/></div>
                  Detecting active page...
                </div>
              ) : (
                <div className="ctx-detected-row">
                  <span style={{color:"var(--g)", fontSize:"9px"}}>✓</span>
                  <span>Page detected:</span>
                  <span className="ctx-detected-label">{page.key}</span>
                  <button
                    className="ctx-demo-cycle"
                    onClick={() => setPageIdx(i => (i + 1) % DETECTED_PAGES.length)}
                    title="[Demo] Simulate navigating to next page"
                  >
                    simulate nav
                  </button>
                </div>
              )}
            </div>

            {!scanning && <>
              <div className="sg-lbl">Suggested for this page</div>
              <div className="sg-grid">
                {page.suggestions.map((s, i) => (
                  <div key={i} className="sg-card" style={{ animationDelay:`${i * 0.05}s` }}>
                    <div className="sg-top">
                      <div className={`sg-ico ${s.color}`}>{s.icon}</div>
                      <span className="sg-lbl2">{s.label}</span>
                    </div>
                    <div className="sg-sub">{s.sub}</div>
                  </div>
                ))}
              </div>
            </>}

            {scanning && (
              <div style={{ height:120, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <div className="scan-dots"><span/><span/><span/></div>
              </div>
            )}

            <div className="divider" />

            <div className="chat-area">
              {messages.map((m, i) => (
                <div key={i} className={`brow ${m.role}`}>
                  <div>
                    <div className={`bubble ${m.role}`}>{m.text}</div>
                    <div className="btime">{m.time}</div>
                  </div>
                </div>
              ))}
              {typing && (
                <div className="brow ai">
                  <div className="typing"><span/><span/><span/></div>
                </div>
              )}
            </div>
          </div>

          <div className="chat-foot">
            <div className="chat-row">
              <input
                className="chat-inp"
                placeholder="Ask anything about your properties..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !typing && send()}
              />
              <button className="send-btn" onClick={send} disabled={typing}>↑</button>
            </div>
          </div>
        </>}

        {/* ════════ TASKS TAB ════════ */}
        {tab === "tasks" && (
          <div className="body">
            <div className="slbl">Incoming <span>· {activeTasks.length} pending</span></div>
            {activeTasks.map((t, i) => (
              <div
                key={t.id}
                className={`tcard ${leaving.includes(t.id) ? "leaving" : ""}`}
                style={{ animationDelay:`${i * 0.045}s` }}
              >
                <div className={`tcard-accent ${t.type}`} />
                <div className="tcard-inner">
                  <div className="tcard-top">
                    <span className="tcard-icon">{t.icon}</span>
                    <div className="tcard-title">{t.title}</div>
                    <div className="tcard-chips">
                      <span className={`chip chip-${t.type}`}>{t.type === "webhook" ? "Webhook" : "Demo"}</span>
                      <span className="chip chip-conf">{t.confidence}%</span>
                    </div>
                  </div>
                  <div className="tcard-src">
                    {t.source[0]}<span className="src-arr"> › </span>{t.source[1]}
                  </div>
                  <div className="conf-track">
                    <div className="conf-fill" style={{ width:`${t.confidence}%` }} />
                  </div>
                  <div className="tcard-foot">
                    <div className="tcard-actions">
                      {t.actions.map(a => <button key={a} className="btn btn-ghost btn-sm">{a}</button>)}
                      <button className="btn btn-red btn-sm" onClick={() => dismiss(t.id)}>Dismiss</button>
                    </div>
                    <button className="btn btn-approve btn-sm" onClick={() => approve(t.id)}>✓ Approve</button>
                  </div>
                </div>
              </div>
            ))}
            {activeTasks.length === 0 && (
              <div className="empty">
                <div className="empty-ico">✓</div>
                <div className="empty-txt">All tasks handled</div>
              </div>
            )}
          </div>
        )}

        {/* ════════ ACTIVITY TAB ════════ */}
        {tab === "activity" && (
          <div className="body">
            <div className="slbl">
              Execution log <span>· Today</span>
              <button className="btn btn-ghost btn-sm">Refresh</button>
            </div>
            {ACTIVITY.map((a, i) => (
              <div key={a.id} className="aentry" style={{ animationDelay:`${i * 0.04}s` }}>
                <div className={`a-orb ${a.orb}`}>{a.icon}</div>
                <div className="a-body">
                  <div className="a-title">{a.title}</div>
                  <div className="a-meta">
                    <span className={`stag stag-${a.stag}`}>{a.status}</span>
                    <span className="a-time">{a.time}</span>
                    <span className="a-src">{a.src}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ════════ SETTINGS TAB ════════ */}
        {tab === "settings" && (
          <div className="body">
            <div className="sg-grp">
              <div className="sg-grp-title">Helixis Cloud</div>
              <div className="srow" style={{ flexDirection:"column", alignItems:"stretch", gap:6 }}>
                <div className="srow-lbl" style={{ marginBottom:2 }}>API Key</div>
                <input
                  className="sinput" type="password" placeholder="Enter API key..."
                  value={apiKey} onChange={e => setApiKey(e.target.value)}
                />
                <div style={{ fontSize:"10px", color:"var(--t3)" }}>
                  {apiKey ? "● Configured" : "○ Not configured"}
                </div>
              </div>
              <div className="notice">
                🔒 Key is written to <code>chrome.storage.local</code>. Never accessible from page scripts or the panel after saving.
              </div>
              <div className="srow" style={{ marginTop:6, flexDirection:"column", alignItems:"stretch", gap:4 }}>
                <div className="srow-lbl">Event Channel URL</div>
                <input className="sinput" defaultValue="ws://localhost:8765/events" />
              </div>
            </div>

            <div className="sg-grp">
              <div className="sg-grp-title">Connectors</div>
              <div className="srow">
                <div className={`cdot ${cloudOn ? "on" : "off"}`} />
                <div className="srow-info">
                  <div className="srow-lbl">Helixis Cloud</div>
                  <div className="srow-sub">Real-time tasks and messages</div>
                </div>
                <button className={`toggle ${cloudOn ? "on" : "off"}`} onClick={() => setCloudOn(p => !p)} />
              </div>
              <div className="srow">
                <div className="cdot off" />
                <div className="srow-info">
                  <div className="srow-lbl">Buildium</div>
                  <div className="srow-sub">Coming soon</div>
                </div>
                <button className="toggle off" style={{ opacity:0.4, cursor:"not-allowed" }} />
              </div>
            </div>

            <div className="sg-grp">
              <div className="sg-grp-title">Developer</div>
              <div className="srow">
                <div className="srow-info">
                  <div className="srow-lbl">Demo Mode</div>
                  <div className="srow-sub">Preload sample data for demos</div>
                </div>
                <button className={`toggle ${demoMode ? "on" : "off"}`} onClick={() => setDemoMode(p => !p)} />
              </div>
            </div>

            <div className="save-row">
              <button className="btn-save">Save Settings</button>
              <button className="btn-test">Test Connection</button>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="foot">
          <div className="foot-l">
            <div className="foot-dot" />
            Connected{demoMode ? " · Demo Mode" : ""}
          </div>
          <div className="foot-r">v0.2.0</div>
        </div>

      </div>
  );
}

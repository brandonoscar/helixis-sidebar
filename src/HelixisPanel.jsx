import { useState, useEffect, useRef } from "react";
import './panel.css';

// ─── Gemini ───────────────────────────────────────────────────────────────────
const GEMINI_API_KEY = "AIzaSyC9Vo6i2baOv9L2aqdmrqSV1o53bbbtRxg";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

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
  { id:1, orb:"done",   icon:"✓", title:"Invoice entered into Buildium",              status:"Completed",     stag:"done",   time:"2m ago",    src:"Webhook" },
  { id:2, orb:"auto",   icon:"⚡", title:"Tenant payment recorded - Unit 12A",         status:"Auto-executed", stag:"auto",   time:"18m ago",   src:"Buildium" },
  { id:3, orb:"ai",     icon:"✦", title:"Lease renewal email drafted - 123 Spruce St", status:"AI-assisted",   stag:"ai",     time:"1h ago",    src:"Demo" },
  { id:4, orb:"done",   icon:"✓", title:"Maintenance ticket closed - Unit 4B",         status:"Completed",     stag:"done",   time:"2h ago",    src:"Manual" },
  { id:5, orb:"auto",   icon:"⚡", title:"Vendor payment queued - ABC Plumbing $480",   status:"Auto-executed", stag:"auto",   time:"3h ago",    src:"Webhook" },
  { id:6, orb:"done",   icon:"✓", title:"Owner statement delivered - Q1 2025",         status:"Completed",     stag:"done",   time:"Yesterday", src:"Buildium" },
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

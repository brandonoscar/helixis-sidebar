import { useState, useEffect, useRef, useCallback } from "react";
import './panel.css';

// ── Demo modules ─────────────────────────────────────────────────────────────
import { detectPageContext, getContextualActions, DEMO_PAGES } from "./demo/pageContext.js";
import { askDemoAssistant } from "./demo/llm.js";
import { runAction } from "./demo/actions.js";
import { fakeSendSms } from "./demo/sms.js";
import { fakeSendEmail, getInitialGmailState, fakeConnectGmail, fakeDisconnectGmail, GMAIL_STATES } from "./demo/gmail.js";

// ── Static demo data ─────────────────────────────────────────────────────────

const TASKS = [
  { id:1, type:"webhook", icon:"🧾", title:"New vendor invoice received — ABC Plumbing $280",    source:["Gmail","Buildium"],          confidence:94, actions:["Start","Complete"] },
  { id:2, type:"demo",    icon:"📋", title:"Lease renewal due in 30 days — 123 Spruce St",        source:["Buildium","Google Calendar"], confidence:87, actions:["Start","Complete"] },
  { id:3, type:"webhook", icon:"🔧", title:"Maintenance request marked complete — Unit 4B",       source:["Buildium","Webhook"],         confidence:99, actions:["Complete"] },
  { id:4, type:"demo",    icon:"📊", title:"Owner statement ready — Feb 2026",                    source:["Buildium","Report Engine"],   confidence:91, actions:["Start","Complete"] },
];

const INIT_ACTIVITY = [
  { id:1, orb:"done", icon:"✓", title:"Invoice entered into Buildium",              status:"Completed",     stag:"done", time:"2m ago",    src:"Webhook" },
  { id:2, orb:"auto", icon:"⚡", title:"Tenant payment recorded — Unit 12A",         status:"Auto-executed", stag:"auto", time:"18m ago",   src:"Buildium" },
  { id:3, orb:"ai",   icon:"✦", title:"Lease renewal email drafted — 123 Spruce St", status:"AI-assisted",   stag:"ai",   time:"1h ago",    src:"Demo" },
];

const INIT_CHAT = [
  { role:"user", text:"What leases expire next month?", time:"2m ago" },
  { role:"ai",   text:"Found 3 leases expiring within 60 days:\n• Sarah Kim — Unit 7A: $1,625/mo, expires in 28 days\n• Emily Zhang — Unit 1A: $1,200/mo, expires in 44 days\n• Marcus Johnson — Unit 2: $1,800/mo, expires in 105 days\n\nWant me to draft renewal notices?", time:"2m ago" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_BADGES = {
  ai:       { label: "AI-assisted", cls: "stag-ai" },
  auto:     { label: "Automated",   cls: "stag-auto" },
  comm:     { label: "Communication", cls: "stag-comm" },
  approval: { label: "Review needed", cls: "stag-approval" },
};

let _activityId = 100;
function makeActivityEntry(title, stag, src = "Demo") {
  return {
    id: ++_activityId,
    orb: stag === "ai" ? "ai" : stag === "auto" ? "auto" : stag === "comm" ? "comm" : "done",
    icon: stag === "ai" ? "✦" : stag === "comm" ? "💬" : stag === "auto" ? "⚡" : "✓",
    title,
    status: TYPE_BADGES[stag]?.label ?? "Completed",
    stag,
    time: "just now",
    src,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function HelixisPanel() {
  // ── Core state ───────────────────────────────────────────────────────────
  const [tab, setTab]             = useState("copilot");
  const [demoMode, setDemoMode]   = useState(true);
  const [cloudOn, setCloudOn]     = useState(false);
  const [apiKey, setApiKey]       = useState("");

  // ── Page context ─────────────────────────────────────────────────────────
  const [demoPageIdx, setDemoPageIdx] = useState(0);
  const [pageCtx, setPageCtx]     = useState(() => detectPageContext(DEMO_PAGES[0].url, DEMO_PAGES[0].title));
  const [scanning, setScanning]   = useState(true);
  const [actions, setActions]     = useState([]);

  // ── Chat ─────────────────────────────────────────────────────────────────
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages]   = useState(INIT_CHAT);
  const [typing, setTyping]       = useState(false);
  const [geminiHistory, setGeminiHistory] = useState([]);
  const chatRef = useRef(null);

  // ── Tasks ────────────────────────────────────────────────────────────────
  const [dismissed, setDismissed] = useState([]);
  const [leaving, setLeaving]     = useState([]);
  const activeTasks = TASKS.filter(t => !dismissed.includes(t.id));

  // ── Activity log ─────────────────────────────────────────────────────────
  const [activity, setActivity]   = useState(INIT_ACTIVITY);

  // ── Overlays ─────────────────────────────────────────────────────────────
  const [actionResult, setActionResult] = useState(null);   // result_card / data_card
  const [smsComposer, setSmsComposer]   = useState(null);   // sms_composer
  const [emailComposer, setEmailComposer] = useState(null); // email_composer
  const [actionLoading, setActionLoading] = useState(null);  // loading action id
  const [toast, setToast]               = useState(null);

  // ── Gmail integration ────────────────────────────────────────────────────
  const [gmail, setGmail] = useState(getInitialGmailState);

  // ── SMS connection ───────────────────────────────────────────────────────
  const [smsEnabled, setSmsEnabled] = useState(true);

  // ── Page context detection ───────────────────────────────────────────────

  useEffect(() => {
    setScanning(true);
    const dp = DEMO_PAGES[demoPageIdx];
    const ctx = detectPageContext(dp.url, dp.title);
    const t = setTimeout(() => {
      setPageCtx(ctx);
      setActions(getContextualActions(ctx.type));
      setScanning(false);
    }, 900);
    return () => clearTimeout(t);
  }, [demoPageIdx]);

  // Also try real tab detection on mount
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs?.[0]) {
          const ctx = detectPageContext(tabs[0].url ?? "", tabs[0].title ?? "");
          if (ctx.live) {
            setPageCtx(ctx);
            setActions(getContextualActions(ctx.type));
          }
        }
      });
    }
  }, []);

  // ── Toast helper ─────────────────────────────────────────────────────────
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  // ── Add to activity log ──────────────────────────────────────────────────
  const addActivity = useCallback((title, stag, src) => {
    setActivity(prev => [makeActivityEntry(title, stag, src), ...prev]);
  }, []);

  // ── Action click handler ─────────────────────────────────────────────────
  const handleAction = async (action) => {
    setActionLoading(action.id);
    try {
      const result = await runAction(action.handler, pageCtx.type);
      setActionLoading(null);

      switch (result.type) {
        case "sms_composer":
          setSmsComposer(result);
          break;
        case "email_composer":
          setEmailComposer(result);
          break;
        case "result_card":
        case "data_card":
          setActionResult(result);
          break;
        default:
          setActionResult(result);
      }

      // Log the action
      const stagMap = { ai: "ai", auto: "auto", comm: "comm", approval: "approval" };
      addActivity(`${action.label} — ${pageCtx.detail}`, stagMap[action.type] ?? "done", "Copilot");
    } catch (e) {
      setActionLoading(null);
      showToast("Action failed: " + e.message);
    }
  };

  // ── Chat send ────────────────────────────────────────────────────────────
  const send = async () => {
    if (!chatInput.trim()) return;
    const txt = chatInput.trim();
    setChatInput("");
    setMessages(p => [...p, { role:"user", text:txt, time:"just now" }]);
    setTyping(true);

    try {
      const { reply, updatedHistory } = await askDemoAssistant(txt, geminiHistory, pageCtx.type);
      setGeminiHistory(updatedHistory);
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

  // ── Task actions ─────────────────────────────────────────────────────────
  const dismiss = (id) => {
    setLeaving(p => [...p, id]);
    setTimeout(() => { setDismissed(p => [...p, id]); setLeaving(p => p.filter(x => x !== id)); }, 280);
  };

  // ── SMS send handler ───────────────────────────────────────────────────
  const handleSmsSend = async (text) => {
    if (!smsComposer || !text.trim()) return;
    const result = await fakeSendSms(smsComposer.threadId, smsComposer.phone, text);
    if (result.success) {
      addActivity(`SMS sent to ${smsComposer.to}: "${text.slice(0, 50)}..."`, "comm", "SMS");
      showToast(`SMS sent to ${smsComposer.to}`);
      setSmsComposer(null);
    }
  };

  // ── Email send handler ─────────────────────────────────────────────────
  const handleEmailSend = async () => {
    if (!emailComposer) return;
    const result = await fakeSendEmail(emailComposer.to, emailComposer.subject, emailComposer.body);
    if (result.success) {
      addActivity(`Email sent to ${emailComposer.to}: "${emailComposer.subject}"`, "comm", "Gmail");
      showToast(`Email sent to ${emailComposer.to}`);
      setEmailComposer(null);
    }
  };

  // ── Gmail connection handlers ──────────────────────────────────────────
  const handleGmailConnect = async () => {
    showToast("Connecting to Gmail...");
    const state = await fakeConnectGmail();
    setGmail(state);
    showToast("Gmail connected");
    addActivity("Gmail account connected", "auto", "Settings");
  };

  const handleGmailDisconnect = async () => {
    const state = await fakeDisconnectGmail();
    setGmail(state);
    showToast("Gmail disconnected");
  };

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════

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
          { id:"activity", label:"Activity", count: activity.length > INIT_ACTIVITY.length ? activity.length - INIT_ACTIVITY.length : undefined },
          { id:"settings", label:"Settings" },
        ].map(t => (
          <button key={t.id} className={`tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="tbadge">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ═══════ COPILOT TAB ═══════ */}
      {tab === "copilot" && <>
        <div className="body" ref={chatRef}>

          {/* Context bar */}
          <div className="ctx-wrap">
            <div className={`ctx-bar ${pageCtx.live ? "live-border" : ""}`}>
              <span className="ctx-page-icon">{pageCtx.icon}</span>
              <div className="ctx-detail">
                <div className="ctx-domain">{pageCtx.domain}</div>
                {!scanning && <div className="ctx-sub2">{pageCtx.detail}</div>}
                {scanning && <div className="ctx-sub2" style={{color:"var(--t4)"}}>Reading page...</div>}
              </div>
              {!scanning && pageCtx.live && <span className="live-chip">Live</span>}
            </div>

            {scanning ? (
              <div className="ctx-scanning">
                <div className="scan-dots"><span/><span/><span/></div>
                Detecting active page...
              </div>
            ) : (
              <div className="ctx-detected-row">
                <span style={{color:"var(--g)", fontSize:"9px"}}>✓</span>
                <span>Context:</span>
                <span className="ctx-detected-label">{pageCtx.type.replace(/_/g, " ")}</span>
                <button
                  className="ctx-demo-cycle"
                  onClick={() => setDemoPageIdx(i => (i + 1) % DEMO_PAGES.length)}
                  title="[Demo] Simulate navigating to next page"
                >
                  simulate nav
                </button>
              </div>
            )}
          </div>

          {/* Contextual actions */}
          {!scanning && <>
            <div className="sg-lbl">Suggested for this page</div>
            <div className="sg-grid">
              {actions.slice(0, 5).map((a, i) => (
                <button
                  key={a.id}
                  className={`sg-card ${actionLoading === a.id ? "sg-loading" : ""}`}
                  style={{ animationDelay:`${i * 0.05}s` }}
                  onClick={() => handleAction(a)}
                  disabled={actionLoading === a.id}
                >
                  <div className="sg-top">
                    <div className={`sg-ico ${a.color}`}>{a.icon}</div>
                    <span className="sg-lbl2">{a.label}</span>
                  </div>
                  <div className="sg-sub">{a.sub}</div>
                  <div className={`sg-badge sg-badge-${a.type}`}>
                    {TYPE_BADGES[a.type]?.label ?? a.type}
                  </div>
                  {actionLoading === a.id && (
                    <div className="sg-card-loader"><div className="scan-dots sm"><span/><span/><span/></div></div>
                  )}
                </button>
              ))}
            </div>
          </>}

          {scanning && (
            <div style={{ height:120, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div className="scan-dots"><span/><span/><span/></div>
            </div>
          )}

          <div className="divider" />

          {/* Chat area */}
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

      {/* ═══════ TASKS TAB ═══════ */}
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
                    {t.actions.map(a => (
                      <button key={a} className="btn btn-ghost btn-sm" onClick={() => { addActivity(`Task "${t.title}" — ${a}`, "done", "Tasks"); dismiss(t.id); showToast(`Task ${a.toLowerCase()}d`); }}>
                        {a}
                      </button>
                    ))}
                    <button className="btn btn-red btn-sm" onClick={() => dismiss(t.id)}>Dismiss</button>
                  </div>
                  <button className="btn btn-approve btn-sm" onClick={() => { addActivity(`Task approved: "${t.title}"`, "done", "Tasks"); dismiss(t.id); showToast("Task approved"); }}>✓ Approve</button>
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

      {/* ═══════ ACTIVITY TAB ═══════ */}
      {tab === "activity" && (
        <div className="body">
          <div className="slbl">
            Execution log <span>· Today</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setActivity(INIT_ACTIVITY)}>Clear</button>
          </div>
          {activity.map((a, i) => (
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

      {/* ═══════ SETTINGS TAB ═══════ */}
      {tab === "settings" && (
        <div className="body">

          {/* Gmail Integration Card */}
          <div className="sg-grp">
            <div className="sg-grp-title">Gmail Integration</div>
            <div className="gmail-card">
              <div className="gmail-header">
                <div className="gmail-icon">📧</div>
                <div className="gmail-info">
                  <div className="gmail-title">Google Gmail</div>
                  <div className={`gmail-status gmail-status-${gmail.status}`}>
                    {gmail.status === GMAIL_STATES.CONNECTED ? "Connected" :
                     gmail.status === GMAIL_STATES.RECONNECT ? "Reconnect Required" : "Not Connected"}
                  </div>
                </div>
                {gmail.status === GMAIL_STATES.CONNECTED ? (
                  <button className="btn btn-ghost btn-sm" onClick={handleGmailDisconnect}>Disconnect</button>
                ) : (
                  <button className="btn btn-approve btn-sm" onClick={handleGmailConnect}>
                    {gmail.status === GMAIL_STATES.RECONNECT ? "Reconnect" : "Connect"}
                  </button>
                )}
              </div>

              {gmail.status === GMAIL_STATES.CONNECTED && (
                <>
                  <div className="gmail-account">
                    <span className="gmail-email">{gmail.email}</span>
                    <span className="gmail-sync">Last sync: {gmail.lastSync}</span>
                  </div>
                  <div className="gmail-scopes-title">Granted Scopes</div>
                  <div className="gmail-scopes">
                    {gmail.scopes.map(s => (
                      <div key={s.id} className="gmail-scope-row">
                        <div className={`gmail-scope-dot ${s.granted ? "on" : "off"}`} />
                        <div className="gmail-scope-info">
                          <div className="gmail-scope-label">{s.label}</div>
                          <div className="gmail-scope-desc">{s.desc}</div>
                        </div>
                        <button
                          className={`toggle sm ${s.granted ? "on" : "off"}`}
                          onClick={() => {
                            setGmail(prev => ({
                              ...prev,
                              scopes: prev.scopes.map(sc =>
                                sc.id === s.id ? { ...sc, granted: !sc.granted } : sc
                              ),
                            }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* SMS Integration Card */}
          <div className="sg-grp">
            <div className="sg-grp-title">SMS Integration</div>
            <div className="gmail-card">
              <div className="gmail-header">
                <div className="gmail-icon">💬</div>
                <div className="gmail-info">
                  <div className="gmail-title">SMS Messaging</div>
                  <div className={`gmail-status ${smsEnabled ? "gmail-status-connected" : "gmail-status-not_connected"}`}>
                    {smsEnabled ? "Enabled" : "Disabled"}
                  </div>
                </div>
                <button className={`toggle ${smsEnabled ? "on" : "off"}`} onClick={() => setSmsEnabled(p => !p)} />
              </div>
              {smsEnabled && (
                <div className="gmail-account">
                  <span className="gmail-email">Demo SMS Provider</span>
                  <span className="gmail-sync">5 active threads · No real messages sent</span>
                </div>
              )}
            </div>
          </div>

          {/* Helixis Cloud */}
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
              🔒 Key is written to <code>chrome.storage.local</code>. Never accessible from page scripts.
            </div>
          </div>

          {/* Connectors */}
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

          {/* Developer */}
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
            <button className="btn-save" onClick={() => showToast("Settings saved")}>Save Settings</button>
            <button className="btn-test" onClick={() => showToast("Connection test passed (demo)")}>Test Connection</button>
          </div>
        </div>
      )}

      {/* ═══════ OVERLAYS ═══════ */}

      {/* Action Result Modal */}
      {actionResult && (
        <div className="overlay" onClick={() => setActionResult(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-hdr">
              <span className="modal-icon">{actionResult.icon ?? "✦"}</span>
              <span className="modal-title">{actionResult.title}</span>
              <button className="modal-close" onClick={() => setActionResult(null)}>×</button>
            </div>
            <div className="modal-body">
              {actionResult.type === "data_card" && actionResult.items ? (
                <ul className="modal-list">
                  {actionResult.items.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              ) : (
                <div className="modal-content">{actionResult.content}</div>
              )}
            </div>
            <div className="modal-foot">
              <span className={`stag stag-${actionResult.status === "done" ? "done" : actionResult.status === "warning" ? "approval" : actionResult.status === "ai" ? "ai" : "auto"}`}>
                {actionResult.status === "done" ? "Completed" : actionResult.status === "warning" ? "Needs Review" : actionResult.status === "ai" ? "AI-assisted" : "Info"}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => setActionResult(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* SMS Composer Modal */}
      {smsComposer && <SmsComposerModal composer={smsComposer} onSend={handleSmsSend} onClose={() => setSmsComposer(null)} />}

      {/* Email Composer Modal */}
      {emailComposer && <EmailComposerModal composer={emailComposer} onSend={handleEmailSend} onClose={() => setEmailComposer(null)} onChange={setEmailComposer} />}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* ── Footer ── */}
      <div className="foot">
        <div className="foot-l">
          <div className="foot-dot" />
          Connected{demoMode ? " · Demo Mode" : ""}
        </div>
        <div className="foot-r">v0.3.0</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function SmsComposerModal({ composer, onSend, onClose }) {
  const [draft, setDraft] = useState(composer.draft ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    await onSend(draft);
    setSending(false);
    setSent(true);
    setTimeout(onClose, 800);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal sms-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-icon">💬</span>
          <span className="modal-title">{composer.title}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="sms-to">
            <span className="sms-to-label">To:</span>
            <span className="sms-to-name">{composer.to}</span>
            <span className="sms-to-phone">{composer.phone}</span>
          </div>

          {/* Previous messages */}
          {composer.existingMessages?.length > 0 && (
            <div className="sms-thread">
              <div className="sms-thread-label">Previous messages</div>
              {composer.existingMessages.slice(-3).map(m => (
                <div key={m.id} className={`sms-msg sms-msg-${m.dir}`}>
                  <div className="sms-msg-text">{m.text}</div>
                  <div className="sms-msg-meta">
                    {m.time}
                    {m.dir === "out" && <span className={`sms-status sms-status-${m.status}`}>{m.status}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <textarea
            className="sms-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={4}
            placeholder="Type your message..."
          />
        </div>

        <div className="modal-foot">
          <span className="sms-char-count">{draft.length} chars</span>
          <div style={{ display:"flex", gap:6 }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-approve btn-sm"
              onClick={handleSend}
              disabled={sending || sent || !draft.trim()}
            >
              {sent ? "✓ Sent" : sending ? "Sending..." : "Send SMS"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailComposerModal({ composer, onSend, onClose, onChange }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    await onSend();
    setSending(false);
    setSent(true);
    setTimeout(onClose, 800);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal email-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-icon">📧</span>
          <span className="modal-title">{composer.title}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="email-field">
            <label>To:</label>
            <input className="sinput" value={composer.to} onChange={e => onChange({ ...composer, to: e.target.value })} />
          </div>
          <div className="email-field">
            <label>Subject:</label>
            <input className="sinput" value={composer.subject} onChange={e => onChange({ ...composer, subject: e.target.value })} />
          </div>
          <textarea
            className="email-body"
            value={composer.body}
            onChange={e => onChange({ ...composer, body: e.target.value })}
            rows={8}
          />
        </div>

        <div className="modal-foot">
          <span className="stag stag-comm">via Gmail</span>
          <div style={{ display:"flex", gap:6 }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-approve btn-sm"
              onClick={handleSend}
              disabled={sending || sent}
            >
              {sent ? "✓ Sent" : sending ? "Sending..." : "Send Email"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

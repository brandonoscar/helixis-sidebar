import React from 'react';
import { createRoot } from 'react-dom/client';
import HelixisPanel from './HelixisPanel';

// Global fallback — shows any error in the DOM even if React never mounts
function showFatalError(msg, detail) {
  document.body.style.cssText = 'margin:0;background:#0f0f18;color:#f87171;font-family:monospace;font-size:11px;padding:16px;';
  document.body.innerHTML = `<b>⚠ Fatal Error</b><pre style="white-space:pre-wrap;margin-top:8px">${msg}</pre><pre style="white-space:pre-wrap;opacity:.5;margin-top:8px">${detail || ''}</pre>`;
}

window.addEventListener('error', e => {
  showFatalError(e.message, e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', e => {
  showFatalError('Unhandled Promise: ' + e.reason, '');
});

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: '#f87171', padding: '16px', fontFamily: 'monospace', fontSize: '11px', background: '#0f0f18', height: '100vh', overflow: 'auto' }}>
          <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>⚠ Render Error</div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', opacity: 0.5, marginTop: '8px' }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

try {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root element not found in DOM');
  createRoot(root).render(
    <ErrorBoundary>
      <HelixisPanel />
    </ErrorBoundary>
  );
} catch (e) {
  showFatalError(e.message, e.stack);
}

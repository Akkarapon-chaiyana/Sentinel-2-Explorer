import { Eye, EyeOff, RefreshCw, X, Layers, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { useState } from 'react';

const PALETTES = [
  { id: 'green',  label: 'Green',  bg: '#22c55e', hex: '22c55e' },
  { id: 'yellow', label: 'Yellow', bg: '#eab308', hex: 'eab308' },
  { id: 'red',    label: 'Red',    bg: '#ef4444', hex: 'ef4444' },
  { id: 'blue',   label: 'Blue',   bg: '#3b82f6', hex: '3b82f6' },
];

const DEFAULT_ASSET   = '';
const DEFAULT_PROJECT = '';

export default function GEEOverlayPanel({ overlay, onLoad, onToggle, onOpacityChange, onRemove }) {
  const [open,        setOpen]      = useState(false);
  const [assetPath,   setAssetPath] = useState(DEFAULT_ASSET);
  const [project,     setProject]   = useState(DEFAULT_PROJECT);
  const [token,       setToken]     = useState('');
  const [palette,     setPalette]   = useState('green');
  const [tokenStatus, setTokenStatus] = useState(null); // 'ok' | 'error' | 'fetching'

  const handleSignIn = () => {
    const clientId = import.meta.env.VITE_GEE_OAUTH_CLIENT_ID;
    if (!clientId || !window.google?.accounts?.oauth2) {
      setTokenStatus('error');
      return;
    }
    setTokenStatus('fetching');
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/earthengine',
      callback: (resp) => {
        if (resp.access_token) {
          setToken(resp.access_token);
          setTokenStatus('ok');
        } else {
          setTokenStatus('error');
        }
      },
    });
    client.requestAccessToken();
  };

  const isLoaded = !!overlay.mapName;

  return (
    <div className="section" style={{ paddingBottom: open ? undefined : 0 }}>

      {/* ── Collapsible header ───────────────────────────────────────────── */}
      <div
        className="section-title"
        onClick={() => setOpen(o => !o)}
        style={{
          cursor: 'pointer', userSelect: 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Layers size={12} />
          GEE Asset Overlay
          {isLoaded && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', borderRadius: 4,
              padding: '1px 5px', marginLeft: 2,
              background: overlay.enabled ? '#dcfce7' : '#f3f4f6',
              color:      overlay.enabled ? '#16a34a' : 'var(--muted)',
            }}>
              {overlay.enabled ? 'ON' : 'OFF'}
            </span>
          )}
        </span>

        {/* Eye toggle — always visible even when collapsed */}
        {isLoaded && (
          <button
            onClick={e => { e.stopPropagation(); onToggle(!overlay.enabled); }}
            title={overlay.enabled ? 'Hide overlay' : 'Show overlay'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 2, lineHeight: 1,
              color: overlay.enabled ? 'var(--gold)' : 'var(--muted)',
            }}
          >
            {overlay.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      {open && (
        <div style={{ marginTop: 8 }}>

          {/* Asset Path */}
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Asset Path</label>
            <input
              className="input"
              value={assetPath}
              onChange={e => setAssetPath(e.target.value)}
              placeholder="projects/project-id/assets/asset_name"
              style={{ fontSize: 11 }}
            />
          </div>

          {/* Project ID */}
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>GEE Project ID</label>
            <input
              className="input"
              value={project}
              onChange={e => setProject(e.target.value)}
              placeholder="your-project-id"
              style={{ fontSize: 11 }}
            />
          </div>

          {/* Access Token + auto-fetch */}
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span>Access Token</span>
              {tokenStatus === 'ok'    && <span style={{ color: '#16a34a' }}>✓ signed in</span>}
              {tokenStatus === 'error' && <span style={{ color: '#dc2626' }}>✗ sign-in failed</span>}
            </label>
            <div style={{ display: 'flex', gap: 5 }}>
              <input
                className="input"
                type="password"
                value={token}
                onChange={e => { setToken(e.target.value); setTokenStatus(null); }}
                placeholder="ya29.…"
                style={{ fontSize: 11, flex: 1 }}
              />
              <button
                onClick={handleSignIn}
                disabled={tokenStatus === 'fetching'}
                title="Sign in with your Google account to get an access token"
                style={{
                  padding: '5px 9px', borderRadius: 8, flexShrink: 0,
                  border: '1px solid var(--border)',
                  background: tokenStatus === 'ok' ? '#dcfce7' : 'var(--gold-pale)',
                  color:      tokenStatus === 'ok' ? '#16a34a' : 'var(--gold)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  gap: 4, fontSize: 11, fontWeight: 600,
                }}
              >
                {tokenStatus === 'fetching'
                  ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Zap size={12} />}
                Sign in
              </button>
            </div>

            {/* Auth hint */}
            {tokenStatus === 'error' && (
              <div style={{
                marginTop: 5, padding: '5px 8px', borderRadius: 6, fontSize: 10,
                background: '#fef9c3', border: '1px solid #fde047', color: '#713f12',
                lineHeight: 1.5,
              }}>
                Sign-in failed. Ensure your Google account has access to{' '}
                <a href="https://earthengine.google.com/signup" target="_blank" rel="noreferrer" style={{ color: '#713f12' }}>
                  Google Earth Engine
                </a>.
              </div>
            )}
            {tokenStatus === null && !token && (
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--muted)' }}>
                Click <strong>Sign in</strong> to authenticate with your Google account.
              </div>
            )}
          </div>

          {/* Color palette */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 5 }}>Overlay Color</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {PALETTES.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPalette(p.id)}
                  title={p.label}
                  style={{
                    width: 26, height: 26, borderRadius: 7, background: p.bg,
                    cursor: 'pointer', flexShrink: 0, transition: 'border 0.15s',
                    border: `2.5px solid ${palette === p.id ? 'var(--gold)' : 'transparent'}`,
                    outline: palette === p.id ? '1px solid var(--gold)' : 'none',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Opacity — only when loaded */}
          {isLoaded && (
            <div style={{ marginBottom: 10 }}>
              <label style={{
                fontSize: 10, color: 'var(--muted)',
                display: 'flex', justifyContent: 'space-between', marginBottom: 4,
              }}>
                <span>Opacity</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10 }}>
                  {Math.round(overlay.opacity * 100)}%
                </span>
              </label>
              <input
                type="range" min="0" max="1" step="0.05"
                value={overlay.opacity}
                onChange={e => onOpacityChange(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--gold)' }}
              />
            </div>
          )}

          {/* Load / Remove */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn-primary"
              onClick={() => onLoad(assetPath, project, token, PALETTES.find(p => p.id === palette)?.hex ?? '22c55e')}
              disabled={overlay.loading || !token.trim()}
              style={{
                flex: 1, fontSize: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                opacity: !token.trim() ? 0.5 : 1,
              }}
            >
              {overlay.loading
                ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</>
                : isLoaded ? 'Reload' : 'Load Overlay'}
            </button>
            {isLoaded && (
              <button
                onClick={onRemove}
                title="Remove overlay"
                style={{
                  padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                  border: '1px solid var(--border)', background: '#fff',
                  color: 'var(--muted)', display: 'flex', alignItems: 'center',
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* API error */}
          {overlay.error && (
            <div style={{
              marginTop: 8, padding: '6px 9px', borderRadius: 7, fontSize: 11,
              background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626',
              wordBreak: 'break-word',
            }}>
              {overlay.error}
            </div>
          )}

          {/* Success */}
          {isLoaded && !overlay.error && (
            <div style={{ marginTop: 6, fontSize: 10, color: '#16a34a' }}>
              ✓ Overlay loaded — collapse this panel, use eye icon to toggle
            </div>
          )}
        </div>
      )}
    </div>
  );
}

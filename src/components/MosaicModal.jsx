import { useState } from 'react';
import { X, Copy, Download, Terminal } from 'lucide-react';
import { buildMosaicScript, buildGridMosaicScript, buildEEMGRSScript, buildEEGridScript } from '../api/stac';

const BAND_OPTIONS = [
  { key: 'blue',     label: 'blue (B02)' },
  { key: 'green',    label: 'green (B03)' },
  { key: 'red',      label: 'red (B04)' },
  { key: 'nir',      label: 'nir (B08)' },
  { key: 'nir08',    label: 'nir08 (B8A)' },
  { key: 'rededge1', label: 'rededge1 (B05)' },
  { key: 'rededge2', label: 'rededge2 (B06)' },
  { key: 'rededge3', label: 'rededge3 (B07)' },
  { key: 'swir16',   label: 'swir16 (B11)' },
  { key: 'swir22',   label: 'swir22 (B12)' },
  { key: 'scl',      label: 'scl (Scene Class)' },
];

const currentYear = new Date().getFullYear();

/**
 * Props:
 *   mode = 'mgrs' | 'grid'
 *   tileIds  – string[] (mode=mgrs)
 *   gridCells – { id, bbox }[] (mode=grid)
 */
export default function MosaicModal({ mode = 'mgrs', tileIds = [], gridCells = [], onClose, toast }) {
  const [yearStart,     setYearStart]     = useState(currentYear - 1);
  const [yearEnd,       setYearEnd]       = useState(currentYear);
  const [maxCloud,      setMaxCloud]      = useState(20);
  const [resolution,    setResolution]    = useState(20);
  const [engine,        setEngine]        = useState('stackstac'); // 'stackstac' | 'earthengine'
  const [geeProject,    setGeeProject]    = useState('');
  const [eeMode,        setEeMode]        = useState('highvolume'); // 'highvolume' | 'drive'
  const [binaryAsset,   setBinaryAsset]   = useState('');
  const [cellWorkers,   setCellWorkers]   = useState(2);
  const [numWorkers,    setNumWorkers]    = useState(4);
  const [chipPx,        setChipPx]        = useState(256);
  const [selectedBands, setSelectedBands] = useState(new Set(BAND_OPTIONS.filter(b => b.key !== 'scl').map(b => b.key)));

  const toggleBand = (key) => {
    setSelectedBands(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  const params = { yearStart: Number(yearStart), yearEnd: Number(yearEnd), bands: [...selectedBands], maxCloud: Number(maxCloud), resolution: Number(resolution) };
  const eeParams = { ...params, project: geeProject.trim(), modeLocal: eeMode === 'highvolume', binaryAsset, cellWorkers: Number(cellWorkers) || 2, numWorkers: Number(numWorkers) || 4, chipPx: Number(chipPx) || 256 };

  const script = engine === 'earthengine'
    ? (mode === 'grid' ? buildEEGridScript({ cells: gridCells, ...eeParams }) : buildEEMGRSScript({ tileIds, ...eeParams }))
    : (mode === 'grid' ? buildGridMosaicScript({ cells: gridCells, ...params }) : buildMosaicScript({ tileIds, ...params }));

  const count     = mode === 'grid' ? gridCells.length : tileIds.length;
  const modeLabel = mode === 'grid' ? '50km Grid Cells' : 'MGRS Tiles';
  const filename  = engine === 'earthengine'
    ? (mode === 'grid' ? 'sentinel2_gee_grid.py' : 'sentinel2_gee_mgrs.py')
    : (mode === 'grid' ? 'sentinel2_grid_mosaic.py' : 'sentinel2_median_mosaic.py');

  const handleCopy = () =>
    navigator.clipboard.writeText(script).then(() => toast('Script copied', 'success'));

  const handleDownload = () => {
    const blob = new Blob([script], { type: 'text/x-python' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Python script downloaded', 'success');
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Yearly median mosaic">
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-titlebar">
          <div className="traffic-light" style={{ background: '#ff5f57' }} />
          <div className="traffic-light" style={{ background: '#ffbd2e' }} />
          <div className="traffic-light" style={{ background: '#28c940' }} />
          <span className="modal-title">
            <Terminal size={12} style={{ marginRight: 6, display: 'inline' }} />
            yearly-median-mosaic — {count} {modeLabel}
          </span>
          <button className="btn-icon" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Engine toggle */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { key: 'stackstac',   label: 'stackstac (local)',        color: 'var(--cyan)' },
              { key: 'earthengine', label: 'Earth Engine (fast)',  color: '#f59e0b' },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setEngine(opt.key)}
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', border: `1px solid`,
                  borderColor: engine === opt.key ? opt.color : 'rgba(255,255,255,0.08)',
                  background: engine === opt.key ? `${opt.color}18` : 'transparent',
                  color: engine === opt.key ? opt.color : 'var(--muted)',
                  transition: 'all 0.15s',
                }}
              >{opt.label}</button>
            ))}
          </div>

          {/* Info banner */}
          {engine === 'stackstac' ? (
            <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
              Generates a <strong style={{ color: 'var(--emerald)' }}>Python script</strong> using{' '}
              <code style={{ color: 'var(--cyan)' }}>stackstac</code> + <code style={{ color: 'var(--cyan)' }}>tqdm</code>.
              Streams data from S3 and computes median <strong style={{ color: 'var(--emerald)' }}>locally</strong>.
              {mode === 'grid' && <span> Each cell is ~<strong style={{ color: 'var(--emerald)' }}>50 km × 50 km</strong>.</span>}
            </div>
          ) : (
            <>
              <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                Generates a <strong style={{ color: '#f59e0b' }}>Google Earth Engine script</strong> using{' '}
                <code style={{ color: '#f59e0b' }}>COPERNICUS/S2_SR_HARMONIZED</code>.
                GEE computes the median <strong style={{ color: '#f59e0b' }}>on Google's servers</strong> — much faster than local.
                Requires a <strong style={{ color: '#f59e0b' }}>GEE account</strong> and{' '}
                <code style={{ color: '#f59e0b' }}>earthengine authenticate</code>.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div className="label" style={{ color: '#f59e0b', marginBottom: 4 }}>GEE Project ID</div>
                  <input
                    className="input"
                    placeholder="e.g. tony-1122"
                    value={geeProject}
                    onChange={e => setGeeProject(e.target.value)}
                    style={{ borderColor: geeProject ? 'rgba(245,158,11,0.5)' : undefined }}
                  />
                  {!geeProject && (
                    <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
                      ⚠ Find at console.cloud.google.com
                    </div>
                  )}
                </div>
                <div>
                  <div className="label" style={{ color: '#f59e0b', marginBottom: 4 }}>Download Mode</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {[
                      { key: 'highvolume', label: 'High Volume API', desc: 'direct to local disk' },
                      { key: 'drive',      label: 'Google Drive',    desc: 'async, then sync' },
                    ].map(opt => (
                      <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12 }}>
                        <input
                          type="radio"
                          name="eeMode"
                          checked={eeMode === opt.key}
                          onChange={() => setEeMode(opt.key)}
                          style={{ accentColor: '#f59e0b' }}
                        />
                        <span>
                          <strong style={{ color: eeMode === opt.key ? '#f59e0b' : 'var(--text)' }}>{opt.label}</strong>
                          <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 4 }}>{opt.desc}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Download tuning — only relevant for High Volume local download */}
              {eeMode === 'highvolume' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                  {/* Chip size */}
                  <div>
                    <div className="label" style={{ color: '#f59e0b', marginBottom: 6 }}>Chip Size (px)</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[64, 128, 256, 512].map(px => (
                        <button
                          key={px}
                          onClick={() => setChipPx(px)}
                          style={{
                            flex: 1, padding: '4px 0', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: chipPx === px ? 700 : 400,
                            background: chipPx === px ? '#f59e0b' : 'transparent',
                            color: chipPx === px ? '#000' : 'var(--muted)',
                            border: `1px solid ${chipPx === px ? '#f59e0b' : 'var(--border)'}`,
                          }}
                        >{px}</button>
                      ))}
                    </div>
                  </div>

                  {/* Parallel cells + chip workers side by side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div className="label" style={{ color: '#f59e0b', marginBottom: 4 }}>
                        Parallel Cells
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="range" min={1} max={8} step={1} value={cellWorkers}
                          onChange={e => setCellWorkers(Number(e.target.value))}
                          style={{ flex: 1, accentColor: '#f59e0b' }} />
                        <span style={{ minWidth: 18, textAlign: 'center', fontWeight: 700, color: '#f59e0b', fontSize: 13 }}>{cellWorkers}</span>
                      </div>
                    </div>
                    <div>
                      <div className="label" style={{ color: '#f59e0b', marginBottom: 4 }}>
                        Chip Workers
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="range" min={1} max={16} step={1} value={numWorkers}
                          onChange={e => setNumWorkers(Number(e.target.value))}
                          style={{ flex: 1, accentColor: '#f59e0b' }} />
                        <span style={{ minWidth: 18, textAlign: 'center', fontWeight: 700, color: '#f59e0b', fontSize: 13 }}>{numWorkers}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                    {cellWorkers} × {numWorkers} = <strong style={{ color: '#f59e0b' }}>{cellWorkers * numWorkers}</strong> total GEE requests.
                    Lower if you see 429 errors.
                  </div>

                </div>
              )}

              {/* Binary image asset */}
              <div>
                <div className="label" style={{ color: '#f59e0b', marginBottom: 4 }}>
                  Binary Image Asset <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
                </div>
                <input
                  className="input"
                  placeholder="e.g. projects/your-project/assets/your-binary-mask"
                  value={binaryAsset}
                  onChange={e => setBinaryAsset(e.target.value)}
                  style={{ borderColor: binaryAsset ? 'rgba(245,158,11,0.5)' : undefined }}
                />
                {binaryAsset && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                    Downloaded separately to <code style={{ color: '#f59e0b' }}>masks/</code>. Spectral bands go to <code style={{ color: '#f59e0b' }}>images/</code>.
                  </div>
                )}
              </div>
            </>
          )}

          {/* Selected items */}
          <div className="section">
            <div className="section-title">
              {mode === 'grid' ? `Selected Grid Cells (${count})` : `Selected MGRS Tiles (${count})`}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 80, overflowY: 'auto' }}>
              {(mode === 'grid' ? gridCells.map(c => c.id) : tileIds).map(id => (
                <span key={id} style={{
                  fontFamily: 'JetBrains Mono', fontSize: 11,
                  background: mode === 'grid' ? 'rgba(245,158,11,0.1)' : 'rgba(6,182,212,0.1)',
                  border: `1px solid ${mode === 'grid' ? 'rgba(245,158,11,0.3)' : 'rgba(6,182,212,0.3)'}`,
                  borderRadius: 5, padding: '2px 8px',
                  color: mode === 'grid' ? 'var(--amber)' : 'var(--cyan)',
                }}>{id}</span>
              ))}
            </div>
          </div>

          {/* Config */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            <div>
              <div className="label">Year From</div>
              <input className="input" type="number" min={2015} max={currentYear} value={yearStart} onChange={e => setYearStart(e.target.value)} />
            </div>
            <div>
              <div className="label">Year To</div>
              <input className="input" type="number" min={yearStart} max={currentYear} value={yearEnd} onChange={e => setYearEnd(e.target.value)} />
            </div>
            <div>
              <div className="label">Max Cloud %</div>
              <input className="input" type="number" min={0} max={100} value={maxCloud} onChange={e => setMaxCloud(e.target.value)} />
            </div>
            <div>
              <div className="label">Resolution (m)</div>
              <select className="input" value={resolution} onChange={e => setResolution(e.target.value)} style={{ cursor: 'pointer' }}>
                <option value={10}>10 m</option>
                <option value={20}>20 m</option>
                <option value={60}>60 m</option>
              </select>
            </div>
          </div>

          {/* Bands */}
          <div className="section">
            <div className="section-title">Bands to Include</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {BAND_OPTIONS.map(({ key, label }) => (
                <label key={key} className="checkbox-row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedBands.has(key)} onChange={() => toggleBand(key)} aria-label={label} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <pre className="code-block" style={{ maxHeight: 200 }}>{script}</pre>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" onClick={handleCopy}><Copy size={13} /> Copy Script</button>
          <button className="btn btn-primary btn-sm" onClick={handleDownload}><Download size={13} /> Download .py</button>
        </div>
      </div>
    </div>
  );
}

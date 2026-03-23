import { useState } from 'react';
import { X, Copy, Download } from 'lucide-react';
import { buildDownloadCommands } from '../api/stac';

// Asset keys as returned by Element84 STAC sentinel-2-l2a collection
const ALL_BANDS = [
  { key: 'visual',     label: 'visual (TrueColor)' },
  { key: 'blue',       label: 'blue (B02)' },
  { key: 'green',      label: 'green (B03)' },
  { key: 'red',        label: 'red (B04)' },
  { key: 'rededge1',   label: 'rededge1 (B05)' },
  { key: 'rededge2',   label: 'rededge2 (B06)' },
  { key: 'rededge3',   label: 'rededge3 (B07)' },
  { key: 'nir',        label: 'nir (B08)' },
  { key: 'nir08',      label: 'nir08 (B8A)' },
  { key: 'nir09',      label: 'nir09 (B09)' },
  { key: 'swir16',     label: 'swir16 (B11)' },
  { key: 'swir22',     label: 'swir22 (B12)' },
  { key: 'coastal',    label: 'coastal (B01)' },
  { key: 'scl',        label: 'scl (Scene Class)' },
  { key: 'aot',        label: 'aot (Aerosol)' },
  { key: 'wvp',        label: 'wvp (Water Vapor)' },
];
const DEFAULT_BANDS = ['blue', 'green', 'red'];

export default function DownloadModal({ scenes, onClose, toast }) {
  const [format, setFormat] = useState('curl');
  const [selectedBands, setSelectedBands] = useState(new Set(DEFAULT_BANDS));

  const toggleBand = (band) => {
    setSelectedBands(prev => {
      const next = new Set(prev);
      next.has(band) ? next.delete(band) : next.add(band);
      return next;
    });
  };

  const commands = buildDownloadCommands(scenes, format, [...selectedBands]);

  const handleCopy = () => {
    navigator.clipboard.writeText(commands).then(() => toast('Copied to clipboard', 'success'));
  };

  const handleExport = (ext) => {
    if (!commands) { toast('No URLs to export — select scenes and bands first', 'error'); return; }
    let content;
    if (ext === 'csv') {
      content = 'url\n' + commands.split('\n').join('\n');
    } else if (ext === 'tsv') {
      content = 'url\n' + commands.split('\n').join('\n');
    } else {
      content = commands;
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sentinel2-downloads.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Exported as .${ext}`, 'success');
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Download commands">
      <div className="modal">
        <div className="modal-titlebar">
          <div className="traffic-light" style={{ background: '#ff5f57' }} />
          <div className="traffic-light" style={{ background: '#ffbd2e' }} />
          <div className="traffic-light" style={{ background: '#28c940' }} />
          <span className="modal-title">sentinel2-downloader — {scenes.length} scene{scenes.length !== 1 ? 's' : ''}</span>
          <button className="btn-icon" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close modal">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          {/* Format selector */}
          <div className="format-tabs" role="tablist" aria-label="Download format">
            {[
              { key: 'curl', label: 'cURL (macOS)' },
              { key: 'aws',  label: 'AWS CLI' },
              { key: 'urls', label: 'Raw URLs' },
            ].map(f => (
              <button
                key={f.key}
                className={`format-tab ${format === f.key ? 'active' : ''}`}
                onClick={() => setFormat(f.key)}
                role="tab"
                aria-selected={format === f.key}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Format hint */}
          {format === 'urls' && (
            <div style={{
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12,
              color: '#f59e0b',
              marginBottom: 10,
              lineHeight: 1.5,
            }}>
              ⚠ Raw URLs open as a map preview in browsers because these are Cloud Optimized GeoTIFFs (COGs).
              Use <strong>AWS CLI</strong>, <strong>cURL</strong>, or <strong>wget</strong> tabs above to actually download the files.
            </div>
          )}

          {/* Band selector */}
          <div className="section" style={{ marginBottom: 12 }}>
            <div className="section-title">Select Bands</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ALL_BANDS.map(({ key, label }) => (
                <label key={key} className="checkbox-row" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedBands.has(key)}
                    onChange={() => toggleBand(key)}
                    aria-label={label}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Commands */}
          {commands ? (
            <pre className="code-block">{commands}</pre>
          ) : (
            <div className="empty-state">Select at least one band to generate commands.</div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" onClick={() => handleExport('txt')}>
            <Download size={13} /> .txt
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => handleExport('csv')}>
            <Download size={13} /> .csv
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => handleExport('tsv')}>
            <Download size={13} /> .tsv
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleCopy} disabled={!commands}>
            <Copy size={13} /> Copy
          </button>
        </div>
      </div>
    </div>
  );
}

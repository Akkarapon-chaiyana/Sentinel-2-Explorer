import { useMemo } from 'react';

export default function SceneChart({ scenes }) {
  const monthly = useMemo(() => {
    const counts = {};
    for (const s of scenes) {
      const dt = s.properties?.datetime;
      if (!dt) continue;
      const key = dt.slice(0, 7); // "YYYY-MM"
      counts[key] = (counts[key] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
    const max = Math.max(...sorted.map(([, v]) => v), 1);
    return sorted.map(([label, count]) => ({ label, count, pct: (count / max) * 100 }));
  }, [scenes]);

  if (monthly.length === 0) return null;

  return (
    <div className="section">
      <div className="section-title">Scene Distribution by Month</div>
      {monthly.map(({ label, count, pct }) => (
        <div className="chart-bar-row" key={label}>
          <div className="chart-bar-label">{label}</div>
          <div className="chart-bar-track">
            <div className="chart-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="chart-bar-count">{count}</div>
        </div>
      ))}
    </div>
  );
}

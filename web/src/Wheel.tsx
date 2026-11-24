import type { ReactNode } from "react";

export type Seat = { state: "open" | "waiting" | "paid" | "due" | "received" | "debt"; label?: string; me?: boolean };

/// The circle drawn as a wheel: one seat per member around a ring, progress as an arc, content in the hub.
export function Wheel({ seats, progress = 0, size = 320, children }: { seats: Seat[]; progress?: number; size?: number; children?: ReactNode }) {
  const c = size / 2;
  const r = c - size * 0.11;
  const dot = Math.max(5, Math.min(size * 0.075, (Math.PI * r) / seats.length - 3));
  const ring = 2 * Math.PI * (r - dot - 10);
  const p = Math.max(0, Math.min(1, progress));

  return (
    <div className="wheel" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="wheel-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffd166" />
            <stop offset="0.5" stopColor="#ff7a59" />
            <stop offset="1" stopColor="#c86bfa" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} className="wheel-track" />
        <circle cx={c} cy={c} r={r - dot - 10} className="wheel-inner" />
        <circle
          cx={c}
          cy={c}
          r={r - dot - 10}
          className="wheel-progress"
          stroke="url(#wheel-arc)"
          strokeDasharray={`${ring * p} ${ring}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
        {seats.map((s, i) => {
          const a = (i / seats.length) * 2 * Math.PI - Math.PI / 2;
          const x = c + r * Math.cos(a);
          const y = c + r * Math.sin(a);
          return (
            <g key={i} className={`seat ${s.state}${s.me ? " me" : ""}`}>
              {s.me && <circle cx={x} cy={y} r={dot + 5} className="seat-halo" />}
              <circle cx={x} cy={y} r={dot} />
              {dot >= 12 && (
                <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={dot * 0.85}>
                  {s.state === "received" ? "★" : s.state === "open" ? "+" : i + 1}
                </text>
              )}
              {s.label && <title>{s.label}</title>}
            </g>
          );
        })}
      </svg>
      <div className="wheel-hub">{children}</div>
    </div>
  );
}

// Small dependency-free SVG chart primitives. They share one palette so the
// dashboard reads consistently, and every chart keeps a text fallback for
// screen readers instead of relying on color alone.
export interface Series {
  label: string;
  value: number;
  color: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <article className="stat-card">
      <header>
        {icon}
        <span>{label}</span>
      </header>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </article>
  );
}

export function AreaChart({
  points,
  label,
  color = 'var(--blue)',
}: {
  points: { label: string; value: number }[];
  label: string;
  color?: string;
}) {
  const width = 640;
  const height = 180;
  const padding = { top: 16, right: 12, bottom: 26, left: 30 };
  const max = Math.max(1, ...points.map((point) => point.value));
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  const x = (index: number) => padding.left + index * step;
  const y = (value: number) => padding.top + innerHeight * (1 - value / max);
  const line = points
    .map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point.value)}`)
    .join(' ');
  const area = `${line} L${x(points.length - 1)},${padding.top + innerHeight} L${x(0)},${padding.top + innerHeight} Z`;
  return (
    <figure className="chart">
      <figcaption>{label}</figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}. Peak ${max} across ${points.length} days.`}
      >
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + innerHeight * ratio}
            y2={padding.top + innerHeight * ratio}
            className="chart-grid"
          />
        ))}
        <path d={area} fill={color} opacity={0.14} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} />
        {points.map((point, index) => (
          <circle
            key={point.label}
            cx={x(index)}
            cy={y(point.value)}
            r={point.value ? 3 : 0}
            fill={color}
          >
            <title>{`${point.label}: ${point.value}`}</title>
          </circle>
        ))}
        {points.map((point, index) =>
          index % 2 === 0 || index === points.length - 1 ? (
            <text
              key={point.label}
              x={x(index)}
              y={height - 8}
              textAnchor="middle"
              className="chart-axis"
            >
              {point.label.slice(5)}
            </text>
          ) : null,
        )}
        <text x={4} y={padding.top + 4} className="chart-axis">
          {max}
        </text>
      </svg>
    </figure>
  );
}

export function BarList({ items, label }: { items: Series[]; label: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <figure className="chart">
      <figcaption>{label}</figcaption>
      {items.length ? (
        <ul className="bar-list">
          {items.map((item) => (
            <li key={item.label}>
              <span className="bar-label">{item.label}</span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{
                    width: `${Math.max(2, (item.value / max) * 100)}%`,
                    background: item.color,
                  }}
                />
              </span>
              <span className="bar-value">{item.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No activity yet.</p>
      )}
    </figure>
  );
}

export function DonutChart({
  segments,
  label,
  total,
}: {
  segments: Series[];
  label: string;
  total: number;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const sum = Math.max(
    1,
    segments.reduce((acc, item) => acc + item.value, 0),
  );
  let offset = 0;
  return (
    <figure className="chart donut">
      <figcaption>{label}</figcaption>
      <div className="donut-body">
        <svg
          viewBox="0 0 140 140"
          role="img"
          aria-label={`${label}. ${segments
            .map((segment) => `${segment.label}: ${segment.value}`)
            .join(', ')}.`}
        >
          <circle
            cx={70}
            cy={70}
            r={radius}
            fill="none"
            stroke="var(--line)"
            strokeWidth={16}
          />
          {segments.map((segment) => {
            const length = (segment.value / sum) * circumference;
            const circle = (
              <circle
                key={segment.label}
                cx={70}
                cy={70}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={16}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              />
            );
            offset += length;
            return circle;
          })}
          <text x={70} y={70} textAnchor="middle" className="donut-total">
            {total}
          </text>
          <text x={70} y={86} textAnchor="middle" className="chart-axis">
            total
          </text>
        </svg>
        <ul className="donut-legend">
          {segments.map((segment) => (
            <li key={segment.label}>
              <i style={{ background: segment.color }} />
              {segment.label}
              <strong>{segment.value}</strong>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

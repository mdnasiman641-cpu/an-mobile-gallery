import { formatPrice } from "@/lib/utils";

// Same output as toLocaleDateString("en-GB", { day, month }), but one formatter per instance.
let dayFormatter: Intl.DateTimeFormat | null = null;
const dayLabel = () => (dayFormatter ??= new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }));

/**
 * 14-day sales bars. Single series, one hue (no legend needed; the title
 * names it). Native <title> tooltips per bar, plus a data table for screen
 * readers. Pure SVG — no chart library shipped to the browser.
 */
export function SalesChart({ data }: { data: { day: string; total: number; orders: number }[] }) {
  const max = Math.max(...data.map((d) => Number(d.total)), 1);
  const W = 700;
  const H = 180;
  const pad = { top: 12, bottom: 24, left: 0, right: 0 };
  const slot = (W - pad.left - pad.right) / Math.max(data.length, 1);
  const barW = Math.max(6, slot - 8);
  const label = (d: string) => dayLabel().format(new Date(`${d}T00:00:00`));

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="Sales per day for the last 14 days">
        <line x1={0} x2={W} y1={H - pad.bottom} y2={H - pad.bottom} stroke="var(--color-line-strong)" strokeWidth={1} />
        {data.map((d, i) => {
          const total = Number(d.total);
          const h = total > 0 ? Math.max(4, ((H - pad.top - pad.bottom) * total) / max) : 0;
          const x = pad.left + i * slot + (slot - barW) / 2;
          const y = H - pad.bottom - h;
          return (
            <g key={d.day}>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={H - pad.top - pad.bottom} fill="transparent">
                <title>{`${label(d.day)}: ${formatPrice(total)} from ${d.orders} order${d.orders === 1 ? "" : "s"}`}</title>
              </rect>
              {h > 0 ? (
                <path
                  d={`M${x},${y + h} V${y + 4} a4,4 0 0 1 4,-4 h${barW - 8} a4,4 0 0 1 4,4 V${y + h} Z`}
                  fill="var(--color-signal)"
                  pointerEvents="none"
                />
              ) : null}
              {i % 2 === 0 || data.length <= 7 ? (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-ink-mute)">
                  {label(d.day)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Sales per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Sales</th>
            <th>Orders</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{formatPrice(d.total)}</td>
              <td>{d.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

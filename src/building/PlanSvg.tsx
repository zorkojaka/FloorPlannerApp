import { entrancePoint, toM2, roomArea, type ReferencePlan, type RoomType } from './schema';

const FILL: Record<RoomType, string> = {
  office: '#173242',
  wc: '#3c3117',
  corridor: '#20262d',
  storage: '#242a31',
  tech: '#31202f',
  other: '#242a31',
};

const STROKE: Record<RoomType, string> = {
  office: '#3f8fb3',
  wc: '#cf9a35',
  corridor: '#4d5866',
  storage: '#5b6673',
  tech: '#a06ba0',
  other: '#5b6673',
};

interface PlanSvgProps {
  plan: ReferencePlan;
  /** ciljna širina v px */
  width?: number;
  showLabels?: boolean;
}

export function PlanSvg({ plan, width = 320, showLabels = false }: PlanSvgProps) {
  const margin = Math.max(plan.outline.w, plan.outline.h) * 0.04;
  const vb = {
    x: plan.outline.x - margin,
    y: plan.outline.y - margin,
    w: plan.outline.w + margin * 2,
    h: plan.outline.h + margin * 2,
  };
  const height = Math.round((width * vb.h) / vb.w);
  const fontSize = vb.w / 42;

  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      width={width}
      height={height}
      style={{ display: 'block' }}
    >
      <rect
        x={plan.outline.x}
        y={plan.outline.y}
        width={plan.outline.w}
        height={plan.outline.h}
        fill="#12161b"
        stroke="#8b97a3"
        strokeWidth={vb.w / 200}
      />
      {plan.rooms.map((room) => (
        <g key={room.id}>
          <rect
            x={room.rect.x}
            y={room.rect.y}
            width={room.rect.w}
            height={room.rect.h}
            fill={FILL[room.type]}
            stroke={STROKE[room.type]}
            strokeWidth={vb.w / 400}
          />
          {showLabels && room.type !== 'corridor' && room.rect.w > vb.w / 10 && (
            <text
              x={room.rect.x + room.rect.w / 2}
              y={room.rect.y + room.rect.h / 2}
              fill="#aab4bf"
              fontSize={fontSize}
              textAnchor="middle"
              dominantBaseline="central"
            >
              <tspan x={room.rect.x + room.rect.w / 2} dy={-fontSize * 0.55}>
                {room.name}
              </tspan>
              <tspan x={room.rect.x + room.rect.w / 2} dy={fontSize * 1.15}>
                {toM2(roomArea(room)).toFixed(1)} m²
              </tspan>
            </text>
          )}
          {showLabels && room.type === 'corridor' && (
            <text
              x={room.rect.x + room.rect.w / 2}
              y={room.rect.y + room.rect.h / 2}
              fill="#6f7a86"
              fontSize={fontSize * 0.9}
              textAnchor="middle"
              dominantBaseline="central"
            >
              Hodnik {Math.round(Math.min(room.rect.w, room.rect.h))} mm
            </text>
          )}
        </g>
      ))}
      {plan.entrances.map((entrance, index) => {
        const point = entrancePoint(plan.outline, entrance);
        const r = vb.w / 55;
        return (
          <g key={index}>
            <circle cx={point.x} cy={point.y} r={r} fill="#1fbf75" />
            <text
              x={point.x + (entrance.side === 'W' ? r * 1.6 : entrance.side === 'E' ? -r * 1.6 : 0)}
              y={point.y + (entrance.side === 'N' ? r * 2.2 : entrance.side === 'S' ? -r * 1.6 : -r * 1.4)}
              fill="#1fbf75"
              fontSize={fontSize}
              textAnchor={entrance.side === 'E' ? 'end' : 'start'}
            >
              vhod
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PlanLegend() {
  const items: Array<{ type: RoomType; label: string }> = [
    { type: 'office', label: 'Pisarna' },
    { type: 'wc', label: 'WC' },
    { type: 'corridor', label: 'Hodnik' },
    { type: 'storage', label: 'Shramba' },
    { type: 'tech', label: 'Tehnika' },
  ];
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: '#aab4bf' }}>
      {items.map((item) => (
        <span key={item.type} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: FILL[item.type],
              border: `1px solid ${STROKE[item.type]}`,
              display: 'inline-block',
            }}
          />
          {item.label}
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 12, height: 12, borderRadius: 8, background: '#1fbf75', display: 'inline-block' }} />
        Vhod
      </span>
    </div>
  );
}

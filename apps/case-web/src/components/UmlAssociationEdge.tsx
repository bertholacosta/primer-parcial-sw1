import React, { useMemo } from 'react';
import { EdgeLabelRenderer, useStore, type EdgeProps, type Edge } from '@xyflow/react';

export type UmlAssociationFlowEdge = Edge;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Pt {
  x: number;
  y: number;
}

const MARGIN = 18;
const FALLBACK_W = 260;
const FALLBACK_H = 150;
const STROKE = '#475569';
const STROKE_SELECTED = '#0284c7';

const expand = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

const pointInRect = (p: Pt, r: Rect) =>
  p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

const segIntersectsSeg = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
  const cross = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

const segIntersectsRect = (a: Pt, b: Pt, r: Rect): boolean => {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const tl = { x: r.x, y: r.y };
  const tr = { x: r.x + r.w, y: r.y };
  const bl = { x: r.x, y: r.y + r.h };
  const br = { x: r.x + r.w, y: r.y + r.h };
  return (
    segIntersectsSeg(a, b, tl, tr) ||
    segIntersectsSeg(a, b, tr, br) ||
    segIntersectsSeg(a, b, br, bl) ||
    segIntersectsSeg(a, b, bl, tl)
  );
};

const pathLength = (pts: Pt[]) =>
  pts.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)), 0);

const countHits = (pts: Pt[], obstacles: Rect[]) => {
  let hits = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    for (const r of obstacles) if (segIntersectsRect(pts[i], pts[i + 1], r)) hits++;
  }
  return hits;
};

const dropCollinear = (pts: Pt[]): Pt[] =>
  pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const a = pts[i - 1];
    const b = pts[i + 1];
    return !(Math.abs(a.x - p.x) < 0.5 && Math.abs(p.x - b.x) < 0.5) &&
      !(Math.abs(a.y - p.y) < 0.5 && Math.abs(p.y - b.y) < 0.5);
  });

/**
 * Routing ortogonal con evitación de obstáculos: prueba las variantes
 * en Z (vertical u horizontal por el medio) y desvíos a los lados de cada
 * obstáculo, y elige la polilínea con menos cruces y menor longitud.
 */
function route(s: Pt, t: Pt, obstacles: Rect[]): Pt[] {
  const midX = (s.x + t.x) / 2;
  const midY = (s.y + t.y) / 2;
  const xs = new Set<number>([midX]);
  const ys = new Set<number>([midY]);
  for (const r of obstacles) {
    xs.add(r.x);
    xs.add(r.x + r.w);
    ys.add(r.y);
    ys.add(r.y + r.h);
  }

  const candidates: Pt[][] = [];
  for (const x of xs) candidates.push([s, { x, y: s.y }, { x, y: t.y }, t]);
  for (const y of ys) candidates.push([s, { x: s.x, y }, { x: t.x, y }, t]);
  candidates.push([s, t]);

  let best: Pt[] = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const hits = countHits(c, obstacles);
    const score = hits * 1e6 + pathLength(c);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return dropCollinear(best);
}

/** Punto a mitad de la longitud total de la polilínea (para la etiqueta). */
function midpointAlong(pts: Pt[]): Pt {
  const total = pathLength(pts) / 2;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (acc + len >= total) {
      const k = len === 0 ? 0 : (total - acc) / len;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    }
    acc += len;
  }
  return pts[Math.floor(pts.length / 2)];
}

/**
 * Arista de asociación UML: segmentos rectos que nunca atraviesan las
 * cajas de clase; rodea cualquier nodo interpuesto. Etiqueta centrada con
 * nombre y multiplicidades junto a cada extremo.
 */
export const UmlAssociationEdge: React.FC<EdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  selected,
  data,
}) => {
  const obstacles = useStore((state) => {
    const rects: Rect[] = [];
    state.nodeLookup.forEach((node) => {
      if (node.id === source || node.id === target) return;
      const pos = node.internals?.positionAbsolute ?? node.position;
      const w = node.measured?.width ?? FALLBACK_W;
      const h = node.measured?.height ?? FALLBACK_H;
      if (pos) rects.push(expand({ x: pos.x, y: pos.y, w, h }, MARGIN));
    });
    return rects;
  });

  const points = useMemo(
    () => route({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, obstacles),
    [sourceX, sourceY, targetX, targetY, obstacles]
  );

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const labelPos = midpointAlong(points);
  const label = [
    (data?.name as string | undefined),
    `[${data?.sourceMultiplicity} → ${data?.targetMultiplicity}]`,
  ]
    .filter(Boolean)
    .join('  ');

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={path}
        fill="none"
        stroke={selected ? STROKE_SELECTED : STROKE}
        strokeWidth={selected ? 2.2 : 1.5}
        markerEnd={markerEnd}
      />
      <path d={path} fill="none" stroke="transparent" strokeWidth={16} pointerEvents="stroke" />

      <EdgeLabelRenderer>
        <div
          data-testid={`edge-label-${id}`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelPos.x}px, ${labelPos.y}px)`,
            background: 'rgba(248,250,252,0.9)',
            borderRadius: 4,
            padding: '1px 5px',
            fontSize: 11,
            color: '#334155',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -130%) translate(${sourceX}px, ${sourceY}px)`,
            fontSize: 10,
            color: '#64748b',
            pointerEvents: 'none',
          }}
        >
          {data?.sourceMultiplicity as string}
        </div>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, 30%) translate(${targetX}px, ${targetY}px)`,
            fontSize: 10,
            color: '#64748b',
            pointerEvents: 'none',
          }}
        >
          {data?.targetMultiplicity as string}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

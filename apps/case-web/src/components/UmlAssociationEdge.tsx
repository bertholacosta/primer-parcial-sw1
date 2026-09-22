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

/** Punto donde el rayo centro→toward cruza el borde del rectángulo. */
function borderPoint(rect: Rect, toward: Pt): Pt {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: cx, y: cy };
  const tx = Math.abs(dx) > 1e-6 ? (rect.w / 2) / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(dy) > 1e-6 ? (rect.h / 2) / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Defs SVG con los marcadores UML por tipo de relación (ADR-0009). */
export const UmlEdgeMarkerDefs: React.FC = () => (
  <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true">
    <defs>
      {/* Generalización: triángulo hueco en el extremo padre */}
      <marker id="uml-gen" markerWidth="16" markerHeight="16" refX="15" refY="8" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M1,1 L15,8 L1,15 Z" fill="#ffffff" stroke={STROKE} strokeWidth="1.5" />
      </marker>
      {/* Dependencia: flecha abierta */}
      <marker id="uml-dep" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M1,1 L13,7 L1,13" fill="none" stroke={STROKE} strokeWidth="1.5" />
      </marker>
      {/* Agregación: rombo hueco en el extremo del todo */}
      <marker id="uml-agg" markerWidth="20" markerHeight="12" refX="1" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M10,0 L19,6 L10,12 L1,6 Z" fill="#ffffff" stroke={STROKE} strokeWidth="1.5" />
      </marker>
      {/* Composición: rombo relleno en el extremo del todo */}
      <marker id="uml-comp" markerWidth="20" markerHeight="12" refX="1" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M10,0 L19,6 L10,12 L1,6 Z" fill={STROKE} stroke={STROKE} strokeWidth="1.5" />
      </marker>
    </defs>
  </svg>
);

/**
 * Arista de asociación UML: segmentos rectos que nunca atraviesan las
 * cajas de clase y se anclan en el punto exacto del borde que mira hacia
 * el otro nodo (no en handles fijos). Rodea cualquier nodo interpuesto.
 * Los marcadores dependen de `data.kind` (ADR-0009).
 */
export const UmlAssociationEdge: React.FC<EdgeProps> = ({
  id,
  source,
  target,
  markerEnd,
  selected,
  data,
}) => {
  const PARALLEL_GAP = 26;
  const kind = (data?.kind as string | undefined) ?? 'association';
  const associationClassId = data?.associationClassId as string | undefined;

  const { obstacles, sourceRect, targetRect, assocClassRect, parallelIndex, parallelCount } = useStore((state) => {
    const rects: Rect[] = [];
    let sourceRect: Rect | undefined;
    let targetRect: Rect | undefined;
    let assocClassRect: Rect | undefined;
    state.nodeLookup.forEach((node) => {
      const pos = node.internals?.positionAbsolute ?? node.position;
      if (!pos) return;
      const rect: Rect = {
        x: pos.x,
        y: pos.y,
        w: node.measured?.width ?? FALLBACK_W,
        h: node.measured?.height ?? FALLBACK_H,
      };
      if (node.id === source) sourceRect = rect;
      else if (node.id === target) targetRect = rect;
      else {
        if (node.id === associationClassId) assocClassRect = rect;
        rects.push(expand(rect, MARGIN));
      }
    });

    // Aristas que unen el mismo par de nodos (en cualquier sentido)
    const siblings: string[] = [];
    state.edgeLookup.forEach((edge) => {
      const samePair =
        (edge.source === source && edge.target === target) ||
        (edge.source === target && edge.target === source);
      if (samePair) siblings.push(edge.id);
    });
    siblings.sort();
    return {
      obstacles: rects,
      sourceRect,
      targetRect,
      assocClassRect,
      parallelIndex: Math.max(0, siblings.indexOf(id)),
      parallelCount: siblings.length,
    };
  });

  const points = useMemo(() => {
    if (!sourceRect || !targetRect) return null;
    const s = borderPoint(sourceRect, {
      x: targetRect.x + targetRect.w / 2,
      y: targetRect.y + targetRect.h / 2,
    });
    const t = borderPoint(targetRect, {
      x: sourceRect.x + sourceRect.w / 2,
      y: sourceRect.y + sourceRect.h / 2,
    });

    // Separar aristas paralelas: desplazamiento perpendicular centrado.
    if (parallelCount > 1) {
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const offset = (parallelIndex - (parallelCount - 1) / 2) * PARALLEL_GAP;
      s.x += nx * offset;
      s.y += ny * offset;
      t.x += nx * offset;
      t.y += ny * offset;
    }

    return route(s, t, obstacles);
  }, [sourceRect, targetRect, obstacles, parallelIndex, parallelCount]);

  if (!points) return null;

  // Etiquetas de multiplicidad fuera de la caja: 14px en la dirección del
  // primer/último segmento para que nunca queden ocultas tras el nodo.
  const outward = (from: Pt, next: Pt, sign: 1 | -1): Pt => {
    const dx = next.x - from.x;
    const dy = next.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: from.x + (dx / len) * 24 * sign, y: from.y + (dy / len) * 24 * sign };
  };
  const srcLabelPos = outward(points[0], points[1], 1);
  const tgtLabelPos = outward(points[points.length - 1], points[points.length - 2], 1);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const labelPos = midpointAlong(points);
  const structural = kind !== 'generalization' && kind !== 'dependency';
  const mults = structural ? `[${data?.sourceMultiplicity} → ${data?.targetMultiplicity}]` : '';
  const label = [(data?.name as string | undefined), mults].filter(Boolean).join('  ');

  // Marcadores por tipo (ADR-0009): generalización/dependencia al final,
  // agregación/composición (rombo en el "todo" = source) al inicio.
  const edgeMarkerEnd =
    kind === 'generalization' ? 'url(#uml-gen)'
    : kind === 'dependency' ? 'url(#uml-dep)'
    : markerEnd;
  const edgeMarkerStart =
    kind === 'aggregation' ? 'url(#uml-agg)'
    : kind === 'composition' ? 'url(#uml-comp)'
    : undefined;
  const dashed = kind === 'dependency';

  // Clase-asociación: línea punteada desde el punto medio hasta la clase enlazada.
  const assocLinkPath =
    kind === 'associationClass' && assocClassRect
      ? `M ${labelPos.x} ${labelPos.y} L ${borderPoint(assocClassRect, labelPos).x} ${borderPoint(assocClassRect, labelPos).y}`
      : undefined;

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={path}
        fill="none"
        stroke={selected ? STROKE_SELECTED : STROKE}
        strokeWidth={selected ? 2.2 : 1.5}
        strokeDasharray={dashed ? '7 4' : undefined}
        markerEnd={edgeMarkerEnd}
        markerStart={edgeMarkerStart}
      />
      {assocLinkPath && (
        <path d={assocLinkPath} fill="none" stroke={STROKE} strokeWidth={1.2} strokeDasharray="5 4" pointerEvents="none" />
      )}
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
        {structural && (
          <>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${srcLabelPos.x}px, ${srcLabelPos.y - 8}px)`,
                fontSize: 10,
                color: '#475569',
                background: 'rgba(255,255,255,0.92)',
                border: '1px solid #e2e8f0',
                borderRadius: 3,
                padding: '0 3px',
                zIndex: 10,
                pointerEvents: 'none',
              }}
            >
              {data?.sourceMultiplicity as string}
            </div>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${tgtLabelPos.x}px, ${tgtLabelPos.y - 8}px)`,
                fontSize: 10,
                color: '#475569',
                background: 'rgba(255,255,255,0.92)',
                border: '1px solid #e2e8f0',
                borderRadius: 3,
                padding: '0 3px',
                zIndex: 10,
                pointerEvents: 'none',
              }}
            >
              {data?.targetMultiplicity as string}
            </div>
          </>
        )}
      </EdgeLabelRenderer>
    </>
  );
};

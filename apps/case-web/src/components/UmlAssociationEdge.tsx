import React, { useCallback } from 'react';
import { EdgeLabelRenderer, useReactFlow, type EdgeProps } from '@xyflow/react';
import type { UmlAssociationFlowEdge } from '../adapter/domainModelAdapter';

const STROKE = '#475569';
const STROKE_SELECTED = '#0284c7';

const mid = (a: number, b: number) => (a + b) / 2;

/**
 * Arista de asociación UML estilo Apollon: segmentos rectos con waypoints
 * arrastrables. Arrastrar el punto medio de un segmento crea un quiebre;
 * doble clic sobre un waypoint lo elimina. El nombre va al centro y las
 * multiplicidades junto a cada extremo, como en un diagrama UML real.
 */
export const UmlAssociationEdge: React.FC<EdgeProps<UmlAssociationFlowEdge>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  selected,
  data,
}) => {
  const { screenToFlowPosition } = useReactFlow();

  const waypoints = data?.waypoints ?? [];
  const editable = Boolean(data?.editable);
  const points = [
    { x: sourceX, y: sourceY },
    ...waypoints,
    { x: targetX, y: targetY },
  ];
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const center = points[Math.floor(points.length / 2)];
  const label = [
    data?.name,
    `[${data?.sourceMultiplicity} → ${data?.targetMultiplicity}]`,
  ]
    .filter(Boolean)
    .join('  ');

  const updateWaypoint = useCallback(
    (index: number, pos: { x: number; y: number }) => {
      data?.onWaypointsChange?.(
        id,
        waypoints.map((w, i) => (i === index ? pos : w))
      );
    },
    [data, id, waypoints]
  );

  const insertWaypoint = useCallback(
    (segmentIndex: number) => (e: React.PointerEvent) => {
      const onChange = data?.onWaypointsChange;
      if (!editable || !onChange) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const next = [...waypoints];
      next.splice(segmentIndex, 0, pos);
      onChange(id, next);

      const move = (ev: PointerEvent) => {
        onChange(
          id,
          next.map((w, i) =>
            i === segmentIndex ? screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) : w
          )
        );
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [editable, data, id, waypoints, screenToFlowPosition]
  );

  const dragWaypoint = useCallback(
    (index: number) => (e: React.PointerEvent) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      const move = (ev: PointerEvent) => {
        updateWaypoint(index, screenToFlowPosition({ x: ev.clientX, y: ev.clientY }));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [editable, updateWaypoint, screenToFlowPosition]
  );

  const removeWaypoint = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      if (!editable || !data?.onWaypointsChange) return;
      e.preventDefault();
      e.stopPropagation();
      data.onWaypointsChange(id, waypoints.filter((_, i) => i !== index));
    },
    [editable, data, id, waypoints]
  );

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
      {/* Zona de hit ampliada para seleccionar la arista */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={16} pointerEvents="stroke" />

      <EdgeLabelRenderer>
        {/* Nombre + multiplicidades al centro de la arista */}
        <div
          data-testid={`edge-label-${id}`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${center.x}px, ${center.y}px)`,
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

        {/* Multiplicidades junto a cada extremo, como en Apollon */}
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -130%) translate(${sourceX}px, ${sourceY}px)`,
            fontSize: 10,
            color: '#64748b',
            pointerEvents: 'none',
          }}
        >
          {data?.sourceMultiplicity}
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
          {data?.targetMultiplicity}
        </div>

        {/* Waypoints existentes: arrastrar para mover, doble clic para quitar */}
        {waypoints.map((w, i) => (
          <div
            key={i}
            data-testid={`edge-waypoint-${id}-${i}`}
            title={editable ? 'Arrastra para mover · doble clic para eliminar' : undefined}
            onPointerDown={dragWaypoint(i)}
            onDoubleClick={removeWaypoint(i)}
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${w.x}px, ${w.y}px)`,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: selected || editable ? '#0284c7' : '#94a3b8',
              border: '2px solid #ffffff',
              cursor: editable ? 'grab' : 'default',
              pointerEvents: 'all',
              zIndex: 5,
            }}
          />
        ))}

        {/* Puntos medios de cada segmento: arrastrar crea un quiebre nuevo */}
        {editable &&
          points.slice(0, -1).map((p, i) => {
            const q = points[i + 1];
            return (
              <div
                key={`seg-${i}`}
                data-testid={`edge-bend-handle-${id}-${i}`}
                title="Arrastra para doblar la línea"
                onPointerDown={insertWaypoint(i)}
                className="nodrag nopan"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${mid(p.x, q.x)}px, ${mid(p.y, q.y)}px)`,
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: 'rgba(2,132,199,0.25)',
                  border: '1.5px solid rgba(2,132,199,0.6)',
                  cursor: 'grab',
                  pointerEvents: 'all',
                  zIndex: 4,
                }}
              />
            );
          })}
      </EdgeLabelRenderer>
    </>
  );
};

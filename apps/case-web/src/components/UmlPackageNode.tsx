import React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { UmlPackageFlowNode } from '../adapter/domainModelAdapter';

const TAB_WIDTH = 90;
const TAB_HEIGHT = 22;
const BODY_HEIGHT = 60;

/** Paquete UML: cuerpo rectangular con pestaña superior izquierda (estilo folder). */
export const UmlPackageNode: React.FC<NodeProps<UmlPackageFlowNode>> = ({ data }) => {
  return (
    <div
      role="figure"
      aria-label={`Paquete UML ${data.name}`}
      data-testid={`uml-package-node-${data.name}`}
      style={{ width: 200, height: TAB_HEIGHT + BODY_HEIGHT, fontFamily: 'system-ui, sans-serif' }}
    >
      <svg width="200" height={TAB_HEIGHT + BODY_HEIGHT} style={{ display: 'block' }}>
        <polygon
          points={`0,${TAB_HEIGHT} 0,0 ${TAB_WIDTH},0 ${TAB_WIDTH + 12},${TAB_HEIGHT}`}
          fill="#f1f5f9"
          stroke="#1e293b"
          strokeWidth="1.5"
        />
        <rect
          x="0"
          y={TAB_HEIGHT}
          width="200"
          height={BODY_HEIGHT}
          fill="#ffffff"
          stroke="#1e293b"
          strokeWidth="1.5"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: 8,
          fontSize: '11px',
          fontWeight: 600,
          color: '#0f172a',
          maxWidth: TAB_WIDTH - 8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {data.name}
      </div>
    </div>
  );
};

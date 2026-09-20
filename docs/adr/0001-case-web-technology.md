# ADR-0001: tecnología del editor CASE web

- **Estado:** `accepted`
- **Decisor:** Product Owner
- **Fecha de decisión:** 2026-09-20
- **Tarea de origen:** P4-002
- **Depende de:** `docs/contracts/model-commands-v1.md`, `docs/ARCHITECTURE.md`

---

## Pregunta

¿Qué stack y biblioteca de edición gráfica satisfacen el modelado UML (corte mínimo: clases, atributos y asociaciones), rendimiento, accesibilidad, pruebas y mantenimiento del proyecto?

---

## Contexto

El módulo `apps/case-web` es el editor visual que emite comandos definidos en `docs/contracts/model-commands-v1.md` (v1.0.0). Restricciones relevantes del contrato y la arquitectura:

- **Invariante 1:** toda representación visual se convierte al modelo canónico antes de generar código.
- **Invariante 2:** una entrada inválida no produce código parcial aceptable; los errores nunca mutan el modelo.
- **Invariante 7:** las propuestas de IA no mutan estado hasta superar validación determinista.
- El contrato usa **optimistic locking** (`modelVersion`) para control de concurrencia; el editor debe propagar la versión actual en cada comando emitido.
- El corte mínimo de la Fase 4 cubre `CreateClass`, `RenameClass`, `DeleteClass`, `AddAttribute`, `UpdateAttribute`, `DeleteAttribute`, `CreateAssociation`, `UpdateAssociation`, `DeleteAssociation`, `CreatePackage` y `DeletePackage`.
- El repositorio es un monorepo en Windows 11 / PowerShell 7; el tooling de CI ejecuta validaciones con `pwsh`.

---

## Alternativas evaluadas

### Alternativa A — React 19 + @xyflow/react (React Flow v12) + Vite + TypeScript + Vitest

**Renderer:** SVG puro (manipulado vía React DOM).
**Licencia:** MIT para `@xyflow/react` y toda la cadena de herramientas.
**npm:** `@xyflow/react` ≥ 12.x, `react` ^19, `vite` ^6, `vitest` ^3.

| Dimensión | Detalle |
|---|---|
| **Pruebas** | Vitest + `@testing-library/react` prueban hooks y componentes con jsdom o happy-dom. Los nodos (clases UML) son componentes React puros: se montan, se interactúa y se comprueba la emisión de comandos sin levantar servidor. |
| **Rendimiento** | SVG nativo; suficiente para diagramas de 50–200 nodos (corte mínimo de la fase). Para diagramas muy grandes (>1 000 nodos), el re-render de React puede ser cuello de botella; `React.memo` + Zustand mitigan el caso. |
| **Accesibilidad** | `nodesFocusable` y `edgesFocusable` activos: navegación por teclado (Tab/Enter/Escape/flechas) integrada. ARIA parcial (`role="button"`, `aria-label` en nodos). La accesibilidad completa del canvas exige añadir tabla semántica alternativa o `aria-describedby` para lectores de pantalla. |
| **Mantenimiento** | Ecosistema React/xyflow activo; v12 publicada en 2025; repositorio xyflow con >25 k estrellas; documentación oficial extensa. Alineado con el resto del monorepo si otros paquetes ya usan React. |
| **Riesgos** | Rendimiento SVG en diagramas muy grandes. Auto-routing de aristas requiere integración manual (dagre/ELK). |

---

### Alternativa B — React 19 + @joint/core + @joint/react (JointJS 4.3+) + Vite + TypeScript + Vitest

**Renderer:** SVG con viewport matching y re-render parcial gestionado por JointJS.
**Licencia:** `@joint/core` y `@joint/react` MPL-2.0 (open-source). Las funciones avanzadas de JointJS+ son comerciales (perpetual license de pago). El corte mínimo v1 no requiere JointJS+.
**npm:** `@joint/core` ≥ 4.3, `@joint/react` ≥ 4.3, `react` ^19, `vite` ^6, `vitest` ^3.

| Dimensión | Detalle |
|---|---|
| **Pruebas** | Vitest + `@testing-library/react` con jsdom; compatible pero la integración de JointJS con JSDOM requiere un mock de `SVGElement` que no es nativo de jsdom. Testing de la capa de datos (comandos) es independiente del renderer. |
| **Rendimiento** | Viewport matching nativo: solo re-renderiza elementos visibles; probado con >100 000 nodos en benchmarks publicados por JointJS. Robusto para diagramas enterprise de alta densidad. |
| **Accesibilidad** | Soporte ARIA básico; la navegación por teclado no está implementada de forma nativa en la misma medida que React Flow. Requiere más trabajo manual para cumplir WCAG 2.1 AA. |
| **Mantenimiento** | Biblioteca madura (>10 años), empresa detrás (client.io). `@joint/react` es nueva (4.3, mayo 2025); documentación aún incompleta. Riesgo de cambios de API en versiones tempranas. Licencia MPL-2.0 require que modificaciones al core se liberen; relevante si se parchea la biblioteca. |
| **Riesgos** | API `@joint/react` inmadura. Riesgo de licencia si se modifican fuentes de JointJS. Mock de SVGElement en Vitest/jsdom. |

---

## Matriz de decisión

| Criterio | Peso | A — React Flow | B — JointJS | Notas |
|---|---|---|---|---|
| Pruebas (integración con Vitest) | Alta | ✅ Sin fricción | ⚠️ Mock SVGElement | jsdom no tiene SVGElement nativo |
| Rendimiento (corte mínimo ≤200 nodos) | Media | ✅ Suficiente | ✅ Superior | JointJS supera solo en diagramas >500 nodos |
| Accesibilidad (WCAG 2.1 AA parcial) | Alta | ✅ keyboard+ARIA built-in | ⚠️ Manual | `nodesFocusable`, `edgesFocusable` en RF |
| Mantenimiento y madurez de API | Alta | ✅ Estable v12 | ⚠️ @joint/react v4.3 nueva | @joint/react pública desde may-2025 |
| Licencia sin fricción en monorepo | Alta | ✅ MIT | ⚠️ MPL-2.0 | MPL-2.0 requiere liberar cambios al core |
| Auto-routing de aristas | Baja | ⚠️ Plugin externo | ✅ Built-in | No requerido en corte mínimo v1 |
| Compatibilidad con contrato de comandos | Alta | ✅ Directo | ✅ Directo | Ambos son agnósticos del contrato |

**Recomendación:** Alternativa A — React + React Flow v12.

La Alternativa A satisface los criterios de mayor peso para el corte mínimo (Fase 4): pruebas sin mocks especiales, accesibilidad de teclado integrada, licencia MIT y API estable. La Alternativa B ofrece mejor rendimiento en alta densidad de nodos, pero ese escenario no aplica en el alcance actual y la inmadurez de `@joint/react` introduce riesgos innecesarios.

---

## Estrategia de integración con el contrato de comandos

El editor opera como un **emisor de comandos** sin lógica de dominio propia:

1. El estado visual (posición de nodos, zoom) vive en el store de React Flow.
2. Cada interacción del usuario (crear nodo, renombrar, conectar) genera un comando tipado (`CreateClass`, `AddAttribute`, etc.) con `commandId` UUID v4 y `modelVersion` del modelo en memoria.
3. El comando se envía al procesador (local o remoto); el resultado (`accepted`/`rejected`/`noop`) se refleja en la UI.
4. Si el procesador retorna `CONCURRENT_MODIFICATION`, el editor descarta el estado optimista y recarga la versión actual del modelo.
5. Los nodos del diagrama mapean 1:1 a clases del modelo; las aristas mapean a asociaciones. Nunca se construyen nodos sin `classId` confirmado por el procesador.

Esta arquitectura preserva la invariante 1 y la invariante 2 de `docs/ARCHITECTURE.md`.

---

## Prueba técnica acotada

La prueba verifica la cadena completa: interacción de usuario → emisión de comando → procesamiento → reflejo en diagrama. Se ejecuta localmente como smoke test antes de aprobar el ADR.

### Comandos exactos

```pwsh
# Desde la raíz del repositorio

# 1. Instalar dependencias del workspace de la app
npm install --prefix apps/case-web

# 2. Ejecutar prueba unitaria acotada (modo non-watch)
npx vitest run --project apps/case-web --reporter=verbose

# 3. Comprobar que no hay errores de tipos TypeScript
npx tsc --noEmit --project apps/case-web/tsconfig.json
```

### Escenario de prueba mínimo (a implementar en `apps/case-web`)

```typescript
// apps/case-web/src/__tests__/command-bridge.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildCreateClassCommand } from '../commands/createClass';
import { v4 as uuidv4 } from 'uuid';

describe('CreateClass command bridge', () => {
  it('genera un comando con commandId UUID v4 y modelVersion correctos', () => {
    const modelId = 'model-01';
    const modelVersion = '1.0.0';
    const cmd = buildCreateClassCommand({
      modelId,
      modelVersion,
      id: 'cls-test',
      name: 'Producto',
      packageId: 'pkg-01',
    });

    expect(cmd.type).toBe('CreateClass');
    expect(cmd.modelId).toBe(modelId);
    expect(cmd.modelVersion).toBe(modelVersion);
    expect(cmd.payload.name).toBe('Producto');
    // UUID v4: 8-4-4-4-12 hex
    expect(cmd.commandId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('rechaza nombres que no cumplan [A-Za-z_][A-Za-z0-9_]*', () => {
    expect(() =>
      buildCreateClassCommand({
        modelId: 'model-01',
        modelVersion: '1.0.0',
        id: 'cls-bad',
        name: '123Malo',
      })
    ).toThrow('INVALID_NAME_FORMAT');
  });
});
```

> **Nota:** la implementación de `buildCreateClassCommand` y el scaffold de `apps/case-web` son tarea de la fase de implementación posterior a la aprobación de este ADR. Este ADR no modifica nada fuera de `docs/adr/`.

---

## Consecuencias

### Si se acepta (Alternativa A)

- `apps/case-web` se scaffoldea con Vite + React 19 + TypeScript + `@xyflow/react` ^12 + Vitest ^3.
- Los nodos del canvas se implementan como componentes React con `role="figure"` y `aria-label` con el nombre de la clase.
- La tabla semántica alternativa (lista de clases y atributos) se incluye para cumplir WCAG 2.1 AA de forma verificable.
- La capa de comandos es un módulo puro (`packages/` o `apps/case-web/src/commands/`) sin dependencia del renderer, testeable de forma independiente.
- La integración de `dagre` o `ELK` para auto-layout es opcional y se decide en la tarea de implementación.

### Si se rechaza

- Se debe especificar la alternativa preferida antes de iniciar la implementación de `apps/case-web`.

---

## Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Rendimiento SVG con >500 nodos | Baja (corte mínimo) | Medio | Virtualización con `react-window` o migrar a JointJS si el scope crece |
| WCAG AA incompleta en canvas interactivo | Media | Medio | Tabla semántica alternativa + audit con axe-core en CI |
| Cambios de API en @xyflow/react | Baja | Bajo | Versión fijada exacta en `package.json`; changelog revisado antes de actualizar |
| Concurrencia no gestionada (CONCURRENT_MODIFICATION) | Media | Alto | Reload del modelo en error + indicador visual; no bloquear UI |

---

## Decisiones cerradas en este ADR

| # | Decisión |
|---|---|
| D1 | El renderer es SVG (no Canvas). SVG permite inspección DOM, testing con jsdom y ARIA nativos. |
| D2 | El estado del modelo canónico vive fuera del store de React Flow; el canvas es una vista derivada. |
| D3 | Cada comando lleva un `commandId` UUID v4 generado en el cliente para idempotencia (contrato §2.1). |
| D4 | El editor no valida reglas de dominio; delega toda validación al procesador de comandos. |

---

## Resolución de preguntas y decisión del Product Owner

- **Decisión sobre Q1 (Stack y renderer):** El Product Owner aprueba la **Alternativa A** (React 19 + @xyflow/react v12 + Vite + TypeScript + Vitest).
- **Q2–Q4:** Se resolverán durante la implementación de `apps/case-web` y del backend de comandos conforme a los contratos y necesidades del monorepo.

---

## Referencias

- [docs/contracts/model-commands-v1.md](../contracts/model-commands-v1.md)
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md)
- [React Flow v12 — xyflow/xyflow](https://github.com/xyflow/xyflow) — MIT
- [React Flow accessibility docs](https://www.reactflow.dev/learn/advanced-use/accessibility)
- [JointJS for React — @joint/react 4.3](https://www.jointjs.com/blog/introducing-jointjs-for-react)
- [Vitest monorepo setup](https://vitest.dev/guide/workspace)
- [React Flow vs JointJS comparison — Neoteric (2026)](https://neoteric.eu/blog/jointjs-vs-react-flow-comparison/)
- [React Flow vs JointJS — Synergy Codes (2025)](https://www.synergycodes.com/blog/react-flow-vs-jointjs-react-wrapper)

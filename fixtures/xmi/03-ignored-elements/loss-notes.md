# Notas de pérdida — 03-ignored-elements

## Pérdidas toleradas (§4 del perfil xmi-profile-v1.md)

| Elemento descartado | Ubicación en el XMI | Sección del perfil | Recuperable |
|---|---|---|---|
| `<xmi:Documentation>` | Raíz | §4 — metadatos del exportador | No |
| `visibility="public"` en paquete y clases | PKG_03, CLS_20, CLS_21 | §4 — `visibility` no modelado en v1 | No |
| `isLeaf="false"` en CLS_20 | CLS_20 | §4 — `isLeaf` no modelado en v1 | No |
| `<ownedOperation>` (validar) en CLS_20 | CLS_20 | §4 — operaciones fuera del corte mínimo v1 | No (v1) |
| `<generalization>` hacia CLS_20 en CLS_21 | CLS_21 | §4 — herencia fuera del corte mínimo v1 | No (v1) |
| `<appliedStereotype>` en CLS_21 | CLS_21 | §4 — estereotipos no modelados en v1 | No |
| `<ownedComment>` con HTML en CLS_21 | CLS_21 | §4 — HTML descartado con WARNING `OWNEDCOMMENT_HTML_DISCARDED` | No |
| `<defaultValue>` en ATTR_23 | CLS_21 / ATTR_23 | §4 — valores por defecto sin equivalente canónico v1 | No |
| `<xmi:Extension extender="Enterprise Architect">` (diagramas, estilos) | Raíz del modelo | §4 — extensiones propietarias EA | No |

## Advertencias esperadas en la conversión

| Código | Elemento | Mensaje esperado |
|---|---|---|
| `OWNEDCOMMENT_HTML_DISCARDED` | CLS_21 | "Comentario HTML descartado en clase 'Articulo'." |
| `ELEMENT_IGNORED` (verbose) | CLS_20/ownedOperation | "Elemento ignorado: `<ownedOperation>` en clase 'EntidadBase'." |
| `ELEMENT_IGNORED` (verbose) | CLS_21/generalization | "Elemento ignorado: `<generalization>` en clase 'Articulo'." |
| `ELEMENT_IGNORED` (verbose) | xmi:Extension | "Elemento ignorado: `<xmi:Extension extender='Enterprise Architect'>`." |

## Notas adicionales

- `description` de CLS_20 se mapea desde el `<ownedComment>` de texto plano (sin HTML): valor
  "Clase base abstracta para todas las entidades del inventario." — esta es la única situación
  donde `<ownedComment>` produce contenido canónico.
- CLS_21 no tiene `description` porque su único `<ownedComment>` contenía HTML y fue descartado.
- La herencia (CLS_21 → CLS_20) no se refleja en el modelo canónico; los atributos heredados
  no se copian automáticamente. Si el consumidor los necesita, debe resolver la jerarquía
  manualmente con los datos que tenga del modelo fuente.

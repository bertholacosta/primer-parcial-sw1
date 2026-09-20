# Notas de pérdida — 02-associations

## Elementos procesados

| Elemento XMI | Resultado canónico |
|---|---|
| `<xmi:Documentation>` | Ignorado (§4: metadatos del exportador) |
| `uml:Association ASSOC_01` sin `isNavigable` explícito | `navigability="bidirectional"` (§3.5: ambos extremos navegables por defecto) |
| `uml:Association ASSOC_02` con `isNavigable="false"` en END_02_TGT | `navigability="unidirectional"` (§3.5) |

## Pérdidas toleradas en este fixture

| Elemento descartado | Sección del perfil | Recuperable |
|---|---|---|
| `<xmi:Documentation>` | §4 — metadatos EA | No |

No hay otras pérdidas. Todos los atributos y asociaciones de este fixture
corresponden a elementos del §3 (soportados).

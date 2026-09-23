# Notas de pérdida — 01-minimal-import

Este fixture no contiene elementos ignorados. La conversión es sin pérdida
para todos los elementos presentes.

## Elementos procesados

| Elemento XMI | Resultado |
|---|---|
| `<xmi:Documentation>` | Ignorado (§4 del perfil: metadatos de exportador) |
| `uml:Package PKG_01` | Aplanado (v1.2: paquete raíz único) — diagnóstico `PACKAGE_FLATTENED`; su contenido se importa en el ámbito raíz |
| `uml:Class CLS_01` con `isAbstract="false"` | → `class.id="CLS_01"`, `name="Libro"` (en el ámbito raíz), `isAbstract=false` |
| `ownedAttribute ATTR_01` (String, 1..1) | → `attribute` `nullable=false`, `multiplicity="1"` |
| `ownedAttribute ATTR_03` (Date, 0..1) | → `attribute` `nullable=true`, `multiplicity="0..1"` |

## Pérdidas toleradas en este fixture

Ninguna. `<xmi:Documentation>` es el único elemento ignorado; está autorizado
por §4 ("Metadatos de EA sin equivalente canónico").

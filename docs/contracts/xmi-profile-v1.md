# Contrato de perfil XMI — Enterprise Architect v1

- **Versión del contrato:** 1.0.0
- **Estado:** accepted
- **Fecha:** 2026-09-20
- **Autoridad:** Product Owner (ADR-0000)
- **Contrato base:** `docs/contracts/domain-model-v1.md` (contractVersion `"1"`)

---

## 1. Propósito y alcance

Este contrato define el subconjunto XMI/UML exportado por Enterprise Architect (EA) que el adaptador `packages/xmi-adapter` acepta para importación, y el subconjunto que genera para exportación. Establece el mapeo bidireccional entre elementos XMI de EA y el modelo canónico (`domain-model-v1`), las reglas de pérdida de información tolerada, y los errores que deben abortar la conversión.

Ningún elemento externo a este contrato puede extender el mapeo sin un ADR aceptado. El modelo canónico es siempre la fuente de verdad: cuando EA y el modelo canónico difieren en semántica, el modelo canónico prevalece.

---

## 2. Exportador y versión objetivo de Enterprise Architect

| Parámetro | Valor |
|---|---|
| Aplicación | Enterprise Architect (Sparx Systems) |
| Versiones soportadas | 15.x, 16.x |
| Formato de exportación | XMI 2.1 con extensiones `<xmi:Extension extender="Enterprise Architect">` |
| Dialecto UML base | UML 2.5.1 |
| Encoding del archivo | UTF-8 (con o sin BOM; el adaptador elimina el BOM) |
| Extensión de archivo | `.xmi` o `.xml` |
| Versiones **no** soportadas | EA < 15.0; exportaciones en formato XMI 1.1 o UML 1.x |

El adaptador detecta la versión del exportador leyendo el atributo `xmi:exporter` del elemento `<xmi:XMI>`. Si el valor indica EA < 15.0 o un exportador distinto, emite `UNSUPPORTED_EXPORTER` (véase §7).

---

## 3. Elementos XMI soportados

Los siguientes elementos y atributos XMI son procesados activamente en la conversión. El adaptador los mapea al modelo canónico (import) o los genera a partir de él (export).

### 3.1 Elemento raíz y metadatos

| Elemento/Atributo XMI | Descripción | Mapeo canónico |
|---|---|---|
| `<xmi:XMI xmi:version="2.1">` | Elemento raíz del documento | — (estructural) |
| `<uml:Model xmi:id="…" name="…">` | Nombre del modelo | → `model.name` |
| `<xmi:Documentation exporter="…" exporterVersion="…">` | Metadatos del exportador | → ignorado (§4) |

### 3.2 Paquetes (`packagedElement` de tipo `uml:Package`)

| Atributo XMI | Obligatorio | Mapeo canónico |
|---|---|---|
| `xmi:id` | sí | → `package.id` |
| `name` | sí | → `package.name` |
| Anidamiento de `packagedElement` dentro de otro `packagedElement` | — | → `package.parentId` (el id del elemento padre) |
| `visibility` | no | ignorado (§4) |

**Paquete raíz EA (`EAPK_ROOT`):** EA requiere que todo el contenido viva dentro de un `uml:Package`; el exportador envuelve el modelo completo en un `packagedElement` con `xmi:id="EAPK_ROOT"` y el mismo nombre del modelo. En importación, si el único `packagedElement` de nivel raíz es ese paquete (id `EAPK_ROOT` y nombre igual al del `uml:Model`), se **pliega**: sus hijos se procesan como elementos de nivel raíz y no se materializa como paquete canónico. Paquetes raíz con otro id o nombre se importan normalmente.

### 3.3 Clases (`packagedElement` de tipo `uml:Class`)

| Atributo XMI | Obligatorio | Mapeo canónico |
|---|---|---|
| `xmi:id` | sí | → `class.id` |
| `name` | sí | → `class.name` |
| Clase contenida en un `packagedElement uml:Package` | — | → `class.packageId` (el id del paquete contenedor) |

### 3.4 Atributos de clase (`ownedAttribute` de tipo `uml:Property`)

Un `ownedAttribute` que no sea el extremo de una asociación (sin `association` ni `type` apuntando a otra clase del modelo) se trata como atributo escalar.

| Atributo XMI | Obligatorio | Mapeo canónico |
|---|---|---|
| `xmi:id` | sí | → `attribute.id` |
| `name` | sí | → `attribute.name` |
| `type` (atributo, o hijo `<type>` con `xmi:idref`/`href`/`name`) | sí | → `attribute.type` (ver §5, tabla de tipos) |
| `<lowerValue xmi:type="uml:LiteralInteger" value="…">` | no | → determina `nullable` y parte inferior de `multiplicity` |
| `<upperValue xmi:type="uml:LiteralUnlimitedNatural" value="…">` | no | → parte superior de `multiplicity` |

**Derivación de `multiplicity` y `nullable`:**

| `lowerValue.value` | `upperValue.value` | Canónico `multiplicity` | Canónico `nullable` |
|---|---|---|---|
| `1` (o ausente) | `1` (o ausente) | `"1"` | `false` |
| `0` | `1` | `"0..1"` | `true` |
| `1` | `*` | `"1..*"` | `false` |
| `0` | `*` | `"0..*"` | `true` |
| otro | cualquiera | → `UNSUPPORTED_MULTIPLICITY` (§7) | — |

### 3.5 Asociaciones (`packagedElement` de tipo `uml:Association`)

| Atributo/Elemento XMI | Obligatorio | Mapeo canónico |
|---|---|---|
| `xmi:id` | sí | → `association.id` |
| `name` | no | → `association.name` |
| `ownedEnd[0]` o `memberEnd[0]` con `type` (atributo o hijo `<type xmi:idref>`) | sí | → `association.sourceClassId` |
| `ownedEnd[1]` o `memberEnd[1]` con `type` (atributo o hijo `<type xmi:idref>`) | sí | → `association.targetClassId` |
| `<lowerValue>` / `<upperValue>` en cada extremo | sí | → `sourceMultiplicity` / `targetMultiplicity` (misma tabla que §3.4) |
| Ambos extremos sin restricción de navegabilidad (`isNavigable` ausente o `true`) | — | → `navigability: "bidirectional"` |
| Un extremo con `isNavigable="false"` | — | → `navigability: "unidirectional"` (origen → destino) |

**Restricción:** self-associations (`sourceClassId == targetClassId`) generan `SELF_ASSOCIATION_NOT_SUPPORTED` (§7).

**Exportación de `kind` de asociación (extensión compatible, ADR-0009):**

El modelo canónico distingue `kind` de asociación. En exportación se mapea a los elementos UML correspondientes; en importación el `kind` no se recupera (las asociaciones vuelven como `association`, y `uml:Dependency`/`uml:AssociationClass`/`<generalization>` se ignoran según §4 — pérdida documentada en §8).

| `kind` canónico | Elemento XMI emitido |
|---|---|
| `association` (o ausente) | `packagedElement uml:Association` |
| `aggregation` | `uml:Association` con `aggregation="shared"` en el extremo del todo (origen) |
| `composition` | `uml:Association` con `aggregation="composite"` en el extremo del todo (origen) |
| `generalization` | `<generalization xmi:type="uml:Generalization" general="{targetClassId}">` dentro de la clase específica (origen) |
| `dependency` | `packagedElement uml:Dependency` con `client="{sourceClassId}"` y `supplier="{targetClassId}"` |
| `associationClass` | `packagedElement uml:AssociationClass` que fusiona la clase portadora (sus `ownedAttribute`) con los extremos de la asociación; en la extensión EA el mismo `xmi:id` aparece como `<element>` (con el nombre de la portadora) y como `<connector>` con `associationclass` apuntando a ese elemento |

En exportación, `navigability: "unidirectional"` se emite con `isNavigable="false"` en el extremo origen (navegable origen → destino). El exportador declara `xmi:exporter="Enterprise Architect"` y `xmi:exporterVersion` configurable, por defecto `15.0.1514.12`.

**Representación de referencias en exportación (formato EA):** los `ownedEnd` llevan `association="{associationId}"` y el clasificador como hijo `<type xmi:idref="{classId}"/>` (no el atributo `type="..."` — EA no lo resuelve y descarta el conector). Los `ownedAttribute` llevan `visibility="private"` y el tipo como hijo `<type xmi:idref="EAnone_{tipo}"/>`, donde `EAnone_` es el prefijo de primitivos internos de EA; en importación el prefijo se elimina antes de mapear (§5).

**Extensión EA en exportación (extensión compatible):**

Para que EA muestre los elementos en un diagrama (no solo en el navegador de proyecto), el exportador emite `<xmi:Extension extender="Enterprise Architect" extenderID="6.5">` como hermano de `uml:Model`, con:

- `<elements>`: una entrada por paquete y clase con `<model>`, `<properties>`, `<project>`, `<style>` y `<links>` (los conectores que tocan cada clase).
- `<connectors>`: una entrada por asociación con `<source>`/`<target>` (`<type multiplicity aggregation>`, `isNavigable`), `<properties ea_type direction>`, `<labels lb mt rb>` y `<extendedProperties virtualInheritance="0" [associationclass]>`. `ea_type` es `Association`, `Generalization` o `Dependency` según `kind`; `direction` es `Bi-Directional` o `Source -> Destination`.
- `<diagrams>`: un `<diagram>` `type="Logical"` (diagrama de clases) que contiene todas las clases en una grilla determinista (`geometry="Left..;Top..;Right..;Bottom..;"`, `subject`, `DUID` de 8 hex) y todos los conectores (`SX/SY/EX/EY/EDGE`, `SOID`/`EOID` apuntando a los DUID de los extremos).

Además, dentro de `uml:Model` se emite un `<umldi:Diagram xmi:type="umldi:UMLClassDiagram">` (UML Diagram Interchange, namespaces `umldi`/`dc` declarados en la raíz): un `UMLClassifierShape` por clase con `dc:bounds` (misma grilla determinista) y un `UMLEdge` por asociación con `UMLMultiplicityLabel`/`UMLNameLabel`/`dc:waypoint`. **EA crea el diagrama a partir de este bloque UMLDI**; el `<diagram>` de la extensión aporta solo metadatos propietarios (DUID, estilos).

Puede desactivarse con `includeDiagram: false`. En importación este bloque se descarta completo (§4).

---

## 4. Elementos XMI ignorados (pérdida de información tolerada)

Los siguientes elementos y atributos son leídos y descartados sin emitir error. La pérdida es conocida y aceptada en el corte mínimo v1. El adaptador puede emitir una advertencia `INFO_ELEMENT_IGNORED` no bloqueante para cada elemento descartado cuando el modo de verbosidad sea `verbose`.

| Elemento / Atributo XMI | Razón del descarte |
|---|---|
| `<xmi:Documentation>` (exportador, fecha, autor) | Metadatos de EA sin equivalente canónico |
| `visibility` en paquetes, clases y atributos | No modelado en domain-model v1 |
| `isLeaf`, `isActive`, `isSingleExecution` en clases | No modelado en v1 |
| `<ownedComment>` (notas UML) | Se mapea a `description` solo si el adaptador encuentra texto plano; si contiene HTML de EA, se descarta |
| `<defaultValue>` en atributos | Sin equivalente canónico en v1 |
| `<xmi:Extension extender="Enterprise Architect">` y todos sus hijos (`diagram`, `connector`, `style`, `color`, `appearance`, `tag`) | Extensiones propietarias de EA sin contraparte en el modelo canónico |
| Diagramas (`uml:Diagram`, `<diagrams>`) | No forman parte del modelo estructural |
| Estereotipos y perfiles UML (`<profileApplication>`, `<appliedStereotype>`) | No modelados en v1 |
| Restricciones (`<ownedRule>`, `<constraint>`) | No modeladas en v1 |
| Operaciones de clase (`ownedOperation`) | No modeladas en v1 |
| Interfaces, enumeraciones, tipos de datos (`uml:Interface`, `uml:Enumeration`, `uml:DataType`) | Fuera del corte mínimo v1 |
| Herencia / generalización (`<generalization>`) | No modelada en v1 (supuesto S2 de domain-model-v1) |
| Dependencias, realizaciones, usos (`uml:Dependency`, `uml:Realization`, `uml:Usage`) | Fuera del corte mínimo v1 |
| Componentes, artefactos, nodos de despliegue | Fuera del corte mínimo v1 |
| `<ownedAttribute>` de tipo asociación que ya está recogido en un `uml:Association` explícito | Evitar doble conteo; se procesa solo la `uml:Association` |

---

## 5. Tabla de mapeo de tipos XMI → canónico

Enterprise Architect exporta tipos de datos primitivos como referencias a tipos primitivos UML (`href` a `http://www.omg.org/spec/UML/…`) o como cadenas de nombre libre en el atributo `type`. El adaptador aplica la siguiente tabla de equivalencias (insensible a mayúsculas/minúsculas):

| Tipo en XMI (nombre o href) | Tipo canónico | Notas |
|---|---|---|
| `String`, `EAJava_String`, `java.lang.String` | `"String"` | |
| `int`, `Integer`, `EAJava_int`, `java.lang.Integer` | `"Integer"` | |
| `long`, `Long`, `EAJava_long`, `java.lang.Long` | `"Long"` | |
| `double`, `Double`, `float`, `Float`, `EAJava_double` | `"Double"` | `float`/`Float` se promueven a `Double` con advertencia `TYPE_PROMOTED` |
| `boolean`, `Boolean`, `EAJava_boolean` | `"Boolean"` | |
| `Date`, `EAJava_Date`, `java.util.Date` | `"Date"` | Sin componente de hora |
| `DateTime`, `Timestamp`, `java.sql.Timestamp`, `java.time.LocalDateTime` | `"DateTime"` | |
| `UUID`, `java.util.UUID` | `"UUID"` | |
| cualquier otro valor | → error `UNKNOWN_TYPE` (§7) | Bloqueante |

**Dirección inversa (canónico → XMI):** El exportador usa los nombres de tipo de la columna izquierda, primer valor de cada fila (forma corta), salvo `Date` → `EAJava_Date` para maximizar compatibilidad con EA.

---

## 6. Mapeo bidireccional — resumen ejecutivo

```
EA XMI (import)                    Canónico                EA XMI (export)
─────────────────────────────────────────────────────────────────────────────
uml:Model.name              ──→  model.name         ──→  uml:Model name="…"
uml:Package(xmi:id, name)   ──→  package{id,name,   ──→  packagedElement
  [anidado en Package]              parentId}              [anidado]
uml:Class(xmi:id, name,     ──→  class{id,name,     ──→  packagedElement
ownedAttribute escalar      ──→  attribute{id,name, ──→  ownedAttribute
  (type, lowerValue,                type,nullable,         (type, lowerValue,
   upperValue)                      multiplicity}          upperValue)
uml:Association             ──→  association{id,    ──→  packagedElement
  (memberEnd×2,                     name,source/           uml:Association
   lowerValue/upperValue,           targetClassId,
   isNavigable)                     multiplicities,
                                    navigability}
```

**Garantías de round-trip:**
- Un modelo canónico exportado a XMI e importado de nuevo produce el mismo modelo canónico (módulo orden canónico).
- Un XMI de EA que solo contenga elementos soportados (§3) importa sin pérdida.
- Un XMI de EA con elementos ignorados (§4) importa con pérdida documentada; la re-exportación no recupera los elementos descartados.

---

## 7. Tabla de errores y advertencias

Los errores son bloqueantes: la conversión se interrumpe y no se emite modelo canónico parcial. Las advertencias son no bloqueantes: la conversión continúa y el resultado canónico se emite con la advertencia adjunta.

| Código | Severidad | Condición | Mensaje de ejemplo |
|---|---|---|---|
| `UNSUPPORTED_EXPORTER` | ERROR | `xmi:exporter` indica EA < 15.0 o exportador desconocido | "Exportador no soportado: 'Enterprise Architect 14.1'. Se requiere EA 15.x o 16.x." |
| `MISSING_ROOT_MODEL` | ERROR | No se encuentra `<uml:Model>` en el documento | "Documento XMI sin elemento raíz uml:Model." |
| `DUPLICATE_ID` | ERROR | Dos elementos tienen el mismo `xmi:id` | "Id duplicado 'EAID_001' en el documento." |
| `UNKNOWN_TYPE` | ERROR | Tipo de atributo sin equivalente en §5 | "Tipo 'BigDecimal' no reconocido. Ruta: Class 'Pedido' / attribute 'total'." |
| `UNSUPPORTED_MULTIPLICITY` | ERROR | Combinación lowerValue/upperValue no contemplada en §3.4 | "Multiplicidad '2..5' no soportada en 'Pedido.items'." |
| `UNRESOLVED_CLASS_REF` | ERROR | `type` o `memberEnd` referencia un `xmi:id` que no existe en el documento | "Referencia sin resolver: 'EAID_999' en asociación 'EAID_assoc_001'." |
| `SELF_ASSOCIATION_NOT_SUPPORTED` | ERROR | `sourceClassId == targetClassId` | "Auto-asociación no permitida en v1. Clase: 'Nodo'." |
| `MALFORMED_XMI` | ERROR | El XML no es bien formado o no valida contra el schema XMI 2.1 mínimo | "Error de parseo XML en línea 42: elemento no cerrado." |
| `TYPE_PROMOTED` | WARNING | `float`/`Float` promovido a `"Double"` | "Tipo 'float' promovido a 'Double' en 'Producto.precio'." |
| `OWNEDCOMMENT_HTML_DISCARDED` | WARNING | `<ownedComment>` contiene HTML; se descarta en lugar de mapearse a `description` | "Comentario HTML descartado en clase 'Factura'." |
| `ELEMENT_IGNORED` | INFO | Elemento de §4 encontrado (solo en modo verbose) | "Elemento ignorado: <generalization> en clase 'ClienteVIP'." |
| `OUT_OF_CANONICAL_ORDER` | WARNING | El resultado importado no está en orden canónico (normalizable automáticamente) | Véase domain-model-v1 §4 |
| `NULLABLE_REQUIRED_CONFLICT` | WARNING | `multiplicity="1"` y `nullable=true` en el mismo atributo | Véase domain-model-v1 §3.6 |
| `NOT_NULLABLE_OPTIONAL_CONFLICT` | WARNING | `multiplicity="0..1"` y `nullable=false` | Véase domain-model-v1 §3.6 |

---

## 8. Reglas de pérdida en ciclos de importación/exportación

| Escenario | Pérdida | Recuperable |
|---|---|---|
| XMI con `<xmi:Extension>` (estilos, colores EA) → canónico → XMI | Todos los metadatos de presentación de EA | No |
| XMI con `<generalization>` → canónico → XMI | Relaciones de herencia | No (v1) |
| XMI con `ownedOperation` → canónico → XMI | Operaciones de clase | No (v1) |
| XMI con `<ownedComment>` en texto plano → canónico → XMI | `description` se preserva si el adaptador la transporta | Sí (si el adaptador exporta `<ownedComment>`) |
| XMI con `<ownedComment>` HTML → canónico → XMI | Contenido HTML descartado | No |
| XMI con `float` → canónico (`Double`) → XMI | Precisión nominal rebajada (float → Double); re-exporta como `Double` | No (sin ADR) |
| Canónico → XMI → canónico (round-trip completo con solo elementos soportados) | Ninguna (garantía de fidelidad) | — |

---

## 9. Política de cambios al contrato

1. **Cambio compatible (nueva versión menor):** añadir tipos soportados, mover un elemento de §4 (ignorado) a §3 (soportado), añadir nuevas advertencias. Requiere actualizar este documento; no requiere ADR.
2. **Cambio incompatible:** eliminar un tipo soportado, cambiar la semántica de un mapeo existente, o modificar la política de errores bloqueantes. Requiere ADR aceptado y nueva versión del contrato (`xmi-profile-v2.md`).
3. El adaptador debe declarar qué versión de este contrato soporta.
4. Las versiones de EA fuera de la tabla del §2 pueden añadirse mediante cambio compatible si se verifica con un fixture real.

---

## 10. Decisiones cerradas, supuestos y preguntas abiertas

### 10.1 Decisiones cerradas

| # | Decisión |
|---|---|
| D1 | Solo EA 15.x y 16.x con XMI 2.1 / UML 2.5.1 están soportados en v1. |
| D2 | Las extensiones propietarias `<xmi:Extension extender="Enterprise Architect">` se descartan sin error. |
| D3 | Los tipos `float`/`Float` se promueven a `Double` con advertencia, en coherencia con domain-model-v1 §3.5. |
| D4 | Herencia, enumeraciones, operaciones e interfaces están fuera del corte mínimo v1. |
| D5 | Las auto-asociaciones son un error bloqueante, alineado con domain-model-v1 §3.7. |
| D6 | El round-trip canónico → XMI → canónico es garantizado para elementos del §3; no se garantiza para elementos del §4. |

### 10.2 Supuestos registrados

| # | Supuesto | Consecuencia si incorrecto |
|---|---|---|
| S1 | EA 15.x y 16.x producen XMI 2.1 compatible; no se han observado regresiones entre subversiones. | Podría necesitarse una tabla de excepciones por subversión. |
| S2 | Los `xmi:id` generados por EA son únicos dentro del documento. | Si no lo son, `DUPLICATE_ID` los detecta; el adaptador aborta. |
| S3 | El corpus de fixtures actual cubre los patrones EA más frecuentes del dominio académico del parcial. | Fixtures adicionales podrían revelar casos no cubiertos. |

### 10.3 Preguntas abiertas

| # | Pregunta | Impacto |
|---|---|---|
| Q1 | ¿Debe el adaptador re-exportar `<ownedComment>` para preservar `description`? | Afecta a la garantía de round-trip de `description`. |
| Q2 | ¿Se requiere soporte de EA 17.x en v1 o es un cambio compatible futuro? | Si sí, verificar con fixture real y añadir a §2. |
| Q3 | ¿El `xmi:id` de EA se preserva como `id` canónico o se reemplaza por un UUID v4 generado? | Afecta a la trazabilidad y a la decisión Q1 de domain-model-v1. |

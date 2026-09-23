# Contrato de perfil XMI — Enterprise Architect v1

- **Versión del contrato:** 1.2.0
- **Estado:** accepted
- **Fecha:** 2026-09-20 (rev. 1.2.0: 2026-09-23)
- **Autoridad:** Product Owner (ADR-0000)
- **Contrato base:** `docs/contracts/domain-model-v1.md` (contractVersion `"1"`)

**Cambio compatible 1.1.0 (§9.1):** la importación recupera `kind` de asociación — `aggregation`/`composition` (atributo `aggregation` del extremo), `generalization` (`<generalization>` hijo de la clase específica), `dependency` (`packagedElement uml:Dependency`) y `associationClass` (`packagedElement uml:AssociationClass`, que materializa la clase portadora con id derivado `ACL_{assocId}`). Además: los atributos del namespace XMI se resuelven por nombre local (tolerancia a prefijos no estándar como `x:`) y `uml:Model` sin `xmi:id`/`name` usa valores derivados en lugar de abortar.

**Cambio compatible 1.2.0 (decisión PO: paquete raíz único):** los `uml:Package` ya no se materializan como paquetes canónicos — el modelo canónico es el único paquete raíz. En importación los paquetes EA se **atraviesan** (su contenido se importa plano) y se informa con el diagnóstico `PACKAGE_FLATTENED`. En exportación se mantiene únicamente el wrapper técnico `EAPK_ROOT` que EA 15 necesita para poblar el diagrama; es un detalle de interoperabilidad, no un paquete del modelo.

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

El adaptador detecta el exportador leyendo `xmi:exporter` / `<xmi:Documentation exporter="…">`. Si el exportador no es Enterprise Architect, emite `UNSUPPORTED_EXPORTER` (véase §7). La versión se lee de `exporterVersion`: los exports reales de EA declaran la versión del **extender XMI** (`6.5`), así que se aceptan valores `6.x` (extender de EA) y `15.x`/`16.x` (versión de producto declarada por otros generadores).

---

## 3. Elementos XMI soportados

Los siguientes elementos y atributos XMI son procesados activamente en la conversión. El adaptador los mapea al modelo canónico (import) o los genera a partir de él (export).

### 3.1 Elemento raíz y metadatos

| Elemento/Atributo XMI | Descripción | Mapeo canónico |
|---|---|---|
| `<xmi:XMI xmi:version="2.1">` | Elemento raíz del documento | — (estructural; resuelto por nombre local, el prefijo de namespace puede variar) |
| `<uml:Model xmi:id="…" name="…">` | Nombre del modelo | → `model.id`/`model.name`. Si `xmi:id` falta se acepta `xmi:uuid` o se deriva `MODEL_ROOT`; si `name` falta se deriva `Modelo_EA` (v1.1) |
| `<xmi:Documentation exporter="…" exporterVersion="…">` | Metadatos del exportador | → ignorado (§4) |

### 3.2 Paquetes (`packagedElement` de tipo `uml:Package`) — aplanados (v1.2)

El modelo canónico no tiene paquetes de usuario (`domain-model-v1` §3.2: el modelo **es** el paquete raíz). En importación, los `packagedElement uml:Package` —en cualquier nivel de anidamiento— se **atraviesan**: sus clases, atributos y relaciones se importan planos al ámbito raíz. Cada paquete atravesado genera el diagnóstico informativo `PACKAGE_FLATTENED`. Ningún atributo del paquete (`xmi:id`, `name`, `visibility`) se conserva en el modelo.

**Paquete raíz EA (`EAPK_ROOT`) — wrapper técnico de exportación:** EA requiere que todo el contenido viva dentro de un `uml:Package`; el exportador envuelve el modelo completo en un `packagedElement` con `xmi:id="EAPK_ROOT"` y el mismo nombre del modelo. Es el único `uml:Package` que la exportación emite — un detalle de interoperabilidad, no un paquete del modelo. En importación se trata como un paquete más: se atraviesa y su contenido queda en el ámbito raíz.

### 3.3 Clases (`packagedElement` de tipo `uml:Class`)

| Atributo XMI | Obligatorio | Mapeo canónico |
|---|---|---|
| `xmi:id` | sí | → `class.id` |
| `name` | sí | → `class.name` |
| Clase contenida en un `packagedElement uml:Package` | — | → ninguno (la clase queda en el ámbito raíz; el paquete se aplana, §3.2) |

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

El modelo canónico distingue `kind` de asociación. En exportación se mapea a los elementos UML correspondientes. Desde la versión 1.1.0 el `kind` también se recupera en importación: `aggregation="shared|composite"` en el extremo del todo (si el extremo marcado es el segundo, se intercambian los extremos para que el todo quede como origen), `<generalization general="{id}">` dentro de la clase específica (id derivado `GEN_{classId}_{n}` si falta `xmi:id`), `uml:Dependency` (atributos `client`/`supplier`; listas separadas por espacios toman el primer id) y `uml:AssociationClass` (la clase portadora se materializa con id `ACL_{assocId}` y los `ownedAttribute` del elemento; la asociación la referencia con `associationClassId`). En v1.0.0 el `kind` no se recuperaba (pérdida documentada en §8).

| `kind` canónico | Elemento XMI emitido |
|---|---|
| `association` (o ausente) | `packagedElement uml:Association` |
| `aggregation` | `uml:Association` con `aggregation="shared"` en el extremo del todo (origen) |
| `composition` | `uml:Association` con `aggregation="composite"` en el extremo del todo (origen) |
| `generalization` | `<generalization xmi:type="uml:Generalization" general="{targetClassId}">` dentro de la clase específica (origen) |
| `dependency` | `packagedElement uml:Dependency` con `client="{sourceClassId}"` y `supplier="{targetClassId}"` |
| `associationClass` | `packagedElement uml:AssociationClass` que fusiona la clase portadora (sus `ownedAttribute`) con los extremos de la asociación. En la extensión EA el elemento y el conector son identidades distintas: el `<element>` usa el `xmi:id` de la asociación con `nType="17"` y `conID` apuntando al conector; el `<connector>` lleva id propio `CONN_{assocId}`, `subtype="Class"` y `extendedProperties associationclass="{assocId}" privatedata1="{ea_localid del elemento}"` |

En exportación, `navigability: "unidirectional"` se emite con `isNavigable="false"` en el extremo origen (navegable origen → destino). El exportador declara `xmi:exporter="Enterprise Architect"` y `xmi:exporterVersion` configurable, por defecto `15.0.1514.12`; `<xmi:Documentation>` declara `exporterVersion="6.5"` (versión del extender XMI que EA escribe en sus exports reales).

**Namespaces (formato EA 15):** el documento usa los URIs legacy `xmlns:uml="http://schema.omg.org/spec/UML/2.1"` y `xmlns:xmi="http://schema.omg.org/spec/XMI/2.1"` — los únicos que el importador XMI de EA 15 resuelve completamente en la extensión propietaria. En importación el adaptador no exige URIs específicos: los nodos se resuelven por nombre local.

**Representación de referencias en exportación (formato EA):** los `ownedEnd` llevan `association="{associationId}"`, el set completo de flags (`visibility="public" isStatic="false" isReadOnly="false" isDerived="false" isOrdered="false" isUnique="true" isDerivedUnion="false"`) y `aggregation` (`none`/`shared`/`composite`), con el clasificador como hijo `<type xmi:idref="{classId}"/>` (no el atributo `type="..."` — EA no lo resuelve y descarta el conector). Los `ownedAttribute` llevan `visibility="private"` + el mismo set de flags y el tipo como hijo `<type>` en dos formas (como en los exports reales de EA): `<type xmi:type="uml:PrimitiveType" href="…PrimitiveTypes.xmi#{String|Integer|Real|Boolean}"/>` para los primitivos UML, y `<type xmi:idref="EAnone_{tipo}"/>` para tipos sin primitivo UML (`long`, `EAJava_Date`, `DateTime`, `UUID`); `EAnone_` es el prefijo de tipos internos de EA. Además, la entrada `<attribute>` de la extensión declara el nombre visible en `<properties type="{tipoEA}"…>` (`String`, `int`, `long`, `double`, `boolean`, `Date`, `DateTime`, `UUID`) — EA toma de ahí el tipo mostrado. En importación se aceptan ambas formas: el prefijo `EAnone_` se elimina y el fragmento `#…` del href se mapea a tipo canónico (§5). Los límites superiores se emiten como `uml:LiteralInteger` para valores finitos y `uml:LiteralUnlimitedNatural value="-1"` para `*`; en importación `-1` se normaliza a `*`.

**Extensión EA en exportación (formato EA 15):**

Para que EA cree el diagrama de clases ya poblado al importar, el exportador emite `<xmi:Extension extender="Enterprise Architect" extenderID="6.5">` como hermano de `uml:Model`, con:

- `<elements>`: una entrada por el paquete raíz técnico (`EAPK_ROOT`, `package2="EAID_ROOT"`, `ea_eleType="package"`) y una por cada clase con `<model>`, `<properties>`, `<project>`, `<code>`, `<style>`, `<extendedProperties tagged="0" package_name="…">`, `<attributes>` (entradas por atributo con `ea_localid`/`ea_guid` deterministas), `<links>` (los conectores que tocan cada clase, referenciados por su id de conector) y `<flags>`. Todas las clases y elementos declaran `package="EAPK_ROOT"` como padre (v1.2: no se emiten paquetes de usuario).
- `<connectors>`: una entrada por asociación con `<source>`/`<target>` (`<role visibility="Public"/>`, `<type multiplicity="1..*" aggregation="none"/>` en notación de rango EA, `<modifiers isOrdered isNavigable>`, `<style value="…Navigable=…"/>`), `<properties ea_type [subtype="Class"] direction>`, `<labels lb mt rb>` y `<extendedProperties [associationclass privatedata1]>`. `ea_type` es `Association`, `Generalization` o `Dependency` según `kind`; `direction` es `Bi-Directional` o `Source -> Destination`. Para `associationClass` el conector usa el id `CONN_{assocId}` y `subtype="Class"`.
- `<primitivetypes>`: `packagedElement uml:Package` `EAPrimitiveTypesPackage` + `<profiles/>`, como en los exports reales.
- `<diagrams>`: un `<diagram>` `type="Logical"` (`<model package="EAPK_ROOT" localID owner>`, `style1`/`style2`/`swimlanes`/`matrixitems` con los valores de EA 15) que contiene todas las clases en una grilla determinista (`geometry="Left..;Top..;Right..;Bottom..;"`, `subject`, `style="DUID=<8 hex>;NSL=0;BCol=-1;…"`) y todos los conectores (`geometry="EDGE=…;$LLB=CX=…;LMT=…;LRB=…;Path=;"` con geometría de etiquetas `CX=17` para multiplicidades y `CX=29` para el nombre; `style="Mode=3;EOID=<DUID destino>;SOID=<DUID origen>;…"`). El `subject` de cada línea es el id del conector (`CONN_{id}` para clase-asociación).

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
| `<xmi:Extension extender="Enterprise Architect">` y todos sus hijos (`diagram`, `connector`, `style`, `color`, `appearance`, `tag`) | Extensiones propietarias sin contraparte canónica. Excepción v1.1: `<element>/<attributes>/<attribute>/<properties type>` se lee como fallback del tipo de atributo (§5) |
| Diagramas (`uml:Diagram`, `<diagrams>`) | No forman parte del modelo estructural |
| Estereotipos y perfiles UML (`<profileApplication>`, `<appliedStereotype>`) | No modelados en v1 |
| Restricciones (`<ownedRule>`, `<constraint>`) | No modeladas en v1 |
| Operaciones de clase (`ownedOperation`) | No modeladas en v1 |
| Interfaces, enumeraciones, tipos de datos (`uml:Interface`, `uml:Enumeration`, `uml:DataType`) | Fuera del corte mínimo v1 |
| Realizaciones, usos (`uml:Realization`, `uml:Usage`) | Fuera del corte mínimo v1 |
| Componentes, artefactos, nodos de despliegue | Fuera del corte mínimo v1 |
| `<ownedAttribute>` de tipo asociación que ya está recogido en un `uml:Association` explícito | Evitar doble conteo; se procesa solo la `uml:Association` |

---

## 5. Tabla de mapeo de tipos XMI → canónico

Enterprise Architect exporta tipos de datos primitivos como referencias a tipos primitivos UML (`href` a `http://www.omg.org/spec/UML/…`) o como cadenas de nombre libre en el atributo `type`. El adaptador aplica la siguiente tabla de equivalencias (insensible a mayúsculas/minúsculas):

| Tipo en XMI (nombre o href) | Tipo canónico | Notas |
|---|---|---|
| `String`, `char`, `EAJava_String`, `java.lang.String` | `"String"` | `char` añadido en v1.1 |
| `int`, `Integer`, `short`, `byte`, `EAJava_int`, `java.lang.Integer` | `"Integer"` | `short`/`byte` añadidos en v1.1 |
| `long`, `Long`, `BigInteger`, `EAJava_long`, `java.lang.Long`, `java.math.BigInteger` | `"Long"` | `BigInteger` añadido en v1.1 |
| `double`, `Double`, `float`, `Float`, `BigDecimal`, `EAJava_double`, `java.math.BigDecimal` | `"Double"` | `float`/`Float`/`BigDecimal` se promueven a `Double` con advertencia `TYPE_PROMOTED` |
| `boolean`, `Boolean`, `EAJava_boolean` | `"Boolean"` | |
| `Date`, `EAJava_Date`, `java.util.Date` | `"Date"` | Sin componente de hora |
| `DateTime`, `Timestamp`, `java.sql.Timestamp`, `java.time.LocalDateTime` | `"DateTime"` | |
| `UUID`, `java.util.UUID` | `"UUID"` | |
| cualquier otro valor | → error `UNKNOWN_TYPE` (§7) | Bloqueante |

**Resolución del tipo en importación (v1.1):** si el `ownedAttribute` no declara atributo `type` ni hijo `<type>`, el adaptador busca el tipo en la extensión propietaria de EA (`<element>/<attributes>/<attribute xmi:idref="{id}">/<properties type="…"/>`). Los exports reales de EA guardan ahí el tipo del atributo.

**Dirección inversa (canónico → XMI):** El exportador usa los nombres de tipo de la columna izquierda, primer valor de cada fila (forma corta), salvo `Date` → `EAJava_Date` para maximizar compatibilidad con EA.

---

## 6. Mapeo bidireccional — resumen ejecutivo

```
EA XMI (import)                    Canónico                EA XMI (export)
─────────────────────────────────────────────────────────────────────────────
uml:Model.name              ──→  model.name         ──→  uml:Model name="…"
uml:Package (cualquier      ──→  aplanado: solo     ──→  único wrapper técnico
  nivel de anidamiento)          PACKAGE_FLATTENED       EAPK_ROOT (§3.2)
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
| `PACKAGE_FLATTENED` | INFO | Un `uml:Package` fue atravesado sin materializarse (v1.2: el canónico solo tiene paquete raíz) | "Paquete 'ventas' aplanado; sus clases se importan en el ámbito raíz." |
| `OUT_OF_CANONICAL_ORDER` | WARNING | El resultado importado no está en orden canónico (normalizable automáticamente) | Véase domain-model-v1 §4 |
| `NULLABLE_REQUIRED_CONFLICT` | WARNING | `multiplicity="1"` y `nullable=true` en el mismo atributo | Véase domain-model-v1 §3.6 |
| `NOT_NULLABLE_OPTIONAL_CONFLICT` | WARNING | `multiplicity="0..1"` y `nullable=false` | Véase domain-model-v1 §3.6 |

---

## 8. Reglas de pérdida en ciclos de importación/exportación

| Escenario | Pérdida | Recuperable |
|---|---|---|
| XMI con `<xmi:Extension>` (estilos, colores EA) → canónico → XMI | Todos los metadatos de presentación de EA | No |
| XMI con `uml:AssociationClass` → canónico → XMI | El id original de la clase portadora se reemplaza por `ACL_{assocId}` | No (id interno) |
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

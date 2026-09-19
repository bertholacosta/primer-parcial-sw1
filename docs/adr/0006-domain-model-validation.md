# ADR-0006: representación ejecutable y validación del modelo

- **Estado:** `accepted`
- **Decisor:** Product Owner
- **Fecha de propuesta:** 2026-09-19
- **Tarea de origen:** P1-002
- **Contrato de referencia:** `docs/contracts/domain-model-v1.md` v1.0.0

---

## Pregunta

¿Qué representación ejecutable y runtime implementarán el contrato canónico (`domain-model-v1.md`) y sus diagnósticos en el módulo `packages/domain-validator/`?

---

## Criterios de evaluación

| Criterio | Descripción |
|---|---|
| **Compatibilidad contractual** | Capacidad de expresar y verificar todas las reglas de `domain-model-v1.md` (campos obligatorios, tipos permitidos, referencias cruzadas, unicidad, coherencia nullable/multiplicity). |
| **Diagnósticos estables** | Producción de códigos de error fijos (`MISSING_REQUIRED_FIELD`, `UNKNOWN_TYPE`, `UNRESOLVED_REFERENCE`, `DUPLICATE_NAME`, `NULLABLE_REQUIRED_CONFLICT`) con ruta JSONPath precisa, sin mensajes variables que rompan snapshots. |
| **Operación offline** | Sin dependencias de red en runtime ni en las pruebas; ejecutable en el pipeline local Windows 11 / PowerShell 7. |
| **Pruebas automatizadas** | Soporte para pruebas unitarias y de snapshot sobre fixtures JSON; ejecutables con un solo comando desde la raíz del repositorio. |
| **Aislamiento del núcleo** | El validador no debe importar código de Spring Boot, Flutter ni de ningún generador; solo depende del contrato. |
| **Fricción de toolchain** | Número de runtimes, herramientas y pasos de instalación adicionales requeridos en el entorno canónico Windows 11 + pwsh. |
| **Mantenibilidad** | Legibilidad de reglas, facilidad de añadir nuevas restricciones al evolucionar el contrato y curva de aprendizaje para el equipo. |

---

## Alternativas evaluadas

### Opción A — TypeScript + Node.js · AJV (JSON Schema draft-07) + reglas custom

**Descripción:** El módulo `packages/domain-validator/` se implementa en TypeScript compilado a CJS/ESM. La validación estructural usa [AJV](https://ajv.js.org/) (Another JSON Validator) con un esquema JSON Schema draft-07 que cubre campos obligatorios, tipos de cadena y enumeraciones. Las reglas semánticas que JSON Schema no puede expresar (unicidad de `id`, referencias cruzadas, ciclos en jerarquía de paquetes, coherencia nullable/multiplicity) se implementan como funciones TypeScript puras. El módulo expone una función `validate(doc: unknown): ValidationResult` que devuelve el array de `Diagnostic` con `code`, `path` y `severity`.

**Evaluación:**

| Criterio | Resultado |
|---|---|
| Compatibilidad contractual | ✅ AJV cubre estructura y enumeraciones; las reglas custom cubren referencias y unicidad. Todos los diagnósticos del contrato v1 son implementables. |
| Diagnósticos estables | ✅ Los códigos son literales TypeScript exportados; la ruta JSONPath proviene de los punteros de instancia de AJV (`instancePath`). Snapshots estables. |
| Operación offline | ✅ Node.js + npm; sin llamadas a red. AJV es una dependencia npm local, no requiere descarga en runtime. |
| Pruebas automatizadas | ✅ Vitest o Jest; fixtures JSON en `fixtures/models/`; un solo `npm test` desde `packages/domain-validator/`. |
| Aislamiento del núcleo | ✅ Solo depende de AJV y TypeScript. Sin imports de Spring, JPA ni Flutter. |
| Fricción de toolchain | ✅ Node.js ya es requerido por `apps/case-web/` (ADR-0001); sin runtime adicional. |
| Mantenibilidad | ✅ Reglas en TypeScript tipado; fácil añadir nuevas restricciones. Curva baja para el equipo si ya usa TS en case-web. |

**Riesgos:**
- AJV v8 cambió la API respecto a v6; se debe fijar la versión exacta en `package.json`.
- Si el equipo no usa TypeScript en ningún otro módulo (hipotético), existe curva de aprendizaje; mitigado porque ADR-0001 ya lo adopta para case-web.

---

### Opción B — Kotlin/JVM · Jackson + Bean Validation (JSR-380)

**Descripción:** El validador se implementa como un módulo Kotlin (o Java) usando Jackson para parsear el JSON y Bean Validation (Hibernate Validator) para las restricciones declarativas vía anotaciones. Las reglas semánticas complejas se expresan como `ConstraintValidator` personalizados.

**Evaluación:**

| Criterio | Resultado |
|---|---|
| Compatibilidad contractual | ✅ Bean Validation cubre campos obligatorios y restricciones de valor; los `ConstraintValidator` cubren referencias cruzadas. |
| Diagnósticos estables | ⚠️ Los mensajes de Hibernate Validator son internacionalizables pero requieren configuración para producir códigos fijos; la ruta al campo no es JSONPath nativo sino expression language de Bean Validation. |
| Operación offline | ✅ Offline puro; sin red. |
| Pruebas automatizadas | ✅ JUnit 5 + Gradle/Maven. |
| Aislamiento del núcleo | ⚠️ La JVM es el mismo runtime que Spring Boot; aunque el módulo no importa Spring, comparte toolchain con el generador y puede generar acoplamiento accidental de dependencias transitivas. |
| Fricción de toolchain | ❌ Requiere JDK ≥ 17 instalado y configurado en el pipeline Windows. Si el agente que ejecuta `domain-validator` no tiene JVM disponible (p. ej. Kiro/Devin en entorno Node), el validador no puede invocarse desde el pipeline orca.ps1 sin un paso de compilación Gradle. |
| Mantenibilidad | ⚠️ Más verboso que TS; los `ConstraintValidator` requieren más boilerplate. Ventaja si el equipo es mayoritariamente Java. |

**Riesgos:**
- Startup de la JVM (~200–400 ms) ralentiza cada invocación del validador en el pipeline; no bloqueante pero perceptible.
- Dependencia de Gradle/Maven en el pipeline orca.ps1; paso de build adicional antes de poder validar.
- Riesgo de acoplamiento con dependencias de Spring si el submódulo comparte `build.gradle` con el generador.

---

### Opción C — Python · jsonschema + Pydantic

**Descripción:** El validador se implementa en Python usando la librería `jsonschema` para validación estructural y Pydantic v2 para modelado de tipos y validaciones adicionales. Se expone como CLI (`python -m domain_validator <file>`).

**Evaluación:**

| Criterio | Resultado |
|---|---|
| Compatibilidad contractual | ✅ Pydantic v2 puede expresar todas las restricciones del contrato. |
| Diagnósticos estables | ✅ Los códigos pueden exportarse como constantes; los paths de Pydantic son navigables. |
| Operación offline | ✅ Offline puro con dependencias pip instaladas. |
| Pruebas automatizadas | ✅ pytest. |
| Aislamiento del núcleo | ✅ Sin dependencias de Spring ni Flutter. |
| Fricción de toolchain | ❌ Requiere Python 3.11+ instalado en el pipeline Windows 11. El entorno canónico (AGENTS.md) lista Node/pwsh como base; Python es un runtime adicional no declarado. Si los agentes Devin/Kiro/Antigravity operan en contenedores Node, Python no está disponible sin configuración extra. |
| Mantenibilidad | ✅ DX alta; Pydantic v2 es expresivo. Curva media si el equipo no usa Python. |

**Riesgos:**
- Gestión de entornos virtuales (`venv`) en Windows puede generar inconsistencias entre agentes.
- Pydantic v2 rompe compatibilidad con v1; versión debe fijarse.

---

### Opción D — Rust · serde_json + validación custom

**Descripción:** El validador se implementa en Rust usando `serde_json` para deserialización y lógica custom para todas las reglas semánticas. Se distribuye como binario compilado.

**Evaluación:**

| Criterio | Resultado |
|---|---|
| Compatibilidad contractual | ✅ Toda la lógica es expresable en Rust. |
| Diagnósticos estables | ✅ Códigos como constantes de string. |
| Operación offline | ✅ Binario nativo; cero dependencias de runtime. |
| Pruebas automatizadas | ✅ `cargo test`. |
| Aislamiento del núcleo | ✅ Sin dependencias externas problemáticas. |
| Fricción de toolchain | ❌❌ Requiere Rust toolchain (rustup, cargo) no presente en el entorno canónico. La compilación cruzada para Windows x64 desde agentes Linux añade complejidad. El binario debe redistribuirse o compilarse en CI. |
| Mantenibilidad | ❌ Curva de aprendizaje alta; cambios en el contrato requieren modificar structs Rust y recompilar. |

**Riesgos:**
- Mayor tiempo de setup; poco justificado para un validador de JSON que no tiene requisitos de rendimiento extremos.
- Dificulta la participación de agentes que no tienen entorno Rust.

---

## Tabla comparativa

| Criterio | A · TS+AJV | B · Kotlin+BV | C · Python+Pydantic | D · Rust |
|---|---|---|---|---|
| Compatibilidad contractual | ✅ | ✅ | ✅ | ✅ |
| Diagnósticos JSONPath estables | ✅ | ⚠️ | ✅ | ✅ |
| Operación offline | ✅ | ✅ | ✅ | ✅ |
| Pruebas automatizadas | ✅ | ✅ | ✅ | ✅ |
| Aislamiento del núcleo | ✅ | ⚠️ | ✅ | ✅ |
| Fricción de toolchain (Windows) | ✅ bajo | ❌ medio-alto | ❌ medio | ❌❌ alto |
| Mantenibilidad | ✅ alta | ⚠️ media | ✅ alta | ❌ baja |
| **Puntuación global** | **6/7** | **3/7** | **5/7** | **3/7** |

---

## Decisión propuesta

**Opción A: TypeScript (ESM/CJS) + AJV 8 + reglas custom, en el módulo `packages/domain-validator/`.**

### Justificación

1. **Reutilización de toolchain:** Node.js ya es parte del entorno canónico del monorepo por ADR-0001 (`apps/case-web/`). No se introduce ningún runtime adicional en el pipeline Windows 11 / PowerShell 7.
2. **Diagnósticos precisos:** AJV 8 expone `instancePath` en notación JSONPath, directamente alineado con los ejemplos de diagnóstico del contrato v1 (p. ej. `$.classes[0].attributes[0].type`). Los códigos de error son literales TypeScript exportados, lo que garantiza snapshots estables en las pruebas.
3. **Validación offline total:** AJV opera sobre el objeto en memoria; no necesita red ni servicios externos. Apto para los agentes que ejecutan en entornos sin conectividad (Devin, Antigravity).
4. **Aislamiento limpio:** El módulo solo importa AJV y sus tipos; ninguna dependencia de Spring, JPA, Flutter o generadores. La invariante 2 de ARCHITECTURE.md (entrada inválida no produce código parcial) puede cumplirse simplemente verificando que `validate()` retorne cero errores bloqueantes antes de invocar el generador.
5. **Pruebas con fixtures:** Los fixtures JSON de `fixtures/models/` son consumibles directamente por Vitest/Jest, lo que permite pruebas de regresión sobre los ejemplos normativos del contrato v1 (§6 de `domain-model-v1.md`).
6. **Consistencia del ecosistema:** Todos los agentes que ya ejecutan operaciones sobre `apps/case-web/` pueden ejecutar este validador sin instalar dependencias nuevas.

### Aprobación del Product Owner

Esta decisión ha sido aprobada por el Product Owner con los siguientes acuerdos:

- [x] **PO-1:** Se acepta TypeScript como lenguaje del módulo `packages/domain-validator/`.
- [x] **PO-2:** Se acepta AJV 8 (versión fijada) como dependencia del validador.
- [x] **PO-3:** Se utilizará Vitest como test runner preferido.
- [x] **PO-4:** El validador expondrá una CLI además de la API de función, para facilitar uso desde `orca.ps1`.

---

## Consecuencias

### Si se acepta la Opción A

- **`packages/domain-validator/`** se inicializa como paquete TypeScript con `package.json`, `tsconfig.json` y dependencias `ajv@^8.17`, `ajv-formats` (opcional) y `typescript`.
- Se define un JSON Schema draft-07 que modela la estructura de `domain-model-v1.md` (campos obligatorios, enumeraciones de tipo, enumeraciones de multiplicidad, navegabilidad).
- Se implementan reglas custom en TypeScript para: unicidad de `id` en el documento, unicidad de `name` por paquete/clase, resolución de referencias (`packageId`, `sourceClassId`, `targetClassId`, `parentId`), detección de ciclos en jerarquía de paquetes, coherencia `nullable`/`multiplicity`.
- La función pública `validate(doc: unknown): ValidationResult` retorna `{ errors: Diagnostic[], warnings: Diagnostic[] }` donde `Diagnostic` tiene `{ code, path, message, severity }`.
- Las pruebas unitarias cubren los cinco ejemplos inválidos del §6.2 de `domain-model-v1.md` y el ejemplo válido del §6.1.
- La integración con el generador (`services/generator-cli/`) consiste en invocar `validate()` y abortar si `errors.length > 0`.

### Riesgos residuales

| Riesgo | Mitigación |
|---|---|
| Cambio de API en AJV entre minor versions | Fijar `"ajv": "8.17.1"` (versión exacta) en `package.json`. |
| Expresividad limitada de JSON Schema para reglas semánticas complejas (ciclos, refs cruzadas) | Implementar esas reglas como funciones TypeScript puras, fuera del schema AJV; pipeline en dos fases: schema primero, semántica después. |
| Divergencia entre el JSON Schema interno y el contrato v1 tras evolución del contrato | El JSON Schema vive en `packages/domain-validator/src/schema/domain-model-v1.schema.json` y se versiona junto al contrato; un ADR de cambio de contrato debe actualizar ambos archivos. |

---

## Validación

El comando que verifica que este ADR está bien formado y contiene las secciones requeridas:

```powershell
# Desde la raíz del repositorio
Select-String -Pattern 'Alternativas|Consecuencias|Validación|Estado' docs/adr/0006-domain-model-validation.md
```

Una vez implementado el módulo, el comando de validación funcional será:

```powershell
# Instalar dependencias del módulo (una vez)
npm install --prefix packages/domain-validator

# Ejecutar pruebas
npm test --prefix packages/domain-validator
```

---

## Referencias

- `docs/contracts/domain-model-v1.md` — Contrato canónico; fuente de todas las reglas implementadas.
- `docs/ARCHITECTURE.md` — Invariantes 1, 2, 3 y 7 aplican directamente al validador.
- `docs/adr/0000-foundational-decisions.md` — Principio de modelo canónico como única fuente de verdad.
- `docs/adr/0001-case-web-technology.md` — Establece Node.js/TypeScript como ecosistema base del monorepo.
- `fixtures/models/` — Fixtures JSON que servirán como casos de prueba.

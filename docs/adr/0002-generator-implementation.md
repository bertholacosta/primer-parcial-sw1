# ADR-0002: implementación del generador

- Estado: `accepted`
- Fecha: 2026-09-19
- Decisor: Product Owner
- Autor (especificación): Kiro / P2-002

---

## Contexto

El contrato `generator-input-output` v1 (aceptado, `docs/contracts/generator-input-output-v1.md`) define
que el generador debe ser determinista (salida byte a byte idéntica ante entradas equivalentes), operar
sin red durante la generación, distribuirse como CLI standalone en Windows 11 (PowerShell 7), validar el
modelo canónico antes de escribir, y producir cinco capas Spring Boot con persistencia JPA/Hibernate.

Ninguna tecnología concreta estaba elegida al inicio de la Fase 2. Esta ADR evalúa las alternativas y
propone una al Product Owner para su aprobación antes de comenzar P2-003.

## Pregunta

¿Qué lenguaje, runtime y mecanismo de plantillas implementarán `services/generator-cli/` y
`templates/spring-boot/`?

## Criterios de evaluación

| Criterio | Descripción |
|---|---|
| Reproducibilidad | Orden de iteración determinista; sin fecha/hora, UUID ni concurrencia en la salida. |
| Escape seguro | Las plantillas no pueden inyectar contenido Java malformado desde el modelo. |
| Formateo | El código generado debe ser legible; se prefiere un formateador integrable. |
| Pruebas golden | El framework de pruebas permite comparar el árbol de salida byte a byte. |
| Distribución CLI | Ejecutable o comando `npx`/`pipx` invocable desde PowerShell 7 sin instalación global obligatoria. |
| Generación sin red | Todas las dependencias del generador deben poder fijarse y cachearse; ninguna llamada de red en tiempo de ejecución. |
| Carga cognitiva | Familiaridad del equipo con el lenguaje; simplicidad de las plantillas para Devin/SWE-2. |

---

## Alternativas

### Alternativa A — Node.js 22 LTS + TypeScript + Handlebars.js

**Stack:** Node.js 22.x LTS, TypeScript 5.x, Handlebars 4.x, Prettier (formateo), Vitest (pruebas),
`pkg` o `ncc` (bundle standalone), `npm` (gestión de dependencias).

**Motor de plantillas:** Handlebars compila plantillas `.hbs` a funciones JS puras. No evalúa expresiones
arbitrarias (solo helpers declarados), lo que elimina la inyección de lógica desde el modelo. El escape
HTML por defecto puede desactivarse con `{{{ }}}` para Java, pero puede reemplazarse con un helper
personalizado que valide el contenido antes de interpolarlo.

**Reproducibilidad:** El orden de iteración sobre arrays JS es determinista si el código itera sobre
arrays ordenados (no sobre propiedades de objetos sin `Object.keys().sort()`). La normalización canónica
del contrato v1 garantiza el orden de entrada. Node.js no introduce no-determinismo en operaciones
síncronas sobre datos inmutables.

**Prueba acotada de reproducibilidad (evidencia ejecutable):**

```powershell
# Desde la raíz del repositorio, una vez implementado P2-003:
node services/generator-cli/dist/index.js `
  --model fixtures/models/valid-minimal.json `
  --output out/run1 `
  --config fixtures/generator-config-minimal.json
node services/generator-cli/dist/index.js `
  --model fixtures/models/valid-minimal.json `
  --output out/run2 `
  --config fixtures/generator-config-minimal.json
# Ambos manifiestos deben ser byte a byte idénticos:
Compare-Object (Get-Content out/run1/generation-manifest.json) `
              (Get-Content out/run2/generation-manifest.json)
# Sin salida = reproducible.
```

**Formateo:** Prettier 3.x con parser `java` (plugin `prettier-plugin-java`) puede ejecutarse como paso
posterior a la generación para normalizar indentación. Alternativamente, las plantillas Handlebars se
diseñan con indentación fija, eliminando la necesidad de un formateador externo.

**Distribución CLI:**
```powershell
# Sin instalación global (npx con versión fijada):
npx --yes generator-cli@1.0.0 --model model.json --output out/ --config config.json
# O con bundle standalone producido por ncc:
node dist/bundle.js --model model.json --output out/ --config config.json
```

**Toolchain completo:**
```
Node.js 22.x LTS  (runtime)
TypeScript 5.x    (lenguaje — compilado a JS antes de distribución)
Handlebars 4.x    (motor de plantillas)
Prettier 3.x      (formateo opcional post-generación)
Vitest 2.x        (pruebas unitarias e integración golden)
@vercel/ncc       (bundle standalone, sin node_modules en distribución)
npm 10.x          (gestión de dependencias, lock file v3)
```

**Riesgos:**
- Handlebars no es context-aware para Java: el escape de `<`, `>`, `&` en bloques `{{ }}` produce
  entidades HTML (`&lt;`, etc.) que deben evitarse con helpers o triple-stache. Mitigación: usar helpers
  personalizados y test golden que detecten entidades HTML en salida.
- `pkg` (Vercel) está en mantenimiento reducido; `ncc` o `esbuild` son alternativas más activas para
  bundling.

---

### Alternativa B — Python 3.12 + Jinja2

**Stack:** Python 3.12.x, Jinja2 3.x, Black (formateo), pytest (pruebas), PyInstaller (standalone),
`pip` con `requirements.txt` o `pyproject.toml` + `uv` (gestión de dependencias).

**Motor de plantillas:** Jinja2 soporta herencia de plantillas (`{% extends %}`), macros reutilizables y
modo de auto-escape configurable. La sintaxis `{{ variable }}` con `autoescape=False` (modo texto) es
apropiada para generar Java; el escape se controla explícitamente mediante filtros (`| e` cuando aplica).

**Reproducibilidad:** Python 3.7+ garantiza orden de inserción en `dict`. Los sets (`set`) no son
deterministas en orden; el código debe usar `sorted()` explícitamente en todos los puntos de iteración
sobre colecciones del modelo. Jinja2 no introduce no-determinismo propio en modo síncrono.

**Prueba acotada de reproducibilidad (evidencia ejecutable):**

```powershell
# Desde la raíz del repositorio, una vez implementado P2-003:
python services/generator-cli/src/main.py `
  --model fixtures/models/valid-minimal.json `
  --output out/run1 `
  --config fixtures/generator-config-minimal.json
python services/generator-cli/src/main.py `
  --model fixtures/models/valid-minimal.json `
  --output out/run2 `
  --config fixtures/generator-config-minimal.json
Compare-Object (Get-Content out/run1/generation-manifest.json) `
              (Get-Content out/run2/generation-manifest.json)
```

**Formateo:** Black 24.x formatea código Python; no formatea Java. Para Java generado se usa indentación
fija en plantillas Jinja2, sin formateador externo en v1.

**Distribución CLI:**
```powershell
# Con uv (sin instalación global):
uvx generator-cli@1.0.0 --model model.json --output out/ --config config.json
# O con PyInstaller (binario standalone, ~15 MB):
.\dist\generator-cli.exe --model model.json --output out/ --config config.json
```

**Toolchain completo:**
```
Python 3.12.x     (runtime)
Jinja2 3.x        (motor de plantillas)
pytest 8.x        (pruebas unitarias e integración golden)
PyInstaller 6.x   (bundle standalone Windows)
uv 0.4.x          (gestión de dependencias reproducible, lock file)
```

**Riesgos:**
- PyInstaller produce binarios de ~15–50 MB que pueden tardar en arrancar (cold start) en Windows.
  Mitigación: usar `--onefile` con `--strip` para reducir tamaño.
- Sin formateador Java nativo: la legibilidad del código depende de la disciplina de las plantillas.
- `set` no ordenado en Python: requiere disciplina en el código para usar `sorted()` en todos los loops
  sobre datos del modelo. Un bug aquí rompe la reproducibilidad de forma silenciosa.

---

### Alternativa C — Java 21 + JTE (Java Template Engine) *(descartada como primera opción)*

**Razón del descarte:** JTE es el motor de plantillas más seguro para generar Java (templates tipadas,
escape context-aware, no evalúa expresiones arbitrarias). Sin embargo, el generador CLI necesita un
wrapper Maven/Gradle para compilar y distribuir, lo que añade complejidad de bootstrap en P2-003 antes
de tener ninguna funcionalidad. La ventaja de usar el mismo lenguaje que el código generado (Java) no
compensa ese coste en la Fase 2 del parcial.

Se documenta como alternativa válida para una segunda versión si el equipo ya tiene infraestructura
Java configurada (ej. tras P2-004/P2-005).

---

## Decisión propuesta

**Alternativa A — Node.js 22 LTS + TypeScript + Handlebars.js**

Justificación:
1. Distribución CLI sin instalación global mediante `npx` (versión fijada en `package-lock.json`).
2. El runtime Node.js está disponible en el entorno Windows 11 del pipeline (PowerShell 7).
3. Handlebars garantiza que las plantillas no ejecutan lógica arbitraria del modelo; los helpers
   son funciones TypeScript puras y testeables.
4. Vitest permite pruebas golden del árbol de salida byte a byte con `toMatchFileSnapshot`.
5. La normalización canónica de la entrada (arrays ya ordenados por el contrato v1 §4.2) elimina
   la principal fuente de no-determinismo sin requerir lógica extra en el generador.
6. El bundle `ncc` produce un único archivo `dist/bundle.js` sin dependencias externas, compatible
   con el requisito de generación sin red.

La Alternativa B (Python + Jinja2) es aceptable como fallback si Node.js resulta no estar disponible
en algún entorno de CI del pipeline Orca.

---

## Reproducibilidad

### Condiciones de reproducibilidad (conforme al contrato v1 §4.1)

Dos ejecuciones del generador implementado con la Alternativa A son byte a byte idénticas si y solo si:

1. `domain-model.json` está normalizado en orden canónico (§4.2 del contrato v1).
2. La configuración de generación (§3.2 del contrato v1) es idéntica campo a campo.
3. El `templateSetId` y el contenido de las plantillas en `templates/spring-boot/` son idénticos.
4. La versión del generador (`generatorVersion`) es idéntica.

### Fuentes de no-determinismo controladas

| Fuente | Control en Alternativa A |
|---|---|
| Orden de arrays del modelo | Garantizado por normalización canónica del contrato v1 antes de llegar a las plantillas. |
| Iteración sobre objetos JS | El código del generador itera únicamente sobre arrays (ya ordenados), nunca sobre `Object.keys()` sin ordenación explícita. |
| Fecha/hora del sistema | `Date.now()` y `new Date()` prohibidos en la lógica de generación de contenido; enforced por regla ESLint personalizada. |
| UUIDs en tiempo de ejecución | `crypto.randomUUID()` prohibido en la lógica de generación. |
| Concurrencia | La generación es síncrona; Node.js no introduce concurrencia en código síncrono. |

### Verificación objetiva de reproducibilidad

```powershell
# Protocolo de verificación ejecutable desde la raíz del repositorio:
node services/generator-cli/dist/bundle.js `
  --model fixtures/models/valid-minimal.json `
  --output out/golden-run1 `
  --config fixtures/generator-config-minimal.json

node services/generator-cli/dist/bundle.js `
  --model fixtures/models/valid-minimal.json `
  --output out/golden-run2 `
  --config fixtures/generator-config-minimal.json

$manifest1 = Get-Content out/golden-run1/generation-manifest.json -Raw
$manifest2 = Get-Content out/golden-run2/generation-manifest.json -Raw
if ($manifest1 -eq $manifest2) {
    Write-Host "PASS: manifests are byte-for-byte identical"
} else {
    Write-Error "FAIL: manifests differ"
    exit 1
}
```

Los sha256 del manifiesto cubren todos los archivos generados; si los manifiestos son idénticos, toda
la salida es idéntica (contrato v1 §4.4).

---

## Comandos

### Build

```powershell
# Instalar dependencias (solo necesario una vez o tras cambios en package.json):
npm ci --prefix services/generator-cli

# Compilar TypeScript a JS:
npm run build --prefix services/generator-cli

# Producir bundle standalone sin node_modules:
npm run bundle --prefix services/generator-cli
# Produce: services/generator-cli/dist/bundle.js
```

### Test

```powershell
# Ejecutar suite de pruebas (unit + golden):
npm run test --prefix services/generator-cli
# Equivalente con vitest en modo single-run (sin watch):
npx --prefix services/generator-cli vitest run
```

### Lint

```powershell
npm run lint --prefix services/generator-cli
```

### Validación de reproducibilidad (CI)

```powershell
# Definido en scripts/validate-reproducibility.ps1 (por implementar en P2-003):
pwsh -File scripts/validate-reproducibility.ps1 `
  -Model fixtures/models/valid-minimal.json `
  -Config fixtures/generator-config-minimal.json
```

### Ejecución del generador

```powershell
# Con bundle (sin node_modules):
node services/generator-cli/dist/bundle.js `
  --model <ruta-al-modelo> `
  --output <directorio-salida> `
  --config <ruta-al-config-json>

# Con npx (versión fijada, requiere red en primera descarga):
npx generator-cli@1.0.0 `
  --model <ruta-al-modelo> `
  --output <directorio-salida> `
  --config <ruta-al-config-json>
```

### Requisitos de entorno

| Herramienta | Versión mínima | Verificación |
|---|---|---|
| Node.js | 22.x LTS | `node --version` |
| npm | 10.x | `npm --version` |
| PowerShell | 7.x | `$PSVersionTable.PSVersion` |
| Git | 2.x | `git --version` |

---

## Consecuencias

### Si el Product Owner aprueba esta ADR (Alternativa A)

- `services/generator-cli/` se inicializa como paquete npm con TypeScript, Handlebars y Vitest.
  P2-003 puede comenzar inmediatamente.
- `templates/spring-boot/` contiene archivos `.hbs` versionados; sus salidas en
  `fixtures/generated-projects/` son regenerables y no se editan manualmente (invariante de
  ARCHITECTURE.md).
- El pipeline Orca requiere Node.js 22 LTS disponible en el entorno Windows 11. Si no está
  instalado, P2-003 debe incluir un paso de bootstrap documentado.
- Las pruebas golden de Vitest (`toMatchFileSnapshot`) actúan como barrera objetiva de
  reproducibilidad en CI.
- La pregunta abierta Q3 del contrato v1 (UUID con `@GeneratedValue` vs `@UuidGenerator`) queda
  abierta hasta que se elija la versión de Hibernate; se decide en P2-004.
- El `templateSetId` v1 se resuelve como ruta local relativa a `templates/spring-boot/`; la pregunta
  Q1 del contrato se cierra con esta decisión.

### Si el Product Owner rechaza la Alternativa A y elige la Alternativa B (Python + Jinja2)

- `services/generator-cli/` se inicializa como paquete Python con `uv` y `pyproject.toml`.
- El entorno Windows 11 requiere Python 3.12 y `uv`; bootstrap documentado en P2-003.
- Los riesgos de `set` no ordenado se mitigan con `sorted()` obligatorio en todos los loops y
  revisión de Antigravity antes de aceptar P2-003.
- Los comandos de build/test cambian a `uv run pytest` y `uv build`.

### Riesgos y mitigaciones (Alternativa A)

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Node.js no disponible en CI Orca | Baja (Windows 11 con nvm/winget) | Alto | Documentar bootstrap en P2-003; añadir check en `orca.ps1`. |
| Handlebars genera entidades HTML (`&lt;`) en código Java | Media | Medio | Usar `{{{ }}}` o helper `java` sin escape; test golden detecta entidades HTML. |
| `ncc` bundle no resuelve plantillas `.hbs` externas | Media | Alto | Empaquetar plantillas como strings literales en el bundle o usar `require` con assets. Alternativa: distribuir `templates/` junto al bundle. |
| Versión de Node.js en producción difiere de CI | Baja | Medio | Fijar versión en `.nvmrc` y en `engines` de `package.json`. |

---

## Estado y próximos pasos

Esta ADR se encuentra en estado `accepted` tras la aprobación de la Alternativa A por el Product Owner.

Próximos pasos:
1. Abrir P2-003 con el toolchain confirmado (Node.js + TS + Handlebars).

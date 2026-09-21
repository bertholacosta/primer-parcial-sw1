# Entrega reproducible del examen

## Alcance

La aceptación final integra, sin modificar artefactos generados, las suites versionadas de P9-001, P9-002 y P9-003. Demuestra el circuito determinista del modelo al descriptor Flutter, el escenario móvil/offline y el subconjunto XMI con convergencia de dos clientes. No amplía contratos ni decisiones arquitectónicas.

## Entorno verificado

Validación ejecutada el 2026-09-21 en Windows 11 (`amd64`) con:

- PowerShell 7.6.6.
- Git 2.54.0.windows.1.
- Node.js 24.16.0 y npm 11.13.0.
- Apache Maven 3.9.16 y Oracle Java 26.0.2.1.
- Flutter 3.47.4 stable, Dart 3.13.3 y DevTools 2.60.0.

Estas son las versiones verificadas, no un rango de compatibilidad. La matriz imprime las versiones efectivas al comienzo de cada ejecución.

## Ejecución desde checkout limpio

1. Clonar o crear un worktree del commit entregable y entrar en la raíz.
2. Ejecutar `git status --short`; el resultado debe estar vacío. Si no lo está, se usa otro checkout sin borrar cambios existentes.
3. Confirmar que `git`, `pwsh`, `node`, `npm`, `mvn` y `flutter` están disponibles en `PATH`.
4. Ejecutar:

   ```powershell
   git diff --check
   pwsh -NoProfile -File scripts/validate-exam-matrix.ps1
   ```

Las suites resuelven dependencias, compilan los paquetes necesarios y escriben salidas ignoradas por Git. Al terminar, `git status --short` debe continuar vacío.

## Demostración

1. Mostrar el commit con `git rev-parse HEAD` y el estado limpio con `git status --short`.
2. Ejecutar `pwsh -NoProfile -File scripts/validate-exam-matrix.ps1` sin editar modelos, fixtures ni salidas generadas.
3. En P9-001, mostrar carga del modelo, validación `domain-model` v1, dos generaciones equivalentes, comparación con el golden, compilación Maven y descriptor Flutter válido.
4. En P9-002, mostrar recarga del snapshot sin red, operación preservada tras reinicio y reintento con un solo `operationId` y cero duplicados.
5. En P9-003, mostrar round-trip del corpus XMI, rechazo `CONCURRENT_MODIFICATION`, catch-up tras reconexión y clientes `IN_SYNC` con el mismo SHA-256.
6. Aceptar la demostración únicamente si aparece `MATRIZ DE ACEPTACIÓN FINAL: 100% COMPLETADA EXITOSAMENTE` y el proceso termina con código 0.

Evidencia temporal regenerable e ignorada por Git:

- P9-001: `fixtures/generated-projects/.work/e2e/`.
- P9-002: `apps/mobile-flutter/build/mobile-offline-acceptance/evidence.json`.
- P9-003: `.validation/xmi-collaboration/evidence.json`.

## Limitaciones y riesgos residuales

- La matriz ejecuta la aceptación móvil host-side. El paso en emulador o dispositivo Android es opcional mediante `pwsh -NoProfile -File scripts/validate-mobile-offline.ps1 -WithDevice`; la matriz no certifica hardware, fabricantes ni versiones concretas de Android.
- El paso Android opcional instala la aplicación, activa modo avión, reinicia y obtiene `logcat`, pero no convierte ese log en una aserción automatizada adicional.
- La aceptación XMI cubre únicamente el corpus y `xmi-profile-v1`; no implica compatibilidad con todo UML 2.5+ ni con extensiones no declaradas de Enterprise Architect.
- La colaboración usa una traza determinista de dos clientes. No certifica transporte real, latencia, particiones prolongadas, carga ni más participantes.
- Un checkout sin cachés requiere acceso a repositorios externos. Su indisponibilidad puede impedir el arranque aunque el código no cambie.
- En la ejecución verificada, `npm audit` informó dependencias con severidad moderada. La aceptación funcional no es una auditoría de seguridad ni resuelve esos avisos.
- La matriz no incluye una aceptación específica de voz o IA local Android; esas capacidades no deben presentarse como certificadas por P9-001, P9-002 o P9-003.
- La compatibilidad comprobada se limita al toolchain listado; otras versiones requieren ejecutar nuevamente toda la matriz.

## Aprobación

El Product Owner debe aceptar explícitamente estas limitaciones y riesgos antes de integrar P9-004. La revisión independiente debe comprobar las dos validaciones declaradas y el cumplimiento del alcance versionado en la tarea.

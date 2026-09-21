# Ecosistema CASE UML

Este repositorio implementa el circuito verificable `UML → modelo canónico validado → generador Spring Boot → API y metadatos → Flutter dinámico` descrito en [`docs/PROJECT.md`](docs/PROJECT.md).

## Requisitos mínimos

- Windows 11 con PowerShell 7.
- Git, Node.js, npm, Maven con Java y Flutter disponibles en `PATH`.
- Acceso a los repositorios de dependencias cuando las cachés locales estén vacías.

## Aceptación reproducible del examen

Desde un checkout limpio, en la raíz del repositorio:

```powershell
git diff --check
pwsh -NoProfile -File scripts/validate-exam-matrix.ps1
```

La matriz muestra las versiones efectivas del toolchain y ejecuta las aceptaciones e2e, móvil/offline y XMI/colaboración. La preparación completa, el guion de demostración, los resultados esperados y los riesgos residuales se documentan en [`docs/EXAM_DELIVERY.md`](docs/EXAM_DELIVERY.md).

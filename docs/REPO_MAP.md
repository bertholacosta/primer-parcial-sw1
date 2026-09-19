# Mapa del repositorio

Solo deben inspeccionarse los módulos vinculados desde la tarea asignada.

```text
apps/
  case-web/                 Editor CASE web (tecnología pendiente)
  mobile-flutter/           Cliente dinámico, Android y offline
services/
  model-server/             API y coordinación del modelo (tecnología pendiente)
  generator-cli/            Entrada y orquestación del generador determinista
packages/
  domain-model/             Contrato canónico versionado
  domain-validator/         Validación y diagnósticos deterministas
  xmi-adapter/              Compatibilidad XMI/Enterprise Architect
  collaboration-protocol/   Comandos y protocolo de colaboración
templates/
  spring-boot/              Plantillas; las salidas no se editan manualmente
fixtures/
  models/                   Modelos válidos e inválidos de prueba
  xmi/                      Corpus XMI
  generated-projects/       Golden files o resultados controlados de pruebas
docs/
  adr/                      Decisiones aceptadas y propuestas pendientes
  contracts/                Contratos entre módulos y formatos versionados
tasks/
  backlog/                  Tareas planificadas aún no ejecutables
  ready/                    Tareas especificadas y desbloqueadas o con dependencias declaradas
  active/                   Tareas asignadas: una por rama/worktree/escritor
  done/                     Tareas aceptadas con evidencia
scripts/                    Validaciones y automatización del repositorio
tests/orca/                 Pruebas unitarias del orquestador PowerShell
orca.ps1                    Entrada del pipeline multiagente
```

Los README de cada módulo definen responsabilidad y límites actuales; no implican elección tecnológica.

`.orca/` contiene estado, locks, sesiones y logs locales del pipeline; es recuperable pero no se versiona.

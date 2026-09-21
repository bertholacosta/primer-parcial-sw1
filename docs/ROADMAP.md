# Roadmap y backlog

Los identificadores son estables. Las especificaciones ejecutables viven como archivos independientes en `tasks/ready/` y declaran dependencias, límites, aceptación, validaciones y entregables.

## Fase 0 — Gobierno y contratos

Estado: baseline aprobada; automatización multiagente en ejecución.

- `P0-001`: establecer gobierno, memoria, estructura y backlog inicial.
- `P0-002`: automatizar el pipeline multiagente de Orca en Windows 11.

Salida: reglas de agentes, arquitectura de referencia, ADR fundacional, propuestas pendientes, mapa del repositorio, contrato de tareas y backlog versionado.

## Fase 1 — Modelo canónico y validador

- `P1-001`: especificar el contrato mínimo del modelo canónico.
- `P1-002`: resolver ADR de representación y validación.
- `P1-003`: implementar esquema versionado y validador mínimo.
- `P1-004`: crear corpus de conformidad y diagnósticos estables.

Cierre: un modelo mínimo válido se acepta y variantes inválidas fallan con diagnósticos reproducibles.

## Fase 2 — Generador Spring Boot

- `P2-001`: especificar contrato de generación y reproducibilidad.
- `P2-002`: resolver ADR de implementación del generador.
- `P2-003`: implementar núcleo CLI y escritura segura.
- `P2-004`: implementar las cinco capas y persistencia JPA/PostgreSQL.
- `P2-005`: compilar fixture generado y producir descriptor Flutter.

Cierre: el mismo fixture genera salida equivalente, compila y contiene Controller, Service, Repository, Entity y DTO.

## Fase 3 — Runtime Flutter dinámico y offline

- `P3-001`: especificar descriptor, compatibilidad y semántica offline.
- `P3-002`: resolver ADR de estado y almacenamiento local.
- `P3-003`: implementar carga y renderizado dinámico mínimo.
- `P3-004`: implementar persistencia y cola offline mínima.

Cierre: Android representa y edita el fixture desde metadatos y conserva operaciones sin red.

## Fase 4 — Diagramador CASE manual

- `P4-001`: especificar interacción y comandos del editor.
- `P4-002`: resolver ADR de tecnología CASE web.
- `P4-003`: renderizar clases desde el modelo canónico.
- `P4-004`: editar atributos mediante comandos validados.
- `P4-005`: crear asociaciones mediante comandos validados.

Cierre: una edición manual se expresa como comando validado y actualiza el modelo canónico.

## Fase 5 — Adaptador XMI

- `P5-001`: definir perfil Enterprise Architect y corpus XMI.
- `P5-002`: implementar importación mínima.
- `P5-003`: implementar exportación y pruebas de ida y vuelta.

Cierre: el subconjunto declarado importa y exporta sin pérdida semántica conocida.

## Fase 6 — Colaboración en tiempo real

- `P6-001`: especificar protocolo y consistencia de comandos.
- `P6-002`: resolver ADR de colaboración.
- `P6-003`: implementar sincronización mínima de dos clientes.

Cierre: dos clientes convergen en el mismo modelo ante la secuencia de prueba.

## Fase 7 — Voz, imágenes y onboarding inteligente

- `P7-001`: especificar contrato de propuestas multimodales.
- `P7-002`: implementar adaptador mínimo de voz sin mutación directa.
- `P7-003`: implementar adaptador mínimo de imagen sin mutación directa.
- `P7-004`: implementar onboarding guiado por propuestas confirmables.

Cierre: cada entrada produce una propuesta auditable que requiere validación/confirmación.

## Fase 8 — IA local móvil

- `P8-001`: resolver ADR de runtime local Android.
- `P8-002`: integrar reconocimiento de voz local Android.
- `P8-003`: integrar propuestas de IA local Android.

Cierre: el escenario Android acordado funciona sin red y no elude el validador.

## Fase 9 — Integración, pruebas del examen y endurecimiento

- `P9-001`: automatizar el circuito determinista de extremo a extremo.
- `P9-002`: automatizar aceptación móvil y offline.
- `P9-003`: automatizar aceptación XMI y colaboración.
- `P9-004`: endurecer reproducibilidad, documentación y entrega del examen.

Cierre: todas las pruebas del examen pasan desde un checkout limpio y la entrega es reproducible.

## Fase 10 — Identidad y colaboración persistente

- `P10-001`: especificar identidad, acceso y compartición.
- `P10-002`: resolver ADR de identidad y colaboración persistente.
- `P10-003`: incorporar runtime HTTP y migraciones PostgreSQL.
- `P10-004`: implementar autenticación por correo y contraseña.
- `P10-005`: implementar propiedad y membresías de diagramas.
- `P10-006`: implementar invitaciones por correo y enlace.
- `P10-007`: persistir modelos y estado de colaboración.
- `P10-008`: exponer colaboración mediante WebSocket/STOMP.
- `P10-009`: integrar identidad y compartición en `case-web`.
- `P10-010`: integrar coedición simultánea en `case-web`.
- `P10-011`: verificar colaboración autenticada extremo a extremo.

Cierre: owner y editor construyen simultáneamente un diagrama persistente, viewer observa sin mutar y la sesión se recupera tras desconexión y reinicio.

## Camino crítico inicial

`P1-001 → P1-002 → P1-003 → P1-004 → P2-001 → P2-002 → P2-003 → P2-004 → P2-005 → P3-001 → P3-003 → P9-001`

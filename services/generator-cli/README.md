# Generator CLI

Núcleo del generador determinista de Spring Boot (contrato
`generator-input-output` v1, ADR-0002: Node.js 22 + TypeScript + Vitest, ESM).

## Alcance implementado (P2-003, P2-004, P2-005)

Pipeline seguro de generación completa:

1. **Lectura**: `domain-model.json` y fichero de configuración JSON.
2. **Validación**: `contractVersion` del modelo (`UNSUPPORTED_MODEL_CONTRACT_VERSION`)
   y validador canónico `domain-validator` (`INVALID_MODEL` con diagnósticos).
3. **Planificación ordenada**: rutas de las cinco capas por clase según §6
   (nombres Java, paquetes, desambiguación de colisiones → `NAME_COLLISION`) y
   plan de escritura ordenado por ruta que rechaza rutas fuera del destino.
4. **Escritura atómica**: staging + rename; ante cualquier error no queda
   salida parcial en `outputDir` (§9.1).

Salida actual de una ejecución válida: proyecto Maven con las cinco capas por
clase (`entity`, `dto`, `repository`, `service`, `controller`), `pom.xml`,
`application.yml`, `Application.java`, `flutter-descriptor.json` conforme al
contrato `flutter-descriptor` v1 y `generation-manifest.json` conforme a §5.2
(cuya entrada `files` incluye el descriptor).

## Pendiente por diseño (tareas posteriores)

- Resolución de `templateSetId` (`TEMPLATE_SET_NOT_FOUND`): por ahora es un
  identificador obligatorio que solo se registra en el manifiesto; las
  plantillas se cargan desde `templates/spring-boot/`.

## Códigos de error

Catálogo §9.2 del contrato, códigos del contrato `flutter-descriptor` v1 §8.1
(`DESCRIPTOR_WRITE_ERROR` — fallo de escritura del descriptor;
`DESCRIPTOR_TYPE_MAPPING_ERROR` — tipo de atributo sin mapeo `uiType`) más
extensiones documentadas pendientes de revisión menor del contrato (§12.1):
`INVALID_CONFIG` (configuración ilegible o campos obligatorios ausentes),
`INVALID_OUTPUT_PATH` (ruta vacía o duplicada en el plan),
`PATH_OUTSIDE_OUTPUT_DIR` (ruta absoluta o que escapa del destino) e
`INTERNAL_ERROR` (excepción no catalogada).

## Comandos

```powershell
npm install --prefix services/generator-cli
npm run build --prefix services/generator-cli   # compila también domain-model y domain-validator
npm run test --prefix services/generator-cli
node services/generator-cli/dist/index.js --model <modelo.json> --output <dir> --config <config.json>
```

En error, el informe §9.3 se emite en `stderr` y en `generation-error.json`
(directorio de trabajo); código de salida `1`. Argumentos inválidos: `2`.

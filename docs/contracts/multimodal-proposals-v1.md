# Contrato de propuestas multimodales — `multimodal-proposals` v1

- **Versión del contrato:** 1.0.0
- **Estado:** accepted
- **Fecha:** 2026-09-21
- **Autoridad:** Product Owner (ADR-0000, Invariante 7)
- **Depende de:** `docs/contracts/model-commands-v1.md` (v1.0.0), `docs/contracts/domain-model-v1.md` (contractVersion "1")

---

## 1. Propósito y alcance

Este contrato define el mecanismo formal mediante el cual entradas no estructuradas y probabilísticas (voz, imágenes de diagramas o bocetos, prompts de lenguaje natural e inferencias de modelos de Inteligencia Artificial) se transforman en **propuestas auditables y deterministas** de comandos de edición (`model-commands`) para el editor CASE.

El sistema CASE opera bajo un principio arquitectónico no negociable: **separación estricta entre la inferencia probabilística y la mutación determinista del modelo**. Los modelos de IA (locales o en la nube), los motores de transcripción por voz y los analizadores de visión por computadora son inherentemente heurísticos; por tanto, **ninguna entrada multimodal puede mutar directamente el modelo canónico ni evadir el validador**.

Este contrato garantiza el cumplimiento de las invariantes del sistema (`docs/ARCHITECTURE.md`):
- **Invariante 1:** Toda representación externa se convierte al modelo canónico antes de generar.
- **Invariante 2:** Una entrada inválida no produce código parcial aceptable.
- **Invariante 7:** Las propuestas de IA no mutan estado hasta superar validación determinista.

Toda propuesta multimodal (`MultimodalProposal`) es un artefacto inmutable y auditable que encapsula:
1. El **origen** de la captura y el agente/modelo extractor.
2. La métrica de **confianza** (global, por comando y por campo inferido).
3. Las **evidencias** auditables (hashes criptográficos, transcripciones de voz con marcas temporales, bounding boxes sobre imágenes).
4. La lista ordenada de **comandos propuestos** (`model-commands` v1).
5. El resultado de la **validación previa** (dry-run) ejecutada deterministamente.
6. El ciclo de vida de **confirmación o rechazo** controlado por el usuario.

---

## 2. Invariantes del contrato

| Invariante | Nombre | Descripción |
|---|---|---|
| **MP-INV-1** | **Cero mutación directa** | Ningún agente de IA, servicio multimodal o transcriptor tiene permisos de escritura sobre `domain-model.json`. Solo el procesador de `model-commands-v1` puede mutar el modelo tras una confirmación autorizada. |
| **MP-INV-2** | **Puerta determinista obligatoria** | Ningún comando propuesto puede ser presentado para confirmación ni aplicado al modelo sin someterse a una validación previa ("dry-run") contra el validador canónico y las precondiciones de `model-commands-v1`. |
| **MP-INV-3** | **Confirmación explícita (Humano en el bucle)** | Ninguna propuesta se aplica automáticamente al modelo. Requiere una acción explícita de confirmación (total o parcial) por parte del usuario humano o de una política de automatización expresamente autorizada en `docs/PROJECT.md`. |
| **MP-INV-4** | **Trazabilidad y evidencia auditable** | Todo comando propuesto debe vincularse obligatoriamente a una evidencia comprobable (fragmento temporal de audio o bounding box de imagen) y a una puntuación de confianza calculada. |
| **MP-INV-5** | **Privacidad por diseño y minimización** | Los datos biométricos crudos (grabaciones de voz, fotografías completas de alta resolución) nunca se incrustan en el modelo de dominio ni en los metadatos permanentes del repositorio. Solo se conservan hashes criptográficos y transcripciones/regiones acotadas. |
| **MP-INV-6** | **Inmutabilidad de la propuesta** | Una propuesta generada posee un identificador único inmutable. Si el usuario desea editar los comandos antes de confirmar, se emite una confirmación parcial o una nueva versión de la propuesta revalidada. |

---

## 3. Estructura de la propuesta multimodal (`MultimodalProposal`)

El esquema canónico de un objeto `MultimodalProposal` se define a continuación:

```json
{
  "proposalId": "string (UUID v4)",
  "contractVersion": "1.0.0",
  "modelId": "string (id del modelo objetivo)",
  "targetModelVersion": "string (semver esperado, e.g. 1.0.0)",
  "createdAt": "string (ISO 8601 UTC)",
  "lifecycleState": "proposed | dry_run_validated | awaiting_confirmation | confirmed | partially_confirmed | rejected | expired",
  "source": {
    "modality": "voice | image | multimodal | text_prompt",
    "clientPlatform": "android | case_web | cli",
    "agentRole": "string (identificador del extractor/modelo, e.g. gemini-nano-local, cloud-vision-v1)",
    "capturedAt": "string (ISO 8601 UTC)"
  },
  "confidence": {
    "overall": "number (0.00 a 1.00)",
    "level": "HIGH | MEDIUM | LOW",
    "breakdown": [
      {
        "commandIndex": "integer (índice 0-based en proposedCommands)",
        "score": "number (0.00 a 1.00)",
        "fieldScores": {
          "fieldName": "number (0.00 a 1.00)"
        }
      }
    ]
  },
  "evidences": [
    {
      "evidenceId": "string (UUID v4)",
      "type": "audio_segment | bounding_box | text_transcript | inference_rationale",
      "mediaSha256": "string (hash criptográfico de la entrada cruda)",
      "payload": {
        "textTranscript": "string (opcional: transcripción de voz asociada)",
        "audioTimeRange": {
          "startMs": "integer",
          "endMs": "integer"
        },
        "boundingBox": {
          "ymin": "number (0.0 a 1.0)",
          "xmin": "number (0.0 a 1.0)",
          "ymax": "number (0.0 a 1.0)",
          "xmax": "number (0.0 a 1.0)"
        },
        "description": "string (justificación o elemento visual identificado)"
      }
    }
  ],
  "intent": {
    "summary": "string (descripción en lenguaje natural de la intención detectada)",
    "rawPrompt": "string (prompt original o transcripción completa cruda)"
  },
  "proposedCommands": [
    {
      "type": "string (Comando válido de model-commands-v1)",
      "commandId": "string (UUID v4)",
      "modelId": "string",
      "modelVersion": "string",
      "payload": {}
    }
  ],
  "dryRunValidation": {
    "validationStatus": "VALID | INVALID | WARNINGS",
    "validatedAt": "string (ISO 8601 UTC)",
    "errors": [
      {
        "commandIndex": "integer",
        "code": "string (código de error de model-commands-v1 o domain-validator)",
        "path": "string (JSONPath a la anomalía)",
        "message": "string",
        "severity": "ERROR"
      }
    ],
    "warnings": [
      {
        "commandIndex": "integer",
        "code": "string",
        "path": "string",
        "message": "string",
        "severity": "WARNING"
      }
    ]
  },
  "resolution": {
    "resolvedAt": "string (ISO 8601 UTC, nulo mientras esté pendiente)",
    "resolvedBy": "string (identificador del usuario o agente)",
    "action": "confirm_all | confirm_selection | reject | expire",
    "acceptedCommandIds": ["string"],
    "rejectedCommandIds": ["string"],
    "rejectionReason": "string (opcional)"
  }
}
```

### 3.1 Detalle de campos

#### 3.1.1 Origen (`source`)
Declara el canal de entrada y el entorno donde se capturaron los datos no estructurados:
- `modality`:
  - `"voice"`: Grabación o flujo de audio con instrucciones habladas.
  - `"image"`: Fotografía de pizarra, boceto en papel, diagrama conceptual o captura visual.
  - `"multimodal"`: Entrada combinada (e.g. fotografía de diagrama anotada verbalmente mediante voz).
  - `"text_prompt"`: Solicitud interactiva en lenguaje natural al asistente de IA.
- `clientPlatform`: Plataforma cliente emisora (`"android"`, `"case_web"`, `"cli"`).
- `agentRole`: Identificador del componente que ejecutó la inferencia (e.g., `"ondevice-whisper-small"`, `"android-gemini-nano"`, `"cloud-vision-multimodal"`).
- `capturedAt`: Marca temporal de captura en el cliente emisor.

#### 3.1.2 Confianza (`confidence`)
Cuantifica la certidumbre probabilística de la extracción:
- `overall`: Puntuación agregada entre `0.00` (incertidumbre total) y `1.00` (certeza absoluta). Corresponde al promedio ponderado de los comandos individuales.
- `level`: Clasificación cualitativa:
  - `HIGH` ($\ge 0.85$): La IA identificó la estructura y tipos con alta fidelidad. Apto para revisión rápida.
  - `MEDIUM` ($0.60 \le x < 0.85$): Certidumbre intermedia; algunos atributos, nombres o multiplicidades fueron inferidos por contexto. Requiere inspección visual atenta.
  - `LOW` ($< 0.60$): Ruido visual/acústico significativo o ambigüedad semántica alta. El cliente debe advertir al usuario y sugerir revisión minuciosa campo por campo o re-captura.
- `breakdown`: Desglose detallado por comando propuesto (`commandIndex`) y por campo del payload (`fieldScores`), permitiendo resaltar en la UI exactamente qué propiedades tienen baja certidumbre.

#### 3.1.3 Evidencias (`evidences`)
Elementos auditables que fundamentan cada comando propuesto:
- `evidenceId`: Identificador único de la evidencia.
- `type`:
  - `audio_segment`: Rango de tiempo de voz asociado (`startMs`, `endMs`) y su texto transcrito.
  - `bounding_box`: Coordenadas relativas normalizadas (`ymin`, `xmin`, `ymax`, `xmax`) en el rango `[0.0, 1.0]` sobre la imagen fuente donde se detectó el elemento (clase, atributo o relación).
  - `text_transcript`: Fragmento de texto crudo.
  - `inference_rationale`: Explicación sintética generada por el extractor indicando por qué se propuso la operación.
- `mediaSha256`: Hash SHA-256 del archivo binario original (audio o imagen), garantizando que cualquier auditoría posterior verifique la correspondencia unívoca sin obligar a persistir el archivo binario pesado en el modelo canónico.

#### 3.1.4 Comandos propuestos (`proposedCommands`)
Lista estrictamente ordenada de comandos que satisfacen la estructura y nomenclatura de `docs/contracts/model-commands-v1.md`.
- Cada comando incluye su `type` (`CreateClass`, `AddAttribute`, `CreateAssociation`, etc.), su `commandId` (UUID v4), `modelId`, `modelVersion` y `payload`.
- Los comandos deben ser idempotentes y ordenados topológicamente (e.g., un `CreateClass` debe preceder obligatoriamente a los comandos `AddAttribute` correspondientes a dicha clase y a cualquier `CreateAssociation` que la referencie).

#### 3.1.5 Validación previa en simulación (`dryRunValidation`)
Resultado de evaluar la secuencia de `proposedCommands` contra una copia en memoria del modelo canónico en su versión actual (`targetModelVersion`), utilizando el motor determinista de `domain-validator` y `model-commands`:
- `validationStatus`:
  - `VALID`: Todos los comandos superaron las precondiciones sin errores ni advertencias.
  - `WARNINGS`: Todos los comandos son aplicables, pero existen advertencias semánticas no bloqueantes (e.g. `NULLABLE_REQUIRED_CONFLICT`).
  - `INVALID`: Al menos un comando falló alguna precondición (e.g. `DUPLICATE_CLASS_NAME`, `UNKNOWN_TYPE`, `SELF_ASSOCIATION_NOT_ALLOWED`).
- `errors` y `warnings`: Arreglo estructurado de diagnósticos con el índice del comando culpable, código canónico, ruta JSONPath y mensaje explicativo.

---

## 4. Ciclo de vida y estados de la propuesta

El ciclo de vida de una propuesta multimodal garantiza que el modelo nunca mute hasta que exista validación determinista y confirmación de usuario:

```text
       [Captura Voz / Imagen / Prompt]
                      |
                      v
             +-----------------+
             | 1. proposed     |  (Inferencia completada, propuesta creada)
             +-----------------+
                      |
                      | Ejecutar simulación determinista (dry-run)
                      v
             +-----------------+
             | 2. validated    |  (dry_run_validated: VALID, WARNINGS o INVALID)
             +-----------------+
                      |
           +----------+----------+
           |                     |
     (Si es INVALID)       (Si es VALID o WARNINGS)
           |                     |
           v                     v
    +--------------+    +---------------------------+
    | 4b. rejected |    | 3. awaiting_confirmation  | (Presentada en UI/CLI)
    | (Automático) |    +---------------------------+
    +--------------+         |           |        |
                             |           |        | (Si modelVersion cambió)
               +-------------+           |        v
               | (Confirmar)             |   +-------------+
               v                         |   | 4c. expired |
     +---------------------+             |   +-------------+
     | 4a. confirmed       |             |
     | (o partial_confirm) |             | (Rechazar manualmente)
     +---------------------+             v
               |                  +--------------+
               v                  | 4b. rejected |
   [Despacho a model-commands]    +--------------+
   [Mutación de domain-model]
```

### 4.1 Definición de estados

1. `proposed`: La propuesta ha sido extraída por el motor multimodal y encapsula los comandos inferidos, la confianza y las evidencias. Aún no ha sido sometida a validación.
2. `dry_run_validated`: Se ejecutó la validación previa ("dry-run") contra el estado actual del modelo canónico. Si la validación falla con errores críticos, el estado puede pasar directamente a `rejected` (con diagnóstico adjunto) o quedar marcado como `INVALID` para inspección del usuario.
3. `awaiting_confirmation`: La propuesta superó la validación determinista (con o sin advertencias) y se encuentra presentada al usuario en la interfaz visual, móvil o CLI para su inspección.
4. `confirmed`: El usuario aprobó la propuesta completa. Los comandos se despachan al procesador canónico de comandos para su ejecución y mutación definitiva del modelo.
5. `partially_confirmed`: El usuario aprobó solo un subconjunto de los comandos propuestos (o ajustó parámetros). El subconjunto seleccionado se revalida y, si es válido, se despacha a ejecución. Los comandos no aprobados quedan registrados como descartados.
6. `rejected`: El usuario rechazó la propuesta explícitamente, o el validador la descartó por violaciones insalvables de precondiciones. El modelo permanece intacto sin ninguna alteración.
7. `expired`: La propuesta quedó obsoleta debido a que otra operación de edición incrementó la versión del modelo canónico (`CONCURRENT_MODIFICATION`) antes de que el usuario confirmara. La propuesta debe re-simularse contra la nueva versión del modelo antes de poder confirmarse.

---

## 5. Modalidades de entrada y captura de evidencias

### 5.1 Modalidad de voz (`voice`)

#### 5.1.1 Flujo operativo
1. El usuario activa la captura de audio en el cliente (e.g. pulsador "Push to Talk" en Android o micrófono en el editor CASE web).
2. El cliente o el servicio local captura la señal de audio (PCM / WAV / AAC).
3. Un motor de transcripción fonética (preferentemente local en el dispositivo según `ADR-0005`, e.g. Whisper On-Device o SpeechRecognizer del sistema operativo) produce la transcripción de texto crudo.
4. Un modelo de lenguaje acotado analiza la transcripción e identifica intenciones de modelado UML:
   - Identificación de clases (e.g. "crear clase Pedido", "nueva entidad Cliente").
   - Identificación de atributos y sus tipos primitivos (e.g. "con fecha de tipo DateTime no nulo", "atributo total de tipo Double").
   - Identificación de asociaciones (e.g. "un Cliente tiene muchos Pedidos", "asociar Factura con Item de uno a muchos").
5. Se calculan las marcas de tiempo (`audioTimeRange`) para cada entidad o comando detectado.
6. Se genera la propuesta con comandos `CreateClass`, `AddAttribute`, `CreateAssociation`, etc.

#### 5.1.2 Evidencia de voz requerida
- `mediaSha256`: Hash del buffer de audio procesado.
- `textTranscript`: Texto exacto transcrito de la locución.
- `audioTimeRange`: Rango milimétrico (`startMs` y `endMs`) del segmento de audio que originó cada comando.

---

### 5.2 Modalidad de imagen (`image`)

#### 5.2.1 Flujo operativo
1. El usuario captura o carga una imagen:
   - Fotografía de pizarra con diagrama de clases dibujado a mano.
   - Boceto a mano alzada en papel.
   - Captura de pantalla de un diagrama exportado o herramienta gráfica externa.
2. El motor de visión (on-device o servicio de inferencia autorizado) ejecuta:
   - Detección de cuadros/rectángulos (potenciales clases UML).
   - OCR dentro de los rectángulos para extraer nombre de clase y lista de atributos.
   - Detección de líneas/conectores entre cuadros para inferir asociaciones, puntas de flecha (navegabilidad) y etiquetas numéricas (multiplicidad).
3. Se normalizan las coordenadas de cada elemento detectado en bounding boxes relativos `[ymin, xmin, ymax, xmax]`.
4. Se asigna una puntuación de certidumbre a la detección de cada elemento y texto.
5. Se produce la lista ordenada de `proposedCommands` vinculando cada clase y relación a su respectivo bounding box.

#### 5.2.2 Evidencia de imagen requerida
- `mediaSha256`: Hash criptográfico de la imagen analizada.
- `boundingBox`: Coordenadas relativas normalizadas donde el modelo visual detectó el elemento.
- `description`: Etiqueta detectada por OCR / detector visual (e.g., `"Bloque de clase con encabezado 'Factura'"`).

---

### 5.3 Modalidad híbrida y de prompt textual (`multimodal` / `text_prompt`)

Cuando el usuario combina un boceto con una nota de voz aclaratoria (e.g. "en este diagrama cambia el tipo de saldo a Double y haz la relación bidireccional"), la propuesta fusiona ambas evidencias:
- Las evidencias incluyen tanto `boundingBox` como `audio_segment`.
- El campo `intent.summary` detalla la combinación de intenciones.
- Cada comando propuesto referencia el `evidenceId` correspondiente a la fuente primaria de dicha instrucción.

---

## 6. Políticas de privacidad y gobernanza de datos

El manejo de voz e imágenes conlleva riesgos inherentes de tratamiento de datos personales, biométricos y confidenciales del usuario y su organización. Por tanto, se establecen los siguientes lineamientos obligatorios:

### 6.1 Procesamiento local prioritario (On-Device First)
- Conforme a los principios de arquitectura (`docs/ARCHITECTURE.md`) y la propuesta de IA móvil local (`docs/adr/0005-android-local-ai.md`), la transcripción de voz y el procesamiento multimodal preliminar deben ejecutarse prioritariamente en el hardware del usuario (e.g., NPU / GPU local en Android mediante Gemini Nano o Whisper local; WebAssembly / ONNX Runtime local en el navegador).
- Si el procesamiento es local, **ningún byte de audio o imagen sale del dispositivo**.

### 6.2 Procesamiento en nube bajo consentimiento explícito (`opt-in`)
- Si el usuario solicita un procesamiento mediante modelos de nube (e.g. para modelos visuales de mayor capacidad), el sistema requiere consentimiento explícito previo del usuario (`opt-in` transparente).
- Toda transmisión hacia servicios externos debe efectuarse mediante canales seguros con TLS 1.3.
- Se exige contractualmente a los proveedores externos una política estricta de **no retención y no entrenamiento** (Zero-Data Retention for Model Training). Los buffers de medios deben destruirse en el servidor inmediatamente tras completar la inferencia.

### 6.3 Desacoplamiento de binarios pesados en el repositorio de modelos
- Las grabaciones de voz crudas (archivos WAV/MP3) y las fotografías de alta resolución **nunca se almacenan en el repositorio Git ni se incrustan en `domain-model.json`**.
- El contrato del modelo canónico almacena únicamente el resultado final de los comandos aceptados.
- La propuesta auditable almacena los hashes SHA-256 de las evidencias. La custodia de los archivos crudos (si el cliente decide almacenarlos para auditoría local de la sesión) permanece en el almacenamiento privado del cliente (`isolated local storage` de Android o almacenamiento de sesión temporal del navegador), con caducidad configurable.

### 6.4 Sanitización de información de identificación personal (PII)
- El extractor multimodal debe filtrar metadatos superfluos de la imagen (e.g., coordenadas GPS EXIF, modelo de cámara, marcas de agua) antes de procesar la entrada.
- En la transcripción de voz, cualquier comentario ajeno al metamodelo (e.g., nombres propios de personas que conversan de fondo, menciones personales) debe ser omitido del resumen de intención y de los comandos propuestos.

---

## 7. Catálogo consolidado de errores y diagnósticos

Los errores y advertencias en el subsistema multimodal se dividen en cuatro categorías operativas:

### 7.1 Errores de captura y preprocesamiento de medios (`MEDIA_*`)

| Código | Severidad | Descripción |
|---|---|---|
| `MEDIA_PAYLOAD_EMPTY` | ERROR | La entrada de audio o imagen se encuentra vacía (0 bytes). |
| `MEDIA_PAYLOAD_TOO_LARGE` | ERROR | El archivo supera el límite permitido (e.g. > 15 MB para imágenes, > 60 s para audio). |
| `IMAGE_FORMAT_UNSUPPORTED` | ERROR | Formato de imagen no soportado. Formatos admitidos: PNG, JPEG, WEBP, SVG. |
| `IMAGE_TOO_BLURRY` | ERROR | La imagen no supera el umbral de nitidez mínima; el texto de los diagramas es ilegible. |
| `IMAGE_RESOLUTION_TOO_LOW` | ERROR | Resolución insuficiente para segmentar cajas UML (inferior a 480x480 píxeles). |
| `AUDIO_TOO_NOISY` | ERROR | La relación señal/ruido del audio es insuficiente para obtener una transcripción inteligible. |
| `AUDIO_DURATION_EXCEEDED` | ERROR | La locución excede la duración máxima para un comando atómico (límite: 45 segundos). |

### 7.2 Errores de inferencia y extracción de IA (`INFERENCE_*`)

| Código | Severidad | Descripción |
|---|---|---|
| `INFERENCE_TIMEOUT` | ERROR | El motor de IA no respondió dentro del tiempo límite establecido (timeout: 10 s local, 20 s nube). |
| `INTENT_UNRECOGNIZED` | ERROR | El audio o imagen no contiene elementos comprensibles como clases, atributos o asociaciones UML. |
| `NO_COMMANDS_GENERATED` | ERROR | La IA procesó la entrada pero no pudo deducir ningún comando válido para el metamodelo v1. |
| `CONFIDENCE_BELOW_THRESHOLD` | ERROR | La confianza general calculada es menor al umbral mínimo de procesamiento seguro ($< 0.40$). |
| `AMBIGUOUS_ASSOCIATION_TARGET`| ERROR | Se detectó una relación visual o verbal pero no se pudo asociar con certeza a una clase existente. |

### 7.3 Errores de validación determinista (`VALIDATION_*`)

Estos errores se originan cuando los comandos propuestos por la IA son evaluados por la simulación ("dry-run") contra el procesador determinista de `model-commands-v1`:

| Código | Severidad | Origen | Descripción |
|---|---|---|---|
| `PROPOSED_COMMAND_SYNTAX_ERROR` | ERROR | Contrato | El payload del comando propuesto incumple la estructura exigida por `model-commands-v1`. |
| `DETERMINISTIC_PRECONDITION_FAILED` | ERROR | `model-commands` | Un comando propuesto falla una precondición (e.g., `DUPLICATE_CLASS_NAME`, `UNKNOWN_TYPE`). |
| `TARGET_VERSION_MISMATCH` | ERROR | Concurrencia | El modelo cambió de versión durante la inferencia; la propuesta debe actualizar su base. |
| `DEPENDENCY_ORDER_VIOLATION` | ERROR | Secuencia | Un comando depende de una entidad que un comando anterior no creó en el orden correcto. |
| `NULLABLE_REQUIRED_CONFLICT` | WARNING | `model-commands` | Advertencia no bloqueante: atributo con multiplicidad 1 y nullable true. |
| `NOT_NULLABLE_OPTIONAL_CONFLICT` | WARNING | `model-commands` | Advertencia no bloqueante: atributo con multiplicidad 0..1 y nullable false. |

### 7.4 Errores de ciclo de vida y resolución (`LIFECYCLE_*`)

| Código | Severidad | Descripción |
|---|---|---|
| `PROPOSAL_ALREADY_RESOLVED` | ERROR | Intento de confirmar o rechazar una propuesta que ya fue resuelta (`confirmed` o `rejected`). |
| `PROPOSAL_EXPIRED` | ERROR | Intento de confirmar una propuesta que ha caducado por concurrencia o tiempo de expiración. |
| `INVALID_COMMAND_SELECTION` | ERROR | En confirmación parcial, se seleccionó un comando con dependencias rotas (e.g. un `AddAttribute` sin su `CreateClass`). |
| `UNAUTHORIZED_CONFIRMATION` | ERROR | La acción de confirmación no fue emitida por un usuario o rol autorizado. |

---

## 8. Formato de las operaciones de confirmación y rechazo

### 8.1 Confirmación de propuesta (`ConfirmProposalRequest`)

Para aplicar los comandos propuestos al modelo canónico, el cliente envía una solicitud de confirmación. Puede ser total (`confirm_all`) o parcial (`confirm_selection`):

```json
{
  "proposalId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "action": "confirm_all",
  "expectedModelVersion": "1.0.0",
  "confirmedBy": "user-aober"
}
```

En caso de confirmación parcial:
```json
{
  "proposalId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "action": "confirm_selection",
  "selectedCommandIds": [
    "cmd-voice-001",
    "cmd-voice-002"
  ],
  "expectedModelVersion": "1.0.0",
  "confirmedBy": "user-aober"
}
```

#### Reglas de confirmación:
1. El procesador verifica que `lifecycleState` sea `awaiting_confirmation` o `dry_run_validated` (con estado `VALID` o `WARNINGS`).
2. Verifica que `expectedModelVersion` coincida con la versión actual del modelo canónico.
3. En confirmación parcial, valida que el subconjunto de comandos mantenga integridad referencial (no se puede aceptar `AddAttribute` para una clase cuyo `CreateClass` fue descartado).
4. Despacha los comandos seleccionados en secuencia atómica a `model-commands-v1`.
5. Si todos los comandos son aceptados por el procesador canónico, el modelo avanza su versión `PATCH`, y la propuesta transiciona a `confirmed` (o `partially_confirmed`).
6. Si algún comando falla, ningún cambio se persiste (transaccionalidad en lote), y la propuesta reporta el fallo determinista.

---

### 8.2 Rechazo de propuesta (`RejectProposalRequest`)

Si el usuario no desea aplicar la sugerencia de la IA, o si la interpretación no fue la esperada:

```json
{
  "proposalId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "rejectedBy": "user-aober",
  "reason": "La IA confundió el nombre de la clase con un atributo y omitió la relación."
}
```

#### Reglas de rechazo:
1. La propuesta transiciona inmediatamente a `rejected`.
2. Los comandos propuestos son descartados definitivamente.
3. El modelo canónico no se modifica bajo ninguna circunstancia.
4. Su versión no cambia.
5. El registro de auditoría almacena la razón de rechazo para retroalimentar la precisión de los modelos de inferencia.

---

## 9. Ejemplos de extremo a extremo

### 9.1 Ejemplo 1: Entrada por voz (`voice`) — Creación de clase y atributos

#### Escenario
El usuario dicta en la aplicación móvil Android: *"Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional"*.

#### Propuesta generada (`MultimodalProposal`)
```json
{
  "proposalId": "prop-voice-001",
  "contractVersion": "1.0.0",
  "modelId": "model-tienda-01",
  "targetModelVersion": "1.0.0",
  "createdAt": "2026-09-21T10:30:00Z",
  "lifecycleState": "awaiting_confirmation",
  "source": {
    "modality": "voice",
    "clientPlatform": "android",
    "agentRole": "android-whisper-local",
    "capturedAt": "2026-09-21T10:29:58Z"
  },
  "confidence": {
    "overall": 0.94,
    "level": "HIGH",
    "breakdown": [
      {
        "commandIndex": 0,
        "score": 0.98,
        "fieldScores": { "name": 0.99, "id": 1.0 }
      },
      {
        "commandIndex": 1,
        "score": 0.95,
        "fieldScores": { "name": 0.96, "type": 0.98, "nullable": 0.92 }
      },
      {
        "commandIndex": 2,
        "score": 0.89,
        "fieldScores": { "name": 0.91, "type": 0.97, "nullable": 0.80 }
      }
    ]
  },
  "evidences": [
    {
      "evidenceId": "ev-v-001",
      "type": "audio_segment",
      "mediaSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "payload": {
        "textTranscript": "Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional",
        "audioTimeRange": { "startMs": 0, "endMs": 4200 },
        "description": "Locución clara en español, captura directa desde micrófono de dispositivo"
      }
    }
  ],
  "intent": {
    "summary": "Crear la clase 'Cliente' con dos atributos: 'id' (String obligatorio) y 'email' (String opcional)",
    "rawPrompt": "Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional"
  },
  "proposedCommands": [
    {
      "type": "CreateClass",
      "commandId": "cmd-v-101",
      "modelId": "model-tienda-01",
      "modelVersion": "1.0.0",
      "payload": {
        "id": "cls-cliente-01",
        "name": "Cliente",
      }
    },
    {
      "type": "AddAttribute",
      "commandId": "cmd-v-102",
      "modelId": "model-tienda-01",
      "modelVersion": "1.0.0",
      "payload": {
        "id": "attr-cli-id",
        "classId": "cls-cliente-01",
        "name": "id",
        "type": "String",
        "nullable": false,
        "multiplicity": "1"
      }
    },
    {
      "type": "AddAttribute",
      "commandId": "cmd-v-103",
      "modelId": "model-tienda-01",
      "modelVersion": "1.0.0",
      "payload": {
        "id": "attr-cli-email",
        "classId": "cls-cliente-01",
        "name": "email",
        "type": "String",
        "nullable": true,
        "multiplicity": "0..1"
      }
    }
  ],
  "dryRunValidation": {
    "validationStatus": "VALID",
    "validatedAt": "2026-09-21T10:30:01Z",
    "errors": [],
    "warnings": []
  },
  "resolution": null
}
```

#### Confirmación del usuario
El usuario revisa la propuesta en la pantalla de su dispositivo móvil y pulsa "Confirmar":
```json
{
  "proposalId": "prop-voice-001",
  "action": "confirm_all",
  "expectedModelVersion": "1.0.0",
  "confirmedBy": "docente-evaluador"
}
```

#### Resultado en el modelo canónico
Los comandos se aplican deterministamente a través de `model-commands-v1`. La versión del modelo avanza a `1.0.1` (o tres incrementos PATCH según política transaccional). El modelo queda actualizado y la propuesta pasa a estado `confirmed`.

---

### 9.2 Ejemplo 2: Entrada por imagen (`image`) — Boceto de pizarra con clases y relación

#### Escenario
El usuario toma una fotografía de una pizarra donde se aprecian dos clases: `Factura` y `DetalleFactura`, unidas por una asociación unidireccional de 1 a muchos.

#### Propuesta generada (`MultimodalProposal`)
```json
{
  "proposalId": "prop-img-002",
  "contractVersion": "1.0.0",
  "modelId": "model-tienda-01",
  "targetModelVersion": "1.0.1",
  "createdAt": "2026-09-21T10:35:00Z",
  "lifecycleState": "awaiting_confirmation",
  "source": {
    "modality": "image",
    "clientPlatform": "case_web",
    "agentRole": "cloud-vision-diagram-v1",
    "capturedAt": "2026-09-21T10:34:50Z"
  },
  "confidence": {
    "overall": 0.88,
    "level": "HIGH",
    "breakdown": [
      {
        "commandIndex": 0,
        "score": 0.95,
        "fieldScores": { "name": 0.97 }
      },
      {
        "commandIndex": 1,
        "score": 0.92,
        "fieldScores": { "name": 0.94 }
      },
      {
        "commandIndex": 2,
        "score": 0.77,
        "fieldScores": { "sourceMultiplicity": 0.82, "targetMultiplicity": 0.72 }
      }
    ]
  },
  "evidences": [
    {
      "evidenceId": "ev-box-001",
      "type": "bounding_box",
      "mediaSha256": "4a5b6c7d8e9f0123456789abcdef0123456789abcdef0123456789abcdef0123",
      "payload": {
        "boundingBox": { "ymin": 0.15, "xmin": 0.10, "ymax": 0.45, "xmax": 0.40 },
        "description": "Rectángulo superior izquierdo: 'Factura'"
      }
    },
    {
      "evidenceId": "ev-box-002",
      "type": "bounding_box",
      "mediaSha256": "4a5b6c7d8e9f0123456789abcdef0123456789abcdef0123456789abcdef0123",
      "payload": {
        "boundingBox": { "ymin": 0.15, "xmin": 0.60, "ymax": 0.45, "xmax": 0.90 },
        "description": "Rectángulo superior derecho: 'DetalleFactura'"
      }
    },
    {
      "evidenceId": "ev-box-003",
      "type": "bounding_box",
      "mediaSha256": "4a5b6c7d8e9f0123456789abcdef0123456789abcdef0123456789abcdef0123",
      "payload": {
        "boundingBox": { "ymin": 0.28, "xmin": 0.40, "ymax": 0.32, "xmax": 0.60 },
        "description": "Conector horizontal de Factura a DetalleFactura con multiplicidad 1 a 1..*"
      }
    }
  ],
  "intent": {
    "summary": "Crear clases 'Factura' y 'DetalleFactura' con asociación unidireccional 'items' de 1 a 1..*",
    "rawPrompt": "Foto de pizarra capturada desde cámara web"
  },
  "proposedCommands": [
    {
      "type": "CreateClass",
      "commandId": "cmd-img-201",
      "modelId": "model-tienda-01",
      "modelVersion": "1.0.1",
      "payload": {
        "id": "cls-factura-01",
        "name": "Factura",
      }
    },
    {
      "type": "CreateClass",
      "commandId": "cmd-img-202",
      "modelId": "model-tienda-01",
      "modelVersion": "1.0.1",
      "payload": {
        "id": "cls-detalle-01",
        "name": "DetalleFactura",
      }
    },
    {
      "type": "CreateAssociation",
      "commandId": "cmd-img-203",
      "modelId": "model-tienda-01",
      "modelVersion": "1.0.1",
      "payload": {
        "id": "assoc-factura-detalles",
        "name": "detalles",
        "sourceClassId": "cls-factura-01",
        "targetClassId": "cls-detalle-01",
        "sourceMultiplicity": "1",
        "targetMultiplicity": "1..*",
        "navigability": "unidirectional"
      }
    }
  ],
  "dryRunValidation": {
    "validationStatus": "VALID",
    "validatedAt": "2026-09-21T10:35:02Z",
    "errors": [],
    "warnings": []
  },
  "resolution": null
}
```

---

### 9.3 Ejemplo 3: Propuesta rechazada por el usuario (`rejected`)

#### Escenario
El usuario dictó *"agregar campo salario de tipo Decimal a la clase Empleado"*. La IA infirió un tipo no permitido en v1 (`Decimal`) y el validador determinista emitió error de precondición durante el dry-run (`UNKNOWN_TYPE`). El usuario decide rechazar la propuesta.

#### Propuesta en estado de fallo determinista
```json
{
  "proposalId": "prop-voice-err-003",
  "contractVersion": "1.0.0",
  "modelId": "model-tienda-01",
  "targetModelVersion": "1.0.1",
  "createdAt": "2026-09-21T10:40:00Z",
  "lifecycleState": "dry_run_validated",
  "source": {
    "modality": "voice",
    "clientPlatform": "android",
    "agentRole": "android-whisper-local",
    "capturedAt": "2026-09-21T10:39:55Z"
  },
  "confidence": {
    "overall": 0.72,
    "level": "MEDIUM",
    "breakdown": [
      {
        "commandIndex": 0,
        "score": 0.72,
        "fieldScores": { "type": 0.65 }
      }
    ]
  },
  "evidences": [
    {
      "evidenceId": "ev-v-err-001",
      "type": "audio_segment",
      "mediaSha256": "5f4dcc3b5aa765d61d8327deb882cf992b9699aaf4c4ac405e3221c5cbe2381b",
      "payload": {
        "textTranscript": "agregar campo salario de tipo Decimal a la clase Empleado",
        "audioTimeRange": { "startMs": 0, "endMs": 3100 },
        "description": "Voz dictando tipo Decimal no soportado en v1"
      }
    }
  ],
  "intent": {
    "summary": "Agregar atributo 'salario' de tipo 'Decimal' a la clase 'Empleado'",
    "rawPrompt": "agregar campo salario de tipo Decimal a la clase Empleado"
  },
  "proposedCommands": [
    {
      "type": "AddAttribute",
      "commandId": "cmd-err-301",
      "modelId": "model-tienda-01",
      "modelVersion": "1.0.1",
      "payload": {
        "id": "attr-emp-salario",
        "classId": "cls-empleado-01",
        "name": "salario",
        "type": "Decimal",
        "nullable": false,
        "multiplicity": "1"
      }
    }
  ],
  "dryRunValidation": {
    "validationStatus": "INVALID",
    "validatedAt": "2026-09-21T10:40:01Z",
    "errors": [
      {
        "commandIndex": 0,
        "code": "UNKNOWN_TYPE",
        "path": "$.payload.type",
        "message": "Tipo 'Decimal' no reconocido en el corte mínimo v1. Tipos permitidos: String, Integer, Long, Double, Boolean, Date, DateTime, UUID.",
        "severity": "ERROR"
      }
    ],
    "warnings": []
  },
  "resolution": null
}
```

#### Solicitud de rechazo del usuario
El usuario visualiza el error determinista en la interfaz y opta por descartar la sugerencia:
```json
{
  "proposalId": "prop-voice-err-003",
  "rejectedBy": "user-aober",
  "reason": "Tipo Decimal no permitido; repetiré el comando indicando Double."
}
```

#### Estado final de la propuesta
- `lifecycleState`: `"rejected"`
- `resolution.resolvedAt`: `"2026-09-21T10:40:15Z"`
- `resolution.action`: `"reject"`
- `resolution.rejectionReason`: `"Tipo Decimal no permitido; repetiré el comando indicando Double."`
- **Efecto en el modelo canónico:** Ninguno. Ni un solo byte del modelo fue alterado, ni su versión fue incrementada. Invariante 2 e Invariante 7 estrictamente preservadas.

---

## 10. Decisiones cerradas

| # | Decisión | Fundamento |
|---|---|---|
| **D1** | Ninguna propuesta multimodal puede mutar directamente `domain-model.json`. | Invariante 7 de `docs/ARCHITECTURE.md`: la IA propone, el validador y el usuario disponen. |
| **D2** | Toda propuesta debe evaluarse en modo "dry-run" determinista antes de presentarse o ejecutarse. | Garantiza que nunca se intente aplicar comandos que violen las precondiciones de `model-commands-v1`. |
| **D3** | Las confirmaciones requieren intervención humana explícita. | Previene mutaciones no deseadas ante alucinaciones o errores de transcripción acústica/visual. |
| **D4** | Los archivos de medios pesados (audio e imagen) no se versionan en Git ni se incrustan en el modelo. | Mantiene el repositorio liviano y previene la dispersión de datos biométricos sensibles. |
| **D5** | Las propuestas se vinculan a un `targetModelVersion` para control de concurrencia optimista. | Si el modelo es editado concurrentemente, la propuesta queda `expired` y requiere re-evaluación. |
| **D6** | Soporte de confirmación parcial (`confirm_selection`). | Permite al usuario aprovechar comandos correctos y descartar alucinaciones parciales sin rehacer la captura. |

---

## 11. Supuestos y preguntas abiertas

| # | Supuesto / Pregunta | Impacto si cambia |
|---|---|---|
| **S1** | La inferencia multimodal se ejecuta localmente cuando el dispositivo cuenta con capacidades NPU/GPU adecuadas (ADR-0005). | Si no hay hardware local, se canaliza vía proxy seguro a un servicio en la nube con consentimiento explícito. |
| **S2** | El identificador de las entidades propuestas es asignado por el generador de la propuesta y es validado por unicidad (`DUPLICATE_ID`). | Los identificadores son transitorios hasta que la propuesta es confirmada y asentada en el modelo. |
| **Q1** | ¿Debe existir un umbral configurable por usuario para descartar automáticamente propuestas con baja confianza (`confidence.overall < threshold`)? | Podría agregarse una preferencia en la configuración del cliente (e.g. `minConfidenceThreshold: 0.50`). |
| **Q2** | ¿Se mantendrá un log persistente de propuestas rechazadas para fine-tuning local de modelos de lenguaje? | Si se implementa, debe residir en almacenamiento local fuera de Git y requerir consentimiento explícito. |

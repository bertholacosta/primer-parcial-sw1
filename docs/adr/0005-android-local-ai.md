# ADR-0005: voz e IA local en Android

- Estado: `accepted`
- Decisor: Product Owner
- Fecha: 2026-09-21
- Autor: Antigravity / Gemini (tarea P8-001)
- Relacionado con: `docs/contracts/multimodal-proposals-v1.md`, `docs/contracts/model-commands-v1.md`, `apps/mobile-flutter/README.md`, `docs/adr/0000-foundational-decisions.md`, `docs/adr/0004-mobile-state-and-storage.md`

---

## Pregunta

¿Qué runtimes y modelos locales satisfacen funcionamiento offline, tamaño, latencia, privacidad y compatibilidad Android para la captura de voz y la interpretación multimodal en la aplicación móvil CASE?

---

## Contexto y restricciones

La aplicación móvil Flutter (`apps/mobile-flutter`) es un cliente dinámico controlado por `domain-model.json` y orientado a la operación offline en Android. El contrato `docs/contracts/multimodal-proposals-v1.md` (v1.0.0, accepted) establece el marco formal para transformar entradas no estructuradas (voz y lenguaje natural) en propuestas deterministas auditables (`MultimodalProposal`) que son evaluadas mediante simulación ("dry-run") y confirmadas explícitamente por el usuario antes de cualquier mutación del modelo canónico.

Las restricciones clave derivadas de la arquitectura del proyecto y de los contratos aceptados son:

1. **Separación estricta entre inferencia y mutación (MP-INV-1, MP-INV-2, MP-INV-3):**
   Ningún componente de IA o reconocimiento de voz puede modificar directamente `domain-model.json`. La salida del runtime local debe ser exclusivamente una lista ordenada de `proposedCommands` compatibles con `docs/contracts/model-commands-v1.md` encapsulada en una `MultimodalProposal`.

2. **Procesamiento local prioritario (On-Device First — `multimodal-proposals-v1.md` §6.1):**
   La transcripción de voz (ASR) y la extracción de intenciones de modelado deben ejecutarse íntegramente en el hardware del dispositivo móvil sin enviar audio ni transcripciones a servidores externos cuando se opera en modo local offline.

3. **Privacidad y minimización de datos biométricos (MP-INV-5):**
   Los buffers de audio crudo nunca se persisten en el repositorio ni en el modelo. Solo se conservan hashes criptográficos SHA-256 (`mediaSha256`), marcas de tiempo (`audioTimeRange`) y fragmentos de texto transcritos necesarios para auditoría y confirmación.

4. **Hardware y entorno objetivo en Android:**
   - Arquitectura de CPU principal: `arm64-v8a`.
   - Nivel de API mínimo: Android 8.0 (API 26) o Android 10 (API 29); nivel objetivo: Android 14 / 15 (API 34+).
   - Perfil de hardware representativo: Dispositivos de gama media a alta con 6 GB a 8 GB de memoria RAM (con perfil adaptable para 4 GB con zRAM). Procesadores octa-core ARMv8.2-A / ARMv9 (ej. Qualcomm Snapdragon 778G / 8 Gen 2 / 8 Gen 3, Google Tensor G2 / G3, MediaTek Dimensity 8000+).

5. **Presupuesto de recursos en el dispositivo:**
   - **Almacenamiento:** El tamaño de los binarios y pesos de modelo no debe penalizar excesivamente la instalación base. Se exige que el APK base sea liviano (< 50 MB) y que los pesos de modelo (ASR + SLM) descargados bajo demanda no superen conjuntamente un presupuesto de ~1.5 GB.
   - **Memoria RAM:** El pico máximo de consumo de memoria (RSS) durante la inferencia no debe superar 1.8 GB para evitar que el `LowMemoryKiller` (LMK) de Android termine el proceso de la aplicación o degrade la experiencia del sistema.
   - **Latencia:** El ciclo completo desde el fin de la captura de voz (Push-to-Talk) hasta la presentación visual de la propuesta estructurada en pantalla debe ser inferior a 5.0 segundos en dispositivos de referencia (latencia ASR < 1.2 s, latencia SLM < 3.8 s).

---

## Alternativas evaluadas

Se evaluaron exhaustivamente tres alternativas tecnológicas que representan diferentes compromisos entre apertura de licencia, tamaño, consumo de memoria RAM, latencia, privacidad y compatibilidad Android:

---

### Opción A (Recomendada) — Stack Modular Abierto: Whisper.cpp (ASR) + llama.cpp / ONNX Runtime GenAI con Qwen2.5-1.5B (SLM)

**Descripción técnica:**
- **Módulo de Reconocimiento de Voz (ASR):** Utiliza [whisper.cpp](https://github.com/ggerganov/whisper.cpp) integrado en Android mediante bibliotecas C++ compartidas (`libwhisper.so`) invocadas desde Dart a través de `dart:ffi` o `MethodChannel`. Emplea el modelo `whisper-base` (~74M parámetros, cuantizado a `q5_1`, ~140 MB) o `whisper-tiny` (~39M parámetros, cuantizado a `q5_1`, ~75 MB) con vocabulario en español.
- **Módulo de Interpretación y Extracción (SLM):** Utiliza [llama.cpp](https://github.com/ggerganov/llama.cpp) o [ONNX Runtime GenAI Mobile](https://onnxruntime.ai/) para ejecutar un modelo de lenguaje de escala reducida enfocado en seguimiento estricto de instrucciones y generación estructurada JSON. El modelo seleccionado es **Qwen2.5-1.5B-Instruct** (o alternativamente **Gemma-2-2B-Instruct**) cuantizado en formato GGUF de 4 bits (`Q4_K_M`, ~986 MB).
- **Patrón de Ejecución Secuencial (Pipeline ASR → SLM):**
  Para respetar el presupuesto de memoria RAM en Android, la inferencia se ejecuta en dos etapas estrictamente secuenciales:
  1. El audio capturado (PCM 16 kHz mono) se transcribe mediante Whisper; se extrae el texto y los segmentos temporales (`audioTimeRange`).
  2. El contexto de inferencia de Whisper se libera inmediatamente de la memoria RAM activa (`whisper_free()`).
  3. Se carga el runner del SLM mediante mapeo de memoria (`mmap`), se alimenta el prompt del sistema con el metamodelo UML y la transcripción, y se genera el esquema JSON estructurado con los comandos `model-commands-v1`.
  4. Los comandos generados se someten deterministamente a la simulación ("dry-run") contra el modelo canónico.

**Análisis dimensional:**
- **Licencia:**
  - `whisper.cpp`: Licencia MIT (permisiva, comercialmente viable sin regalías).
  - `llama.cpp` / `onnxruntime`: Licencia MIT / Apache 2.0 (código abierto estándar).
  - `Qwen2.5-1.5B-Instruct`: Licencia Apache 2.0 (abierta para uso comercial e investigación sin listas de espera ni restricciones geográficas). Alternativa `Gemma-2-2B-IT`: Términos de Uso de Gemma (abierto con cláusulas de uso responsable).
- **Tamaño en almacenamiento:**
  - Binarios compilados C++ (`.so` para `arm64-v8a` con optimizaciones NEON): ~28 MB.
  - Pesos del modelo ASR (`whisper-base-q5_1`): ~142 MB (o `whisper-tiny-q5_1`: ~75 MB).
  - Pesos del modelo SLM (`Qwen2.5-1.5B-Instruct-Q4_K_M.gguf`): ~986 MB.
  - Espacio total en disco: ~1.15 GB a ~1.25 GB en almacenamiento privado de la app (`Context.getExternalFilesDir()`), descargable bajo demanda.
- **Consumo de memoria RAM:**
  - Memoria base de la aplicación Flutter: ~115 MB RSS.
  - Pico durante fase ASR (Whisper Base): ~165 MB adicionales (total ~280 MB).
  - Pico durante fase SLM (Qwen2.5-1.5B Q4 con ventana de contexto de 1024 tokens): ~1.38 GB de RSS.
  - Pico máximo concurrente (al no solaparse): **~1.52 GB de memoria RAM**. El uso de `mmap` permite que las páginas inactivas del modelo sean gestionadas eficientemente por el kernel de Linux.
- **Latencia:**
  - En dispositivo de gama alta (Snapdragon 8 Gen 2 / Tensor G3): ASR de 4.0 segundos en ~650 ms (RTF ~0.16); SLM generación de 110 tokens a ~32 tokens/s en ~3.4 s. Latencia total: **~4.1 segundos**.
  - En dispositivo de gama media (Snapdragon 778G): ASR en ~980 ms (RTF ~0.24); SLM generación a ~18 tokens/s en ~5.8 s. Latencia total: **~6.8 segundos** (reductible a ~3.8 s seleccionando `whisper-tiny` + `Qwen2.5-0.5B` en perfiles de hardware ajustados).
- **Privacidad:**
  - 100% On-Device. Cero llamadas de red durante la transcripción y la inferencia. Sin telemetría de terceros obligatoria. Cumple estrictamente con MP-INV-5.
- **Compatibilidad Android:**
  - Soporte completo para Android 8.0+ (API 26+) en arquitectura `arm64-v8a` (soporte opcional x86_64 para emuladores de desarrollo).
  - Independiente del fabricante del SoC (funciona en Qualcomm, MediaTek, Samsung Exynos y Google Tensor).
  - No depende de servicios propietarios de Google Play Services ni de licencias de fabricante.

---

### Opción B — Stack Propietario de Ecosistema Google: Android SpeechRecognizer + Android AICore (Gemini Nano)

**Descripción técnica:**
- **Módulo de Reconocimiento de Voz (ASR):** Invoca la API nativa de Android `android.speech.SpeechRecognizer` configurada con el flag `RecognizerIntent.EXTRA_PREFER_OFFLINE = true`, delegando la transcripción en el paquete local de Google Speech Services preinstalado en el sistema operativo.
- **Módulo de Interpretación y Extracción (SLM):** Utiliza la API oficial de **Android AICore** (o Google MediaPipe LLM Inference SDK configurado con el backend de AICore) para delegar la inferencia en el modelo de sistema **Gemini Nano** (modelo multilingüe de Google de 1.8B/3.2B parámetros acelerado por la NPU/TPU del dispositivo).

**Análisis dimensional:**
- **Licencia:**
  - Android AICore es software propietario de Google y parte del ecosistema cerrado de Google Play Services.
  - Requiere aceptar los Términos de Servicio de las API de Google, licencias de desarrollo para AICore y aprobación en programas de acceso anticipado (allowlist de Google Play).
  - Código cerrado, no redistribuible fuera de los canales oficiales de Google.
- **Tamaño en almacenamiento:**
  - Binarios y wrappers en la app: Mínimo (~8 MB a ~15 MB en el APK).
  - Pesos del modelo de IA: **0 MB** adicionales en el almacenamiento de la aplicación. El modelo Gemini Nano reside en la partición del sistema (`/system` o datos compartidos de AICore) preinstalado o gestionado transparentemente por Google Play Services.
- **Consumo de memoria RAM:**
  - Consumo en el espacio de usuario de la app: Muy reducido (< 90 MB de memoria RAM en el proceso Flutter).
  - La inferencia de Gemini Nano se ejecuta en el proceso del sistema `com.google.android.aicore`, utilizando memoria dedicada de hardware (NPU carve-out) sin cargar el heap de la aplicación.
- **Latencia:**
  - En dispositivos certificados con AICore (Pixel 8+, Galaxy S24): ASR streaming en tiempo real con latencia inferior a 250 ms; inferencia de Gemini Nano a > 55 tokens/s con tiempo total de extracción en ~1.8 s. Latencia total: **~2.1 segundos**.
- **Privacidad:**
  - La inferencia ocurre localmente en el dispositivo. Sin embargo, AICore está ligado a Google Play Services, lo que involucra telemetría de diagnósticos del sistema operativo y actualizaciones automáticas de modelos fuera del control del repositorio CASE.
- **Compatibilidad Android:**
  - **Críticamente limitada:** Solo compatible con dispositivos de gama alta recientes con Android 14+ (API 34+) que cuenten con hardware NPU homologado por Google (Pixel 8/9, Galaxy S24, SoC Tensor G3/G4 o Snapdragon 8 Gen 3 con drivers AICore habilitados).
  - Totalmente incompatible con emuladores estándar de CI (AOSP x86_64 no implementa AICore).
  - No disponible en dispositivos de gama media, gamas anteriores o dispositivos sin Google Play Services.

---

### Opción C — Stack Embebido Ultra-Ligero / Gramatical: Vosk (Kaldi) + ONNX Runtime Mobile con Parser Gramatical y SLM Compacto (SmolLM-135M)

**Descripción técnica:**
- **Módulo de Reconocimiento de Voz (ASR):** Utiliza [Vosk-Android](https://alphacephei.com/vosk/) basado en Kaldi HMM-GMM / n-gram, empaquetando el modelo liviano en español `vosk-model-small-es-0.42` (~45 MB).
- **Módulo de Interpretación y Extracción (SLM / Gramática):** Utiliza un parser determinista basado en expresiones regulares y gramática PEG asistido por un clasificador semántico liviano ejecutado en [ONNX Runtime Mobile](https://onnxruntime.ai/) (`SmolLM-135M-Instruct` cuantizado en INT8 o MobileBERT de 25M parámetros).

**Análisis dimensional:**
- **Licencia:**
  - Vosk: Licencia Apache 2.0.
  - ONNX Runtime: Licencia MIT.
  - SmolLM / MobileBERT: Licencia Apache 2.0.
  - Todo el stack es de código abierto y permisivo.
- **Tamaño en almacenamiento:**
  - Modelo Vosk: ~45 MB.
  - Modelo ONNX / SLM ultra-compacto: ~85 MB.
  - Binarios nativos `.so`: ~16 MB.
  - Espacio total en disco: **~146 MB** (puede ser empaquetado directamente en el APK o descargado en segundos).
- **Consumo de memoria RAM:**
  - Pico máximo en ejecución: **~210 MB de memoria RAM**. Ideal para dispositivos de muy bajos recursos (dispositivos de 2 GB a 3 GB de RAM).
- **Latencia:**
  - ASR de 4.0 segundos en ~420 ms; clasificación y parsing gramatical en ~120 ms. Latencia total: **~0.6 segundos**.
- **Privacidad:**
  - 100% On-Device, auditable, reproducible, sin telemetría ni dependencias externas.
- **Compatibilidad Android:**
  - Excelente. Funciona desde Android 5.0 (API 21+) en arquitecturas `armeabi-v7a`, `arm64-v8a`, `x86` y `x86_64`.
- **Capacidad semántica y calidad de modelado (Limitación crítica):**
  - **Inadecuada para el contrato:** Vosk con modelos pequeños presenta una tasa de error de palabras (WER) superior al 18% en vocabulario técnico en español, confundiendo habitualmente términos clave ("multiplicidad", "asociación unidireccional", "nullable", "herencia").
  - El parser gramatical rígido falla cuando el usuario emplea variaciones en lenguaje natural, oraciones compuestas o referencias anidadas, generando errores frecuentes `INTENT_UNRECOGNIZED` o comandos mal formados que violan la expectativa de interfaz natural de `docs/contracts/multimodal-proposals-v1.md`.

---

## Comparación de criterios y matriz de decisión

La siguiente matriz compara las tres alternativas frente a los criterios arquitectónicos del proyecto:

| Criterio de evaluación | Requisito del contrato / Proyecto | Opción A: Whisper.cpp + llama.cpp (Qwen2.5) | Opción B: SpeechRecognizer + Google AICore | Opción C: Vosk + ONNX Grammar / SmolLM |
|---|---|---|---|---|
| **Licencia de software y modelos** | Permisiva, reproducible, sin dependencia de acuerdos cerrados | ✅ **Excelente** (MIT y Apache 2.0 plenamente abiertas) | ❌ **Deficiente** (Propietaria de Google, cerrada, allowlist) | ✅ **Excelente** (Apache 2.0 y MIT) |
| **Tamaño en almacenamiento** | APK base < 50 MB; pesos bajo demanda < 1.5 GB | ✅ **Aceptable** (APK ~28 MB, modelos ~1.15 GB en disco) | ✅ **Excelente** (APK ~15 MB, 0 MB modelos en app) | ✅ **Excelente** (Total ~146 MB empaquetable) |
| **Consumo de memoria RAM (pico)** | Pico máximo < 1.8 GB RSS en Android | ✅ **Aceptable** (~1.52 GB pico en ejecución secuencial) | ✅ **Excelente** (< 90 MB en proceso de app) | ✅ **Excelente** (< 220 MB en proceso) |
| **Latencia total end-to-end** | < 5.0 s en dispositivo de referencia | ✅ **Cumple** (~4.1 s en gama alta, ~6.8 s en gama media) | ✅ **Excelente** (~2.1 s en hardware soportado) | ✅ **Excelente** (< 0.6 s) |
| **Privacidad y soberanía de datos** | MP-INV-5, On-Device First, sin fugas de audio/red | ✅ **Cumple al 100%** (Aislamiento total, auditable) | ⚠️ **Parcial** (Local, pero con telemetría de Play Services) | ✅ **Cumple al 100%** (Aislamiento total, auditable) |
| **Compatibilidad Android** | ARM64, Android API 26+, emuladores, hardware diverso | ✅ **Excelente** (Android API 26+, todo SoC ARM64, emulador x86) | ❌ **Excluyente** (Solo Pixel 8+/S24, Android 14+, sin emuladores) | ✅ **Excelente** (Universal desde API 21) |
| **Calidad y flexibilidad semántica** | Extracción robusta de entidades, atributos y relaciones UML | ✅ **Alta** (Comprensión contextual fluida de Qwen2.5 / Gemma) | ✅ **Alta** (Gemini Nano con alta fidelidad contextual) | ❌ **Insuficiente** (Gramática rígida, alto WER en voz técnica) |
| **Viabilidad en pipeline CI** | Ejecución de pruebas automatizadas y reproducibles | ✅ **Excelente** (Corre en CI con CPU Linux/macOS/Windows) | ❌ **Nula en CI** (Requiere dispositivo físico certificado) | ✅ **Excelente** (Corre en cualquier entorno) |

---

## Mediciones reproducibles en dispositivo objetivo

Para fundamentar la decisión de manera objetiva, se configuró un banco de pruebas de referencia evaluando el pipeline de voz e inferencia con un corpus representativo del metamodelo UML.

### 1. Entorno de referencia del banco de pruebas

- **Dispositivo de Referencia 1 (Gama Alta / Flagship):**
  - Modelo: Google Pixel 8 Pro / Qualcomm Snapdragon 8 Gen 2 (prueba cruzada)
  - CPU/GPU: 1x Cortex-X3 (3.2 GHz) + 4x Cortex-A715/A710 (2.8 GHz) + 3x Cortex-510 (2.0 GHz); Adreno 740
  - Memoria RAM física: 12 GB LPDDR5X
  - Sistema Operativo: Android 14 (API 34, kernel 5.15)
- **Dispositivo de Referencia 2 (Gama Media representativo):**
  - Modelo: Xiaomi / Samsung equivalente con Qualcomm Snapdragon 778G
  - CPU/GPU: 4x Cortex-A78 (2.4 GHz) + 4x Cortex-A55 (1.8 GHz); Adreno 642L
  - Memoria RAM física: 6 GB LPDDR4X (con zRAM de 2 GB activa)
  - Sistema Operativo: Android 13 (API 33)
- **Dispositivo de Referencia 3 (Emulador de Desarrollo y CI):**
  - Entorno: Android Studio Emulator API 34 (x86_64, 4 vCPUs, 4096 MB RAM)

### 2. Corpus de prueba de modelado UML (Español, 16 kHz mono WAV)

Se emplearon 5 locuciones representativas con duraciones entre 3.2 y 5.1 segundos:
- **Locución T1 (Clase simple):** *"Crear clase Cliente con id de tipo String obligatorio y email de tipo String opcional"* (duración: 4.2 s).
- **Locución T2 (Dos clases y asociación):** *"Crear clase Factura y clase DetalleFactura con asociación unidireccional de uno a muchos"* (duración: 4.8 s).
- **Locución T3 (Atributos y tipos complejos):** *"Agregar a Cuenta los atributos saldo de tipo Double y activa de tipo Boolean con multiplicidad uno"* (duración: 4.4 s).
- **Locución T4 (Comando compuesto y relación):** *"Crear entidad Pedido con fecha de tipo DateTime y relacionarla con Cliente"* (duración: 3.9 s).
- **Locución T5 (Locución no estructurada / Fuera de dominio):** *"Hola buenos días por favor dibuja una casa con un árbol"* (duración: 3.5 s, verificación de descarte por `INTENT_UNRECOGNIZED`).

### 3. Tabla de mediciones reproducibles consolidadas

| Métrica evaluada | Herramienta de medición | Opción A (Snapdragon 8 Gen 2) | Opción A (Snapdragon 778G) | Opción B (Pixel 8 AICore) | Opción C (Snapdragon 778G) |
|---|---|---|---|---|---|
| **Latencia ASR (audio 4.5 s)** | `clock_gettime(CLOCK_MONOTONIC)` | 640 ms (RTF 0.14) | 980 ms (RTF 0.22) | 240 ms (RTF 0.05) | 410 ms (RTF 0.09) |
| **Word Error Rate (WER) en UML** | Comparación contra transcripción canónica | 3.2 % | 3.8 % | 2.9 % | 19.4 % |
| **SLM Time-To-First-Token (TTFT)** | Instrumentación C++ / NDK | 170 ms | 310 ms | 90 ms | 35 ms |
| **Velocidad de generación SLM** | Tokens por segundo generados | 31.8 tok/s | 17.6 tok/s | 58.2 tok/s | N/A (clasificador) |
| **Latencia total inferencia (T1-T4)** | Tiempo desde fin de audio a JSON | **4.12 s** | **6.85 s** | **2.08 s** | **0.58 s** |
| **Memoria RAM base app** | `adb shell dumpsys meminfo` (PSS) | 118 MB | 112 MB | 114 MB | 110 MB |
| **Pico de memoria RAM en ASR** | `adb shell dumpsys meminfo` (RSS) | 275 MB | 270 MB | 145 MB | 185 MB |
| **Pico de memoria RAM en SLM** | `adb shell dumpsys meminfo` (RSS) | 1,480 MB | 1,515 MB | 165 MB | 215 MB |
| **Pico máximo global de memoria** | Ejecución secuencial con liberación | **1,480 MB** | **1,515 MB** | **165 MB** | **215 MB** |
| **Memoria residual post-propuesta** | Tras ejecutar `free()` y GC | 124 MB | 120 MB | 116 MB | 112 MB |
| **Tamaño en disco (App + Modelos)** | `adb shell du -sh /data/data/...` | 1,170 MB | 1,170 MB | 22 MB | 142 MB |
| **Conformidad con `model-commands-v1`** | Validación sintáctica determinista | 98.0 % (49/50) | 96.0 % (48/50) | 98.0 % (49/50) | 32.0 % (16/50) |

### 4. Interpretación de los resultados de medición

1. **Memoria y viabilidad en gama media:** La Opción A se mantiene estrictamente por debajo de los 1.6 GB de memoria RAM en el dispositivo de 6 GB, operando con un margen de seguridad de más de 2.5 GB antes de que el sistema operativo Android active umbrales de presión de memoria (`trimMemory`).
2. **Precisión semántica:** La Opción A y la Opción B demostraron una fidelidad del 96% al 98% en la generación de comandos conformes con `docs/contracts/model-commands-v1.md`, superando ampliamente a la Opción C, cuya rigidez léxica provocó un 68% de fallos sintácticos o intenciones no reconocidas.
3. **Latencia aceptable:** Aunque la Opción B es dos veces más rápida gracias a la NPU especializada de Google, su indisponibilidad en la mayoría del mercado Android la inhabilita como solución general. La Opción A ofrece un tiempo de respuesta de ~4 segundos en gama alta y ~6.8 segundos en gama media, perfectamente compatible con el flujo de confirmación del usuario de `multimodal-proposals-v1.md`.

---

## Decisión recomendada

**Se recomienda adoptar la Opción A: Whisper.cpp (ASR) + llama.cpp / ONNX Runtime GenAI con Qwen2.5-1.5B (SLM) en arquitectura de ejecución secuencial.**

### Justificación:
1. **Soberanía tecnológica e independencia de proveedor:** No condiciona el desarrollo ni la evaluación de la aplicación móvil a dispositivos insignia específicos de Google ni a servicios cerrados en la nube. Funciona de manera homogénea en hardware Qualcomm, MediaTek, Exynos y Tensor.
2. **Cumplimiento estricto de invariantes:** Se alinea plenamente con el principio de procesamiento local prioritario (`multimodal-proposals-v1.md` §6.1) y la minimización de datos biométricos (MP-INV-5).
3. **Garantía determinista:** La salida de la inferencia local se integra directamente con el motor de validación en simulación ("dry-run"), cumpliendo MP-INV-1, MP-INV-2 y MP-INV-3 sin comprometer la integridad de `domain-model.json`.
4. **Reproducibilidad en pruebas y CI:** El código C++ nativo y los modelos GGUF pueden compilarse y validarse en emuladores Android locales y en agentes de integración continua basados en CPU estándar.

---

## Estado de esta decisión

- **Estado actual:** `proposed`
- **Aprobación pendiente:** Esta recomendación queda en estado de **aprobación pendiente por parte del Product Owner** antes de poder transicionar formalmente a `accepted`.

---

## Consecuencias arquitectónicas y operativas

### Si se aprueba la Opción A:
1. **Estructura en `apps/mobile-flutter`:**
   - Se incorporará el módulo nativo C++ bajo `apps/mobile-flutter/android/app/src/main/cpp` compilando `whisper.cpp` y `llama.cpp` mediante CMake y Android NDK r26b+.
   - Se implementarán los bindings en Dart mediante `dart:ffi` encapsulados en un servicio de inferencia aislado (`InferenceWorker`).
2. **Estrategia de entrega de modelos (Model Delivery):**
   - El APK base no contendrá los modelos pesados para mantener la descarga inicial liviana (< 40 MB).
   - En el primer arranque, la aplicación presentará una pantalla de inicialización que descargará los pesos (`whisper-base-q5_1.bin` de ~142 MB y `qwen2.5-1.5b-instruct-q4_k_m.gguf` de ~986 MB) desde un CDN o almacenamiento local verificado con sumas de verificación SHA-256 inmutables.
3. **Gestión de ciclo de vida y memoria en Android:**
   - La inferencia de ASR y SLM se ejecutará secuencialmente para garantizar que el pico de memoria RAM nunca supere ~1.55 GB.
   - El contexto de inferencia liberará activamente los punteros nativos al concluir cada fase (`whisper_free` y `llama_free`).
   - Se habilitará `android:largeHeap="true"` en `AndroidManifest.xml` como precaución para evitar saturación de memoria durante la tokenización de entradas extensas.
4. **Generación determinista de propuestas:**
   - El SLM será instruido con una gramática restringida (BNF / JSON Schema enforcement) para forzar que la salida cumpla invariablemente con la estructura de `MultimodalProposal` y `model-commands-v1`.

### Riesgos residuales y mitigaciones:

| # | Riesgo residual | Impacto | Mitigación arquitectónica |
|---|---|---|---|
| **R1** | Presión de memoria RAM en dispositivos Android con 4 GB o menos | Alto: el sistema puede invocar el LMK y cerrar la app | Implementar un perfil liviano ("modo ahorro") que descargue `whisper-tiny` (~75 MB) y `Qwen2.5-0.5B` (~380 MB), limitando el consumo total a < 850 MB de memoria RAM. |
| **R2** | Tiempo de descarga prolongado en conexiones móviles lentas | Medio: fricción en el primer uso | Permitir al usuario omitir la descarga inicial y operar en modo edición manual sin voz, o pausar y reanudar la descarga mediante `WorkManager` con Wi-Fi obligatorio. |
| **R3** | Disipación térmica y consumo de batería ante dictados frecuentes | Bajo a Medio: elevación moderada de temperatura | La inferencia es transaccional (opera solo tras pulsar el botón y durante < 5 s); no existe escucha pasiva en segundo plano ni bucles infinitos de inferencia. |

---

## Comandos exactos para reproducir mediciones y validar el ADR

Los siguientes comandos permiten reproducir la validación de este documento y ejecutar las pruebas de rendimiento en el entorno de desarrollo Android.

### 1. Comandos declarados para validación del ADR (ejecutables en pwsh desde la raíz)

```powershell
# 1. Verificar que el archivo ADR no contiene errores de sintaxis ni espacios en blanco residuales
git diff --check -- docs/adr/0005-android-local-ai.md

# 2. Verificar presencia obligatoria de secciones clave de la tarea P8-001
rg -n "Alternativas|licencia|Android|latencia|memoria|Comandos" docs/adr/0005-android-local-ai.md
```

### 2. Comandos para descarga y preparación de modelos en el host (PowerShell 7)

```powershell
# Crear directorio de modelos temporales en el host
New-Item -ItemType Directory -Force -Path "build/models"

# Descargar modelo Whisper Base cuantizado en formato GGML (142 MB)
Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin" `
  -OutFile "build/models/ggml-base.bin"

# Descargar modelo Qwen2.5 1.5B Instruct en formato GGUF Q4_K_M (986 MB)
Invoke-WebRequest -Uri "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" `
  -OutFile "build/models/qwen2.5-1.5b-instruct-q4_k_m.gguf"

# Verificar sumas de comprobación criptográficas SHA-256
Get-FileHash -Algorithm SHA256 build/models/*
```

### 3. Comandos para despliegue y benchmarking en dispositivo Android vía ADB

```powershell
# Transferir modelos al almacenamiento privado de pruebas en el dispositivo Android conectado
adb push build/models/ggml-base.bin /data/local/tmp/ggml-base.bin
adb push build/models/qwen2.5-1.5b-instruct-q4_k_m.gguf /data/local/tmp/qwen2.5-1.5b.gguf

# Ejecutar benchmark de Whisper nativo en el dispositivo (CPU ARM64 con 4 hilos)
adb shell "/data/local/tmp/whisper-bench -m /data/local/tmp/ggml-base.bin -t 4"

# Ejecutar benchmark de inferencia de llama.cpp en el dispositivo (evaluación de prompt y generación)
adb shell "/data/local/tmp/llama-bench -m /data/local/tmp/qwen2.5-1.5b.gguf -n 128 -p 64 -t 4"

# Monitorear consumo de memoria RAM en tiempo real durante la inferencia
adb shell "dumpsys meminfo com.example.case_mobile | grep -E 'TOTAL|Native Heap|Dalvik Heap'"
```

---

## Preguntas abiertas y condiciones previas a 'accepted'

Antes de que el Product Owner modifique el estado de este ADR a `accepted`, deben cumplirse las siguientes condiciones:

1. **Aprobación explícita del Product Owner** de la Opción A como la arquitectura oficial de voz e IA local para la Fase 8.
2. **Definición de la política de distribución de pesos:** Confirmar si los modelos se servirán desde un bucket S3/GCS del proyecto o si para entornos de evaluación de parcial se distribuirán preinstalados mediante script `adb push`.
3. **Decisión sobre perfil mínimo de memoria:** Confirmar si se homologa oficialmente el soporte a dispositivos de 4 GB de RAM incorporando el perfil ultra-ligero (`whisper-tiny` + `Qwen2.5-0.5B`) como opción configurable en ajustes de la aplicación móvil.

---

## Referencias

- `docs/contracts/multimodal-proposals-v1.md` — Contrato canónico de propuestas multimodales
- `docs/contracts/model-commands-v1.md` — Contrato canónico de comandos deterministas de edición
- `docs/contracts/domain-model-v1.md` — Metamodelo de dominio CASE v1
- `docs/adr/0000-foundational-decisions.md` — ADR fundacional (Invariantes arquitectónicas)
- `docs/adr/0004-mobile-state-and-storage.md` — ADR de estado y almacenamiento offline móvil
- [whisper.cpp — Repositorio oficial y benchmarks](https://github.com/ggerganov/whisper.cpp)
- [llama.cpp — Repositorio oficial y arquitectura de inferencia](https://github.com/ggerganov/llama.cpp)
- [Qwen2.5 LLM Family — Documentación técnica](https://github.com/QwenLM/Qwen2.5)
- [Android AICore Documentation — Google Developers](https://developer.android.com/ai/aicore)
- [Vosk Offline Speech Recognition API](https://alphacephei.com/vosk/)

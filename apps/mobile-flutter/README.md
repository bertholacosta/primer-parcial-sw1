# Mobile Flutter

Cliente dinámico controlado por `domain-model.json` o su descriptor
versionado. Android, operación offline, voz e IA local (ADR-0005).

## Reconocimiento de voz local (P8-002)

Escenario acordado (ADR-0005, Opción A): push-to-talk → captura PCM
16 kHz mono (`AudioRecord`) → whisper.cpp on-device vía JNI →
`VoiceProposalAdapter` → `MultimodalProposal` confirmable. Sin red en
ningún paso: funciona en modo avión.

- `lib/services/local_speech_recognizer.dart` — `LocalSpeechRecognizer`,
  `SpeechAudio`, `SpeechTranscript`, `WhisperChannelRecognizer` y
  `MethodChannelAudioCapture` sobre el canal `case_mobile/local_asr`.
- `lib/services/voice_input_pipeline.dart` — `VoiceProposalService`:
  audio → transcripción → propuesta confirmable. Los errores de
  reconocimiento se registran como propuestas INVALID auditables con el
  código del catálogo §7 del contrato en `dryRunValidation.errors`.
- `android/app/src/main/cpp/` — `whisper_jni.cpp` + `CMakeLists.txt`.
  Sin `WHISPER_CPP_DIR` se compila un stub y la app reporta
  `SPEECH_RECOGNIZER_UNAVAILABLE` (degradación controlada).
- Permisos: `RECORD_AUDIO` (runtime) y `android:largeHeap="true"`.

## Interpretación local de IA (P8-003)

Segunda etapa del pipeline secuencial de ADR-0005 (Opción A): tras la
transcripción, el SLM on-device (llama.cpp + Qwen2.5-1.5B-Instruct GGUF
Q4_K_M) interpreta el texto y produce comandos `model-commands-v1`
estructurados. La salida nunca muta el modelo: pasa por el dry-run
determinista (`ModelCommandProcessor`) y exige confirmación explícita
(MP-INV-1/2/3). Si el motor o los pesos no están disponibles, el
pipeline degrada al parser determinista sin perder el escenario.

- `lib/services/local_interpreter.dart` — `LocalInterpreter`,
  `InterpretationResult`, `SlmPromptBuilder` y
  `LlamaChannelInterpreter` sobre el canal `case_mobile/local_slm`.
- `lib/services/voice_proposal_adapter.dart` —
  `proposeFromInterpretation`: envuelve los comandos del SLM (envelope
  sellado localmente), adjunta la evidencia `inference_rationale` con la
  latencia registrada y aplica el mismo dry-run que el parser.
- `android/app/src/main/cpp/llama_jni.cpp` — bridge llama.cpp; sin
  `LLAMA_CPP_DIR` se compila un stub y la app reporta `SLM_UNAVAILABLE`.
- `android/app/src/main/kotlin/.../LlamaEngine.kt` +
  `LocalSlmMethodHandler.kt` — generación por prompt con ciclo de vida
  secuencial (`nativeInit` → `nativeGenerate` → `nativeFree`) y pesos en
  `models/qwen2.5-1.5b-instruct-q4_k_m.gguf` bajo el directorio privado.
- `tool/local_ai_proposals_gate.ps1` — compuerta offline: descarga de
  pesos, modo avión, escenario intención → propuesta y verificación del
  presupuesto de memoria (< 1.8 GB RSS).
- `test/local_ai_pipeline_test.dart` — prueba offline en CI del corpus
  T1–T5 de ADR-0005: propuestas validadas, evidenciadas y confirmables,
  presupuesto de latencia (< 5 s) y cero mutación sin confirmación.

## Validación

```powershell
git diff --check -- apps/mobile-flutter
Push-Location apps/mobile-flutter; flutter analyze; Pop-Location
Push-Location apps/mobile-flutter; flutter test; Pop-Location
```

Compuertas en dispositivo/emulador (ADR-0005, modo avión):

```powershell
Push-Location apps/mobile-flutter
pwsh tool/voice_android_gate.ps1          # P8-002: etapa ASR whisper.cpp
pwsh tool/local_ai_proposals_gate.ps1     # P8-003: etapa SLM llama.cpp
Pop-Location
```

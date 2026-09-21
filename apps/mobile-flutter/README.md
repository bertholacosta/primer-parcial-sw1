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

## Validación

```powershell
git diff --check -- apps/mobile-flutter
Push-Location apps/mobile-flutter; flutter analyze; Pop-Location
Push-Location apps/mobile-flutter; flutter test; Pop-Location
```

Compuerta en dispositivo/emulador (ADR-0005, modo avión):

```powershell
Push-Location apps/mobile-flutter
pwsh tool/voice_android_gate.ps1
Pop-Location
```

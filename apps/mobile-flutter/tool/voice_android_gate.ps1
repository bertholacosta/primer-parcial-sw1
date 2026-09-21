#Requires -Version 7.0
<#
.SYNOPSIS
  Compuerta reproducible del escenario de voz local (P8-002 / ADR-0005).

.DESCRIPTION
  Prepara whisper.cpp y los pesos del modelo, compila el APK con el bridge
  JNI, lo instala en el dispositivo/emulador definido por ADR-0005 (API 34,
  arm64-v8a o x86_64), activa el modo avión y ejecuta el escenario
  push-to-talk -> propuesta confirmable. Sin WHISPER_CPP_DIR el APK se
  compila con la librería stub y la app debe reportar
  SPEECH_RECOGNIZER_UNAVAILABLE.

  Ejecutar desde apps/mobile-flutter:
    pwsh tool/voice_android_gate.ps1 [-WhisperCppDir <path>] [-SkipAirplane]

.PARAMETER WhisperCppDir
  Checkout local de https://github.com/ggerganov/whisper.cpp. Si no se
  indica, se clona en build/whisper.cpp (requiere red una sola vez).

.PARAMETER ModelPath
  Ruta local del modelo ggml-base (whisper-base q5_1, ~142 MB). Si falta,
  se descarga desde HuggingFace como indica ADR-0005.

.PARAMETER Serial
  Serial adb del dispositivo/emulador objetivo (por defecto: el primero).
#>
param(
  [string]$WhisperCppDir = $env:WHISPER_CPP_DIR,
  [string]$ModelPath = "build/models/ggml-base.bin",
  [string]$Serial = "",
  [switch]$SkipModelFetch,
  [switch]$SkipAirplaneToggle
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)  # apps/mobile-flutter
$pkg = 'com.example.mobile_flutter'
$deviceModelDir = "/sdcard/Android/data/$pkg/files/models"

function Invoke-Adb([string[]]$AdbArgs) {
  $full = @(); if ($Serial) { $full += @('-s', $Serial) }; $full += $AdbArgs
  & adb @full
}

Write-Host '== 0. Herramientas =='
flutter --version | Select-Object -First 1
adb version | Select-Object -First 1
if (-not $Serial) {
  $Serial = (adb devices | Select-String '\tdevice$' | Select-Object -First 1).ToString().Split("`t")[0]
}
if (-not $Serial) { throw 'No hay dispositivo/emulador adb conectado.' }
Write-Host "Dispositivo objetivo: $Serial"
Invoke-Adb @('shell', 'getprop ro.build.version.sdk; getprop ro.product.cpu.abi')

Write-Host '== 1. Fuentes whisper.cpp =='
if (-not $WhisperCppDir) {
  $WhisperCppDir = 'build/whisper.cpp'
  if (-not (Test-Path $WhisperCppDir)) {
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp $WhisperCppDir
  }
}
$env:WHISPER_CPP_DIR = (Resolve-Path $WhisperCppDir).Path
Write-Host "WHISPER_CPP_DIR=$env:WHISPER_CPP_DIR"

Write-Host '== 2. Pesos del modelo ASR =='
if (-not (Test-Path $ModelPath)) {
  if ($SkipModelFetch) { throw "Modelo no encontrado: $ModelPath" }
  New-Item -ItemType Directory -Force (Split-Path $ModelPath) | Out-Null
  Invoke-WebRequest -Uri 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' `
    -OutFile $ModelPath
}
Get-FileHash -Algorithm SHA256 $ModelPath
Invoke-Adb @('shell', "mkdir -p $deviceModelDir")
Invoke-Adb @('push', $ModelPath, "$deviceModelDir/ggml-base-q5_1.bin")

Write-Host '== 3. Compilación e instalación =='
flutter build apk --debug
Invoke-Adb @('install', '-r', 'build/app/outputs/flutter-apk/app-debug.apk')

Write-Host '== 4. Modo avión (offline estricto) =='
if (-not $SkipAirplaneToggle) {
  Invoke-Adb @('shell', 'settings put global airplane_mode_on 1')
  Invoke-Adb @('shell', 'am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true')
  Invoke-Adb @('shell', 'settings get global airplane_mode_on')
}

Write-Host '== 5. Escenario: PTT -> propuesta confirmable =='
Invoke-Adb @('shell', "am start -n $pkg/.MainActivity")
Invoke-Adb @('shell', 'input keyevent KEYCODE_WAKEUP')
Write-Host @'
Manual: abrir "Onboarding guiado", mantener el micrófono y dictar la
locución T1 del corpus ADR-0005:
  "Crear clase Cliente con id de tipo String obligatorio y email de tipo
   String opcional"
La propuesta debe llegar a awaiting_confirmation con dryRun VALID y la
evidencia audio_segment con mediaSha256 del buffer capturado.
'@
Invoke-Adb @('logcat', '-d', '-s', 'flutter', 'WhisperEngine')

Write-Host '== 6. Restaurar conectividad =='
if (-not $SkipAirplaneToggle) {
  Invoke-Adb @('shell', 'settings put global airplane_mode_on 0')
  Invoke-Adb @('shell', 'am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false')
}
Write-Host 'GATE P8-002 completado.'

#Requires -Version 7.0
<#
.SYNOPSIS
  Compuerta reproducible del escenario de interpretación local (P8-003 /
  ADR-0005, Opción A — etapa SLM).

.DESCRIPTION
  Prepara llama.cpp y los pesos del modelo Qwen2.5-1.5B-Instruct (GGUF
  Q4_K_M), compila el APK con el bridge JNI, lo instala en el
  dispositivo/emulador definido por ADR-0005 (API 34, arm64-v8a o
  x86_64), activa el modo avión y ejecuta el escenario de interpretación:
  intención -> SLM on-device -> propuesta confirmable, exigiendo
  validación determinista y confirmación humana antes de cualquier
  mutación del modelo. Sin LLAMA_CPP_DIR el APK se compila con la
  librería stub y la app debe reportar SLM_UNAVAILABLE (degradación al
  adaptador determinista).

  Ejecutar desde apps/mobile-flutter:
    pwsh tool/local_ai_proposals_gate.ps1 [-LlamaCppDir <path>] [-SkipAirplaneToggle]

.PARAMETER LlamaCppDir
  Checkout local de https://github.com/ggerganov/llama.cpp. Si no se
  indica, se clona en build/llama.cpp (requiere red una sola vez).

.PARAMETER ModelPath
  Ruta local del modelo Qwen2.5-1.5B-Instruct GGUF Q4_K_M (~986 MB). Si
  falta, se descarga desde HuggingFace como indica ADR-0005.

.PARAMETER Serial
  Serial adb del dispositivo/emulador objetivo (por defecto: el primero).

.PARAMETER WhisperCppDir
  Opcional: checkout de whisper.cpp para habilitar también la etapa ASR
  (locución por voz real). Sin él la etapa de voz degrada a
  SPEECH_RECOGNIZER_UNAVAILABLE pero el escenario de interpretación por
  texto sigue siendo válido.
#>
param(
  [string]$LlamaCppDir = $env:LLAMA_CPP_DIR,
  [string]$WhisperCppDir = $env:WHISPER_CPP_DIR,
  [string]$ModelPath = "build/models/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  [string]$Serial = "",
  [switch]$SkipModelFetch,
  [switch]$SkipAirplaneToggle
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)  # apps/mobile-flutter
$pkg = 'com.example.mobile_flutter'
$deviceModelDir = "/sdcard/Android/data/$pkg/files/models"
$memoryBudgetKb = 1835008  # ADR-0005: pico RSS < 1.8 GB

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

Write-Host '== 1. Fuentes llama.cpp =='
if (-not $LlamaCppDir) {
  $LlamaCppDir = 'build/llama.cpp'
  if (-not (Test-Path $LlamaCppDir)) {
    git clone --depth 1 https://github.com/ggerganov/llama.cpp $LlamaCppDir
  }
}
$env:LLAMA_CPP_DIR = (Resolve-Path $LlamaCppDir).Path
Write-Host "LLAMA_CPP_DIR=$env:LLAMA_CPP_DIR"
if ($WhisperCppDir) {
  $env:WHISPER_CPP_DIR = (Resolve-Path $WhisperCppDir).Path
  Write-Host "WHISPER_CPP_DIR=$env:WHISPER_CPP_DIR"
}

Write-Host '== 2. Pesos del modelo SLM =='
if (-not (Test-Path $ModelPath)) {
  if ($SkipModelFetch) { throw "Modelo no encontrado: $ModelPath" }
  New-Item -ItemType Directory -Force (Split-Path $ModelPath) | Out-Null
  Invoke-WebRequest -Uri 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf' `
    -OutFile $ModelPath
}
Get-FileHash -Algorithm SHA256 $ModelPath
Invoke-Adb @('shell', "mkdir -p $deviceModelDir")
Invoke-Adb @('push', $ModelPath, "$deviceModelDir/qwen2.5-1.5b-instruct-q4_k_m.gguf")

Write-Host '== 3. Compilación e instalación =='
flutter build apk --debug
Invoke-Adb @('install', '-r', 'build/app/outputs/flutter-apk/app-debug.apk')

Write-Host '== 4. Modo avión (offline estricto) =='
if (-not $SkipAirplaneToggle) {
  Invoke-Adb @('shell', 'settings put global airplane_mode_on 1')
  Invoke-Adb @('shell', 'am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true')
  Invoke-Adb @('shell', 'settings get global airplane_mode_on')
}

Write-Host '== 5. Escenario: intención -> SLM -> propuesta confirmable =='
Invoke-Adb @('shell', "am start -n $pkg/.MainActivity")
Invoke-Adb @('shell', 'input keyevent KEYCODE_WAKEUP')
Write-Host @'
Manual: abrir "Onboarding guiado" e ingresar la intención T1 del corpus
ADR-0005 (texto o voz si el bridge whisper está compilado):
  "Crear clase Cliente con id de tipo String obligatorio y email de tipo
   String opcional"
Verificar:
  1. La propuesta llega a awaiting_confirmation con dry-run VALID y
     source.agentRole = 'android-qwen2.5-slm-local'.
  2. La evidencia inference_rationale registra la interpretación del SLM.
  3. El modelo solo muta tras pulsar "Confirmar" (MP-INV-3).
'@

Write-Host '== 6. Presupuesto de memoria (ADR-0005 < 1.8 GB RSS) =='
$meminfo = Invoke-Adb @('shell', "dumpsys meminfo $pkg")
$totalLine = $meminfo | Select-String 'TOTAL\s+(\d+)' | Select-Object -First 1
if ($totalLine -and $totalLine.Matches[0].Groups[1].Value) {
  $totalKb = [int64]$totalLine.Matches[0].Groups[1].Value
  Write-Host "TOTAL RSS: $totalKb KB (presupuesto: $memoryBudgetKb KB)"
  if ($totalKb -gt $memoryBudgetKb) {
    Write-Warning 'El pico de memoria supera el presupuesto aprobado por ADR-0005.'
  }
} else {
  Write-Host 'No se pudo leer dumpsys meminfo; registrar manualmente durante la inferencia.'
}
Invoke-Adb @('logcat', '-d', '-s', 'flutter', 'LlamaEngine')

Write-Host '== 7. Restaurar conectividad =='
if (-not $SkipAirplaneToggle) {
  Invoke-Adb @('shell', 'settings put global airplane_mode_on 0')
  Invoke-Adb @('shell', 'am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false')
}
Write-Host 'GATE P8-003 completado.'

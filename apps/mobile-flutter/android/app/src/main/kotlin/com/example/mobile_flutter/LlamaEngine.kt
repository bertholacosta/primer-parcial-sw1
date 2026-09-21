package com.example.mobile_flutter

import android.content.Context
import android.os.SystemClock
import android.util.Log
import java.io.File

/**
 * JNI bridge to llama.cpp (ADR-0005, Opción A — SLM stage).
 *
 * The native library `libllama_jni.so` is built by
 * `android/app/src/main/cpp/CMakeLists.txt`. When the build runs without
 * `LLAMA_CPP_DIR` the CMake project produces a stub whose
 * [nativeBackendReady] returns false, so [isAvailable] degrades
 * gracefully instead of crashing — the Dart layer then reports
 * `SLM_UNAVAILABLE` and falls back to the deterministic parser.
 *
 * Lifecycle follows the ADR's sequential memory policy: the model and
 * context are loaded per interpretation ([nativeInit]), used once
 * ([nativeGenerate]) and released immediately ([nativeFree]) so the SLM
 * heap never overlaps with the ASR stage. Weights are mmap'd by
 * llama.cpp, keeping the RSS peak inside the ~1.8 GB budget.
 */
class LlamaEngine(private val context: Context) {

    /** Structured failure surfaced to Dart as a PlatformException code. */
    class SlmException(val code: String, override val message: String) :
        Exception(message)

    private external fun nativeBackendReady(): Boolean
    private external fun nativeInit(
        modelPath: String,
        threads: Int,
        ctxSize: Int,
    ): Boolean
    private external fun nativeGenerate(prompt: String, maxTokens: Int): String
    private external fun nativeFree()

    /** Model weights delivered per ADR-0005 (app-private external dir). */
    fun modelFile(): File =
        File(context.getExternalFilesDir(null), MODEL_RELATIVE_PATH)

    /** True when the native backend is linked and weights are present. */
    fun isAvailable(): Boolean =
        libraryLoaded && nativeBackendReady() && modelFile().exists()

    /**
     * Generates text for [prompt] fully on-device with
     * Qwen2.5-1.5B-Instruct (GGUF Q4_K_M). No network access: safe in
     * airplane mode. Returns the raw output plus the generation latency,
     * which the proposal records as budget evidence.
     */
    @Synchronized
    fun generate(prompt: String, maxTokens: Int): Map<String, Any> {
        if (!isAvailable()) {
            throw SlmException(
                "SLM_UNAVAILABLE",
                "Motor llama.cpp no enlazado o modelo " +
                    "${modelFile().absolutePath} ausente.",
            )
        }
        if (prompt.isBlank()) {
            throw SlmException(
                "INTENT_UNRECOGNIZED",
                "No hay contenido que interpretar.",
            )
        }
        if (!nativeInit(modelFile().absolutePath, THREADS, CTX_SIZE)) {
            throw SlmException(
                "SLM_UNAVAILABLE",
                "llama_init falló al cargar el modelo.",
            )
        }
        try {
            val started = SystemClock.elapsedRealtime()
            val text = nativeGenerate(prompt, maxTokens)
            val elapsedMs = SystemClock.elapsedRealtime() - started
            if (text.isBlank()) {
                throw SlmException(
                    "NO_COMMANDS_GENERATED",
                    "El modelo local no produjo salida interpretable.",
                )
            }
            return mapOf(
                "text" to text,
                "elapsedMs" to elapsedMs,
            )
        } finally {
            nativeFree()
        }
    }

    companion object {
        private const val TAG = "LlamaEngine"
        private const val THREADS = 4

        // ADR-0005: ventana de contexto de 1024 tokens para el SLM más
        // margen para el prompt del sistema con el metamodelo.
        private const val CTX_SIZE = 2048
        private const val MODEL_RELATIVE_PATH =
            "models/qwen2.5-1.5b-instruct-q4_k_m.gguf"

        private val libraryLoaded: Boolean by lazy {
            runCatching { System.loadLibrary("llama_jni") }
                .onFailure { Log.w(TAG, "libllama_jni.so no enlazada", it) }
                .isSuccess
        }
    }
}

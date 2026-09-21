package com.example.mobile_flutter

import android.content.Context
import android.util.Log
import java.io.File

/**
 * JNI bridge to whisper.cpp (ADR-0005, Opción A).
 *
 * The native library `libwhisper_jni.so` is built by
 * `android/app/src/main/cpp/CMakeLists.txt`. When the build runs without
 * `WHISPER_CPP_DIR` the CMake project produces a stub whose
 * [nativeBackendReady] returns false, so [isAvailable] degrades
 * gracefully instead of crashing — the Dart layer then reports
 * `SPEECH_RECOGNIZER_UNAVAILABLE`.
 *
 * Lifecycle follows the ADR's sequential memory policy: the whisper
 * context is loaded per utterance ([nativeInit]), used once
 * ([nativeTranscribe]) and released immediately ([nativeFree]) so the
 * ASR heap never overlaps with later inference stages.
 */
class WhisperEngine(private val context: Context) {

    /** Structured failure surfaced to Dart as a PlatformException code. */
    class AsrException(val code: String, override val message: String) :
        Exception(message)

    private external fun nativeBackendReady(): Boolean
    private external fun nativeInit(modelPath: String, threads: Int): Boolean
    private external fun nativeTranscribe(pcm: ShortArray, sampleRate: Int): String
    private external fun nativeFree()

    /** Model weights delivered per ADR-0005 (app-private external dir). */
    fun modelFile(): File =
        File(context.getExternalFilesDir(null), MODEL_RELATIVE_PATH)

    /** True when the native backend is linked and weights are present. */
    fun isAvailable(): Boolean =
        libraryLoaded && nativeBackendReady() && modelFile().exists()

    /**
     * Transcribes [pcm] (16-bit little-endian mono at [sampleRate]) fully
     * on-device. No network access: safe in airplane mode.
     */
    @Synchronized
    fun transcribe(pcm: ByteArray, sampleRate: Int): Map<String, Any> {
        if (!isAvailable()) {
            throw AsrException(
                "SPEECH_RECOGNIZER_UNAVAILABLE",
                "Motor whisper.cpp no enlazado o modelo " +
                    "${modelFile().absolutePath} ausente.",
            )
        }
        val samples = ShortArray(pcm.size / 2) { i ->
            ((pcm[2 * i + 1].toInt() shl 8) or (pcm[2 * i].toInt() and 0xFF))
                .toShort()
        }
        if (!nativeInit(modelFile().absolutePath, THREADS)) {
            throw AsrException(
                "SPEECH_RECOGNIZER_UNAVAILABLE",
                "whisper_init falló al cargar el modelo.",
            )
        }
        try {
            val text = nativeTranscribe(samples, sampleRate).trim()
            if (text.isEmpty()) {
                throw AsrException(
                    "INTENT_UNRECOGNIZED",
                    "El motor local no produjo texto para la locución.",
                )
            }
            return mapOf(
                "text" to text,
                "startMs" to 0,
                "endMs" to samples.size * 1000 / sampleRate,
                "language" to "es",
            )
        } finally {
            nativeFree()
        }
    }

    companion object {
        private const val TAG = "WhisperEngine"
        private const val THREADS = 4
        private const val MODEL_RELATIVE_PATH = "models/ggml-base-q5_1.bin"

        private val libraryLoaded: Boolean by lazy {
            runCatching { System.loadLibrary("whisper_jni") }
                .onFailure { Log.w(TAG, "libwhisper_jni.so no enlazada", it) }
                .isSuccess
        }
    }
}

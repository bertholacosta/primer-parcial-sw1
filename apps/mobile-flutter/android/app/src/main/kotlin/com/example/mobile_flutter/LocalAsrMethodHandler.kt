package com.example.mobile_flutter

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * MethodChannel bridge for the agreed local voice scenario (ADR-0005,
 * multimodal-proposals-v1 §5.1): push-to-talk PCM capture via
 * [AudioRecord] (16 kHz mono 16-bit) and on-device transcription via
 * [WhisperEngine]. No network access anywhere — airplane-mode safe.
 *
 * Channel: `case_mobile/local_asr`
 *  - `isAvailable`   → Boolean
 *  - `startCapture`  → requests RECORD_AUDIO if needed, then records
 *  - `stopCapture`   → {pcm: ByteArray, sampleRate: Int, durationMs: Int}
 *  - `cancelCapture` → discards the in-progress recording
 *  - `transcribe`    → {text, startMs, endMs, language}
 */
class LocalAsrMethodHandler(private val activity: Activity) {

    companion object {
        const val CHANNEL = "case_mobile/local_asr"
        const val SAMPLE_RATE = 16000
        private const val REQ_RECORD_AUDIO = 7101
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val engine = WhisperEngine(activity)

    @Volatile private var recorder: AudioRecord? = null
    @Volatile private var recording = false
    private var pcmBuffer = ByteArrayOutputStream()
    private var pendingPermissionResult: MethodChannel.Result? = null

    fun register(flutterEngine: FlutterEngine) {
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler(this::onMethodCall)
    }

    private fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "isAvailable" -> result.success(engine.isAvailable())
            "startCapture" -> startCapture(result)
            "stopCapture" -> stopCapture(result)
            "cancelCapture" -> {
                stopRecording()
                result.success(null)
            }
            "transcribe" -> transcribe(call, result)
            else -> result.notImplemented()
        }
    }

    // ---- Capture --------------------------------------------------------

    private fun startCapture(result: MethodChannel.Result) {
        if (recording) {
            result.error("RECORDING_FAILED", "Ya hay una captura en curso.", null)
            return
        }
        if (ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.RECORD_AUDIO,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingPermissionResult = result
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                REQ_RECORD_AUDIO,
            )
            return
        }
        beginRecording()
        result.success(null)
    }

    /** Forwards the runtime-permission answer from [MainActivity]. */
    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != REQ_RECORD_AUDIO) return false
        val pending = pendingPermissionResult
        pendingPermissionResult = null
        if (pending == null) return true
        if (grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        ) {
            beginRecording()
            pending.success(null)
        } else {
            pending.error(
                "RECORDING_PERMISSION_DENIED",
                "El usuario no concedió el permiso de micrófono.",
                null,
            )
        }
        return true
    }

    private fun beginRecording() {
        val minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        pcmBuffer = ByteArrayOutputStream()
        val record = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            minBuffer * 2,
        )
        recorder = record
        recording = true
        record.startRecording()
        executor.execute {
            val chunk = ByteArray(minBuffer)
            while (recording) {
                val read = record.read(chunk, 0, chunk.size)
                if (read > 0) {
                    synchronized(pcmBuffer) { pcmBuffer.write(chunk, 0, read) }
                }
            }
        }
    }

    private fun stopRecording(): ByteArray {
        recording = false
        val record = recorder
        recorder = null
        record?.let {
            runCatching { it.stop() }
            runCatching { it.release() }
        }
        return synchronized(pcmBuffer) { pcmBuffer.toByteArray() }
    }

    private fun stopCapture(result: MethodChannel.Result) {
        val pcm = stopRecording()
        mainHandler.post {
            result.success(
                mapOf(
                    "pcm" to pcm,
                    "sampleRate" to SAMPLE_RATE,
                    "durationMs" to pcm.size / 2 * 1000 / SAMPLE_RATE,
                ),
            )
        }
    }

    // ---- Transcription --------------------------------------------------

    private fun transcribe(call: MethodCall, result: MethodChannel.Result) {
        val pcm = call.argument<ByteArray>("pcm") ?: ByteArray(0)
        val sampleRate = call.argument<Int>("sampleRate") ?: SAMPLE_RATE
        executor.execute {
            try {
                val transcript = engine.transcribe(pcm, sampleRate)
                mainHandler.post { result.success(transcript) }
            } catch (e: WhisperEngine.AsrException) {
                mainHandler.post { result.error(e.code, e.message, null) }
            } catch (e: Exception) {
                mainHandler.post {
                    result.error(
                        "SPEECH_RECOGNIZER_UNAVAILABLE",
                        e.message ?: "Error nativo de reconocimiento.",
                        null,
                    )
                }
            }
        }
    }
}

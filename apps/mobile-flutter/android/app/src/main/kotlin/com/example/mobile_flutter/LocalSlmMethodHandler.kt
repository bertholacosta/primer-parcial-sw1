package com.example.mobile_flutter

import android.app.Activity
import android.os.Handler
import android.os.Looper
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors

/**
 * MethodChannel bridge for the on-device interpretation stage of the
 * agreed scenario (ADR-0005, Opción A; multimodal-proposals-v1 §5.1):
 * the Dart side builds the grammar-oriented prompt and parses the JSON
 * output; this bridge only feeds it to llama.cpp. No network access —
 * airplane-mode safe.
 *
 * Channel: `case_mobile/local_slm`
 *  - `isAvailable` → Boolean
 *  - `generate`    → {text: String, elapsedMs: Long}
 */
class LocalSlmMethodHandler(private val activity: Activity) {

    companion object {
        const val CHANNEL = "case_mobile/local_slm"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val engine = LlamaEngine(activity)

    fun register(flutterEngine: FlutterEngine) {
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler(this::onMethodCall)
    }

    private fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "isAvailable" -> result.success(engine.isAvailable())
            "generate" -> generate(call, result)
            else -> result.notImplemented()
        }
    }

    private fun generate(call: MethodCall, result: MethodChannel.Result) {
        val prompt = call.argument<String>("prompt") ?: ""
        val maxTokens = call.argument<Int>("maxTokens") ?: 512
        executor.execute {
            try {
                val output = engine.generate(prompt, maxTokens)
                mainHandler.post { result.success(output) }
            } catch (e: LlamaEngine.SlmException) {
                mainHandler.post { result.error(e.code, e.message, null) }
            } catch (e: Exception) {
                mainHandler.post {
                    result.error(
                        "SLM_UNAVAILABLE",
                        e.message ?: "Error nativo de interpretación.",
                        null,
                    )
                }
            }
        }
    }
}

package com.example.mobile_flutter

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var asrHandler: LocalAsrMethodHandler? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val handler = LocalAsrMethodHandler(this)
        handler.register(flutterEngine)
        asrHandler = handler
        LocalSlmMethodHandler(this).register(flutterEngine)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        val handler = asrHandler
        if (handler != null &&
            handler.onRequestPermissionsResult(requestCode, grantResults)
        ) {
            return
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }
}

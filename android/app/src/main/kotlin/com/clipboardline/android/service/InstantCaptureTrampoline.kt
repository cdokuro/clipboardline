package com.clipboardline.android.service

import android.os.Bundle
import androidx.activity.ComponentActivity

class InstantCaptureTrampoline : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
        // Wait 180ms so Samsung Edge Panel slides away cleanly, then zero-disk instant snap
        ClipAccessibilityService.requestInstantCapture(applicationContext, delayMs = 180L, dismissShade = true)
    }
}

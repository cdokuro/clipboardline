package com.clipboardline.android.service

import android.os.Bundle
import androidx.activity.ComponentActivity

class InstantCaptureTrampoline : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
        // Wait 320ms so Samsung Edge Panel / Notification shade finishes closing before snapping
        ClipAccessibilityService.requestInstantCapture(applicationContext, delayMs = 320L, dismissShade = true)
    }
}

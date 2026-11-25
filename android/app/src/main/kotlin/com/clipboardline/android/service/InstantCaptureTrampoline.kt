package com.clipboardline.android.service

import android.os.Bundle
import androidx.activity.ComponentActivity

class InstantCaptureTrampoline : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        finish()
        ClipAccessibilityService.requestInstantCapture(applicationContext, delayMs = 240L)
    }
}

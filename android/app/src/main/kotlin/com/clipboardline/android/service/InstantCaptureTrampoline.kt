package com.clipboardline.android.service

import android.os.Bundle
import androidx.activity.ComponentActivity

class InstantCaptureTrampoline : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        finish()
        // Wait 340ms so notification shade / Quick Panel finishes collapsing before snapping
        ClipAccessibilityService.requestInstantCapture(applicationContext, delayMs = 340L)
    }
}

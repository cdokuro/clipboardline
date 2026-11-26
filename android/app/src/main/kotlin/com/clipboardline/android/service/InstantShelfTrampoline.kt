package com.clipboardline.android.service

import android.os.Bundle
import androidx.activity.ComponentActivity

class InstantShelfTrampoline : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
        ClipAccessibilityService.dismissShadeIfReady()
        FloatingEdgeService.toggleShelf(applicationContext)
    }
}

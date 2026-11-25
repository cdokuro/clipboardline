package com.clipboardline.android.service

import android.os.Bundle
import androidx.activity.ComponentActivity

class InstantShelfTrampoline : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        finish()
        FloatingEdgeService.toggleShelf(applicationContext)
    }
}

package com.clipboardline.android.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import com.clipboardline.android.ClipBoardLineApp

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val settings = ClipBoardLineApp.instance.repository.store.value.settings
        if (settings.autoStartOnBoot && settings.edgeHandleEnabled && Settings.canDrawOverlays(context)) {
            FloatingEdgeService.start(context)
        }
    }
}

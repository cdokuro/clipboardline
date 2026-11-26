package com.clipboardline.android.service

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import com.clipboardline.android.ui.capture.CaptureBitmapHolder
import com.clipboardline.android.ui.capture.CaptureEditorActivity
import com.clipboardline.android.ui.capture.ScreenCaptureActivity
import java.io.File
import java.io.FileOutputStream
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

class ClipAccessibilityService : AccessibilityService() {

    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        super.onServiceConnected()
        instanceRef = WeakReference(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not snooping on events; used solely for instant zero-dialog screenshots.
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instanceRef?.get() === this) instanceRef = null
        ioExecutor.shutdownNow()
        super.onDestroy()
    }

    fun dismissNotificationShade() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
            } catch (_: Exception) {}
        }
    }

    fun captureScreenNow(delayMs: Long = 90L, dismissShade: Boolean = false) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            ScreenCaptureActivity.launch(this)
            return
        }
        FloatingEdgeService.setHandleVisible(false)
        if (dismissShade) {
            dismissNotificationShade()
        }
        mainHandler.postDelayed({
            try {
                takeScreenshot(
                    Display.DEFAULT_DISPLAY,
                    ioExecutor,
                    object : TakeScreenshotCallback {
                        override fun onSuccess(screenshot: ScreenshotResult) {
                            try {
                                val hwBuf = screenshot.hardwareBuffer
                                val colorSpace = screenshot.colorSpace
                                val hwBmp = Bitmap.wrapHardwareBuffer(hwBuf, colorSpace)
                                hwBuf.close()
                                if (hwBmp == null) {
                                    restoreHandleAndFallback()
                                    return
                                }
                                val swBmp = hwBmp.copy(Bitmap.Config.ARGB_8888, false)
                                hwBmp.recycle()

                                // Zero-disk in-memory handoff (~15ms vs ~1400ms PNG encode/decode!)
                                val memToken = CaptureBitmapHolder.put(swBmp)

                                mainHandler.post {
                                    FloatingEdgeService.setHandleVisible(true)
                                    startActivity(
                                        CaptureEditorActivity.createIntentFromMemory(
                                            this@ClipAccessibilityService,
                                            memToken
                                        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NO_ANIMATION)
                                    )
                                }
                            } catch (_: Exception) {
                                restoreHandleAndFallback()
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            restoreHandleAndFallback()
                        }
                    }
                )
            } catch (_: Exception) {
                restoreHandleAndFallback()
            }
        }, delayMs)
    }

    private fun restoreHandleAndFallback() {
        mainHandler.post {
            FloatingEdgeService.setHandleVisible(true)
            ScreenCaptureActivity.launch(this)
        }
    }

    companion object {
        @Volatile
        private var instanceRef: WeakReference<ClipAccessibilityService>? = null

        fun isReady(): Boolean = instanceRef?.get() != null

        fun dismissShadeIfReady() {
            instanceRef?.get()?.dismissNotificationShade()
        }

        /**
         * Takes an instant zero-dialog screenshot if AccessibilityService is active;
         * otherwise falls back to MediaProjection flow.
         */
        fun requestInstantCapture(context: Context, delayMs: Long = 90L, dismissShade: Boolean = false) {
            val svc = instanceRef?.get()
            if (svc != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                svc.captureScreenNow(delayMs, dismissShade)
            } else {
                ScreenCaptureActivity.launch(context)
            }
        }
    }
}

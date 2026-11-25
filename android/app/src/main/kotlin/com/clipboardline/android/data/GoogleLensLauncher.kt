package com.clipboardline.android.data

import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

object GoogleLensLauncher {

    private const val GOOGLE_APP_PKG = "com.google.android.googlequicksearchbox"
    private const val LENS_SHARE_ACTIVITY = "com.google.android.apps.search.lens.LensShareEntryPointActivity"
    private const val LENS_STANDALONE_PKG = "com.google.ar.lens"

    suspend fun searchBitmap(context: Context, bitmap: Bitmap): Boolean = withContext(Dispatchers.IO) {
        val scaled = scaleDown(bitmap, 1800)
        val outDir = File(context.cacheDir, "shared").apply { mkdirs() }
        // Keep cache tidy
        outDir.listFiles()?.filter { it.name.startsWith("lens_") && System.currentTimeMillis() - it.lastModified() > 600_000 }?.forEach { it.delete() }
        val outFile = File(outDir, "lens_${System.currentTimeMillis()}.jpg")
        FileOutputStream(outFile).use { fos ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 92, fos)
        }
        if (scaled !== bitmap) scaled.recycle()
        withContext(Dispatchers.Main) {
            launchNativeLens(context, outFile)
        }
    }

    suspend fun searchFile(context: Context, file: File): Boolean = withContext(Dispatchers.IO) {
        if (!file.exists()) return@withContext false
        val bmp = BitmapFactory.decodeFile(file.absolutePath) ?: return@withContext false
        try {
            searchBitmap(context, bmp)
        } finally {
            bmp.recycle()
        }
    }

    private fun launchNativeLens(context: Context, imageFile: File): Boolean {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", imageFile)

        // 1. Direct native Google Lens share entry point (verified on Samsung S23 Ultra / Android 11-17)
        val baseSend = Intent(Intent.ACTION_SEND).apply {
            type = "image/jpeg"
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newRawUri("Google Lens", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        // Resolve exact Lens activity dynamically first so it adapts across Google App updates
        val pm = context.packageManager
        val resolved = try {
            pm.queryIntentActivities(baseSend, PackageManager.MATCH_DEFAULT_ONLY)
        } catch (_: Exception) {
            emptyList()
        }

        val lensTarget = resolved.firstOrNull {
            it.activityInfo.packageName == GOOGLE_APP_PKG &&
                it.activityInfo.name.contains("Lens", ignoreCase = true)
        } ?: resolved.firstOrNull {
            it.activityInfo.packageName == LENS_STANDALONE_PKG
        } ?: resolved.firstOrNull {
            it.activityInfo.packageName == GOOGLE_APP_PKG
        }

        if (lensTarget != null) {
            val pkg = lensTarget.activityInfo.packageName
            val cls = lensTarget.activityInfo.name
            try {
                context.grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                val directIntent = Intent(baseSend).apply {
                    component = ComponentName(pkg, cls)
                }
                context.startActivity(directIntent)
                return true
            } catch (_: Exception) {}
        }

        // 2. Explicit known component fallback
        try {
            context.grantUriPermission(GOOGLE_APP_PKG, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val explicit = Intent(baseSend).apply {
                component = ComponentName(GOOGLE_APP_PKG, LENS_SHARE_ACTIVITY)
            }
            context.startActivity(explicit)
            return true
        } catch (_: Exception) {}

        // 3. Final fallback: Android share chooser (user can pick Lens/Circle/etc.)
        return try {
            val chooser = Intent.createChooser(baseSend, "Google Lens ile Ara").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            true
        } catch (_: Exception) {
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://lens.google.com/")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                true
            } catch (_: Exception) {
                false
            }
        }
    }

    private fun scaleDown(src: Bitmap, maxEdge: Int): Bitmap {
        val maxDim = maxOf(src.width, src.height)
        if (maxDim <= maxEdge || maxDim <= 0) return src
        val ratio = maxEdge.toFloat() / maxDim.toFloat()
        val nw = maxOf(1, (src.width * ratio).toInt())
        val nh = maxOf(1, (src.height * ratio).toInt())
        return Bitmap.createScaledBitmap(src, nw, nh, true)
    }
}

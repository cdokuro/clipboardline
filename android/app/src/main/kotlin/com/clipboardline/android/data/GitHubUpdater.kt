package com.clipboardline.android.data

import com.clipboardline.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object GitHubUpdater {
    private const val REPO = "cdokuro/clipboardline"

    suspend fun checkLatest(): UpdateInfo = withContext(Dispatchers.IO) {
        val current = BuildConfig.VERSION_NAME
        try {
            val conn = (URL("https://api.github.com/repos/$REPO/releases/latest").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("Accept", "application/vnd.github+json")
                setRequestProperty("User-Agent", "ClipBoardLine-Android/$current")
            }
            val code = conn.responseCode
            if (code == 200) {
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(body)
                val tag = json.optString("tag_name", "").removePrefix("android-v").removePrefix("v")
                val url = json.optString("html_url", "https://github.com/$REPO/releases")
                val newer = tag.isNotBlank() && compareSemver(tag, current) > 0
                return@withContext UpdateInfo(
                    currentVersion = current,
                    latestVersion = tag.ifBlank { current },
                    releaseUrl = url,
                    hasUpdate = newer
                )
            }
            UpdateInfo(currentVersion = current, latestVersion = current, releaseUrl = "https://github.com/$REPO/releases", hasUpdate = false)
        } catch (e: Exception) {
            UpdateInfo(currentVersion = current, error = e.message)
        }
    }

    private fun compareSemver(a: String, b: String): Int {
        val pa = a.split(".").map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
        val pb = b.split(".").map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val diff = pa.getOrElse(i) { 0 } - pb.getOrElse(i) { 0 }
            if (diff != 0) return diff
        }
        return 0
    }
}

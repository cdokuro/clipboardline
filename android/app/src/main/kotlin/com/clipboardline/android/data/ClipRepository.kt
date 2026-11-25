package com.clipboardline.android.data

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Patterns
import androidx.core.content.FileProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.UUID

class ClipRepository(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = false
    }
    private val storeMutex = Mutex()
    private val storeFile = File(context.filesDir, "clipboardline_store.json")
    val mediaDir = File(context.filesDir, "media").apply { mkdirs() }

    private val _store = MutableStateFlow(loadInitial())
    val store: StateFlow<ClipStoreData> = _store.asStateFlow()

    private val _toasts = MutableSharedFlow<String>(extraBufferCapacity = 16)
    val toasts: SharedFlow<String> = _toasts.asSharedFlow()

    @Volatile
    private var lastOwnFingerprint: String = ""

    @Volatile
    private var lastSeenFingerprint: String = ""

    private fun loadInitial(): ClipStoreData {
        return try {
            if (storeFile.exists()) {
                json.decodeFromString<ClipStoreData>(storeFile.readText(Charsets.UTF_8))
            } else {
                ClipStoreData()
            }
        } catch (_: Exception) {
            ClipStoreData()
        }
    }

    private suspend fun mutate(transform: (ClipStoreData) -> ClipStoreData) {
        storeMutex.withLock {
            val updated = transform(_store.value)
            _store.value = updated
            persistLocked(updated)
        }
    }

    private fun persistLocked(data: ClipStoreData) {
        try {
            val tmp = File(context.filesDir, "clipboardline_store.json.tmp")
            tmp.writeText(json.encodeToString(data), Charsets.UTF_8)
            if (!tmp.renameTo(storeFile)) {
                tmp.copyTo(storeFile, overwrite = true)
                tmp.delete()
            }
        } catch (_: Exception) {}
    }

    fun emitToast(message: String) {
        _toasts.tryEmit(message)
    }

    fun mediaFile(item: ClipItem): File? {
        val name = item.imageFile ?: return null
        return File(mediaDir, name)
    }

    private fun sha256(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun detectUrl(text: String): String? {
        val trimmed = text.trim()
        if (trimmed.contains('\n') || trimmed.contains(' ')) return null
        if (!trimmed.startsWith("http://", ignoreCase = true) &&
            !trimmed.startsWith("https://", ignoreCase = true)
        ) return null
        return if (Patterns.WEB_URL.matcher(trimmed).matches()) trimmed else null
    }

    fun captureFromSystemClipboard(force: Boolean = false) {
        scope.launch {
            try {
                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = cm.primaryClip ?: return@launch
                if (clip.itemCount == 0) return@launch
                val clipItem = clip.getItemAt(0)

                val uri = clipItem.uri
                if (uri != null) {
                    val mime = context.contentResolver.getType(uri) ?: ""
                    if (mime.startsWith("image/")) {
                        if (!_store.value.settings.captureImages) return@launch
                        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        if (bytes != null && bytes.isNotEmpty()) {
                            insertImageBytes(bytes, force = force)
                            return@launch
                        }
                    }
                }

                val text = clipItem.coerceToText(context)?.toString()?.trim() ?: return@launch
                if (text.isBlank()) return@launch
                insertTextOrLink(text, force = force)
            } catch (_: Exception) {}
        }
    }

    suspend fun insertTextOrLink(rawText: String, title: String = "", force: Boolean = false): ClipItem? {
        val trimmed = rawText.trim()
        if (trimmed.isBlank()) return null
        val settings = _store.value.settings
        val detectedUrl = if (settings.captureLinks) detectUrl(trimmed) else null
        val kind = if (detectedUrl != null) ClipKind.LINK else ClipKind.TEXT
        if (kind == ClipKind.TEXT && !settings.captureText && !force) return null
        if (kind == ClipKind.LINK && !settings.captureLinks && !force) return null

        val fp = "${kind.name.lowercase()}:${sha256(trimmed.toByteArray(Charsets.UTF_8))}"
        if (!force && (fp == lastOwnFingerprint || fp == lastSeenFingerprint)) {
            if (fp == lastOwnFingerprint) lastOwnFingerprint = ""
            return null
        }
        lastSeenFingerprint = fp

        val now = System.currentTimeMillis()
        var result: ClipItem? = null
        mutate { data ->
            val existing = data.items.firstOrNull { it.fingerprint == fp && it.trashedAt == null }
            if (existing != null) {
                val bumped = existing.copy(lastCopiedAt = now)
                result = bumped
                data.copy(items = listOf(bumped) + data.items.filterNot { it.id == existing.id })
            } else {
                val hostTitle = if (kind == ClipKind.LINK && title.isBlank()) {
                    try { Uri.parse(detectedUrl).host?.removePrefix("www.") ?: (detectedUrl ?: "") } catch (_: Exception) { detectedUrl ?: "" }
                } else title
                val created = ClipItem(
                    id = UUID.randomUUID().toString(),
                    kind = kind,
                    text = if (kind == ClipKind.TEXT) trimmed else "",
                    url = detectedUrl ?: "",
                    title = hostTitle,
                    fingerprint = fp,
                    createdAt = now,
                    lastCopiedAt = now
                )
                result = created
                trimHistory(data.copy(items = listOf(created) + data.items))
            }
        }
        return result
    }

    suspend fun insertImageBytes(bytes: ByteArray, title: String = "", force: Boolean = false): ClipItem? {
        if (bytes.isEmpty()) return null
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        return try {
            insertImageBitmap(bmp, title = title, force = force)
        } finally {
            bmp.recycle()
        }
    }

    suspend fun insertImageBitmap(bitmap: Bitmap, title: String = "", force: Boolean = false): ClipItem? {
        val baos = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, baos)
        val pngBytes = baos.toByteArray()
        val fp = "image:${sha256(pngBytes)}"
        if (!force && (fp == lastOwnFingerprint || fp == lastSeenFingerprint)) {
            if (fp == lastOwnFingerprint) lastOwnFingerprint = ""
            return null
        }
        lastSeenFingerprint = fp

        val now = System.currentTimeMillis()
        var result: ClipItem? = null
        mutate { data ->
            val existing = data.items.firstOrNull { it.fingerprint == fp && it.trashedAt == null }
            if (existing != null) {
                val bumped = existing.copy(lastCopiedAt = now)
                result = bumped
                data.copy(items = listOf(bumped) + data.items.filterNot { it.id == existing.id })
            } else {
                val id = UUID.randomUUID().toString()
                val fileName = "$id.png"
                File(mediaDir, fileName).writeBytes(pngBytes)
                val created = ClipItem(
                    id = id,
                    kind = ClipKind.IMAGE,
                    title = title,
                    imageFile = fileName,
                    width = bitmap.width,
                    height = bitmap.height,
                    fingerprint = fp,
                    createdAt = now,
                    lastCopiedAt = now
                )
                result = created
                trimHistory(data.copy(items = listOf(created) + data.items))
            }
        }
        val inserted = result
        if (inserted != null && _store.value.settings.autoOcr && inserted.ocrText.isBlank()) {
            scope.launch {
                val file = mediaFile(inserted) ?: return@launch
                val recognized = OcrEngine.recognizeFile(file)
                if (recognized.isNotBlank()) {
                    setOcrText(inserted.id, recognized)
                }
            }
        }
        return inserted
    }

    suspend fun insertImageUri(uri: Uri, title: String = ""): ClipItem? {
        val bytes = try {
            context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        } catch (_: Exception) {
            null
        } ?: return null
        return insertImageBytes(bytes, title = title, force = true)
    }

    private fun trimHistory(data: ClipStoreData): ClipStoreData {
        val max = data.settings.maxHistoryItems.coerceIn(50, 2000)
        val active = data.items.filter { it.trashedAt == null }
        if (active.size <= max) return data
        val keep = mutableListOf<ClipItem>()
        val drop = mutableListOf<ClipItem>()
        for (item in active) {
            if (item.pinned || item.folderId != null || keep.size < max) {
                keep.add(item)
            } else {
                drop.add(item)
            }
        }
        drop.forEach { it.imageFile?.let { fn -> File(mediaDir, fn).delete() } }
        val trashed = data.items.filter { it.trashedAt != null }
        return data.copy(items = keep + trashed)
    }

    fun copyToSystemClipboard(item: ClipItem, notify: Boolean = true) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        lastOwnFingerprint = item.fingerprint
        lastSeenFingerprint = item.fingerprint
        when (item.kind) {
            ClipKind.TEXT -> {
                cm.setPrimaryClip(ClipData.newPlainText("ClipBoardLine", item.text))
            }
            ClipKind.LINK -> {
                cm.setPrimaryClip(ClipData.newPlainText("ClipBoardLine", item.url))
            }
            ClipKind.IMAGE -> {
                val file = mediaFile(item)
                if (file != null && file.exists()) {
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                    val clip = ClipData.newUri(context.contentResolver, "ClipBoardLine Image", uri)
                    cm.setPrimaryClip(clip)
                }
            }
        }
        scope.launch {
            mutate { data ->
                data.copy(items = data.items.map {
                    if (it.id == item.id) it.copy(lastCopiedAt = System.currentTimeMillis()) else it
                })
            }
        }
        if (notify) emitToast("Panoya kopyalandı")
    }

    fun copyPlainText(text: String, toastMsg: String = "Metin panoya kopyalandı") {
        if (text.isBlank()) return
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val fp = "text:${sha256(text.trim().toByteArray(Charsets.UTF_8))}"
        lastOwnFingerprint = fp
        lastSeenFingerprint = fp
        cm.setPrimaryClip(ClipData.newPlainText("ClipBoardLine", text))
        emitToast(toastMsg)
    }

    fun shareItem(callerContext: Context, item: ClipItem) {
        val intent = when (item.kind) {
            ClipKind.TEXT -> Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, item.text)
            }
            ClipKind.LINK -> Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, item.url)
            }
            ClipKind.IMAGE -> {
                val file = mediaFile(item) ?: return
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                Intent(Intent.ACTION_SEND).apply {
                    type = "image/png"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            }
        }
        val chooser = Intent.createChooser(intent, "Paylaş").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        callerContext.startActivity(chooser)
    }

    suspend fun togglePin(id: String) = mutate { data ->
        data.copy(items = data.items.map { if (it.id == id) it.copy(pinned = !it.pinned) else it })
    }

    suspend fun updateTitle(id: String, title: String) = mutate { data ->
        data.copy(items = data.items.map { if (it.id == id) it.copy(title = title.trim()) else it })
    }

    suspend fun updateText(id: String, text: String) = mutate { data ->
        data.copy(items = data.items.map { if (it.id == id) it.copy(text = text) else it })
    }

    suspend fun setFolder(id: String, folderId: String?) = mutate { data ->
        data.copy(items = data.items.map { if (it.id == id) it.copy(folderId = folderId) else it })
    }

    suspend fun setTags(id: String, tags: List<String>) = mutate { data ->
        val clean = tags.map { it.trim().removePrefix("#") }.filter { it.isNotBlank() }.distinct()
        data.copy(items = data.items.map { if (it.id == id) it.copy(tags = clean) else it })
    }

    suspend fun setOcrText(id: String, ocrText: String) = mutate { data ->
        data.copy(items = data.items.map { if (it.id == id) it.copy(ocrText = ocrText) else it })
    }

    suspend fun trashItem(id: String) = mutate { data ->
        val now = System.currentTimeMillis()
        data.copy(items = data.items.map { if (it.id == id) it.copy(trashedAt = now) else it })
    }

    suspend fun restoreItem(id: String) = mutate { data ->
        data.copy(items = data.items.map { if (it.id == id) it.copy(trashedAt = null) else it })
    }

    suspend fun deleteForever(id: String) = mutate { data ->
        data.items.firstOrNull { it.id == id }?.imageFile?.let { File(mediaDir, it).delete() }
        data.copy(items = data.items.filterNot { it.id == id })
    }

    suspend fun emptyTrash() = mutate { data ->
        data.items.filter { it.trashedAt != null }.forEach { it.imageFile?.let { fn -> File(mediaDir, fn).delete() } }
        data.copy(items = data.items.filter { it.trashedAt == null })
    }

    suspend fun createFolder(name: String): ClipFolder? {
        val clean = name.trim()
        if (clean.isBlank()) return null
        val folder = ClipFolder(id = UUID.randomUUID().toString(), name = clean)
        mutate { data -> data.copy(folders = data.folders + folder) }
        return folder
    }

    suspend fun deleteFolder(folderId: String) = mutate { data ->
        data.copy(
            folders = data.folders.filterNot { it.id == folderId },
            items = data.items.map { if (it.folderId == folderId) it.copy(folderId = null) else it }
        )
    }

    suspend fun updateSettings(transform: (ClipSettings) -> ClipSettings) = mutate { data ->
        data.copy(settings = transform(data.settings))
    }

    suspend fun runOcrOnItem(item: ClipItem): String {
        if (item.ocrText.isNotBlank()) return item.ocrText
        val file = mediaFile(item) ?: return ""
        val text = OcrEngine.recognizeFile(file)
        if (text.isNotBlank()) setOcrText(item.id, text)
        return text
    }
}

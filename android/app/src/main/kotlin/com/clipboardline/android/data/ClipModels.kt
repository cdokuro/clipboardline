package com.clipboardline.android.data

import kotlinx.serialization.Serializable

@Serializable
enum class ClipKind {
    IMAGE, TEXT, LINK
}

@Serializable
enum class AppThemeMode {
    EDNA, SOFT, NEUTRAL
}

@Serializable
enum class EdgeSide {
    RIGHT, LEFT
}

@Serializable
data class ClipItem(
    val id: String,
    val kind: ClipKind,
    val text: String = "",
    val url: String = "",
    val title: String = "",
    val imageFile: String? = null,
    val width: Int = 0,
    val height: Int = 0,
    val ocrText: String = "",
    val fingerprint: String = "",
    val pinned: Boolean = false,
    val folderId: String? = null,
    val tags: List<String> = emptyList(),
    val createdAt: Long = System.currentTimeMillis(),
    val lastCopiedAt: Long = System.currentTimeMillis(),
    val trashedAt: Long? = null
)

@Serializable
data class ClipFolder(
    val id: String,
    val name: String,
    val createdAt: Long = System.currentTimeMillis()
)

@Serializable
data class ClipSettings(
    val theme: AppThemeMode = AppThemeMode.EDNA,
    val captureText: Boolean = true,
    val captureImages: Boolean = true,
    val captureLinks: Boolean = true,
    val autoOcr: Boolean = true,
    val edgeHandleEnabled: Boolean = true,
    val edgeSide: EdgeSide = EdgeSide.RIGHT,
    val edgeYFraction: Float = 0.42f,
    val autoStartOnBoot: Boolean = true,
    val maxHistoryItems: Int = 400
)

@Serializable
data class ClipStoreData(
    val items: List<ClipItem> = emptyList(),
    val folders: List<ClipFolder> = emptyList(),
    val settings: ClipSettings = ClipSettings()
)

data class UpdateInfo(
    val currentVersion: String,
    val latestVersion: String? = null,
    val releaseUrl: String? = null,
    val hasUpdate: Boolean = false,
    val checking: Boolean = false,
    val error: String? = null
)

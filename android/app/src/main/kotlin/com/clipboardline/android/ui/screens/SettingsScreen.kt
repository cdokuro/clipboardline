package com.clipboardline.android.ui.screens

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Layers
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clipboardline.android.BuildConfig
import com.clipboardline.android.data.AppThemeMode
import com.clipboardline.android.data.ClipRepository
import com.clipboardline.android.data.ClipStoreData
import com.clipboardline.android.data.EdgeSide
import com.clipboardline.android.data.GitHubUpdater
import com.clipboardline.android.data.UpdateInfo
import com.clipboardline.android.service.ClipAccessibilityService
import com.clipboardline.android.service.FloatingEdgeService
import com.clipboardline.android.ui.theme.LocalClipPalette
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    store: ClipStoreData,
    repository: ClipRepository
) {
    val palette = LocalClipPalette.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val settings = store.settings
    val hasOverlayPermission = Settings.canDrawOverlays(context)
    val hasInstantCapture = ClipAccessibilityService.isReady()
    var updateInfo by remember { mutableStateOf(UpdateInfo(currentVersion = BuildConfig.VERSION_NAME)) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.bg)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("Ayarlar", color = palette.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)

        // Quick Access & Optional Edge Handle Card
        SettingsCard(title = "Hızlı Erişim (Ekranı Kaplamadan)") {
            Text(
                text = "Önerilen: Bildirim çubuğundaki İp Askısı / Ekran Alıntısı düğmeleri, Samsung Hızlı Panel (Quick Tiles) veya S Pen Air Command / Tek El İşlemi kısayolları.",
                color = palette.textSecondary,
                fontSize = 12.sp,
                lineHeight = 17.sp
            )
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Rounded.Layers, null, tint = palette.accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("Kenar Çubuğu Tutamağı (Opsiyonel)", color = palette.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    Text(
                        if (!hasOverlayPermission) "Üstte gösterme izni gerekli"
                        else if (settings.edgeHandleEnabled) "Açık · Ekran kenarında görünür"
                        else "Kapalı · Ekran tamamen temiz (önerilen)",
                        color = if (hasOverlayPermission) palette.success else palette.pinGold,
                        fontSize = 12.sp
                    )
                }
                Switch(
                    checked = settings.edgeHandleEnabled && hasOverlayPermission,
                    onCheckedChange = { enabled ->
                        if (enabled && !Settings.canDrawOverlays(context)) {
                            context.startActivity(
                                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            )
                        } else {
                            scope.launch {
                                repository.updateSettings { it.copy(edgeHandleEnabled = enabled) }
                                FloatingEdgeService.start(context)
                            }
                        }
                    }
                )
            }

            if (!hasOverlayPermission) {
                Spacer(Modifier.height(10.dp))
                Button(
                    onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Üstte Gösterme İznini Aç")
                }
            }

            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = settings.edgeSide == EdgeSide.RIGHT,
                    onClick = {
                        scope.launch {
                            repository.updateSettings { it.copy(edgeSide = EdgeSide.RIGHT) }
                            if (settings.edgeHandleEnabled && Settings.canDrawOverlays(context)) FloatingEdgeService.start(context)
                        }
                    },
                    label = { Text("Sağ Kenar") }
                )
                FilterChip(
                    selected = settings.edgeSide == EdgeSide.LEFT,
                    onClick = {
                        scope.launch {
                            repository.updateSettings { it.copy(edgeSide = EdgeSide.LEFT) }
                            if (settings.edgeHandleEnabled && Settings.canDrawOverlays(context)) FloatingEdgeService.start(context)
                        }
                    },
                    label = { Text("Sol Kenar") }
                )
            }
        }

        // Instant Zero-Popup Capture Card
        SettingsCard(title = "Anında Ekran Alıntısı (Onay Penceresiz)") {
            Text(
                text = if (hasInstantCapture) "Aktif · Alıntı'ya dokunduğun an sistem onay penceresi çıkmadan seçim ekranı açılır."
                else "Kapalı · Erişilebilirlik servisini açarsan \"Ekran paylaşılsın mı?\" sorusu hiç çıkmadan anında seçim ekranı açılır.",
                color = if (hasInstantCapture) palette.success else palette.pinGold,
                fontSize = 12.5.sp,
                lineHeight = 18.sp
            )
            if (!hasInstantCapture) {
                Spacer(Modifier.height(10.dp))
                Button(
                    onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Erişilebilirlik Ayarlarını Aç (ClipBoardLine)")
                }
            }
        }

        // Theme Card
        SettingsCard(title = "Görünüm & Tema") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(
                    AppThemeMode.EDNA to "Edna Dark",
                    AppThemeMode.SOFT to "Soft Dark",
                    AppThemeMode.NEUTRAL to "Neutral"
                ).forEach { (mode, label) ->
                    FilterChip(
                        selected = settings.theme == mode,
                        onClick = { scope.launch { repository.updateSettings { it.copy(theme = mode) } } },
                        label = { Text(label) }
                    )
                }
            }
        }

        // Capture Settings Card
        SettingsCard(title = "Pano & OCR") {
            ToggleRow("Metin kopyalarını yakala", settings.captureText) { v ->
                scope.launch { repository.updateSettings { it.copy(captureText = v) } }
            }
            ToggleRow("Linkleri ayrı rafta yakala", settings.captureLinks) { v ->
                scope.launch { repository.updateSettings { it.copy(captureLinks = v) } }
            }
            ToggleRow("Görselleri yakala", settings.captureImages) { v ->
                scope.launch { repository.updateSettings { it.copy(captureImages = v) } }
            }
            ToggleRow("Görsellerde otomatik yerel OCR", settings.autoOcr) { v ->
                scope.launch { repository.updateSettings { it.copy(autoOcr = v) } }
            }
            ToggleRow("Telefon açılışında kenar servisini başlat", settings.autoStartOnBoot) { v ->
                scope.launch { repository.updateSettings { it.copy(autoStartOnBoot = v) } }
            }
        }

        // Quick Settings Tip Card
        SettingsCard(title = "Hızlı Ayarlar (Quick Panel) İpucu") {
            Text(
                text = "Samsung Hızlı Paneli aşağı çekip Düzenle'ye dokunarak \"İp Askısı\" ve \"Ekran Alıntısı\" düğmelerini ekleyebilirsin. Böylece herhangi bir uygulamadayken tek dokunuşla ekran görüntüsü alıp Google Lens veya OCR ile aratabilirsin.",
                color = palette.textSecondary,
                fontSize = 12.5.sp,
                lineHeight = 18.sp
            )
        }

        // GitHub Updates Card
        SettingsCard(title = "Güncellemeler (GitHub)") {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Rounded.SystemUpdate, null, tint = palette.accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("ClipBoardLine Android v${BuildConfig.VERSION_NAME}", color = palette.textPrimary, fontWeight = FontWeight.Medium)
                    val statusText = when {
                        updateInfo.checking -> "GitHub kontrol ediliyor…"
                        updateInfo.hasUpdate -> "Yeni sürüm mevcut: v${updateInfo.latestVersion}"
                        updateInfo.error != null -> "Kontrol edilemedi: ${updateInfo.error}"
                        updateInfo.latestVersion != null -> "Güncel (v${updateInfo.latestVersion})"
                        else -> "cdokuro/clipboardline"
                    }
                    Text(
                        text = statusText,
                        color = if (updateInfo.hasUpdate) palette.success else palette.textSecondary,
                        fontSize = 12.sp
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = {
                        updateInfo = updateInfo.copy(checking = true, error = null)
                        scope.launch { updateInfo = GitHubUpdater.checkLatest() }
                    },
                    enabled = !updateInfo.checking
                ) {
                    if (updateInfo.checking) {
                        CircularProgressIndicator(Modifier.size(15.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(6.dp))
                    }
                    Text("Güncellemeleri Denetle")
                }
                if (updateInfo.hasUpdate && !updateInfo.releaseUrl.isNullOrBlank()) {
                    Button(onClick = {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(updateInfo.releaseUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }) {
                        Text("İndir")
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsCard(
    title: String,
    content: @Composable () -> Unit
) {
    val palette = LocalClipPalette.current
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = palette.surface,
        border = BorderStroke(1.dp, palette.border),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, color = palette.accent, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(10.dp))
            content()
        }
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val palette = LocalClipPalette.current
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = palette.textPrimary, fontSize = 13.5.sp, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

package com.clipboardline.android.ui.components

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Crop
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DocumentScanner
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.ImageSearch
import androidx.compose.material.icons.rounded.OpenInBrowser
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material.icons.rounded.RestoreFromTrash
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.clipboardline.android.data.ClipFolder
import com.clipboardline.android.data.ClipItem
import com.clipboardline.android.data.ClipKind
import com.clipboardline.android.data.ClipRepository
import com.clipboardline.android.data.GoogleLensLauncher
import com.clipboardline.android.ui.capture.CaptureEditorActivity
import com.clipboardline.android.ui.theme.LocalClipPalette
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ItemDetailSheet(
    item: ClipItem,
    folders: List<ClipFolder>,
    repository: ClipRepository,
    onDismiss: () -> Unit
) {
    val palette = LocalClipPalette.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var ocrBusy by remember { mutableStateOf(false) }
    var ocrResult by remember(item.id, item.ocrText) { mutableStateOf(item.ocrText) }
    var lensBusy by remember { mutableStateOf(false) }
    var tagInput by remember(item.id, item.tags) { mutableStateOf(item.tags.joinToString(", ")) }
    var titleInput by remember(item.id, item.title) { mutableStateOf(item.title) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = palette.surface,
        contentColor = palette.textPrimary
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Preview header
            when (item.kind) {
                ClipKind.IMAGE -> {
                    val file = repository.mediaFile(item)
                    if (file != null && file.exists()) {
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = Color.Black,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 300.dp)
                        ) {
                            AsyncImage(
                                model = file,
                                contentDescription = item.title,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }
                }
                ClipKind.TEXT -> {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = palette.bg,
                        border = BorderStroke(1.dp, palette.border),
                        modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp)
                    ) {
                        Text(
                            text = item.text,
                            color = palette.textPrimary,
                            fontSize = 14.sp,
                            lineHeight = 20.sp,
                            modifier = Modifier.verticalScroll(rememberScrollState()).padding(14.dp)
                        )
                    }
                }
                ClipKind.LINK -> {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = palette.bg,
                        border = BorderStroke(1.dp, palette.border),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Text(item.title.ifBlank { item.url }, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                            Spacer(Modifier.height(4.dp))
                            Text(item.url, color = palette.linkAccent, fontSize = 13.sp)
                        }
                    }
                }
            }

            // Primary actions row
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                ActionPill(Icons.Rounded.ContentCopy, "Kopyala", palette.accent) {
                    repository.copyToSystemClipboard(item)
                    onDismiss()
                }
                ActionPill(
                    Icons.Rounded.PushPin,
                    if (item.pinned) "Sabiti Kaldır" else "Sabitle",
                    if (item.pinned) palette.pinGold else palette.textPrimary
                ) {
                    scope.launch { repository.togglePin(item.id) }
                }
                ActionPill(Icons.Rounded.Share, "Paylaş", palette.textPrimary) {
                    repository.shareItem(context, item)
                }
                if (item.kind == ClipKind.LINK) {
                    ActionPill(Icons.Rounded.OpenInBrowser, "Aç", palette.linkAccent) {
                        try {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(item.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        } catch (_: Exception) {}
                    }
                }
                if (item.trashedAt != null) {
                    ActionPill(Icons.Rounded.RestoreFromTrash, "Geri Yükle", palette.success) {
                        scope.launch { repository.restoreItem(item.id); onDismiss() }
                    }
                    ActionPill(Icons.Rounded.Delete, "Kalıcı Sil", palette.danger) {
                        scope.launch { repository.deleteForever(item.id); onDismiss() }
                    }
                } else {
                    ActionPill(Icons.Rounded.Delete, "Çöpe At", palette.danger) {
                        scope.launch { repository.trashItem(item.id); onDismiss() }
                    }
                }
            }

            // Image superpower actions: Google Lens, OCR, Edit/Crop
            if (item.kind == ClipKind.IMAGE) {
                val mediaFile = repository.mediaFile(item)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = {
                            if (mediaFile != null && !lensBusy) {
                                lensBusy = true
                                scope.launch {
                                    val ok = GoogleLensLauncher.searchFile(context, mediaFile)
                                    lensBusy = false
                                    if (!ok) repository.emitToast("Tarayıcı açılamadı")
                                    else onDismiss()
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                        modifier = Modifier.weight(1f)
                    ) {
                        if (lensBusy) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.Black)
                        } else {
                            Icon(Icons.Rounded.ImageSearch, null, modifier = Modifier.size(18.dp))
                        }
                        Spacer(Modifier.width(6.dp))
                        Text("Google Lens", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    }

                    OutlinedButton(
                        onClick = {
                            if (!ocrBusy) {
                                ocrBusy = true
                                scope.launch {
                                    val text = repository.runOcrOnItem(item)
                                    ocrResult = text
                                    ocrBusy = false
                                    if (text.isBlank()) repository.emitToast("Görselde metin bulunamadı")
                                }
                            }
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        if (ocrBusy) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Rounded.DocumentScanner, null, modifier = Modifier.size(18.dp))
                        }
                        Spacer(Modifier.width(6.dp))
                        Text("OCR Metin", fontSize = 13.sp)
                    }
                }

                if (mediaFile != null && mediaFile.exists()) {
                    OutlinedButton(
                        onClick = {
                            onDismiss()
                            context.startActivity(
                                CaptureEditorActivity.createIntent(context, mediaFile.absolutePath)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            )
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Rounded.Crop, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Kırp ve İşaretle (Çizim / Bulanıklaştır)")
                    }
                }

                if (ocrResult.isNotBlank()) {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = palette.bg,
                        border = BorderStroke(1.dp, palette.success.copy(alpha = 0.4f)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(12.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("OCR Metni", color = palette.success, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                                Text(
                                    "Kopyala",
                                    color = palette.accent,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.clickable {
                                        repository.copyPlainText(ocrResult, "OCR metni panoya kopyalandı")
                                    }
                                )
                            }
                            Spacer(Modifier.height(6.dp))
                            Text(ocrResult, color = palette.textPrimary, fontSize = 13.sp, lineHeight = 18.sp)
                        }
                    }
                }
            }

            // Title & Tags editor
            OutlinedTextField(
                value = titleInput,
                onValueChange = {
                    titleInput = it
                    scope.launch { repository.updateTitle(item.id, it) }
                },
                label = { Text("Başlık / İsim") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = tagInput,
                onValueChange = {
                    tagInput = it
                    scope.launch { repository.setTags(item.id, it.split(",")) }
                },
                label = { Text("Etiketler (virgülle ayır)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            // Folder chips
            if (folders.isNotEmpty()) {
                Text("Klasör", color = palette.textSecondary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    FilterChip(
                        selected = item.folderId == null,
                        onClick = { scope.launch { repository.setFolder(item.id, null) } },
                        label = { Text("Klasörsüz") }
                    )
                    folders.forEach { folder ->
                        FilterChip(
                            selected = item.folderId == folder.id,
                            onClick = { scope.launch { repository.setFolder(item.id, folder.id) } },
                            leadingIcon = { Icon(Icons.Rounded.Folder, null, modifier = Modifier.size(15.dp)) },
                            label = { Text(folder.name) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionPill(
    icon: ImageVector,
    label: String,
    tint: Color,
    onClick: () -> Unit
) {
    val palette = LocalClipPalette.current
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = palette.surfaceElevated,
        border = BorderStroke(1.dp, palette.border)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(label, color = tint, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
        }
    }
}

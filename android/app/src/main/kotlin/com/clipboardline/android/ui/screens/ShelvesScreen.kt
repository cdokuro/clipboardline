package com.clipboardline.android.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ContentPasteGo
import androidx.compose.material.icons.rounded.Crop
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Notes
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clipboardline.android.data.AppThemeMode
import com.clipboardline.android.data.ClipItem
import com.clipboardline.android.data.ClipKind
import com.clipboardline.android.data.ClipRepository
import com.clipboardline.android.data.ClipStoreData
import com.clipboardline.android.ui.components.ClotheslineWire
import com.clipboardline.android.ui.components.HangingClipCard
import com.clipboardline.android.ui.theme.LocalClipPalette
import kotlinx.coroutines.launch

@Composable
fun ShelvesScreen(
    store: ClipStoreData,
    repository: ClipRepository,
    onSelectItem: (ClipItem) -> Unit,
    onStartScreenCapture: () -> Unit,
    onPickImage: () -> Unit
) {
    val palette = LocalClipPalette.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var pinnedOnly by remember { mutableStateOf(false) }
    var searchOpen by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var showNewNote by remember { mutableStateOf(false) }
    var noteText by remember { mutableStateOf("") }

    val activeItems = remember(store.items, pinnedOnly, query) {
        val q = query.trim().lowercase()
        store.items.filter { item ->
            item.trashedAt == null &&
                (!pinnedOnly || item.pinned) &&
                (q.isEmpty() ||
                    item.text.lowercase().contains(q) ||
                    item.url.lowercase().contains(q) ||
                    item.title.lowercase().contains(q) ||
                    item.ocrText.lowercase().contains(q) ||
                    item.tags.any { it.lowercase().contains(q) })
        }
    }

    val images = remember(activeItems) { activeItems.filter { it.kind == ClipKind.IMAGE } }
    val texts = remember(activeItems) { activeItems.filter { it.kind == ClipKind.TEXT } }
    val links = remember(activeItems) { activeItems.filter { it.kind == ClipKind.LINK } }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.bg)
    ) {
        // Header toolbar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "ClipBoardLine",
                    color = palette.textPrimary,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "${activeItems.size} öğe ipte asılı",
                    color = palette.textSecondary,
                    fontSize = 12.sp
                )
            }
            IconButton(onClick = { searchOpen = !searchOpen; if (!searchOpen) query = "" }) {
                Icon(Icons.Rounded.Search, contentDescription = "Ara", tint = if (searchOpen) palette.accent else palette.textPrimary)
            }
            IconButton(onClick = { repository.captureFromSystemClipboard(force = true); repository.emitToast("Pano kontrol edildi") }) {
                Icon(Icons.Rounded.ContentPasteGo, contentDescription = "Panoyu Yakala", tint = palette.success)
            }
            IconButton(onClick = {
                val modes = AppThemeMode.entries
                val next = modes[(modes.indexOf(store.settings.theme) + 1) % modes.size]
                scope.launch { repository.updateSettings { it.copy(theme = next) } }
            }) {
                Icon(Icons.Rounded.Palette, contentDescription = "Tema", tint = palette.pinGold)
            }
        }

        if (searchOpen) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Metin, link, OCR veya etiket ara…") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
            )
        }

        // Quick Action Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                onClick = onStartScreenCapture,
                shape = RoundedCornerShape(12.dp),
                color = palette.accent
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Rounded.Crop, null, tint = Color(0xFF0D101A), modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Alıntı Al", color = Color(0xFF0D101A), fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp)
                }
            }

            Surface(
                onClick = { showNewNote = true },
                shape = RoundedCornerShape(12.dp),
                color = palette.surfaceElevated,
                border = BorderStroke(1.dp, palette.border)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Rounded.Add, null, tint = palette.textPrimary, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Not", color = palette.textPrimary, fontSize = 12.5.sp)
                }
            }

            Surface(
                onClick = onPickImage,
                shape = RoundedCornerShape(12.dp),
                color = palette.surfaceElevated,
                border = BorderStroke(1.dp, palette.border)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Rounded.PhotoLibrary, null, tint = palette.imageAccent, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Görsel", color = palette.textPrimary, fontSize = 12.5.sp)
                }
            }

            Spacer(Modifier.weight(1f))

            FilterChip(
                selected = pinnedOnly,
                onClick = { pinnedOnly = !pinnedOnly },
                leadingIcon = { Icon(Icons.Rounded.PushPin, null, modifier = Modifier.size(14.dp)) },
                label = { Text("Sabit", fontSize = 11.5.sp) }
            )
        }

        // Clothesline Shelves
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item(key = "shelf_images") {
                ShelfRowSection(
                    title = "Görseller",
                    icon = Icons.Rounded.Image,
                    accent = palette.imageAccent,
                    items = images,
                    repository = repository,
                    onTapItem = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        repository.copyToSystemClipboard(it)
                    },
                    onLongPressItem = onSelectItem
                )
            }
            item(key = "shelf_texts") {
                ShelfRowSection(
                    title = "Metinler",
                    icon = Icons.Rounded.Notes,
                    accent = palette.textAccent,
                    items = texts,
                    repository = repository,
                    onTapItem = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        repository.copyToSystemClipboard(it)
                    },
                    onLongPressItem = onSelectItem
                )
            }
            item(key = "shelf_links") {
                ShelfRowSection(
                    title = "Linkler",
                    icon = Icons.Rounded.Link,
                    accent = palette.linkAccent,
                    items = links,
                    repository = repository,
                    onTapItem = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        repository.copyToSystemClipboard(it)
                    },
                    onLongPressItem = onSelectItem
                )
            }
        }
    }

    if (showNewNote) {
        AlertDialog(
            onDismissRequest = { showNewNote = false },
            containerColor = palette.surface,
            title = { Text("Yeni Not Ekle", color = palette.textPrimary) },
            text = {
                OutlinedTextField(
                    value = noteText,
                    onValueChange = { noteText = it },
                    placeholder = { Text("Metin veya URL yaz…") },
                    minLines = 3,
                    maxLines = 6,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                Button(onClick = {
                    val v = noteText
                    noteText = ""
                    showNewNote = false
                    scope.launch { repository.insertTextOrLink(v, force = true) }
                }) { Text("Ekle") }
            },
            dismissButton = {
                TextButton(onClick = { showNewNote = false }) { Text("İptal") }
            }
        )
    }
}

@Composable
private fun ShelfRowSection(
    title: String,
    icon: ImageVector,
    accent: Color,
    items: List<ClipItem>,
    repository: ClipRepository,
    onTapItem: (ClipItem) -> Unit,
    onLongPressItem: (ClipItem) -> Unit
) {
    val palette = LocalClipPalette.current
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(title, color = palette.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.width(6.dp))
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = palette.surfaceElevated
            ) {
                Text(
                    text = items.size.toString(),
                    color = palette.textSecondary,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp)
                )
            }
            Spacer(Modifier.weight(1f))
            if (items.isNotEmpty()) {
                Text("Dokun: Kopyala · Basılı tut: Detay", color = palette.textSecondary, fontSize = 10.5.sp)
            }
        }

        Box(modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
            ClotheslineWire(modifier = Modifier.padding(top = 6.dp))
            if (items.isEmpty()) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = palette.surface.copy(alpha = 0.6f),
                    border = BorderStroke(1.dp, palette.border),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp)
                ) {
                    Text(
                        text = "Henüz $title yok — bir şey kopyala veya paylaş.",
                        color = palette.textSecondary,
                        fontSize = 12.5.sp,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            } else {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    itemsIndexed(items, key = { _, item -> item.id }) { idx, item ->
                        HangingClipCard(
                            item = item,
                            mediaFile = repository.mediaFile(item),
                            index = idx,
                            onTap = { onTapItem(item) },
                            onLongPress = { onLongPressItem(item) }
                        )
                    }
                }
            }
        }
    }
}

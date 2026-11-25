package com.clipboardline.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CreateNewFolder
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clipboardline.android.data.ClipItem
import com.clipboardline.android.data.ClipKind
import com.clipboardline.android.data.ClipRepository
import com.clipboardline.android.data.ClipStoreData
import com.clipboardline.android.ui.components.HangingClipCard
import com.clipboardline.android.ui.theme.LocalClipPalette
import kotlinx.coroutines.launch

private enum class LibraryScope { ALL, PINNED, IMAGES, TEXTS, LINKS, TRASH }

@Composable
fun LibraryScreen(
    store: ClipStoreData,
    repository: ClipRepository,
    onSelectItem: (ClipItem) -> Unit
) {
    val palette = LocalClipPalette.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var activeScope by remember { mutableStateOf(LibraryScope.ALL) }
    var selectedFolderId by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var showNewFolder by remember { mutableStateOf(false) }
    var folderName by remember { mutableStateOf("") }

    val filtered = remember(store.items, activeScope, selectedFolderId, query) {
        val q = query.trim().lowercase()
        store.items.filter { item ->
            val scopeMatch = when {
                selectedFolderId != null -> item.trashedAt == null && item.folderId == selectedFolderId
                activeScope == LibraryScope.ALL -> item.trashedAt == null
                activeScope == LibraryScope.PINNED -> item.trashedAt == null && item.pinned
                activeScope == LibraryScope.IMAGES -> item.trashedAt == null && item.kind == ClipKind.IMAGE
                activeScope == LibraryScope.TEXTS -> item.trashedAt == null && item.kind == ClipKind.TEXT
                activeScope == LibraryScope.LINKS -> item.trashedAt == null && item.kind == ClipKind.LINK
                activeScope == LibraryScope.TRASH -> item.trashedAt != null
                else -> true
            }
            scopeMatch && (q.isEmpty() ||
                item.text.lowercase().contains(q) ||
                item.url.lowercase().contains(q) ||
                item.title.lowercase().contains(q) ||
                item.ocrText.lowercase().contains(q) ||
                item.tags.any { it.lowercase().contains(q) })
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.bg)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Kütüphane", color = palette.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text("${filtered.size} öğe", color = palette.textSecondary, fontSize = 12.sp)
            }
            if (activeScope == LibraryScope.TRASH && filtered.isNotEmpty()) {
                IconButton(onClick = { scope.launch { repository.emptyTrash(); repository.emitToast("Çöp kutusu boşaltıldı") } }) {
                    Icon(Icons.Rounded.DeleteSweep, contentDescription = "Çöpü Boşalt", tint = palette.danger)
                }
            }
            IconButton(onClick = { showNewFolder = true }) {
                Icon(Icons.Rounded.CreateNewFolder, contentDescription = "Yeni Klasör", tint = palette.accent)
            }
        }

        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            leadingIcon = { Icon(Icons.Rounded.Search, null) },
            placeholder = { Text("Kütüphanede ara (OCR metinleri dahil)…") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)
        )

        Spacer(Modifier.height(8.dp))

        // Scope & Folder chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            listOf(
                LibraryScope.ALL to "Tümü",
                LibraryScope.PINNED to "Sabitlenenler",
                LibraryScope.IMAGES to "Görseller",
                LibraryScope.TEXTS to "Metinler",
                LibraryScope.LINKS to "Linkler",
                LibraryScope.TRASH to "Çöp"
            ).forEach { (sc, label) ->
                FilterChip(
                    selected = selectedFolderId == null && activeScope == sc,
                    onClick = { selectedFolderId = null; activeScope = sc },
                    label = { Text(label, fontSize = 12.sp) }
                )
            }
            store.folders.forEach { folder ->
                FilterChip(
                    selected = selectedFolderId == folder.id,
                    onClick = { selectedFolderId = folder.id },
                    leadingIcon = { Icon(Icons.Rounded.Folder, null, modifier = Modifier.size(14.dp)) },
                    label = { Text(folder.name, fontSize = 12.sp) }
                )
            }
        }

        Spacer(Modifier.height(6.dp))

        if (filtered.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Bu görünümde öğe yok.", color = palette.textSecondary, fontSize = 14.sp)
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                itemsIndexed(filtered, key = { _, item -> item.id }) { idx, item ->
                    HangingClipCard(
                        item = item,
                        mediaFile = repository.mediaFile(item),
                        index = idx,
                        onTap = { onSelectItem(item) },
                        onLongPress = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            repository.copyToSystemClipboard(item)
                        },
                        cardWidth = 200.dp,
                        cardHeight = 164.dp,
                        showClothespin = false,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        }
    }

    if (showNewFolder) {
        AlertDialog(
            onDismissRequest = { showNewFolder = false },
            containerColor = palette.surface,
            title = { Text("Yeni Klasör", color = palette.textPrimary) },
            text = {
                OutlinedTextField(
                    value = folderName,
                    onValueChange = { folderName = it },
                    placeholder = { Text("Klasör adı") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                Button(onClick = {
                    val n = folderName
                    folderName = ""
                    showNewFolder = false
                    scope.launch { repository.createFolder(n) }
                }) { Text("Oluştur") }
            },
            dismissButton = {
                TextButton(onClick = { showNewFolder = false }) { Text("İptal") }
            }
        )
    }
}

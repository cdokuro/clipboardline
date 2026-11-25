package com.clipboardline.android

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesomeMotion
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.clipboardline.android.data.ClipItem
import com.clipboardline.android.service.ClipAccessibilityService
import com.clipboardline.android.service.FloatingEdgeService
import com.clipboardline.android.ui.components.ItemDetailSheet
import com.clipboardline.android.ui.screens.LibraryScreen
import com.clipboardline.android.ui.screens.SettingsScreen
import com.clipboardline.android.ui.screens.ShelvesScreen
import com.clipboardline.android.ui.theme.ClipBoardLineTheme
import com.clipboardline.android.ui.theme.LocalClipPalette
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val notifPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        val repo = ClipBoardLineApp.instance.repository
        handleShareIntent(intent)

        // Always keep clean background service & status bar quick actions alive (edge handle is optional)
        FloatingEdgeService.start(this)

        setContent {
            val store by repo.store.collectAsState()
            val scope = rememberCoroutineScope()
            var selectedTab by remember { mutableIntStateOf(0) }
            var selectedItemId by remember { mutableStateOf<String?>(null) }

            val imagePicker = rememberLauncherForActivityResult(
                ActivityResultContracts.PickVisualMedia()
            ) { uri ->
                if (uri != null) {
                    scope.launch {
                        val added = repo.insertImageUri(uri)
                        if (added != null) repo.emitToast("Görsel ipe asıldı")
                    }
                }
            }

            LaunchedEffect(Unit) {
                repo.toasts.collect { msg ->
                    Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show()
                }
            }

            ClipBoardLineTheme(mode = store.settings.theme) {
                val palette = LocalClipPalette.current
                val detailItem: ClipItem? = remember(store.items, selectedItemId) {
                    selectedItemId?.let { id -> store.items.firstOrNull { it.id == id } }
                }

                Scaffold(
                    containerColor = palette.bg,
                    bottomBar = {
                        NavigationBar(
                            containerColor = palette.surface,
                            tonalElevation = 0.dp
                        ) {
                            val navColors = NavigationBarItemDefaults.colors(
                                selectedIconColor = palette.accent,
                                selectedTextColor = palette.accent,
                                indicatorColor = palette.accent.copy(alpha = 0.16f),
                                unselectedIconColor = palette.textSecondary,
                                unselectedTextColor = palette.textSecondary
                            )
                            NavigationBarItem(
                                selected = selectedTab == 0,
                                onClick = { selectedTab = 0 },
                                icon = { Icon(Icons.Rounded.AutoAwesomeMotion, "İp Askısı") },
                                label = { Text("İp Askısı") },
                                colors = navColors
                            )
                            NavigationBarItem(
                                selected = selectedTab == 1,
                                onClick = { selectedTab = 1 },
                                icon = { Icon(Icons.Rounded.GridView, "Kütüphane") },
                                label = { Text("Kütüphane") },
                                colors = navColors
                            )
                            NavigationBarItem(
                                selected = selectedTab == 2,
                                onClick = { selectedTab = 2 },
                                icon = { Icon(Icons.Rounded.Settings, "Ayarlar") },
                                label = { Text("Ayarlar") },
                                colors = navColors
                            )
                        }
                    }
                ) { innerPadding ->
                    Box(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
                        when (selectedTab) {
                            0 -> ShelvesScreen(
                                store = store,
                                repository = repo,
                                onSelectItem = { selectedItemId = it.id },
                                onStartScreenCapture = { ClipAccessibilityService.requestInstantCapture(this@MainActivity, delayMs = 90L) },
                                onPickImage = {
                                    imagePicker.launch(
                                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                    )
                                }
                            )
                            1 -> LibraryScreen(
                                store = store,
                                repository = repo,
                                onSelectItem = { selectedItemId = it.id }
                            )
                            else -> SettingsScreen(
                                store = store,
                                repository = repo
                            )
                        }
                    }
                }

                if (detailItem != null) {
                    ItemDetailSheet(
                        item = detailItem,
                        folders = store.folders,
                        repository = repo,
                        onDismiss = { selectedItemId = null }
                    )
                }
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            ClipBoardLineApp.instance.repository.captureFromSystemClipboard()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent == null) return
        val repo = ClipBoardLineApp.instance.repository
        when (intent.action) {
            Intent.ACTION_SEND -> {
                val type = intent.type ?: return
                if (type.startsWith("text/")) {
                    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                    if (!text.isNullOrBlank()) {
                        lifecycleScope.launch {
                            repo.insertTextOrLink(text, force = true)
                            repo.emitToast("ClipBoardLine'a kaydedildi")
                        }
                    }
                } else if (type.startsWith("image/")) {
                    val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(Intent.EXTRA_STREAM)
                    }
                    if (uri != null) {
                        lifecycleScope.launch {
                            repo.insertImageUri(uri)
                            repo.emitToast("Görsel ClipBoardLine'a kaydedildi")
                        }
                    }
                }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val uris = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
                }
                if (!uris.isNullOrEmpty()) {
                    lifecycleScope.launch {
                        var count = 0
                        uris.forEach { if (repo.insertImageUri(it) != null) count++ }
                        if (count > 0) repo.emitToast("$count görsel ClipBoardLine'a kaydedildi")
                    }
                }
            }
        }
    }
}

package com.clipboardline.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentPasteGo
import androidx.compose.material.icons.rounded.Crop
import androidx.compose.material.icons.rounded.OpenInNew
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.clipboardline.android.ClipBoardLineApp
import com.clipboardline.android.MainActivity
import com.clipboardline.android.R
import com.clipboardline.android.data.ClipKind
import com.clipboardline.android.data.EdgeSide
import com.clipboardline.android.ui.capture.ScreenCaptureActivity
import com.clipboardline.android.ui.components.ClotheslineWire
import com.clipboardline.android.ui.components.HangingClipCard
import com.clipboardline.android.ui.theme.ClipBoardLineTheme
import com.clipboardline.android.ui.theme.LocalClipPalette
import kotlin.math.abs

class FloatingEdgeService : Service(), LifecycleOwner, ViewModelStoreOwner, SavedStateRegistryOwner {

    private val lifecycleRegistry = LifecycleRegistry(this)
    private val storeOwner = ViewModelStore()
    private val savedStateController = SavedStateRegistryController.create(this)

    override val lifecycle: Lifecycle get() = lifecycleRegistry
    override val viewModelStore: ViewModelStore get() = storeOwner
    override val savedStateRegistry: SavedStateRegistry get() = savedStateController.savedStateRegistry

    private lateinit var windowManager: WindowManager
    private lateinit var clipboardManager: ClipboardManager
    private var edgeHandleView: View? = null
    private var shelfOverlayView: View? = null

    private val clipListener = ClipboardManager.OnPrimaryClipChangedListener {
        ClipBoardLineApp.instance.repository.captureFromSystemClipboard()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        activeInstance = this
        savedStateController.performAttach()
        savedStateController.performRestore(null)
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)

        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        clipboardManager = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        try {
            clipboardManager.addPrimaryClipChangedListener(clipListener)
        } catch (_: Exception) {}
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureNotificationChannel()
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, notification)
        }

        when (intent?.action) {
            ACTION_TOGGLE_SHELF -> {
                if (shelfOverlayView != null) hideShelfOverlay() else showShelfOverlay()
            }
            ACTION_SHOW_SHELF -> showShelfOverlay()
            ACTION_HIDE_SHELF -> hideShelfOverlay()
            else -> {
                if (Settings.canDrawOverlays(this)) {
                    attachEdgeHandle()
                }
            }
        }
        return START_STICKY
    }

    private fun attachEdgeHandle() {
        removeEdgeHandle()
        if (!Settings.canDrawOverlays(this)) return
        val settings = ClipBoardLineApp.instance.repository.store.value.settings
        if (!settings.edgeHandleEnabled) return

        val density = resources.displayMetrics.density
        val handleW = (18 * density).toInt()
        val handleH = (96 * density).toInt()
        val barW = (6 * density).toInt()
        val barH = (64 * density).toInt()
        val isRight = settings.edgeSide == EdgeSide.RIGHT

        val container = FrameLayout(this)
        val pill = View(this).apply {
            background = GradientDrawable().apply {
                setColor(0xD97C9CFF.toInt())
                cornerRadius = 12 * density
                setStroke((1 * density).toInt(), 0x55FFFFFF)
            }
        }
        val pillParams = FrameLayout.LayoutParams(barW, barH).apply {
            gravity = (if (isRight) Gravity.END else Gravity.START) or Gravity.CENTER_VERTICAL
            marginEnd = if (isRight) (2 * density).toInt() else 0
            marginStart = if (!isRight) (2 * density).toInt() else 0
        }
        container.addView(pill, pillParams)

        val screenH = resources.displayMetrics.heightPixels
        val lp = WindowManager.LayoutParams(
            handleW,
            handleH,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = (if (isRight) Gravity.END else Gravity.START) or Gravity.TOP
            x = 0
            y = (screenH * settings.edgeYFraction).toInt().coerceIn(80, screenH - handleH - 80)
        }

        var downX = 0f
        var downY = 0f
        var startY = 0
        var moved = false

        container.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    startY = lp.y
                    moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    val swipeInward = if (isRight) dx < -22 * density else dx > 22 * density
                    if (swipeInward && abs(dx) > abs(dy)) {
                        moved = true
                        showShelfOverlay()
                        return@setOnTouchListener true
                    }
                    if (abs(dy) > 10 * density) {
                        moved = true
                        lp.y = (startY + dy.toInt()).coerceIn(80, screenH - handleH - 80)
                        try { windowManager.updateViewLayout(container, lp) } catch (_: Exception) {}
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) {
                        showShelfOverlay()
                    }
                    true
                }
                else -> false
            }
        }

        try {
            windowManager.addView(container, lp)
            edgeHandleView = container
        } catch (_: Exception) {}
    }

    private fun removeEdgeHandle() {
        edgeHandleView?.let {
            try { windowManager.removeView(it) } catch (_: Exception) {}
        }
        edgeHandleView = null
    }

    private fun showShelfOverlay() {
        if (!Settings.canDrawOverlays(this)) {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        if (shelfOverlayView != null) return

        val repo = ClipBoardLineApp.instance.repository
        val composeView = ComposeView(this).apply {
            setViewTreeLifecycleOwner(this@FloatingEdgeService)
            setViewTreeViewModelStoreOwner(this@FloatingEdgeService)
            setViewTreeSavedStateRegistryOwner(this@FloatingEdgeService)
            setContent {
                val store by repo.store.collectAsState()
                ClipBoardLineTheme(mode = store.settings.theme) {
                    FloatingShelfOverlayContent(
                        onDismiss = { hideShelfOverlay() },
                        onSnip = {
                            hideShelfOverlay()
                            ClipAccessibilityService.requestInstantCapture(this@FloatingEdgeService, delayMs = 110L)
                        },
                        onOpenApp = {
                            hideShelfOverlay()
                            startActivity(Intent(this@FloatingEdgeService, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        }
                    )
                }
            }
        }

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }

        try {
            windowManager.addView(composeView, lp)
            shelfOverlayView = composeView
            // Once focused, immediately read latest system clipboard even without background permission!
            composeView.postDelayed({ repo.captureFromSystemClipboard() }, 120L)
        } catch (_: Exception) {}
    }

    private fun hideShelfOverlay() {
        shelfOverlayView?.let {
            try { windowManager.removeView(it) } catch (_: Exception) {}
        }
        shelfOverlayView = null
    }

    override fun onDestroy() {
        if (activeInstance === this) activeInstance = null
        hideShelfOverlay()
        removeEdgeHandle()
        try { clipboardManager.removePrimaryClipChangedListener(clipListener) } catch (_: Exception) {}
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
        storeOwner.clear()
        super.onDestroy()
    }

    private fun ensureNotificationChannel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "ClipBoardLine Kenar Çubuğu", NotificationManager.IMPORTANCE_MIN)
            )
        }
    }

    private fun buildNotification(): Notification {
        val openPending = PendingIntent.getActivity(
            this, 1,
            Intent(this, InstantShelfTrampoline::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val snipPending = PendingIntent.getActivity(
            this, 2,
            Intent(this, InstantCaptureTrampoline::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_tile_shelf)
            .setContentTitle("ClipBoardLine")
            .setContentText("İp Askısı için dokun · Anında Alıntı aşağıda")
            .setContentIntent(openPending)
            .addAction(R.drawable.ic_tile_shelf, "İp Askısı", openPending)
            .addAction(R.drawable.ic_tile_snip, "Ekran Alıntısı", snipPending)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "clipboardline_edge"
        private const val NOTIF_ID = 4101
        const val ACTION_TOGGLE_SHELF = "com.clipboardline.android.TOGGLE_SHELF"
        const val ACTION_SHOW_SHELF = "com.clipboardline.android.SHOW_SHELF"
        const val ACTION_HIDE_SHELF = "com.clipboardline.android.HIDE_SHELF"

        @Volatile
        private var activeInstance: FloatingEdgeService? = null

        fun setHandleVisible(visible: Boolean) {
            val svc = activeInstance ?: return
            svc.edgeHandleView?.post {
                svc.edgeHandleView?.visibility = if (visible) View.VISIBLE else View.INVISIBLE
            }
        }

        fun start(context: Context) {
            context.startForegroundService(Intent(context, FloatingEdgeService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, FloatingEdgeService::class.java))
        }

        fun toggleShelf(context: Context) {
            val intent = Intent(context, FloatingEdgeService::class.java).setAction(ACTION_TOGGLE_SHELF)
            context.startForegroundService(intent)
        }
    }
}

@Composable
private fun FloatingShelfOverlayContent(
    onDismiss: () -> Unit,
    onSnip: () -> Unit,
    onOpenApp: () -> Unit
) {
    val palette = LocalClipPalette.current
    val repo = ClipBoardLineApp.instance.repository
    val store by repo.store.collectAsState()
    var filterKind by remember { mutableStateOf<ClipKind?>(null) }

    val items = remember(store.items, filterKind) {
        store.items.filter { it.trashedAt == null && (filterKind == null || it.kind == filterKind) }.take(40)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.52f))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismiss
            )
    ) {
        Surface(
            shape = RoundedCornerShape(bottomStart = 24.dp, bottomEnd = 24.dp),
            color = palette.bg.copy(alpha = 0.96f),
            border = BorderStroke(1.dp, palette.border),
            shadowElevation = 16.dp,
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopCenter)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {}
                )
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 42.dp, bottom = 16.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "ClipBoardLine",
                        color = palette.textPrimary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 17.sp,
                        modifier = Modifier.weight(1f)
                    )
                    Surface(
                        onClick = onSnip,
                        shape = RoundedCornerShape(10.dp),
                        color = palette.accent
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Rounded.Crop, null, tint = Color(0xFF0D101A), modifier = Modifier.size(15.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Alıntı", color = Color(0xFF0D101A), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                    Spacer(Modifier.width(4.dp))
                    IconButton(onClick = { repo.captureFromSystemClipboard(force = true) }, modifier = Modifier.size(34.dp)) {
                        Icon(Icons.Rounded.ContentPasteGo, "Panoyu Yakala", tint = palette.success, modifier = Modifier.size(19.dp))
                    }
                    IconButton(onClick = onOpenApp, modifier = Modifier.size(34.dp)) {
                        Icon(Icons.Rounded.OpenInNew, "Uygulamayı Aç", tint = palette.textPrimary, modifier = Modifier.size(19.dp))
                    }
                    IconButton(onClick = onDismiss, modifier = Modifier.size(34.dp)) {
                        Icon(Icons.Rounded.Close, "Kapat", tint = palette.textSecondary, modifier = Modifier.size(20.dp))
                    }
                }

                Spacer(Modifier.height(6.dp))

                Row(
                    modifier = Modifier.padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilterChip(selected = filterKind == null, onClick = { filterKind = null }, label = { Text("Tümü", fontSize = 11.5.sp) })
                    FilterChip(selected = filterKind == ClipKind.IMAGE, onClick = { filterKind = ClipKind.IMAGE }, label = { Text("Görsel", fontSize = 11.5.sp) })
                    FilterChip(selected = filterKind == ClipKind.TEXT, onClick = { filterKind = ClipKind.TEXT }, label = { Text("Metin", fontSize = 11.5.sp) })
                    FilterChip(selected = filterKind == ClipKind.LINK, onClick = { filterKind = ClipKind.LINK }, label = { Text("Link", fontSize = 11.5.sp) })
                }

                Spacer(Modifier.height(4.dp))

                Box(modifier = Modifier.fillMaxWidth()) {
                    ClotheslineWire(modifier = Modifier.padding(top = 6.dp))
                    if (items.isEmpty()) {
                        Text(
                            text = "Bu rafta henüz öğe yok.",
                            color = palette.textSecondary,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 28.dp)
                        )
                    } else {
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            itemsIndexed(items, key = { _, item -> item.id }) { idx, item ->
                                HangingClipCard(
                                    item = item,
                                    mediaFile = repo.mediaFile(item),
                                    index = idx,
                                    onTap = {
                                        repo.copyToSystemClipboard(item)
                                        onDismiss()
                                    },
                                    onLongPress = {
                                        repo.shareItem(ClipBoardLineApp.instance, item)
                                        onDismiss()
                                    },
                                    cardWidth = if (item.kind == ClipKind.IMAGE) 78.dp else 118.dp,
                                    cardHeight = if (item.kind == ClipKind.IMAGE) 78.dp else 102.dp
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

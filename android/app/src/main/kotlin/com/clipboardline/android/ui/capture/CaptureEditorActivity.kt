package com.clipboardline.android.ui.capture

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.Redo
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.rounded.BlurOn
import androidx.compose.material.icons.rounded.Brush
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Crop
import androidx.compose.material.icons.rounded.CropSquare
import androidx.compose.material.icons.rounded.DocumentScanner
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Fullscreen
import androidx.compose.material.icons.rounded.ImageSearch
import androidx.compose.material.icons.rounded.Pin
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import com.clipboardline.android.ClipBoardLineApp
import com.clipboardline.android.data.GoogleLensLauncher
import com.clipboardline.android.data.OcrEngine
import com.clipboardline.android.ui.theme.ClipBoardLineTheme
import com.clipboardline.android.ui.theme.LocalClipPalette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

private enum class MarkupTool {
    CROP, PEN, HIGHLIGHTER, ARROW, RECT, ELLIPSE, PIXELATE, NUMBER
}

private enum class CropDragHandle {
    NEW, MOVE, TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT, LEFT, RIGHT, TOP, BOTTOM
}

private sealed class AnnotationItem {
    data class Freehand(
        val points: List<Offset>,
        val color: Color,
        val strokeWidth: Float,
        val highlighter: Boolean
    ) : AnnotationItem()

    data class Shape(
        val kind: MarkupTool,
        val start: Offset,
        val end: Offset,
        val color: Color,
        val strokeWidth: Float
    ) : AnnotationItem()

    data class NumberStamp(
        val center: Offset,
        val number: Int,
        val color: Color
    ) : AnnotationItem()
}

class CaptureEditorActivity : ComponentActivity() {

    private var sourcePath: String = ""
    private var deleteSourceOnClose: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        sourcePath = intent.getStringExtra(EXTRA_IMAGE_PATH).orEmpty()
        deleteSourceOnClose = intent.getBooleanExtra(EXTRA_DELETE_SOURCE, false)

        val bitmap = if (sourcePath.isNotBlank() && File(sourcePath).exists()) {
            BitmapFactory.decodeFile(sourcePath)
        } else null

        if (bitmap == null) {
            finish()
            return
        }

        val repo = ClipBoardLineApp.instance.repository

        setContent {
            val store by repo.store.collectAsState()
            ClipBoardLineTheme(mode = store.settings.theme) {
                CaptureEditorScreen(
                    bitmap = bitmap,
                    onCancel = { finishAndCleanup(bitmap) },
                    onSaveToLine = { rendered ->
                        val item = repo.insertImageBitmap(rendered, force = true)
                        if (item != null) repo.copyToSystemClipboard(item, notify = false)
                        repo.emitToast("Alıntı kaydedildi ve panoya kopyalandı")
                        if (rendered !== bitmap) rendered.recycle()
                        finishAndCleanup(bitmap)
                    },
                    onGoogleLens = { rendered ->
                        val item = repo.insertImageBitmap(rendered, force = true)
                        if (item != null) repo.copyToSystemClipboard(item, notify = false)
                        val ok = GoogleLensLauncher.searchBitmap(this, rendered)
                        if (rendered !== bitmap) rendered.recycle()
                        if (!ok) repo.emitToast("Tarayıcı açılamadı")
                        finishAndCleanup(bitmap)
                    },
                    onShare = { rendered ->
                        val sharedDir = File(cacheDir, "shared").apply { mkdirs() }
                        val outFile = File(sharedDir, "clip_${System.currentTimeMillis()}.png")
                        FileOutputStream(outFile).use { rendered.compress(Bitmap.CompressFormat.PNG, 100, it) }
                        if (rendered !== bitmap) rendered.recycle()
                        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", outFile)
                        val shareIntent = Intent(Intent.ACTION_SEND).apply {
                            type = "image/png"
                            putExtra(Intent.EXTRA_STREAM, uri)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        startActivity(Intent.createChooser(shareIntent, "Paylaş"))
                    },
                    onCopyOcr = { text ->
                        repo.copyPlainText(text, "OCR metni panoya kopyalandı")
                    }
                )
            }
        }
    }

    private fun finishAndCleanup(bitmap: Bitmap) {
        if (deleteSourceOnClose && sourcePath.isNotBlank()) {
            try { File(sourcePath).delete() } catch (_: Exception) {}
        }
        if (!bitmap.isRecycled) bitmap.recycle()
        finish()
    }

    companion object {
        private const val EXTRA_IMAGE_PATH = "image_path"
        private const val EXTRA_DELETE_SOURCE = "delete_source"

        fun createIntent(context: Context, imagePath: String, deleteSourceOnClose: Boolean = false): Intent =
            Intent(context, CaptureEditorActivity::class.java).apply {
                putExtra(EXTRA_IMAGE_PATH, imagePath)
                putExtra(EXTRA_DELETE_SOURCE, deleteSourceOnClose)
            }
    }
}

@Composable
private fun CaptureEditorScreen(
    bitmap: Bitmap,
    onCancel: () -> Unit,
    onSaveToLine: suspend (Bitmap) -> Unit,
    onGoogleLens: suspend (Bitmap) -> Unit,
    onShare: (Bitmap) -> Unit,
    onCopyOcr: (String) -> Unit
) {
    val palette = LocalClipPalette.current
    val scope = rememberCoroutineScope()
    val imageBitmap = remember(bitmap) { bitmap.asImageBitmap() }

    var activeTool by remember { mutableStateOf(MarkupTool.CROP) }
    var activeColor by remember { mutableStateOf(Color(0xFFFF5C6C)) }
    var strokeWidth by remember { mutableFloatStateOf(7f) }
    var busy by remember { mutableStateOf(false) }
    var ocrDialogText by remember { mutableStateOf<String?>(null) }

    // Crop rect in image pixel coordinates (null = full screen)
    var cropRect by remember { mutableStateOf<RectF?>(null) }
    val annotations = remember { mutableStateListOf<AnnotationItem>() }
    val redoStack = remember { mutableStateListOf<AnnotationItem>() }
    var draftAnnotation by remember { mutableStateOf<AnnotationItem?>(null) }
    var stampCounter by remember { mutableIntStateOf(1) }

    // Viewport transform (fit image centered inside canvas)
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    val imgW = bitmap.width.toFloat().coerceAtLeast(1f)
    val imgH = bitmap.height.toFloat().coerceAtLeast(1f)

    val fitScale = if (canvasSize.width > 0 && canvasSize.height > 0) {
        min(canvasSize.width / imgW, canvasSize.height / imgH)
    } else 1f
    val drawW = imgW * fitScale
    val drawH = imgH * fitScale
    val offsetX = (canvasSize.width - drawW) / 2f
    val offsetY = (canvasSize.height - drawH) / 2f

    fun screenToImage(pt: Offset): Offset {
        val ix = ((pt.x - offsetX) / fitScale).coerceIn(0f, imgW)
        val iy = ((pt.y - offsetY) / fitScale).coerceIn(0f, imgH)
        return Offset(ix, iy)
    }

    fun imageToScreen(pt: Offset): Offset = Offset(offsetX + pt.x * fitScale, offsetY + pt.y * fitScale)

    val colorChoices = remember {
        listOf(
            Color(0xFFFF5C6C),
            Color(0xFFF6B756),
            Color(0xFF4ADE80),
            Color(0xFF60A5FA),
            Color(0xFFC084FC),
            Color.White,
            Color(0xFF14151C)
        )
    }

    val cropW = cropRect?.width()?.roundToInt() ?: bitmap.width
    val cropH = cropRect?.height()?.roundToInt() ?: bitmap.height

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        // Main interactive canvas
        Box(
            modifier = Modifier
                .fillMaxSize()
                .onSizeChanged { canvasSize = it }
                .pointerInput(activeTool, activeColor, strokeWidth, fitScale, offsetX, offsetY) {
                    if (activeTool == MarkupTool.NUMBER) {
                        detectTapGestures { tap ->
                            val pt = screenToImage(tap)
                            annotations.add(AnnotationItem.NumberStamp(pt, stampCounter++, activeColor))
                            redoStack.clear()
                        }
                    }
                }
                .pointerInput(activeTool, activeColor, strokeWidth, fitScale, offsetX, offsetY) {
                    if (activeTool == MarkupTool.NUMBER) return@pointerInput
                    var dragStartImg = Offset.Zero
                    var cropHandle = CropDragHandle.NEW
                    var origCrop: RectF? = null
                    val currentPathPoints = mutableListOf<Offset>()
                    val cornerHitPx = 34.dp.toPx()
                    val edgeHitPx = 26.dp.toPx()
                    val minCropPx = 24f

                    fun hitCropHandle(screenPos: Offset, rect: RectF): CropDragHandle {
                        val tl = imageToScreen(Offset(rect.left, rect.top))
                        val tr = imageToScreen(Offset(rect.right, rect.top))
                        val bl = imageToScreen(Offset(rect.left, rect.bottom))
                        val br = imageToScreen(Offset(rect.right, rect.bottom))
                        fun dist(a: Offset, b: Offset): Float = kotlin.math.hypot((a.x - b.x).toDouble(), (a.y - b.y).toDouble()).toFloat()

                        if (dist(screenPos, tl) <= cornerHitPx) return CropDragHandle.TOP_LEFT
                        if (dist(screenPos, tr) <= cornerHitPx) return CropDragHandle.TOP_RIGHT
                        if (dist(screenPos, bl) <= cornerHitPx) return CropDragHandle.BOTTOM_LEFT
                        if (dist(screenPos, br) <= cornerHitPx) return CropDragHandle.BOTTOM_RIGHT

                        val withinY = screenPos.y in (tl.y - edgeHitPx)..(br.y + edgeHitPx)
                        val withinX = screenPos.x in (tl.x - edgeHitPx)..(br.x + edgeHitPx)
                        if (withinY && abs(screenPos.x - tl.x) <= edgeHitPx) return CropDragHandle.LEFT
                        if (withinY && abs(screenPos.x - br.x) <= edgeHitPx) return CropDragHandle.RIGHT
                        if (withinX && abs(screenPos.y - tl.y) <= edgeHitPx) return CropDragHandle.TOP
                        if (withinX && abs(screenPos.y - br.y) <= edgeHitPx) return CropDragHandle.BOTTOM

                        if (screenPos.x in tl.x..br.x && screenPos.y in tl.y..br.y) return CropDragHandle.MOVE
                        return CropDragHandle.NEW
                    }

                    detectDragGestures(
                        onDragStart = { pos ->
                            val imgPt = screenToImage(pos)
                            dragStartImg = imgPt
                            when (activeTool) {
                                MarkupTool.CROP -> {
                                    val c = cropRect
                                    if (c != null && c.width() >= minCropPx && c.height() >= minCropPx) {
                                        cropHandle = hitCropHandle(pos, c)
                                        if (cropHandle == CropDragHandle.NEW) {
                                            origCrop = null
                                            cropRect = RectF(imgPt.x, imgPt.y, imgPt.x, imgPt.y)
                                        } else {
                                            origCrop = RectF(c)
                                        }
                                    } else {
                                        cropHandle = CropDragHandle.NEW
                                        origCrop = null
                                        cropRect = RectF(imgPt.x, imgPt.y, imgPt.x, imgPt.y)
                                    }
                                }
                                MarkupTool.PEN, MarkupTool.HIGHLIGHTER -> {
                                    currentPathPoints.clear()
                                    currentPathPoints.add(imgPt)
                                    draftAnnotation = AnnotationItem.Freehand(
                                        points = currentPathPoints.toList(),
                                        color = activeColor,
                                        strokeWidth = if (activeTool == MarkupTool.HIGHLIGHTER) strokeWidth * 3f else strokeWidth,
                                        highlighter = activeTool == MarkupTool.HIGHLIGHTER
                                    )
                                }
                                MarkupTool.ARROW, MarkupTool.RECT, MarkupTool.ELLIPSE, MarkupTool.PIXELATE -> {
                                    draftAnnotation = AnnotationItem.Shape(
                                        kind = activeTool,
                                        start = imgPt,
                                        end = imgPt,
                                        color = activeColor,
                                        strokeWidth = strokeWidth
                                    )
                                }
                                MarkupTool.NUMBER -> {}
                            }
                        },
                        onDrag = { change, _ ->
                            change.consume()
                            val imgPt = screenToImage(change.position)
                            when (activeTool) {
                                MarkupTool.CROP -> {
                                    val orig = origCrop
                                    if (cropHandle == CropDragHandle.NEW || orig == null) {
                                        cropRect = RectF(
                                            min(dragStartImg.x, imgPt.x),
                                            min(dragStartImg.y, imgPt.y),
                                            max(dragStartImg.x, imgPt.x),
                                            max(dragStartImg.y, imgPt.y)
                                        )
                                    } else if (cropHandle == CropDragHandle.MOVE) {
                                        val dx = imgPt.x - dragStartImg.x
                                        val dy = imgPt.y - dragStartImg.y
                                        val w = orig.width()
                                        val h = orig.height()
                                        val nx = (orig.left + dx).coerceIn(0f, imgW - w)
                                        val ny = (orig.top + dy).coerceIn(0f, imgH - h)
                                        cropRect = RectF(nx, ny, nx + w, ny + h)
                                    } else {
                                        var l = orig.left
                                        var t = orig.top
                                        var r = orig.right
                                        var b = orig.bottom
                                        when (cropHandle) {
                                            CropDragHandle.TOP_LEFT -> { l = imgPt.x.coerceIn(0f, r - minCropPx); t = imgPt.y.coerceIn(0f, b - minCropPx) }
                                            CropDragHandle.TOP_RIGHT -> { r = imgPt.x.coerceIn(l + minCropPx, imgW); t = imgPt.y.coerceIn(0f, b - minCropPx) }
                                            CropDragHandle.BOTTOM_LEFT -> { l = imgPt.x.coerceIn(0f, r - minCropPx); b = imgPt.y.coerceIn(t + minCropPx, imgH) }
                                            CropDragHandle.BOTTOM_RIGHT -> { r = imgPt.x.coerceIn(l + minCropPx, imgW); b = imgPt.y.coerceIn(t + minCropPx, imgH) }
                                            CropDragHandle.LEFT -> { l = imgPt.x.coerceIn(0f, r - minCropPx) }
                                            CropDragHandle.RIGHT -> { r = imgPt.x.coerceIn(l + minCropPx, imgW) }
                                            CropDragHandle.TOP -> { t = imgPt.y.coerceIn(0f, b - minCropPx) }
                                            CropDragHandle.BOTTOM -> { b = imgPt.y.coerceIn(t + minCropPx, imgH) }
                                            else -> {}
                                        }
                                        cropRect = RectF(l, t, r, b)
                                    }
                                }
                                MarkupTool.PEN, MarkupTool.HIGHLIGHTER -> {
                                    currentPathPoints.add(imgPt)
                                    draftAnnotation = AnnotationItem.Freehand(
                                        points = currentPathPoints.toList(),
                                        color = activeColor,
                                        strokeWidth = if (activeTool == MarkupTool.HIGHLIGHTER) strokeWidth * 3f else strokeWidth,
                                        highlighter = activeTool == MarkupTool.HIGHLIGHTER
                                    )
                                }
                                MarkupTool.ARROW, MarkupTool.RECT, MarkupTool.ELLIPSE, MarkupTool.PIXELATE -> {
                                    draftAnnotation = AnnotationItem.Shape(
                                        kind = activeTool,
                                        start = dragStartImg,
                                        end = imgPt,
                                        color = activeColor,
                                        strokeWidth = strokeWidth
                                    )
                                }
                                MarkupTool.NUMBER -> {}
                            }
                        },
                        onDragEnd = {
                            if (activeTool == MarkupTool.CROP) {
                                val c = cropRect
                                if (c != null && (c.width() < 16f || c.height() < 16f)) {
                                    cropRect = null
                                }
                            } else {
                                draftAnnotation?.let {
                                    annotations.add(it)
                                    redoStack.clear()
                                }
                                draftAnnotation = null
                            }
                        },
                        onDragCancel = {
                            draftAnnotation = null
                        }
                    )
                }
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                // Base screenshot
                drawImage(
                    image = imageBitmap,
                    dstOffset = IntOffset(offsetX.roundToInt(), offsetY.roundToInt()),
                    dstSize = IntSize(drawW.roundToInt(), drawH.roundToInt())
                )

                // Draw committed + draft annotations
                val allAnns = if (draftAnnotation != null) annotations + draftAnnotation!! else annotations
                for (ann in allAnns) {
                    when (ann) {
                        is AnnotationItem.Freehand -> {
                            if (ann.points.size >= 2) {
                                val path = androidx.compose.ui.graphics.Path().apply {
                                    val p0 = imageToScreen(ann.points.first())
                                    moveTo(p0.x, p0.y)
                                    for (i in 1 until ann.points.size) {
                                        val p = imageToScreen(ann.points[i])
                                        lineTo(p.x, p.y)
                                    }
                                }
                                drawPath(
                                    path = path,
                                    color = if (ann.highlighter) ann.color.copy(alpha = 0.36f) else ann.color,
                                    style = Stroke(
                                        width = ann.strokeWidth * fitScale,
                                        cap = StrokeCap.Round,
                                        join = StrokeJoin.Round
                                    )
                                )
                            }
                        }
                        is AnnotationItem.Shape -> {
                            val s = imageToScreen(ann.start)
                            val e = imageToScreen(ann.end)
                            val left = min(s.x, e.x)
                            val top = min(s.y, e.y)
                            val w = abs(e.x - s.x)
                            val h = abs(e.y - s.y)
                            when (ann.kind) {
                                MarkupTool.RECT -> drawRect(
                                    color = ann.color,
                                    topLeft = Offset(left, top),
                                    size = Size(w, h),
                                    style = Stroke(width = ann.strokeWidth * fitScale)
                                )
                                MarkupTool.ELLIPSE -> drawOval(
                                    color = ann.color,
                                    topLeft = Offset(left, top),
                                    size = Size(w, h),
                                    style = Stroke(width = ann.strokeWidth * fitScale)
                                )
                                MarkupTool.PIXELATE -> {
                                    drawRect(
                                        color = Color(0xCC181B24),
                                        topLeft = Offset(left, top),
                                        size = Size(w, h)
                                    )
                                    drawRect(
                                        color = Color.White.copy(alpha = 0.45f),
                                        topLeft = Offset(left, top),
                                        size = Size(w, h),
                                        style = Stroke(width = 2f)
                                    )
                                }
                                MarkupTool.ARROW -> {
                                    val sw = ann.strokeWidth * fitScale
                                    drawLine(ann.color, s, e, strokeWidth = sw, cap = StrokeCap.Round)
                                    val angle = atan2((e.y - s.y).toDouble(), (e.x - s.x).toDouble())
                                    val headLen = max(24f, sw * 4.5f)
                                    val p1 = Offset(
                                        (e.x - headLen * cos(angle - Math.PI / 6)).toFloat(),
                                        (e.y - headLen * sin(angle - Math.PI / 6)).toFloat()
                                    )
                                    val p2 = Offset(
                                        (e.x - headLen * cos(angle + Math.PI / 6)).toFloat(),
                                        (e.y - headLen * sin(angle + Math.PI / 6)).toFloat()
                                    )
                                    drawLine(ann.color, e, p1, strokeWidth = sw, cap = StrokeCap.Round)
                                    drawLine(ann.color, e, p2, strokeWidth = sw, cap = StrokeCap.Round)
                                }
                                else -> {}
                            }
                        }
                        is AnnotationItem.NumberStamp -> {
                            val c = imageToScreen(ann.center)
                            val r = 24f * fitScale.coerceAtLeast(0.75f)
                            drawCircle(color = ann.color, radius = r, center = c)
                            drawCircle(color = Color.White, radius = r, center = c, style = Stroke(width = 3f))
                        }
                    }
                }

                // Crop overlay scrim + crisp selection border & handles
                val c = cropRect
                if (c != null && c.width() >= 4f && c.height() >= 4f) {
                    val tl = imageToScreen(Offset(c.left, c.top))
                    val br = imageToScreen(Offset(c.right, c.bottom))
                    val scrim = Color.Black.copy(alpha = 0.58f)
                    drawRect(scrim, Offset.Zero, Size(size.width, tl.y))
                    drawRect(scrim, Offset(0f, br.y), Size(size.width, size.height - br.y))
                    drawRect(scrim, Offset(0f, tl.y), Size(tl.x, br.y - tl.y))
                    drawRect(scrim, Offset(br.x, tl.y), Size(size.width - br.x, br.y - tl.y))

                    val boxW = br.x - tl.x
                    val boxH = br.y - tl.y
                    // Subtle rule-of-thirds grid inside selection
                    if (boxW > 70f && boxH > 70f) {
                        val gridColor = Color.White.copy(alpha = 0.22f)
                        drawLine(gridColor, Offset(tl.x + boxW / 3f, tl.y), Offset(tl.x + boxW / 3f, br.y), strokeWidth = 1.2f)
                        drawLine(gridColor, Offset(tl.x + boxW * 2f / 3f, tl.y), Offset(tl.x + boxW * 2f / 3f, br.y), strokeWidth = 1.2f)
                        drawLine(gridColor, Offset(tl.x, tl.y + boxH / 3f), Offset(br.x, tl.y + boxH / 3f), strokeWidth = 1.2f)
                        drawLine(gridColor, Offset(tl.x, tl.y + boxH * 2f / 3f), Offset(br.x, tl.y + boxH * 2f / 3f), strokeWidth = 1.2f)
                    }

                    drawRect(
                        color = Color(0xFF7C9CFF),
                        topLeft = tl,
                        size = Size(boxW, boxH),
                        style = Stroke(width = 3.5f)
                    )
                    // 4 crisp edge grab bars (top, bottom, left, right)
                    val barLen = min(36f, min(boxW, boxH) * 0.32f).coerceAtLeast(14f)
                    val midX = (tl.x + br.x) / 2f
                    val midY = (tl.y + br.y) / 2f
                    drawLine(Color.White, Offset(midX - barLen / 2f, tl.y), Offset(midX + barLen / 2f, tl.y), strokeWidth = 7f, cap = StrokeCap.Round)
                    drawLine(Color.White, Offset(midX - barLen / 2f, br.y), Offset(midX + barLen / 2f, br.y), strokeWidth = 7f, cap = StrokeCap.Round)
                    drawLine(Color.White, Offset(tl.x, midY - barLen / 2f), Offset(tl.x, midY + barLen / 2f), strokeWidth = 7f, cap = StrokeCap.Round)
                    drawLine(Color.White, Offset(br.x, midY - barLen / 2f), Offset(br.x, midY + barLen / 2f), strokeWidth = 7f, cap = StrokeCap.Round)

                    // 4 crisp corner handles
                    val cornerR = 11f
                    listOf(tl, Offset(br.x, tl.y), Offset(tl.x, br.y), br).forEach { corner ->
                        drawCircle(Color.White, radius = cornerR, center = corner)
                        drawCircle(Color(0xFF7C9CFF), radius = cornerR, center = corner, style = Stroke(width = 3.5f))
                    }
                }
            }
        }

        // TOP FLOATING TOOLBAR (Drawing tools + Colors + Undo/Redo + Crop dimensions)
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = palette.surface.copy(alpha = 0.94f),
            border = BorderStroke(1.dp, palette.border),
            shadowElevation = 10.dp,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(horizontal = 10.dp, vertical = 8.dp)
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    ToolChip(Icons.Rounded.Crop, "Kırp", activeTool == MarkupTool.CROP) { activeTool = MarkupTool.CROP }
                    ToolChip(Icons.Rounded.Edit, "Kalem", activeTool == MarkupTool.PEN) { activeTool = MarkupTool.PEN }
                    ToolChip(Icons.Rounded.Brush, "Fosforlu", activeTool == MarkupTool.HIGHLIGHTER) { activeTool = MarkupTool.HIGHLIGHTER }
                    ToolChip(Icons.AutoMirrored.Rounded.ArrowForward, "Ok", activeTool == MarkupTool.ARROW) { activeTool = MarkupTool.ARROW }
                    ToolChip(Icons.Rounded.CropSquare, "Kutu", activeTool == MarkupTool.RECT) { activeTool = MarkupTool.RECT }
                    ToolChip(Icons.Rounded.RadioButtonUnchecked, "Daire", activeTool == MarkupTool.ELLIPSE) { activeTool = MarkupTool.ELLIPSE }
                    ToolChip(Icons.Rounded.BlurOn, "Gizle", activeTool == MarkupTool.PIXELATE) { activeTool = MarkupTool.PIXELATE }
                    ToolChip(Icons.Rounded.Pin, "Sayı", activeTool == MarkupTool.NUMBER) { activeTool = MarkupTool.NUMBER }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    colorChoices.forEach { color ->
                        Box(
                            modifier = Modifier
                                .size(22.dp)
                                .clip(CircleShape)
                                .background(color)
                                .border(
                                    width = if (activeColor == color) 2.5.dp else 1.dp,
                                    color = if (activeColor == color) palette.accent else Color.White.copy(alpha = 0.35f),
                                    shape = CircleShape
                                )
                                .clickable { activeColor = color }
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                    IconButton(
                        onClick = { if (annotations.isNotEmpty()) redoStack.add(annotations.removeAt(annotations.lastIndex)) },
                        enabled = annotations.isNotEmpty(),
                        modifier = Modifier.size(30.dp)
                    ) {
                        Icon(Icons.AutoMirrored.Rounded.Undo, "Geri Al", tint = if (annotations.isNotEmpty()) palette.textPrimary else palette.textSecondary.copy(alpha = 0.35f), modifier = Modifier.size(18.dp))
                    }
                    IconButton(
                        onClick = { if (redoStack.isNotEmpty()) annotations.add(redoStack.removeAt(redoStack.lastIndex)) },
                        enabled = redoStack.isNotEmpty(),
                        modifier = Modifier.size(30.dp)
                    ) {
                        Icon(Icons.AutoMirrored.Rounded.Redo, "İleri Al", tint = if (redoStack.isNotEmpty()) palette.textPrimary else palette.textSecondary.copy(alpha = 0.35f), modifier = Modifier.size(18.dp))
                    }
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = palette.surfaceElevated
                    ) {
                        Text(
                            text = "${cropW}×${cropH}",
                            color = palette.textSecondary,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp)
                        )
                    }
                }
            }
        }

        // BOTTOM FLOATING ACTION BAR (Google Lens + OCR + Fullscreen + Share + Cancel + Save)
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = palette.surface.copy(alpha = 0.94f),
            border = BorderStroke(1.dp, palette.border),
            shadowElevation = 10.dp,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = 10.dp, vertical = 10.dp)
        ) {
            Row(
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onCancel, enabled = !busy, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Rounded.Close, "İptal", tint = palette.danger)
                }

                if (cropRect != null) {
                    BottomPill(Icons.Rounded.Fullscreen, "Tam", palette.surfaceElevated, palette.textPrimary, enabled = !busy) {
                        cropRect = null
                    }
                }

                BottomPill(Icons.Rounded.ImageSearch, "Google Lens", Color(0xFF2B3B6B), Color(0xFFA8C5FF), enabled = !busy) {
                    busy = true
                    scope.launch {
                        val rendered = withContext(Dispatchers.Default) { renderFinalBitmap(bitmap, cropRect, annotations) }
                        onGoogleLens(rendered)
                    }
                }

                BottomPill(Icons.Rounded.DocumentScanner, "OCR", palette.surfaceElevated, palette.success, enabled = !busy) {
                    busy = true
                    scope.launch {
                        val rendered = withContext(Dispatchers.Default) { renderFinalBitmap(bitmap, cropRect, annotations) }
                        val text = OcrEngine.recognizeBitmap(rendered)
                        if (rendered !== bitmap) rendered.recycle()
                        busy = false
                        ocrDialogText = text.ifBlank { "(Görselde okunabilir metin bulunamadı)" }
                    }
                }

                IconButton(
                    onClick = {
                        busy = true
                        scope.launch {
                            val rendered = withContext(Dispatchers.Default) { renderFinalBitmap(bitmap, cropRect, annotations) }
                            onShare(rendered)
                            busy = false
                        }
                    },
                    enabled = !busy,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(Icons.Rounded.Share, "Paylaş", tint = palette.textPrimary)
                }

                BottomPill(Icons.Rounded.Check, "Kaydet", palette.accent, Color(0xFF0D101A), enabled = !busy) {
                    busy = true
                    scope.launch {
                        val rendered = withContext(Dispatchers.Default) { renderFinalBitmap(bitmap, cropRect, annotations) }
                        onSaveToLine(rendered)
                    }
                }
            }
        }

        if (busy) {
            Box(
                modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = palette.accent)
            }
        }
    }

    if (ocrDialogText != null) {
        AlertDialog(
            onDismissRequest = { ocrDialogText = null },
            containerColor = palette.surface,
            title = { Text("OCR Metni", color = palette.textPrimary) },
            text = { Text(ocrDialogText.orEmpty(), color = palette.textPrimary, fontSize = 13.5.sp) },
            confirmButton = {
                Button(onClick = {
                    val t = ocrDialogText.orEmpty()
                    ocrDialogText = null
                    onCopyOcr(t)
                }) { Text("Kopyala") }
            },
            dismissButton = {
                TextButton(onClick = { ocrDialogText = null }) { Text("Kapat") }
            }
        )
    }
}

@Composable
private fun ToolChip(icon: ImageVector, label: String, selected: Boolean, onClick: () -> Unit) {
    val palette = LocalClipPalette.current
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = if (selected) palette.accent.copy(alpha = 0.24f) else Color.Transparent,
        border = if (selected) BorderStroke(1.dp, palette.accent) else null
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, label, tint = if (selected) palette.accent else palette.textPrimary, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(4.dp))
            Text(label, color = if (selected) palette.accent else palette.textPrimary, fontSize = 11.5.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
        }
    }
}

@Composable
private fun BottomPill(
    icon: ImageVector,
    label: String,
    bg: Color,
    fg: Color,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(12.dp),
        color = bg
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 11.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, label, tint = fg, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(5.dp))
            Text(label, color = fg, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

private fun renderFinalBitmap(
    source: Bitmap,
    cropRect: RectF?,
    annotations: List<AnnotationItem>
): Bitmap {
    val mutable = source.copy(Bitmap.Config.ARGB_8888, true)
    val canvas = Canvas(mutable)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    for (ann in annotations) {
        when (ann) {
            is AnnotationItem.Freehand -> {
                if (ann.points.size >= 2) {
                    paint.style = Paint.Style.STROKE
                    paint.strokeCap = Paint.Cap.ROUND
                    paint.strokeJoin = Paint.Join.ROUND
                    paint.strokeWidth = ann.strokeWidth
                    paint.color = (if (ann.highlighter) ann.color.copy(alpha = 0.36f) else ann.color).toArgb()
                    val path = Path().apply {
                        moveTo(ann.points.first().x, ann.points.first().y)
                        for (i in 1 until ann.points.size) lineTo(ann.points[i].x, ann.points[i].y)
                    }
                    canvas.drawPath(path, paint)
                }
            }
            is AnnotationItem.Shape -> {
                val left = min(ann.start.x, ann.end.x)
                val top = min(ann.start.y, ann.end.y)
                val right = max(ann.start.x, ann.end.x)
                val bottom = max(ann.start.y, ann.end.y)
                when (ann.kind) {
                    MarkupTool.RECT -> {
                        paint.style = Paint.Style.STROKE
                        paint.strokeWidth = ann.strokeWidth
                        paint.color = ann.color.toArgb()
                        canvas.drawRect(left, top, right, bottom, paint)
                    }
                    MarkupTool.ELLIPSE -> {
                        paint.style = Paint.Style.STROKE
                        paint.strokeWidth = ann.strokeWidth
                        paint.color = ann.color.toArgb()
                        canvas.drawOval(RectF(left, top, right, bottom), paint)
                    }
                    MarkupTool.PIXELATE -> {
                        val rx = left.roundToInt().coerceIn(0, mutable.width - 1)
                        val ry = top.roundToInt().coerceIn(0, mutable.height - 1)
                        val rw = (right - left).roundToInt().coerceIn(1, mutable.width - rx)
                        val rh = (bottom - top).roundToInt().coerceIn(1, mutable.height - ry)
                        if (rw >= 4 && rh >= 4) {
                            val region = Bitmap.createBitmap(mutable, rx, ry, rw, rh)
                            val block = max(12, min(rw, rh) / 10)
                            val smallW = max(1, rw / block)
                            val smallH = max(1, rh / block)
                            val tiny = Bitmap.createScaledBitmap(region, smallW, smallH, false)
                            val mosaic = Bitmap.createScaledBitmap(tiny, rw, rh, false)
                            canvas.drawBitmap(mosaic, null, Rect(rx, ry, rx + rw, ry + rh), null)
                            region.recycle(); tiny.recycle(); mosaic.recycle()
                        }
                    }
                    MarkupTool.ARROW -> {
                        paint.style = Paint.Style.STROKE
                        paint.strokeCap = Paint.Cap.ROUND
                        paint.strokeWidth = ann.strokeWidth
                        paint.color = ann.color.toArgb()
                        canvas.drawLine(ann.start.x, ann.start.y, ann.end.x, ann.end.y, paint)
                        val angle = atan2((ann.end.y - ann.start.y).toDouble(), (ann.end.x - ann.start.x).toDouble())
                        val headLen = max(28f, ann.strokeWidth * 4.5f)
                        canvas.drawLine(
                            ann.end.x, ann.end.y,
                            (ann.end.x - headLen * cos(angle - Math.PI / 6)).toFloat(),
                            (ann.end.y - headLen * sin(angle - Math.PI / 6)).toFloat(),
                            paint
                        )
                        canvas.drawLine(
                            ann.end.x, ann.end.y,
                            (ann.end.x - headLen * cos(angle + Math.PI / 6)).toFloat(),
                            (ann.end.y - headLen * sin(angle + Math.PI / 6)).toFloat(),
                            paint
                        )
                    }
                    else -> {}
                }
            }
            is AnnotationItem.NumberStamp -> {
                val r = 28f
                paint.style = Paint.Style.FILL
                paint.color = ann.color.toArgb()
                canvas.drawCircle(ann.center.x, ann.center.y, r, paint)
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 4f
                paint.color = android.graphics.Color.WHITE
                canvas.drawCircle(ann.center.x, ann.center.y, r, paint)
                paint.style = Paint.Style.FILL
                paint.textAlign = Paint.Align.CENTER
                paint.textSize = 30f
                paint.isFakeBoldText = true
                canvas.drawText(ann.number.toString(), ann.center.x, ann.center.y + 10f, paint)
            }
        }
    }

    if (cropRect != null && cropRect.width() >= 16f && cropRect.height() >= 16f) {
        val x = cropRect.left.roundToInt().coerceIn(0, mutable.width - 1)
        val y = cropRect.top.roundToInt().coerceIn(0, mutable.height - 1)
        val w = cropRect.width().roundToInt().coerceIn(1, mutable.width - x)
        val h = cropRect.height().roundToInt().coerceIn(1, mutable.height - y)
        val cropped = Bitmap.createBitmap(mutable, x, y, w, h)
        mutable.recycle()
        return cropped
    }
    return mutable
}

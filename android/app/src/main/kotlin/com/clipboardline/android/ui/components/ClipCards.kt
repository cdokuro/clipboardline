package com.clipboardline.android.ui.components

import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Notes
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.clipboardline.android.data.ClipItem
import com.clipboardline.android.data.ClipKind
import com.clipboardline.android.ui.theme.LocalClipPalette
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

@Composable
fun ClotheslineWire(modifier: Modifier = Modifier) {
    val palette = LocalClipPalette.current
    Canvas(modifier = modifier.fillMaxWidth().height(16.dp)) {
        val path = Path().apply {
            moveTo(0f, 3f)
            quadraticTo(size.width / 2f, size.height + 6f, size.width, 3f)
        }
        drawPath(
            path = path,
            color = palette.wireColor,
            style = Stroke(width = 2.5f, cap = StrokeCap.Round)
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HangingClipCard(
    item: ClipItem,
    mediaFile: File?,
    index: Int,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
    modifier: Modifier = Modifier,
    cardWidth: Dp? = null,
    cardHeight: Dp? = null,
    showClothespin: Boolean = true
) {
    val palette = LocalClipPalette.current
    val resolvedWidth = cardWidth ?: when (item.kind) {
        ClipKind.IMAGE -> 86.dp
        ClipKind.TEXT -> 122.dp
        ClipKind.LINK -> 130.dp
    }
    val resolvedHeight = cardHeight ?: when (item.kind) {
        ClipKind.IMAGE -> 86.dp
        ClipKind.TEXT -> 108.dp
        ClipKind.LINK -> 104.dp
    }
    val tilt = if (showClothespin) {
        val seed = (abs(item.id.hashCode()) + index * 7) % 5 - 2
        seed * 0.55f
    } else 0f

    val accent = when (item.kind) {
        ClipKind.IMAGE -> palette.imageAccent
        ClipKind.TEXT -> palette.textAccent
        ClipKind.LINK -> palette.linkAccent
    }

    Box(
        modifier = modifier
            .width(resolvedWidth)
            .padding(top = if (showClothespin) 7.dp else 0.dp)
            .rotate(tilt),
        contentAlignment = Alignment.TopCenter
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(resolvedHeight)
                .clip(RoundedCornerShape(12.dp))
                .combinedClickable(onClick = onTap, onLongClick = onLongPress),
            shape = RoundedCornerShape(12.dp),
            color = palette.surface,
            border = BorderStroke(
                width = if (item.pinned) 1.3.dp else 1.dp,
                color = if (item.pinned) palette.pinGold.copy(alpha = 0.65f) else palette.border
            ),
            shadowElevation = 3.dp
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                when (item.kind) {
                    ClipKind.IMAGE -> {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f)
                                .background(palette.surfaceElevated)
                        ) {
                            if (mediaFile != null && mediaFile.exists()) {
                                AsyncImage(
                                    model = mediaFile,
                                    contentDescription = item.title.ifBlank { "Görsel" },
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize()
                                )
                            } else {
                                Icon(
                                    Icons.Rounded.Image,
                                    contentDescription = null,
                                    tint = palette.textSecondary,
                                    modifier = Modifier.align(Alignment.Center).size(24.dp)
                                )
                            }
                            if (item.ocrText.isNotBlank()) {
                                Surface(
                                    shape = RoundedCornerShape(5.dp),
                                    color = Color.Black.copy(alpha = 0.7f),
                                    modifier = Modifier.align(Alignment.BottomStart).padding(4.dp)
                                ) {
                                    Text(
                                        text = "OCR",
                                        color = palette.success,
                                        fontSize = 8.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp)
                                    )
                                }
                            }
                            if (item.pinned) {
                                PinDot(
                                    color = palette.pinGold,
                                    modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)
                                )
                            }
                        }
                    }

                    ClipKind.TEXT -> {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(8.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Rounded.Notes,
                                        contentDescription = null,
                                        tint = accent,
                                        modifier = Modifier.size(11.dp)
                                    )
                                    Spacer(Modifier.width(3.dp))
                                    Text(
                                        text = item.title.ifBlank { formatShortTime(item.lastCopiedAt) },
                                        color = palette.textSecondary,
                                        fontSize = 9.5.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                if (item.pinned) PinDot(color = palette.pinGold)
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = item.text,
                                color = palette.textPrimary,
                                fontSize = 11.sp,
                                lineHeight = 14.5.sp,
                                maxLines = 5,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }

                    ClipKind.LINK -> {
                        val host = try {
                            Uri.parse(item.url).host?.removePrefix("www.") ?: item.url
                        } catch (_: Exception) {
                            item.url
                        }
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(8.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Surface(
                                    shape = RoundedCornerShape(5.dp),
                                    color = accent.copy(alpha = 0.16f)
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(
                                            Icons.Rounded.Link,
                                            contentDescription = null,
                                            tint = accent,
                                            modifier = Modifier.size(10.dp)
                                        )
                                        Spacer(Modifier.width(2.dp))
                                        Text(
                                            text = host,
                                            color = accent,
                                            fontSize = 9.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                                if (item.pinned) PinDot(color = palette.pinGold)
                            }
                            Spacer(Modifier.height(5.dp))
                            Text(
                                text = item.title.ifBlank { host },
                                color = palette.textPrimary,
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(Modifier.height(2.dp))
                            Text(
                                text = item.url,
                                color = palette.textSecondary,
                                fontSize = 9.5.sp,
                                lineHeight = 13.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }
            }
        }

        if (showClothespin) {
            Box(
                modifier = Modifier
                    .offset(y = (-6).dp)
                    .width(9.dp)
                    .height(14.dp)
                    .clip(RoundedCornerShape(2.5.dp))
                    .background(if (item.pinned) palette.pinGold else palette.pinGold.copy(alpha = 0.82f))
            ) {
                Box(
                    modifier = Modifier
                        .align(Alignment.Center)
                        .fillMaxWidth()
                        .height(1.5.dp)
                        .background(Color.Black.copy(alpha = 0.28f))
                )
            }
        }
    }
}

@Composable
private fun PinDot(color: Color, modifier: Modifier = Modifier) {
    Surface(
        shape = CircleShape,
        color = color.copy(alpha = 0.22f),
        modifier = modifier.size(18.dp)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                Icons.Rounded.PushPin,
                contentDescription = "Sabitli",
                tint = color,
                modifier = Modifier.size(11.dp)
            )
        }
    }
}

fun formatShortTime(ts: Long): String {
    val diff = System.currentTimeMillis() - ts
    return when {
        diff < 60_000 -> "az önce"
        diff < 3_600_000 -> "${diff / 60_000} dk"
        diff < 86_400_000 -> "${diff / 3_600_000} sa"
        else -> SimpleDateFormat("dd MMM", Locale("tr")).format(Date(ts))
    }
}

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
    cardWidth: Dp = 152.dp,
    cardHeight: Dp = 158.dp,
    showClothespin: Boolean = true
) {
    val palette = LocalClipPalette.current
    val tilt = if (showClothespin) {
        val seed = (abs(item.id.hashCode()) + index * 7) % 5 - 2
        seed * 0.65f
    } else 0f

    val accent = when (item.kind) {
        ClipKind.IMAGE -> palette.imageAccent
        ClipKind.TEXT -> palette.textAccent
        ClipKind.LINK -> palette.linkAccent
    }

    Box(
        modifier = modifier
            .width(cardWidth)
            .padding(top = if (showClothespin) 10.dp else 0.dp)
            .rotate(tilt),
        contentAlignment = Alignment.TopCenter
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(cardHeight)
                .clip(RoundedCornerShape(14.dp))
                .combinedClickable(onClick = onTap, onLongClick = onLongPress),
            shape = RoundedCornerShape(14.dp),
            color = palette.surface,
            border = BorderStroke(
                width = if (item.pinned) 1.3.dp else 1.dp,
                color = if (item.pinned) palette.pinGold.copy(alpha = 0.65f) else palette.border
            ),
            shadowElevation = 4.dp
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
                                    modifier = Modifier.align(Alignment.Center).size(30.dp)
                                )
                            }
                            if (item.ocrText.isNotBlank()) {
                                Surface(
                                    shape = RoundedCornerShape(6.dp),
                                    color = Color.Black.copy(alpha = 0.65f),
                                    modifier = Modifier.align(Alignment.BottomStart).padding(6.dp)
                                ) {
                                    Text(
                                        text = "OCR",
                                        color = palette.success,
                                        fontSize = 9.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp)
                                    )
                                }
                            }
                            if (item.pinned) {
                                PinDot(
                                    color = palette.pinGold,
                                    modifier = Modifier.align(Alignment.TopEnd).padding(6.dp)
                                )
                            }
                        }
                        if (item.title.isNotBlank() || item.width > 0) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 8.dp, vertical = 5.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = item.title.ifBlank { "${item.width}×${item.height}" },
                                    color = palette.textSecondary,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }

                    ClipKind.TEXT -> {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(10.dp)
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
                                        modifier = Modifier.size(13.dp)
                                    )
                                    Spacer(Modifier.width(4.dp))
                                    Text(
                                        text = item.title.ifBlank { formatShortTime(item.lastCopiedAt) },
                                        color = palette.textSecondary,
                                        fontSize = 10.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                if (item.pinned) PinDot(color = palette.pinGold)
                            }
                            Spacer(Modifier.height(6.dp))
                            Text(
                                text = item.text,
                                color = palette.textPrimary,
                                fontSize = 12.5.sp,
                                lineHeight = 17.sp,
                                maxLines = 6,
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
                                .padding(10.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Surface(
                                    shape = RoundedCornerShape(6.dp),
                                    color = accent.copy(alpha = 0.16f)
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Icon(
                                            Icons.Rounded.Link,
                                            contentDescription = null,
                                            tint = accent,
                                            modifier = Modifier.size(12.dp)
                                        )
                                        Spacer(Modifier.width(3.dp))
                                        Text(
                                            text = host,
                                            color = accent,
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                                if (item.pinned) PinDot(color = palette.pinGold)
                            }
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = item.title.ifBlank { host },
                                color = palette.textPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = item.url,
                                color = palette.textSecondary,
                                fontSize = 11.sp,
                                lineHeight = 15.sp,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }
            }
        }

        if (showClothespin) {
            // Warm wooden/gold clothespin clipping the card to the wire
            Box(
                modifier = Modifier
                    .offset(y = (-8).dp)
                    .width(12.dp)
                    .height(20.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(if (item.pinned) palette.pinGold else palette.pinGold.copy(alpha = 0.82f))
            ) {
                Box(
                    modifier = Modifier
                        .align(Alignment.Center)
                        .fillMaxWidth()
                        .height(2.dp)
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

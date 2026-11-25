package com.clipboardline.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.clipboardline.android.data.AppThemeMode

@Immutable
data class ClipPalette(
    val bg: Color,
    val surface: Color,
    val surfaceElevated: Color,
    val border: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val accent: Color,
    val pinGold: Color,
    val success: Color,
    val danger: Color,
    val wireColor: Color,
    val imageAccent: Color,
    val textAccent: Color,
    val linkAccent: Color
)

val EdnaPalette = ClipPalette(
    bg = Color(0xFF14151C),
    surface = Color(0xFF1C1E28),
    surfaceElevated = Color(0xFF252836),
    border = Color(0x19FFFFFF),
    textPrimary = Color(0xFFEDF0FA),
    textSecondary = Color(0xFF97A0BA),
    accent = Color(0xFF7C9CFF),
    pinGold = Color(0xFFF0A868),
    success = Color(0xFF52D196),
    danger = Color(0xFFFF6E7B),
    wireColor = Color(0xFF47506B),
    imageAccent = Color(0xFF52D196),
    textAccent = Color(0xFF7C9CFF),
    linkAccent = Color(0xFFC08BFF)
)

val SoftPalette = ClipPalette(
    bg = Color(0xFF1A1B22),
    surface = Color(0xFF242630),
    surfaceElevated = Color(0xFF2F3240),
    border = Color(0x1CFFFFFF),
    textPrimary = Color(0xFFF2F3F7),
    textSecondary = Color(0xFFA7ADBF),
    accent = Color(0xFF8AB4F8),
    pinGold = Color(0xFFF2B880),
    success = Color(0xFF68D391),
    danger = Color(0xFFFC8181),
    wireColor = Color(0xFF565C72),
    imageAccent = Color(0xFF68D391),
    textAccent = Color(0xFF8AB4F8),
    linkAccent = Color(0xFFD6BCFA)
)

val NeutralPalette = ClipPalette(
    bg = Color(0xFF0E0E10),
    surface = Color(0xFF18181B),
    surfaceElevated = Color(0xFF242429),
    border = Color(0x1FFFFFFF),
    textPrimary = Color(0xFFFAFAFA),
    textSecondary = Color(0xFFA1A1AA),
    accent = Color(0xFFE4E4E7),
    pinGold = Color(0xFFEAB308),
    success = Color(0xFF4ADE80),
    danger = Color(0xFFF87171),
    wireColor = Color(0xFF3F3F46),
    imageAccent = Color(0xFF4ADE80),
    textAccent = Color(0xFF60A5FA),
    linkAccent = Color(0xFFA78BFA)
)

val LocalClipPalette = staticCompositionLocalOf { EdnaPalette }

private val ClipTypography = Typography(
    titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium)
)

@Composable
fun ClipBoardLineTheme(
    mode: AppThemeMode = AppThemeMode.EDNA,
    content: @Composable () -> Unit
) {
    val palette = when (mode) {
        AppThemeMode.EDNA -> EdnaPalette
        AppThemeMode.SOFT -> SoftPalette
        AppThemeMode.NEUTRAL -> NeutralPalette
    }

    val colorScheme = darkColorScheme(
        primary = palette.accent,
        onPrimary = Color(0xFF0D101A),
        secondary = palette.pinGold,
        background = palette.bg,
        onBackground = palette.textPrimary,
        surface = palette.surface,
        onSurface = palette.textPrimary,
        surfaceVariant = palette.surfaceElevated,
        onSurfaceVariant = palette.textSecondary,
        error = palette.danger,
        outline = palette.border
    )

    CompositionLocalProvider(LocalClipPalette provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = ClipTypography,
            content = content
        )
    }
}

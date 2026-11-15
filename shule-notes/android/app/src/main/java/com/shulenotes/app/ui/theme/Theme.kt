package com.shulenotes.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val BrandGreen = Color(0xFF1D6F4F)
val BrandGreenDark = Color(0xFF0F4A32)
val BrandGold = Color(0xFFF2B705)
val BrandPaper = Color(0xFFF7F5F2)
val BrandInk = Color(0xFF1A1310)
val BrandDanger = Color(0xFFC23B3B)

private val LightColors = lightColorScheme(
    primary = BrandGreen,
    onPrimary = Color.White,
    secondary = BrandGold,
    background = BrandPaper,
    onBackground = BrandInk,
    surface = Color.White,
    onSurface = BrandInk,
    error = BrandDanger,
)

private val DarkColors = darkColorScheme(
    primary = BrandGreen,
    onPrimary = Color.White,
    secondary = BrandGold,
)

@Composable
fun ShuleNotesTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}

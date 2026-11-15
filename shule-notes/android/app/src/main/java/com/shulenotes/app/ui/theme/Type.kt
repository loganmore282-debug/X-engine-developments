package com.shulenotes.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.shulenotes.app.R

// Poppins for headings, titles and buttons; the system font for body text,
// which stays easier to read in long descriptions and AI answers.
val Poppins = FontFamily(
    Font(R.font.poppins_medium, FontWeight.Medium),
    Font(R.font.poppins_semibold, FontWeight.SemiBold),
    Font(R.font.poppins_bold, FontWeight.Bold),
)

private fun heading(weight: FontWeight, size: Int, line: Int) =
    TextStyle(fontFamily = Poppins, fontWeight = weight, fontSize = size.sp, lineHeight = line.sp)

private val Base = Typography()

val ShuleTypography = Typography(
    headlineLarge = heading(FontWeight.Bold, 30, 38),
    headlineMedium = heading(FontWeight.Bold, 26, 34),
    headlineSmall = heading(FontWeight.SemiBold, 22, 30),
    titleLarge = heading(FontWeight.SemiBold, 19, 26),
    titleMedium = heading(FontWeight.SemiBold, 16, 22),
    titleSmall = heading(FontWeight.Medium, 14, 20),
    labelLarge = heading(FontWeight.SemiBold, 15, 20),
    labelMedium = heading(FontWeight.Medium, 12, 16),
    labelSmall = Base.labelSmall,
    bodyLarge = Base.bodyLarge.copy(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = Base.bodyMedium.copy(fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = Base.bodySmall.copy(fontSize = 13.sp, lineHeight = 18.sp),
)

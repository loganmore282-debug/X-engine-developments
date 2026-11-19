package com.shulenotes.app.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Calculate
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Eco
import androidx.compose.material.icons.filled.HistoryEdu
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import com.shulenotes.app.data.Subject

// accent / container colour the subject's chips and labels; the cover pair
// is the gradient on a document's cover tile, with onCover as the icon on it.
data class SubjectTint(
    val accent: Color,
    val container: Color,
    val coverStart: Color,
    val coverEnd: Color,
    val onCover: Color,
)

private val LightAccents = listOf(
    Color(0xFF17694B), Color(0xFF2B5FB3), Color(0xFFA9530B),
    Color(0xFF6B4BB8), Color(0xFFAD3759), Color(0xFF0F6E7A),
)
private val LightContainers = listOf(
    Color(0xFFD9F0E4), Color(0xFFDDE8FB), Color(0xFFFCE7D3),
    Color(0xFFE9E1FA), Color(0xFFFBDEE6), Color(0xFFD6EEF1),
)
private val DarkAccents = listOf(
    Color(0xFF7CD3AA), Color(0xFF9DBDF5), Color(0xFFF5B27E),
    Color(0xFFC3B0F5), Color(0xFFF3A3BA), Color(0xFF7FD3DE),
)

private fun lightTint(accent: Color, container: Color) = SubjectTint(
    accent = accent,
    container = container,
    coverStart = lerp(accent, Color.White, 0.14f),
    coverEnd = lerp(accent, Color.Black, 0.24f),
    onCover = Color.White,
)

private fun darkTint(accent: Color) = SubjectTint(
    accent = accent,
    container = accent.copy(alpha = 0.18f),
    coverStart = accent.copy(alpha = 0.32f),
    coverEnd = accent.copy(alpha = 0.14f),
    onCover = accent,
)

// Each subject keeps one colour everywhere, taken from its position in the
// admin's subject order, so the first six subjects never share one. A
// document with no subject gets the logo's teal.
@Composable
fun subjectTint(subjectId: String?, subjects: List<Subject>): SubjectTint {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val position = subjects.indexOfFirst { it.id == subjectId }
    if (position < 0) {
        return if (dark) darkTint(Color(0xFF3CE0C6)) else lightTint(Color(0xFF0F8F80), Color(0xFFD3F1EC))
    }
    val index = position % LightAccents.size
    return if (dark) darkTint(DarkAccents[index]) else lightTint(LightAccents[index], LightContainers[index])
}

// A picture for the subject, guessed from its name; any other subject gets an open book.
fun subjectIcon(name: String?): ImageVector {
    val n = name.orEmpty().lowercase()
    return when {
        "bio" in n || "agric" in n || "nature" in n -> Icons.Filled.Eco
        "math" in n || "arith" in n || "algebra" in n -> Icons.Filled.Calculate
        "phys" in n -> Icons.Filled.Bolt
        "chem" in n || "science" in n -> Icons.Filled.Science
        "hist" in n || "relig" in n || "cre" == n || "ire" == n -> Icons.Filled.HistoryEdu
        "geo" in n || "social" in n -> Icons.Filled.Public
        "engl" in n || "lang" in n || "lit" in n || "kiswa" in n || "luganda" in n || "french" in n || "german" in n -> Icons.Filled.Translate
        "comput" in n || "ict" in n || "tech" in n -> Icons.Filled.Computer
        else -> Icons.AutoMirrored.Filled.MenuBook
    }
}

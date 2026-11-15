package com.shulenotes.app.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.shulenotes.app.data.Subject

data class SubjectTint(val accent: Color, val container: Color)

private val LightTints = listOf(
    SubjectTint(Color(0xFF17694B), Color(0xFFD9F0E4)),
    SubjectTint(Color(0xFF2B5FB3), Color(0xFFDDE8FB)),
    SubjectTint(Color(0xFFA9530B), Color(0xFFFCE7D3)),
    SubjectTint(Color(0xFF6B4BB8), Color(0xFFE9E1FA)),
    SubjectTint(Color(0xFFAD3759), Color(0xFFFBDEE6)),
    SubjectTint(Color(0xFF0F6E7A), Color(0xFFD6EEF1)),
)

private val DarkAccents = listOf(
    Color(0xFF7CD3AA), Color(0xFF9DBDF5), Color(0xFFF5B27E),
    Color(0xFFC3B0F5), Color(0xFFF3A3BA), Color(0xFF7FD3DE),
)

// Each subject keeps one colour everywhere, taken from its position in the
// admin's subject order, so the first six subjects never share a colour.
@Composable
fun subjectTint(subjectId: String?, subjects: List<Subject>): SubjectTint {
    val position = subjects.indexOfFirst { it.id == subjectId }
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    if (position < 0) {
        return SubjectTint(MaterialTheme.colorScheme.onSurfaceVariant, MaterialTheme.colorScheme.surfaceContainerHigh)
    }
    val index = position % LightTints.size
    return if (dark) SubjectTint(DarkAccents[index], DarkAccents[index].copy(alpha = 0.18f)) else LightTints[index]
}

package com.shulenotes.app.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import com.shulenotes.app.R
import com.shulenotes.app.data.Subject
import kotlin.math.abs

// accent / container colour the subject's labels and tile; the cover pair is
// the gradient on a document's cover, with onCover as the icon on it.
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

// A subject's picture and colour. Both come from its NAME, so they never
// change when other subjects are added or removed. Related subjects share a
// colour: sciences green, numbers blue, physics and sport orange, chemistry
// and the arts purple, languages pink, places and people teal.
class SubjectLook(@DrawableRes val icon: Int, val colour: Int)

private const val GREEN = 0
private const val BLUE = 1
private const val ORANGE = 2
private const val PURPLE = 3
private const val PINK = 4
private const val TEAL = 5

fun subjectLook(name: String?): SubjectLook {
    val tokens = name.orEmpty().lowercase().split(Regex("[^a-z]+")).filter { it.isNotEmpty() }
    fun has(vararg prefixes: String) = tokens.any { t -> prefixes.any { t.startsWith(it) } }
    return when {
        // Order matters: the more specific names are checked first.
        has("christian", "divinity") -> SubjectLook(R.drawable.ic_subject_christian, PURPLE)
        has("islam") -> SubjectLook(R.drawable.ic_subject_islam, PURPLE)
        has("religio") -> SubjectLook(R.drawable.ic_subject_religion, PURPLE)
        has("literature") -> SubjectLook(R.drawable.ic_subject_literature, PINK)
        has("general") -> SubjectLook(R.drawable.ic_subject_generalpaper, PINK)
        has("physical") -> SubjectLook(R.drawable.ic_subject_pe, ORANGE)
        has("perform", "music", "drama", "dance") -> SubjectLook(R.drawable.ic_subject_music, PURPLE)
        has("creative", "art", "fine", "design") && !has("technolog") -> SubjectLook(R.drawable.ic_subject_art, PURPLE)
        has("nutrition", "food") -> SubjectLook(R.drawable.ic_subject_nutrition, GREEN)
        has("technolog") -> SubjectLook(R.drawable.ic_subject_technology, BLUE)
        has("entrepreneur") -> SubjectLook(R.drawable.ic_subject_entrepreneurship, ORANGE)
        has("econom") -> SubjectLook(R.drawable.ic_subject_economics, BLUE)
        has("ict", "comput") -> SubjectLook(R.drawable.ic_subject_ict, BLUE)
        has("math", "numeracy", "arithmetic", "algebra", "mtc") -> SubjectLook(R.drawable.ic_subject_math, BLUE)
        has("english") -> SubjectLook(R.drawable.ic_subject_english, PINK)
        has("kiswahili", "luganda", "local", "foreign", "french", "german", "arabic", "chinese", "latin", "language") ->
            SubjectLook(R.drawable.ic_subject_languages, PINK)
        has("reading", "literacy") -> SubjectLook(R.drawable.ic_subject_reading, PINK)
        has("physic") -> SubjectLook(R.drawable.ic_subject_physics, ORANGE)
        has("chem") -> SubjectLook(R.drawable.ic_subject_chemistry, PURPLE)
        has("bio") -> SubjectLook(R.drawable.ic_subject_biology, GREEN)
        has("agric") -> SubjectLook(R.drawable.ic_subject_agriculture, GREEN)
        has("science") -> SubjectLook(R.drawable.ic_subject_science, GREEN)
        has("geograph") -> SubjectLook(R.drawable.ic_subject_geography, TEAL)
        has("histor") -> SubjectLook(R.drawable.ic_subject_history, TEAL)
        has("social", "civic") -> SubjectLook(R.drawable.ic_subject_social, TEAL)
        // Any other subject: an open book, and a colour picked from the name.
        else -> SubjectLook(R.drawable.ic_subject_reading, abs(name.orEmpty().lowercase().hashCode()) % 6)
    }
}

@DrawableRes
fun subjectIcon(name: String?): Int = subjectLook(name).icon

@Composable
fun subjectTint(subjectId: String?, subjects: List<Subject>): SubjectTint {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val subject = subjects.firstOrNull { it.id == subjectId }
    if (subject == null) {
        // A document with no subject gets the logo's teal.
        return if (dark) darkTint(Color(0xFF3CE0C6)) else lightTint(Color(0xFF0F8F80), Color(0xFFD3F1EC))
    }
    val index = subjectLook(subject.name).colour
    return if (dark) darkTint(DarkAccents[index]) else lightTint(LightAccents[index], LightContainers[index])
}

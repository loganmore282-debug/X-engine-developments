package com.shulenotes.app.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp

// The font size (in sp) at which the LONGEST WORD of `text` still fits `maxWidth`, starting from the style's own size and
// shrinking by half a point down to `minSp`. A long word ("Entrepreneurship") is therefore never cut in the middle; normal
// names keep the regular size.
@Composable
fun fitFontSize(text: String, style: TextStyle, maxWidth: Dp, minSp: Float = 10f): Float {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val maxPx = with(density) { maxWidth.roundToPx() }
    return remember(text, style, maxPx) {
        val longest = text.split(' ', '-', '/', '&').maxByOrNull { it.length } ?: text
        var size = if (style.fontSize.isSp) style.fontSize.value else 14f
        while (size > minSp && measurer.measure(longest, style.copy(fontSize = size.sp)).size.width > maxPx) size -= 0.5f
        size
    }
}

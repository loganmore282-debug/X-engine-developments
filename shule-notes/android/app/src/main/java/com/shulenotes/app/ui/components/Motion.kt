package com.shulenotes.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

// Shared motion for the app: one place, so every screen moves the same way.

// A card appears the FIRST time it is shown: it fades in and rises a little, one after another (the first
// eight are staggered). `seen` remembers what has already appeared, so scrolling back never replays it.
@Composable
fun Modifier.enterOnce(id: String, seen: MutableSet<String>, index: Int): Modifier {
    val firstTime = remember(id) { id !in seen }
    val progress = remember(id) { Animatable(if (firstTime) 0f else 1f) }
    LaunchedEffect(id) {
        if (firstTime) {
            seen.add(id)
            delay(minOf(index, 7) * 45L)
            progress.animateTo(1f, tween(380, easing = FastOutSlowInEasing))
        }
    }
    return this.graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * 26.dp.toPx()
    }
}

// A soft band of light that sweeps across a placeholder while something loads.
fun Modifier.shimmer(): Modifier = composed {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val sweep by transition.animateFloat(
        initialValue = -0.6f,
        targetValue = 1.6f,
        animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart),
        label = "shimmer-sweep",
    )
    drawWithContent {
        drawContent()
        val w = size.width
        drawRect(
            Brush.linearGradient(
                colors = listOf(Color.Transparent, Color.White.copy(alpha = 0.65f), Color.Transparent),
                start = Offset(sweep * w, 0f),
                end = Offset(sweep * w + w * 0.55f, size.height * 0.25f),
            ),
        )
    }
}

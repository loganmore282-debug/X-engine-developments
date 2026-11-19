package com.shulenotes.app.ui.splash

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shulenotes.app.R
import com.shulenotes.app.ui.components.StatusBarIcons

// The first thing seen when the app opens: the whole Shule Notes logo (the mark with its lettering) on white,
// with a soft green glow behind it, a line underneath and a thin bar that fills while the app gets ready.
// Android 12 and newer draw their own launch screen for a moment first (the mark on the same white), so this
// picks up from it.
@Composable
fun SplashScreen() {
    StatusBarIcons(light = false) // dark clock and battery on the white screen
    val logo = remember { Animatable(0f) }
    val line = remember { Animatable(0f) }
    val bar = remember { Animatable(0f) }

    LaunchedEffect(Unit) { logo.animateTo(1f, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessLow)) }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(380)
        line.animateTo(1f, tween(520))
    }
    LaunchedEffect(Unit) { bar.animateTo(1f, tween(1250, easing = LinearEasing)) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            // A soft green glow centred behind the logo.
            .drawBehind {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(Color(0x241F7F59), Color(0x00FFFFFF)),
                        center = Offset(size.width / 2f, size.height * 0.46f),
                        radius = size.width * 0.9f,
                    ),
                    radius = size.width * 0.9f,
                    center = Offset(size.width / 2f, size.height * 0.46f),
                )
            },
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
        ) {
            Image(
                painter = painterResource(R.drawable.logo_full),
                contentDescription = "Shule Notes",
                modifier = Modifier
                    .fillMaxWidth(0.66f)
                    .scale(0.82f + 0.18f * logo.value)
                    .alpha(logo.value.coerceIn(0f, 1f)),
            )
            Spacer(Modifier.height(22.dp))
            Text(
                "Study smarter, anywhere.",
                color = Color(0xFF3E5A4E),
                fontSize = 15.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.alpha(line.value).padding(top = ((1f - line.value) * 10f).dp),
            )
        }

        // A thin bar that fills while the app gets ready.
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 56.dp)
                .width(96.dp)
                .height(3.dp)
                .clip(CircleShape)
                .background(Color(0x1F1F7F59))
                .drawBehind {
                    drawRect(Color(0xFF1F7F59), size = Size(size.width * bar.value, size.height), topLeft = Offset.Zero)
                },
        )
    }
}

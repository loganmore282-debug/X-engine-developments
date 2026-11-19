package com.shulenotes.app.ui.splash

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import com.shulenotes.app.R
import com.shulenotes.app.ui.components.StatusBarIcons
import com.shulenotes.app.ui.theme.Poppins

// The first thing seen when the app opens: the logo on the brand green, which then gives way to the app.
// Android 12 and newer draw their own launch screen for a moment first (a white disc with the logo on the
// same green), so this picks up from exactly that look.
@Composable
fun SplashScreen() {
    StatusBarIcons(light = true)
    val logo = remember { Animatable(0f) }
    val words = remember { Animatable(0f) }
    val bar = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        logo.animateTo(1f, spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessLow))
    }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(260)
        words.animateTo(1f, tween(520))
    }
    LaunchedEffect(Unit) {
        bar.animateTo(1f, tween(1250, easing = LinearEasing))
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF176E4C), Color(0xFF0F4D35)))),
    ) {
        // Two soft circles for depth, as in the Home header.
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 40.dp)
                .size(260.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.05f)),
        )
        Box(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .size(220.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.04f)),
        )

        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(
                modifier = Modifier
                    .scale(0.72f + 0.28f * logo.value)
                    .alpha(logo.value.coerceIn(0f, 1f))
                    .size(148.dp)
                    .clip(CircleShape)
                    .background(Color.White),
                contentAlignment = Alignment.Center,
            ) {
                Image(painterResource(R.drawable.logo_mark), contentDescription = "Shule Notes", modifier = Modifier.size(96.dp))
            }
            Spacer(Modifier.height(28.dp))
            Text(
                "ShuleNotes",
                color = Color.White,
                fontFamily = Poppins,
                fontWeight = FontWeight.Bold,
                fontSize = 30.sp,
                modifier = Modifier.alpha(words.value).padding(top = ((1f - words.value) * 12f).dp),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Study smarter, anywhere.",
                color = Color.White.copy(alpha = 0.80f),
                fontSize = 15.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.alpha(words.value),
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
                .background(Color.White.copy(alpha = 0.22f))
                .drawBehind {
                    drawRect(Color.White, size = Size(size.width * bar.value, size.height), topLeft = Offset.Zero)
                },
        )
    }
}

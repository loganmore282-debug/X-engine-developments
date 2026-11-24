package com.shulenotes.app.ui.onboarding

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Quiz
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CloudDownload
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.imageLoader
import coil.request.ImageRequest
import com.shulenotes.app.BuildConfig
import com.shulenotes.app.R
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.ui.components.StatusBarIcons
import com.shulenotes.app.ui.theme.Poppins
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

// One screen of the introduction. A slide the owner made has a picture; the built-in ones draw an icon
// on a green gradient instead.
private class IntroSlide(
    val title: String,
    val text: String,
    val imageUrl: String? = null,
    val drawable: Int? = null, // a picture shipped inside the app
    val icon: ImageVector? = null,
    val tint: Pair<Color, Color> = Color(0xFF1F7F59) to Color(0xFF0B2F22),
)

// What a student sees until the owner makes slides of their own in the admin panel.
private val BuiltIn = listOf(
    IntroSlide(
        "Every note in one place",
        "Notes and exams for your class, added the moment they are ready.",
        drawable = R.drawable.intro_1,
    ),
    IntroSlide(
        "Stuck? Ask the AI helper",
        "Open any page and ask a question. The answer comes from the document you are reading.",
        drawable = R.drawable.intro_2,
    ),
    // The owner is choosing a picture for this one; until intro_4 is added to the app it is drawn as an icon on green.
    IntroSlide(
        "Be ready for every exam",
        "Practise with exams for your class, then watch your streak and progress grow every day.",
        icon = Icons.Outlined.Quiz,
    ),
    IntroSlide(
        "Study anywhere",
        "Download notes to read without data, and carry on exactly where you stopped.",
        drawable = R.drawable.intro_3,
    ),
)

private val Scrim = Color(0xFF06170F)

// Shown once, before the first sign-in. The owner's slides come from the server; if they cannot be
// fetched quickly (or none were ever made) the built-in ones are used, so there is always an introduction.
@Composable
fun IntroScreen(onFinished: () -> Unit) {
    StatusBarIcons(light = true)
    val context = LocalContext.current
    var slides by remember { mutableStateOf<List<IntroSlide>?>(null) }

    LaunchedEffect(Unit) {
        val answer = withTimeoutOrNull(3000) { runCatching { ApiClient.service.onboarding() }.getOrNull() }
        val chosen = if (answer != null && answer.status == "success" && answer.configured) {
            answer.slides.map { IntroSlide(it.title, it.text, it.imageUrl?.let { u -> BuildConfig.API_BASE_URL.trimEnd('/') + u }) }
        } else {
            BuiltIn
        }
        // Fetch every picture now so swiping never shows an empty slide.
        chosen.forEach { s -> s.imageUrl?.let { context.imageLoader.enqueue(ImageRequest.Builder(context).data(it).build()) } }
        if (chosen.isEmpty()) onFinished() else slides = chosen
    }

    val list = slides
    if (list == null) {
        Box(
            modifier = Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(BuiltIn[0].tint.first, BuiltIn[0].tint.second))),
            contentAlignment = Alignment.Center,
        ) {
            Image(painterResource(R.drawable.logo_mark), contentDescription = null, modifier = Modifier.size(96.dp))
        }
        return
    }

    val pager = rememberPagerState(pageCount = { list.size })
    val scope = rememberCoroutineScope()
    val last = pager.currentPage == list.size - 1

    Box(modifier = Modifier.fillMaxSize().background(Scrim)) {
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
            SlidePage(list[page])
        }

        // Top: one thin bar per slide, filled up to the current one, and a Skip button.
        Column(modifier = Modifier.statusBarsPadding().padding(horizontal = 24.dp, vertical = 14.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                list.indices.forEach { i ->
                    val color by animateColorAsState(if (i <= pager.currentPage) Color.White else Color.White.copy(alpha = 0.32f), label = "bar")
                    Box(modifier = Modifier.weight(1f).height(4.dp).clip(CircleShape).background(color))
                }
            }
            Spacer(Modifier.height(14.dp))
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.logo_mark), contentDescription = null, modifier = Modifier.size(30.dp))
                Spacer(Modifier.size(8.dp))
                Text("ShuleNotes", color = Color.White, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Spacer(Modifier.weight(1f))
                if (!last) {
                    Text(
                        "Skip",
                        color = Color.White,
                        fontFamily = Poppins,
                        fontWeight = FontWeight.Medium,
                        fontSize = 14.sp,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.16f))
                            .clickable(onClickLabel = "Skip the introduction", onClick = onFinished)
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
            }
        }

        // Bottom: one wide button that moves on, and becomes "Get started" on the last slide.
        Button(
            onClick = { if (last) onFinished() else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } },
            shape = RoundedCornerShape(18.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color(0xFF0B3B28)),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = 24.dp, vertical = 24.dp)
                .fillMaxWidth()
                .height(56.dp),
        ) {
            Text(if (last) "Get started" else "Continue", fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        }
    }
}

@Composable
private fun SlidePage(slide: IntroSlide) {
    Box(modifier = Modifier.fillMaxSize()) {
        if (slide.drawable != null) {
            Image(
                painter = painterResource(slide.drawable),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else if (slide.imageUrl != null) {
            AsyncImage(
                model = slide.imageUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Box(modifier = Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(slide.tint.first, slide.tint.second))))
            if (slide.icon != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = 150.dp)
                        .size(150.dp)
                        .clip(RoundedCornerShape(44.dp))
                        .background(Color.White.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(slide.icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(76.dp))
                }
            }
        }
        // A dark fade from the bottom so white text reads on any picture.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.62f)
                .align(Alignment.BottomCenter)
                .background(Brush.verticalGradient(listOf(Color.Transparent, Scrim.copy(alpha = 0.78f), Scrim.copy(alpha = 0.96f)))),
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .navigationBarsPadding()
                .padding(start = 24.dp, end = 24.dp, bottom = 120.dp),
        ) {
            Text(slide.title, color = Color.White, fontFamily = Poppins, fontWeight = FontWeight.Bold, fontSize = 30.sp, lineHeight = 38.sp)
            Spacer(Modifier.height(12.dp))
            Text(slide.text, color = Color.White.copy(alpha = 0.86f), fontSize = 16.sp, lineHeight = 24.sp, modifier = Modifier.alpha(0.98f))
        }
    }
}

package com.shulenotes.app.ui.note

import androidx.compose.animation.core.animate
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import com.shulenotes.app.ui.components.shimmer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

private const val MAX_ZOOM = 4f
private const val DOUBLE_TAP_ZOOM = 2.2f
private const val MAX_RENDER_WIDTH_PX = 2200

// The document as a scrolling strip of pages. Pinch or double-tap to zoom:
// zooming widens the pages rather than magnifying a picture of them, so text
// is redrawn sharp at the new size. Only the pages on screen are ever drawn.
@Composable
fun PdfPagesView(document: PdfDocument, listState: LazyListState, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier = modifier.clipToBounds()) {
        val viewportPx = constraints.maxWidth.toFloat()
        val sidePaddingPx = with(LocalDensity.current) { 12.dp.toPx() }
        val scope = rememberCoroutineScope()
        var zoom by remember { mutableFloatStateOf(1f) }
        var panX by remember { mutableFloatStateOf(0f) }
        val sharp by remember { derivedStateOf { zoom > 1.25f } }
        val renderWidthPx = ((viewportPx - 2 * sidePaddingPx) * (if (sharp) 2f else 1f))
            .roundToInt().coerceIn(1, MAX_RENDER_WIDTH_PX)

        // Keeps the point under `anchor` (a finger, or the pinch centre) still while the zoom changes.
        fun zoomTo(target: Float, anchor: Offset) {
            val newZoom = target.coerceIn(1f, MAX_ZOOM)
            val ratio = newZoom / zoom
            if (ratio == 1f) return
            panX = ((panX + anchor.x) * ratio - anchor.x).coerceIn(0f, viewportPx * (newZoom - 1f))
            val offsetInPage = listState.firstVisibleItemScrollOffset
            listState.requestScrollToItem(
                index = listState.firstVisibleItemIndex,
                scrollOffset = ((offsetInPage + anchor.y) * ratio - anchor.y).roundToInt().coerceAtLeast(0),
            )
            zoom = newZoom
        }

        val horizontalPan = rememberScrollableState { delta ->
            val before = panX
            panX = (panX - delta).coerceIn(0f, viewportPx * (zoom - 1f))
            before - panX
        }

        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 104.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxSize()
                // Seen before the list sees it, so two fingers always zoom instead of scrolling.
                .pointerInput(viewportPx) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        do {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            if (event.changes.count { it.pressed } >= 2) {
                                val change = event.calculateZoom()
                                if (change != 1f) zoomTo(zoom * change, event.calculateCentroid(useCurrent = false))
                                event.changes.forEach { it.consume() }
                            }
                        } while (event.changes.any { it.pressed })
                    }
                }
                .pointerInput(viewportPx) {
                    detectTapGestures(
                        onDoubleTap = { tap ->
                            val from = zoom
                            val to = if (from > 1.05f) 1f else DOUBLE_TAP_ZOOM
                            scope.launch { animate(from, to) { value, _ -> zoomTo(value, tap) } }
                        },
                    )
                }
                .scrollable(horizontalPan, Orientation.Horizontal, enabled = zoom > 1f)
                .layout { measurable, constraints ->
                    val width = (constraints.maxWidth * zoom).roundToInt()
                    val placeable = measurable.measure(constraints.copy(minWidth = width, maxWidth = width))
                    layout(constraints.maxWidth, placeable.height) { placeable.place(-panX.roundToInt(), 0) }
                },
        ) {
            items(count = document.pageCount, key = { it }) { index ->
                @Suppress("UNUSED_VARIABLE") val layoutVersion = document.layoutVersion // re-measures when a page turns out a different shape
                PdfPage(
                    document = document,
                    index = index,
                    renderWidthPx = renderWidthPx,
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(document.aspectRatios[index])
                        .shadow(2.dp, RoundedCornerShape(6.dp))
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color.White),
                )
            }
        }
    }
}

@Composable
private fun PdfPage(document: PdfDocument, index: Int, renderWidthPx: Int, modifier: Modifier = Modifier) {
    var bitmap by remember { mutableStateOf<ImageBitmap?>(null) }
    // Re-runs when the zoom crosses into "sharp"; the old picture stays up until the new one is ready.
    LaunchedEffect(renderWidthPx) {
        // A page drawn before (at this width) comes straight from memory.
        document.cachedPage(index, renderWidthPx)?.let { bitmap = it.asImageBitmap(); return@LaunchedEffect }
        // Otherwise a quick small draft first (about a ninth of the work), so something readable shows at once,
        // then the sharp one replaces it.
        if (bitmap == null) {
            val draft = withContext(Dispatchers.IO) {
                runCatching { document.renderPage(index, (renderWidthPx / 3).coerceAtLeast(160), keep = false)?.asImageBitmap() }.getOrNull()
            }
            if (draft != null && bitmap == null) bitmap = draft
        }
        val rendered = withContext(Dispatchers.IO) {
            runCatching { document.renderPage(index, renderWidthPx)?.asImageBitmap() }.getOrNull()
        }
        if (rendered != null) bitmap = rendered
    }
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        val current = bitmap
        // Until the first picture arrives: a pale sheet with a band of light sweeping over it.
        androidx.compose.animation.AnimatedVisibility(
            visible = current == null,
            enter = androidx.compose.animation.fadeIn(),
            exit = androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(220)),
        ) {
            Box(Modifier.fillMaxSize().background(Color(0xFFEDEDED)).shimmer())
        }
        if (current != null) {
            Image(
                bitmap = current,
                contentDescription = "Page ${index + 1}",
                contentScale = ContentScale.FillBounds,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

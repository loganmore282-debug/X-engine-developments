package com.shulenotes.app.ui.note

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Renders lazily as pages scroll into view -- LazyColumn only composes
// visible items, so only a handful of pages are ever bitmap-rendered at
// once rather than the whole document up front.
@Composable
fun PdfPagesView(document: PdfDocument, modifier: Modifier = Modifier) {
    val density = LocalDensity.current
    val screenWidthDp = LocalConfiguration.current.screenWidthDp
    val widthPx = with(density) { screenWidthDp.dp.toPx().toInt() }

    LazyColumn(modifier = modifier) {
        items(document.pageCount) { index ->
            var bitmap by remember(index) { mutableStateOf<Bitmap?>(null) }
            LaunchedEffect(index) {
                bitmap = withContext(Dispatchers.IO) { document.renderPage(index, widthPx) }
            }
            val current = bitmap
            if (current != null) {
                Image(
                    bitmap = current.asImageBitmap(),
                    contentDescription = "Page ${index + 1}",
                    modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
                )
            } else {
                Box(
                    modifier = Modifier.fillMaxWidth().height(500.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
            }
        }
    }
}

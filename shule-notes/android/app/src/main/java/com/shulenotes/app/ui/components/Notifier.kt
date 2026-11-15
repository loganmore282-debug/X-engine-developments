package com.shulenotes.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

enum class NoticeKind { Error, Success, Info }

data class Notice(val id: Long, val kind: NoticeKind, val message: String)

// The app's one way of telling the user how something went: a small card that
// slides down from the top, then leaves on its own. One at a time; a newer
// message replaces the one showing. Mistakes in a form field are NOT shown
// here; they belong under the field itself.
object Notifier {
    var current by mutableStateOf<Notice?>(null)
        private set
    private var lastId = 0L

    fun error(message: String) = show(NoticeKind.Error, message)
    fun success(message: String) = show(NoticeKind.Success, message)
    fun info(message: String) = show(NoticeKind.Info, message)

    fun dismiss(id: Long) {
        if (current?.id == id) current = null
    }

    private fun show(kind: NoticeKind, message: String) {
        lastId += 1
        current = Notice(lastId, kind, message)
    }
}

// Drawn once, over the whole app. It sits at the top so the keyboard and the
// bottom bar never cover it, and it does not block touches on what is beneath.
@Composable
fun NotifierHost(modifier: Modifier = Modifier) {
    val notice = Notifier.current
    var lastShown by remember { mutableStateOf<Notice?>(null) }

    LaunchedEffect(notice?.id) {
        if (notice != null) {
            lastShown = notice
            // Errors stay long enough to read; confirmations are brief.
            delay(if (notice.kind == NoticeKind.Error) 5000L + notice.message.length * 60L else 3500L)
            Notifier.dismiss(notice.id)
        }
    }

    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        AnimatedVisibility(
            visible = notice != null,
            enter = slideInVertically(initialOffsetY = { -it }) + fadeIn(),
            exit = slideOutVertically(targetOffsetY = { -it }) + fadeOut(),
            modifier = Modifier.statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            val shown = notice ?: lastShown
            if (shown != null) NoticeCard(shown)
        }
    }
}

@Composable
private fun NoticeCard(notice: Notice) {
    val scheme = MaterialTheme.colorScheme
    val (icon, tint, tintBackground) = when (notice.kind) {
        NoticeKind.Error -> Triple(Icons.Filled.Error, scheme.error, scheme.errorContainer)
        NoticeKind.Success -> Triple(Icons.Filled.CheckCircle, scheme.primary, scheme.primaryContainer)
        NoticeKind.Info -> Triple(Icons.Filled.Info, scheme.onSurfaceVariant, scheme.surfaceContainerHighest)
    }
    Surface(
        color = scheme.surface,
        contentColor = scheme.onSurface,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, scheme.outlineVariant),
        shadowElevation = 10.dp,
        modifier = Modifier
            .widthIn(max = 480.dp)
            .fillMaxWidth()
            .semantics { liveRegion = LiveRegionMode.Polite }
            .pointerInput(notice.id) {
                detectVerticalDragGestures { _, dragAmount ->
                    if (dragAmount < -8f) Notifier.dismiss(notice.id)
                }
            },
    ) {
        Row(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(36.dp).clip(CircleShape).background(tintBackground),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Text(
                notice.message,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 3,
            )
        }
    }
}

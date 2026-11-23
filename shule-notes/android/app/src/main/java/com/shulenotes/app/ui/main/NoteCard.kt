package com.shulenotes.app.ui.main

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.outlined.Lock
import com.shulenotes.app.data.AccessHolder
import com.shulenotes.app.data.Note
import com.shulenotes.app.ui.components.SubjectTint
import com.shulenotes.app.ui.components.subjectIcon
import com.shulenotes.app.ui.theme.Poppins

fun pagesLabel(pageCount: Int): String? = when {
    pageCount <= 0 -> null
    pageCount == 1 -> "1 page"
    else -> "$pageCount pages"
}

// The document's "cover": the subject's colour and picture, like a book jacket.
@Composable
fun NoteCover(subjectName: String?, tint: SubjectTint, modifier: Modifier = Modifier, width: Int = 64, height: Int = 84) {
    Box(
        modifier = modifier
            .size(width = width.dp, height = height.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Brush.linearGradient(listOf(tint.coverStart, tint.coverEnd))),
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(subjectIcon(subjectName)), contentDescription = null, tint = tint.onCover, modifier = Modifier.size((width * 0.5f).dp))
        Text(
            "PDF",
            color = tint.onCover.copy(alpha = 0.85f),
            fontFamily = Poppins,
            fontWeight = FontWeight.SemiBold,
            fontSize = 9.sp,
            modifier = Modifier.align(Alignment.BottomStart).padding(start = 8.dp, bottom = 6.dp),
        )
    }
}

@Composable
fun NoteCard(
    note: Note,
    subjectName: String?,
    tint: SubjectTint,
    saved: Boolean,
    onClick: () -> Unit,
    onToggleSaved: () -> Unit,
    modifier: Modifier = Modifier,
    // Kept on the phone for offline reading.
    downloaded: Boolean = false,
    // The class is left out when the whole list is already one class.
    showClass: Boolean = true,
    // "Past paper" is left out when the whole list is past papers.
    showKind: Boolean = true,
) {
    // The card sinks a little under the finger and springs back.
    val pressSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    val pressed by pressSource.collectIsPressedAsState()
    val pressScale by androidx.compose.animation.core.animateFloatAsState(
        targetValue = if (pressed) 0.972f else 1f,
        animationSpec = androidx.compose.animation.core.spring(dampingRatio = 0.55f, stiffness = 520f),
        label = "card-press",
    )
    Surface(
        onClick = onClick,
        interactionSource = pressSource,
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier.fillMaxWidth().graphicsLayer { scaleX = pressScale; scaleY = pressScale },
    ) {
        Row(modifier = Modifier.padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 4.dp)) {
            Box {
                NoteCover(subjectName, tint)
                if (AccessHolder.locked(note.free, note.classLevel)) {
                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier.align(Alignment.BottomEnd).size(24.dp),
                    ) {
                        Icon(Icons.Outlined.Lock, contentDescription = "Needs a pass", modifier = Modifier.padding(5.dp))
                    }
                }
            }
            Column(modifier = Modifier.weight(1f).padding(start = 14.dp, top = 2.dp)) {
                Text(
                    note.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!note.description.isNullOrBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        note.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.height(10.dp))
                // Two quiet lines: the subject chip (never wider than the card), then the details with the small status
                // icons pinned to the end at a FIXED size, so every card shows them identically.
                if (subjectName != null) {
                    Text(
                        subjectName,
                        style = MaterialTheme.typography.labelMedium,
                        color = tint.accent,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(tint.container)
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val details = listOfNotNull(
                        "Past paper".takeIf { showKind && note.kind == "past-paper" },
                        note.classLevel?.takeIf { showClass && it.isNotBlank() },
                        pagesLabel(note.pageCount),
                    )
                    Text(
                        details.joinToString("  ·  "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (downloaded) {
                        Icon(
                            Icons.Filled.DownloadForOffline,
                            contentDescription = "Downloaded for offline reading",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(start = 8.dp).requiredSize(18.dp),
                        )
                    }
                    if (note.hasAiContext) {
                        Icon(
                            Icons.Filled.AutoAwesome,
                            contentDescription = "AI helper available",
                            tint = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.padding(start = 8.dp).requiredSize(18.dp),
                        )
                    }
                }
            }
            // The bookmark pops when it is switched on (not when a card merely scrolls into view).
            val pop = remember { androidx.compose.animation.core.Animatable(1f) }
            var firstRun by remember { mutableStateOf(true) }
            LaunchedEffect(saved) {
                if (firstRun) { firstRun = false; return@LaunchedEffect }
                if (saved) {
                    pop.snapTo(0.55f)
                    pop.animateTo(1f, androidx.compose.animation.core.spring(dampingRatio = 0.4f, stiffness = 380f))
                }
            }
            IconButton(onClick = onToggleSaved, modifier = Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value }) {
                Icon(
                    imageVector = if (saved) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                    contentDescription = if (saved) "Remove from saved" else "Save note",
                    tint = if (saved) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// Shown in place of the list while the library loads for the first time.
@Composable
fun NoteCardSkeleton(modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "skeleton")
    val pulse by transition.animateFloat(
        initialValue = 0.45f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 800), RepeatMode.Reverse),
        label = "skeleton-alpha",
    )
    val block = MaterialTheme.colorScheme.surfaceContainerHighest
    Surface(
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(modifier = Modifier.padding(12.dp).alpha(pulse)) {
            Box(Modifier.size(width = 64.dp, height = 84.dp).clip(RoundedCornerShape(14.dp)).background(block))
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Box(Modifier.fillMaxWidth(0.7f).height(16.dp).clip(RoundedCornerShape(6.dp)).background(block))
                Spacer(Modifier.height(10.dp))
                Box(Modifier.fillMaxWidth().height(12.dp).clip(RoundedCornerShape(6.dp)).background(block))
                Spacer(Modifier.height(18.dp))
                Box(Modifier.width(96.dp).height(20.dp).clip(CircleShape).background(block))
            }
        }
    }
}

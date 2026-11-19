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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.outlined.BookmarkBorder
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
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(modifier = Modifier.padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 4.dp)) {
            NoteCover(subjectName, tint)
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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (subjectName != null) {
                        Text(
                            subjectName,
                            style = MaterialTheme.typography.labelMedium,
                            color = tint.accent,
                            maxLines = 1,
                            modifier = Modifier
                                .clip(CircleShape)
                                .background(tint.container)
                                .padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    val details = listOfNotNull(
                        "Past paper".takeIf { note.kind == "past-paper" },
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
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                    if (note.hasAiContext) {
                        Icon(
                            Icons.Filled.AutoAwesome,
                            contentDescription = "AI helper available",
                            tint = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                    }
                }
            }
            IconButton(onClick = onToggleSaved) {
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

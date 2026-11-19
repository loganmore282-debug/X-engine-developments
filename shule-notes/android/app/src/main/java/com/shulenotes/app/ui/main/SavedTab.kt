package com.shulenotes.app.ui.main

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.data.Note
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.components.subjectTint
import kotlinx.coroutines.launch

// One bookmarked page of a note.
private data class PageMark(val note: Note, val page: Int)

@Composable
fun SavedTab(
    viewModel: LibraryViewModel,
    savedIds: Set<String>,
    contentPadding: PaddingValues,
    onOpenNote: (String) -> Unit,
    onOpenPage: (String, Int) -> Unit,
) {
    // Three lists on one page: notes bookmarked, notes kept for offline reading, and single pages bookmarked.
    var section by rememberSaveable { mutableIntStateOf(0) }
    val downloadedIds by Downloads.ids.collectAsState()
    val pageKeys by ShuleApp.session.pageBookmarks.collectAsState(initial = emptySet())
    val scope = rememberCoroutineScope()

    val saved = viewModel.notes.filter { it.id in savedIds }
    val downloads = viewModel.notes.filter { it.id in downloadedIds }
    val pageMarks = pageKeys.mapNotNull { key ->
        val noteId = key.substringBefore(':')
        val page = key.substringAfter(':', "").toIntOrNull() ?: return@mapNotNull null
        viewModel.notes.firstOrNull { it.id == noteId }?.let { PageMark(it, page) }
    }.sortedWith(compareBy({ it.note.title }, { it.page }))

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        contentPadding = PaddingValues(bottom = 24.dp),
    ) {
        item(key = "title") {
            Column {
                Text(
                    "My library",
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp),
                )
                Text(
                    when (section) {
                        0 -> "Notes you bookmarked on this phone"
                        1 -> "Notes you can read without internet"
                        else -> "Pages you marked inside documents"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 12.dp),
                )
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(selected = section == 0, onClick = { section = 0 }, label = { Text("Saved (${saved.size})") })
                    FilterChip(selected = section == 1, onClick = { section = 1 }, label = { Text("Downloads (${downloads.size})") })
                    FilterChip(selected = section == 2, onClick = { section = 2 }, label = { Text("Pages (${pageMarks.size})") })
                }
            }
        }

        if (section == 2) {
            if (pageMarks.isEmpty()) {
                item(key = "empty-pages") {
                    StateMessage(
                        icon = Icons.Outlined.BookmarkBorder,
                        title = "No bookmarked pages",
                        body = "While reading, tap the bookmark next to the page number to mark a page you want to come back to.",
                    )
                }
            } else {
                items(pageMarks, key = { "${it.note.id}:${it.page}" }) { mark ->
                    Surface(
                        onClick = { onOpenPage(mark.note.id, mark.page) },
                        shape = RoundedCornerShape(18.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 5.dp),
                    ) {
                        Row(
                            modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(mark.note.title, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    listOfNotNull("Page ${mark.page}", viewModel.subjectName(mark.note.subjectId)).joinToString("  ·  "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            IconButton(onClick = { scope.launch { ShuleApp.session.togglePageBookmark(mark.note.id, mark.page) } }) {
                                Icon(
                                    Icons.Filled.Bookmark,
                                    contentDescription = "Remove page bookmark",
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                }
            }
            return@LazyColumn
        }

        val shown = if (section == 0) saved else downloads
        if (shown.isEmpty()) {
            item(key = "empty") {
                if (section == 0) {
                    StateMessage(
                        icon = Icons.Outlined.BookmarkBorder,
                        title = "Nothing saved yet",
                        body = "Tap the bookmark on any note to keep it here for quick revision.",
                    )
                } else {
                    StateMessage(
                        icon = Icons.Outlined.FileDownload,
                        title = "No downloads yet",
                        body = "Open a note and tap the download icon at the top to read it later without internet.",
                    )
                }
            }
        } else {
            items(shown, key = { it.id }) { note ->
                NoteCard(
                    note = note,
                    subjectName = viewModel.subjectName(note.subjectId),
                    tint = subjectTint(note.subjectId, viewModel.subjects),
                    saved = note.id in savedIds,
                    downloaded = note.id in downloadedIds,
                    // These cards are narrow with the bookmark, download and AI marks; the class would squeeze the page count.
                    showClass = false,
                    onClick = { onOpenNote(note.id) },
                    onToggleSaved = { viewModel.toggleSaved(note.id) },
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 5.dp),
                )
            }
        }
    }
}

package com.shulenotes.app.ui.main

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.components.subjectTint

@Composable
fun SavedTab(
    viewModel: LibraryViewModel,
    savedIds: Set<String>,
    contentPadding: PaddingValues,
    onOpenNote: (String) -> Unit,
) {
    // Two lists on one page: notes bookmarked, and notes kept on the phone for offline reading.
    var section by rememberSaveable { mutableIntStateOf(0) }
    val downloadedIds by Downloads.ids.collectAsState()
    val saved = viewModel.notes.filter { it.id in savedIds }
    val downloads = viewModel.notes.filter { it.id in downloadedIds }
    val shown = if (section == 0) saved else downloads
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
                    if (section == 0) "Notes you bookmarked on this phone" else "Notes you can read without internet",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 12.dp),
                )
                Row(
                    modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(selected = section == 0, onClick = { section = 0 }, label = { Text("Saved (${saved.size})") })
                    FilterChip(selected = section == 1, onClick = { section = 1 }, label = { Text("Downloads (${downloads.size})") })
                }
            }
        }
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
                    onClick = { onOpenNote(note.id) },
                    onToggleSaved = { viewModel.toggleSaved(note.id) },
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 5.dp),
                )
            }
        }
    }
}

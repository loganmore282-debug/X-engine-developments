package com.shulenotes.app.ui.main

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.components.subjectTint

@Composable
fun SavedTab(
    viewModel: LibraryViewModel,
    savedIds: Set<String>,
    contentPadding: PaddingValues,
    onOpenNote: (String) -> Unit,
) {
    val saved = viewModel.notes.filter { it.id in savedIds }
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        contentPadding = PaddingValues(bottom = 24.dp),
    ) {
        item(key = "title") {
            Column {
            Text(
                "Saved",
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp),
            )
            Text(
                "Notes you bookmarked on this phone",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 14.dp),
            )
            }
        }
        if (saved.isEmpty()) {
            item(key = "empty") {
                StateMessage(
                    icon = Icons.Outlined.BookmarkBorder,
                    title = "Nothing saved yet",
                    body = "Tap the bookmark on any note to keep it here for quick revision.",
                )
            }
        } else {
            items(saved, key = { it.id }) { note ->
                NoteCard(
                    note = note,
                    subjectName = viewModel.subjectName(note.subjectId),
                    tint = subjectTint(note.subjectId, viewModel.subjects),
                    saved = true,
                    onClick = { onOpenNote(note.id) },
                    onToggleSaved = { viewModel.toggleSaved(note.id) },
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 5.dp),
                )
            }
        }
    }
}

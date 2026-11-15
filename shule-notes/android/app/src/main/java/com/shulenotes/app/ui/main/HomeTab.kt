package com.shulenotes.app.ui.main

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.shulenotes.app.ui.components.Avatar
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.components.subjectTint

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeTab(
    viewModel: LibraryViewModel,
    userName: String,
    savedIds: Set<String>,
    contentPadding: PaddingValues,
    onOpenNote: (String) -> Unit,
    onOpenProfile: () -> Unit,
) {
    val focus = LocalFocusManager.current
    val visible = viewModel.visibleNotes()
    val searching = viewModel.query.isNotBlank()

    PullToRefreshBox(
        isRefreshing = viewModel.isRefreshing,
        onRefresh = { viewModel.refresh() },
        modifier = Modifier.fillMaxSize().padding(contentPadding),
    ) {
        LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item(key = "header") {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        val firstName = userName.trim().substringBefore(' ')
                        Text(
                            if (firstName.isEmpty()) "Hello" else "Hello, $firstName",
                            style = MaterialTheme.typography.headlineSmall,
                            maxLines = 1,
                        )
                        Text(
                            "What are you studying today?",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Avatar(
                        name = userName,
                        size = 44.dp,
                        modifier = Modifier.clip(CircleShape).clickable(onClickLabel = "Open profile", onClick = onOpenProfile),
                    )
                }
            }

            item(key = "search") {
                OutlinedTextField(
                    value = viewModel.query,
                    onValueChange = { viewModel.updateQuery(it) },
                    placeholder = { Text("Search notes and past papers") },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    trailingIcon = if (searching) {
                        {
                            IconButton(onClick = { viewModel.updateQuery("") }) {
                                Icon(Icons.Filled.Close, contentDescription = "Clear search")
                            }
                        }
                    } else {
                        null
                    },
                    singleLine = true,
                    shape = CircleShape,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surface,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                    ),
                    modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 18.dp),
                )
            }

            if (viewModel.subjects.isNotEmpty()) {
                item(key = "subjects") {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 20.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                    ) {
                        item(key = "all") {
                            SubjectChip("All", viewModel.selectedSubjectId == null) { viewModel.selectSubject(null) }
                        }
                        items(viewModel.subjects, key = { it.id }) { subject ->
                            SubjectChip(subject.name, viewModel.selectedSubjectId == subject.id) {
                                viewModel.selectSubject(subject.id)
                            }
                        }
                    }
                }
            }

            item(key = "section") {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        when {
                            searching -> "Search results"
                            else -> viewModel.subjectName(viewModel.selectedSubjectId) ?: "All notes"
                        },
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.weight(1f),
                    )
                    if (!viewModel.isLoading && visible.isNotEmpty()) {
                        Text(
                            if (visible.size == 1) "1 document" else "${visible.size} documents",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            val error = viewModel.errorMessage
            when {
                viewModel.isLoading -> items(4) {
                    NoteCardSkeleton(Modifier.padding(horizontal = 20.dp, vertical = 5.dp))
                }
                error != null && viewModel.notes.isEmpty() -> item(key = "error") {
                    StateMessage(
                        icon = Icons.Outlined.CloudOff,
                        title = "We could not load your notes",
                        body = error,
                        actionLabel = "Try again",
                        onAction = { viewModel.refresh() },
                    )
                }
                visible.isEmpty() && searching -> item(key = "no-results") {
                    StateMessage(
                        icon = Icons.Outlined.SearchOff,
                        title = "No matches",
                        body = "Nothing matches “${viewModel.query.trim()}”. Try a different word.",
                    )
                }
                visible.isEmpty() -> item(key = "empty") {
                    StateMessage(
                        icon = Icons.Outlined.Description,
                        title = "No notes here yet",
                        body = "New notes and past papers will appear here as soon as they are added.",
                    )
                }
                else -> {
                    items(visible, key = { it.id }) { note ->
                        NoteCard(
                            note = note,
                            subjectName = viewModel.subjectName(note.subjectId),
                            tint = subjectTint(note.subjectId, viewModel.subjects),
                            saved = note.id in savedIds,
                            onClick = { onOpenNote(note.id) },
                            onToggleSaved = { viewModel.toggleSaved(note.id) },
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 5.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SubjectChip(label: String, isSelected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
        contentColor = if (isSelected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
        border = if (isSelected) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.semantics { selected = isSelected; role = Role.Tab },
    ) {
        Text(
            label,
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 9.dp),
        )
    }
}

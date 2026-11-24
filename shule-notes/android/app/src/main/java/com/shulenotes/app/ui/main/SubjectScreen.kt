package com.shulenotes.app.ui.main

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.components.StatusBarIcons
import com.shulenotes.app.ui.components.fitFontSize
import com.shulenotes.app.ui.components.subjectIcon
import com.shulenotes.app.ui.components.subjectTint

// One subject on its own page (opened from the subject grid on Home): a coloured header with its name and counts, a search
// box that only looks inside this subject, Notes / Exams chips, a sort menu, and then its documents -- right at the top, so
// nobody has to scroll past other subjects to find the PDF.
@Composable
fun SubjectScreen(
    subjectId: String,
    viewModel: LibraryViewModel,
    savedIds: Set<String>,
    onOpenNote: (String) -> Unit,
    onBack: () -> Unit,
) {
    // This page has the normal background, so the status bar icons must match it.
    StatusBarIcons(light = MaterialTheme.colorScheme.background.luminance() < 0.5f)

    val subject = viewModel.subjects.firstOrNull { it.id == subjectId }
    val name = subject?.name ?: "Subject"
    val tint = subjectTint(subjectId, viewModel.subjects)
    val downloadedIds by Downloads.ids.collectAsState()

    var query by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf<String?>(null) }
    var sortOrder by remember { mutableStateOf(SortOrder.NEWEST) }
    var sortMenuOpen by remember { mutableStateOf(false) }

    // The documents of this subject for the class on screen (the same rule as Home).
    val inSubject = viewModel.scopedNotes().filter { it.subjectId == subjectId }
    val hasBoth = inSubject.map { it.kind ?: "notes" }.toSet().size > 1
    val words = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val matching = inSubject.filter { note ->
        (kind == null || (note.kind ?: "notes") == kind) &&
            words.all { word -> note.title.lowercase().contains(word) || note.description.orEmpty().lowercase().contains(word) }
    }
    val visible = when (sortOrder) {
        SortOrder.NEWEST -> matching.sortedByDescending { it.uploadedAt.orEmpty() }
        SortOrder.MOST_READ -> matching.sortedWith(compareByDescending<com.shulenotes.app.data.Note> { it.views }.thenByDescending { it.uploadedAt.orEmpty() })
        SortOrder.A_TO_Z -> matching.sortedBy { it.title.lowercase() }
    }
    val pages = inSubject.sumOf { it.pageCount }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding(),
    ) {
        LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item(key = "hero") {
                Surface(
                    shape = RoundedCornerShape(26.dp),
                    color = tint.container,
                    modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 8.dp),
                ) {
                    Column(modifier = Modifier.padding(start = 12.dp, end = 18.dp, top = 12.dp, bottom = 18.dp)) {
                        Surface(onClick = onBack, shape = CircleShape, color = MaterialTheme.colorScheme.surface) {
                            Row(
                                modifier = Modifier.padding(start = 10.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, modifier = Modifier.size(20.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Back", style = MaterialTheme.typography.labelLarge)
                            }
                        }
                        Spacer(Modifier.height(14.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(64.dp)
                                    .clip(RoundedCornerShape(20.dp))
                                    .background(MaterialTheme.colorScheme.surface),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(painterResource(subjectIcon(name)), contentDescription = null, tint = tint.accent, modifier = Modifier.size(38.dp))
                            }
                            Spacer(Modifier.width(14.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                // Room for the title: the screen, less the margins, the page padding, the picture and the gap.
                                val titleStyle = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold)
                                val titleSize = fitFontSize(name, titleStyle, (LocalConfiguration.current.screenWidthDp - 148).dp, 14f)
                                Text(
                                    name,
                                    style = titleStyle,
                                    fontSize = titleSize.sp,
                                    lineHeight = (titleSize + 5f).sp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    maxLines = 3,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    (if (inSubject.size == 1) "1 document" else "${inSubject.size} documents") + (if (pages > 0) "  ·  $pages pages" else ""),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }

            item(key = "search") {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    shape = RoundedCornerShape(28.dp),
                    placeholder = { Text("Search this subject") },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    trailingIcon = if (query.isNotEmpty()) ({
                        IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, contentDescription = "Clear search") }
                    }) else null,
                    modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 4.dp),
                )
            }

            item(key = "controls") {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            when (kind) { "past-paper" -> "Exams"; "notes" -> "Notes"; else -> "All documents" },
                            style = MaterialTheme.typography.titleLarge,
                        )
                        if (visible.isNotEmpty()) {
                            Text(
                                if (visible.size == 1) "1 document" else "${visible.size} documents",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (visible.size > 1) {
                        Box {
                            TextButton(onClick = { sortMenuOpen = true }) {
                                Icon(Icons.Outlined.SwapVert, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(4.dp))
                                Text(sortOrder.label, style = MaterialTheme.typography.labelLarge)
                            }
                            DropdownMenu(expanded = sortMenuOpen, onDismissRequest = { sortMenuOpen = false }) {
                                SortOrder.values().forEach { order ->
                                    DropdownMenuItem(
                                        text = { Text(order.label) },
                                        onClick = {
                                            sortOrder = order
                                            sortMenuOpen = false
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (hasBoth) {
                item(key = "kinds") {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        listOf<Pair<String?, String>>(null to "All", "notes" to "Notes", "past-paper" to "Exams").forEach { (value, label) ->
                            FilterChip(selected = kind == value, onClick = { kind = value }, label = { Text(label) })
                        }
                    }
                }
            }

            when {
                inSubject.isEmpty() && viewModel.isLoading -> items(3) {
                    NoteCardSkeleton(Modifier.padding(horizontal = 20.dp, vertical = 5.dp))
                }
                visible.isEmpty() -> item(key = "empty") {
                    StateMessage(
                        icon = if (words.isNotEmpty()) Icons.Outlined.SearchOff else Icons.Outlined.Description,
                        title = if (words.isNotEmpty()) "No matches" else "Nothing here yet",
                        body = if (words.isNotEmpty()) "Nothing in $name matches “${query.trim()}”."
                        else "New documents appear here as soon as they are added.",
                    )
                }
                else -> itemsIndexed(visible, key = { _, n -> n.id }) { _, note ->
                    NoteCard(
                        note = note,
                        subjectName = name,
                        tint = tint,
                        saved = note.id in savedIds,
                        downloaded = note.id in downloadedIds,
                        showClass = viewModel.scopeClass == null,
                        showKind = kind == null,
                        onClick = { onOpenNote(note.id) },
                        onToggleSaved = { viewModel.toggleSaved(note.id) },
                        modifier = Modifier
                            .animateItem()
                            .padding(horizontal = 20.dp, vertical = 5.dp),
                    )
                }
            }
        }
    }
}

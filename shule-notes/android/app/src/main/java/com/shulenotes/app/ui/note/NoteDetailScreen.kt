package com.shulenotes.app.ui.note

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.data.NoteCache
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.main.notifySaved
import com.shulenotes.app.ui.main.pagesLabel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteDetailScreen(noteId: String, viewModel: NoteViewModel, onBack: () -> Unit, onAskAi: () -> Unit) {
    LaunchedEffect(noteId) { viewModel.load(noteId) }

    val note = viewModel.note
    val state = viewModel.pdfState
    val savedIds by ShuleApp.session.savedNoteIds.collectAsState(initial = emptySet())
    val saved = noteId in savedIds
    val downloadedIds by Downloads.ids.collectAsState()
    val downloaded = noteId in downloadedIds
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    // The page crossing the middle of the screen counts as the current one.
    val currentPage by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val middle = (info.viewportStartOffset + info.viewportEndOffset) / 2
            val item = info.visibleItemsInfo.firstOrNull { it.offset + it.size >= middle }
                ?: info.visibleItemsInfo.lastOrNull()
            (item?.index ?: 0) + 1
        }
    }

    // Reopen on the page the student stopped at, and keep that page up to date.
    // collectLatest restarts the wait on every change, so only a page the
    // student rests on for a moment is stored, not every page scrolled past.
    val ready = state as? PdfLoadState.Ready
    LaunchedEffect(ready) {
        if (ready != null) {
            val pageCount = ready.document.pageCount
            val earlier = ShuleApp.session.recent.first().firstOrNull { it.id == noteId }
            if (earlier != null && earlier.page in 2..pageCount) listState.scrollToItem(earlier.page - 1)
            snapshotFlow { currentPage }.collectLatest { page ->
                delay(700)
                ShuleApp.session.recordProgress(noteId, page, pageCount)
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceDim,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            note?.title ?: "Document",
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        val pageCount = (state as? PdfLoadState.Ready)?.document?.pageCount ?: note?.pageCount ?: 0
                        val subtitle = listOfNotNull(NoteCache.subjectName(note?.subjectId), pagesLabel(pageCount))
                        if (subtitle.isNotEmpty()) {
                            Text(
                                subtitle.joinToString("  ·  "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.toggleDownload(noteId) }, enabled = state is PdfLoadState.Ready) {
                        Icon(
                            imageVector = if (downloaded) Icons.Filled.DownloadForOffline else Icons.Outlined.FileDownload,
                            contentDescription = if (downloaded) "Remove download" else "Download for offline reading",
                            tint = if (downloaded) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = { scope.launch { notifySaved(ShuleApp.session.toggleSaved(noteId)) } }) {
                        Icon(
                            imageVector = if (saved) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                            contentDescription = if (saved) "Remove from saved" else "Save note",
                            tint = if (saved) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        floatingActionButton = {
            if (state is PdfLoadState.Ready && note?.hasAiContext == true) {
                ExtendedFloatingActionButton(
                    onClick = onAskAi,
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    // Material hides the text from screen readers and expects the icon to carry the label.
                    icon = { Icon(Icons.Filled.AutoAwesome, contentDescription = "Ask AI") },
                    text = { Text("Ask AI") },
                )
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (state) {
                is PdfLoadState.Loading -> Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(16.dp))
                    Text(
                        "Opening document…",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                is PdfLoadState.Failed -> StateMessage(
                    icon = Icons.Outlined.CloudOff,
                    title = "Document not available",
                    body = state.message,
                    actionLabel = "Try again",
                    onAction = { viewModel.load(noteId, retry = true) },
                    modifier = Modifier.align(Alignment.Center),
                )

                is PdfLoadState.Ready -> {
                    PdfPagesView(document = state.document, listState = listState, modifier = Modifier.fillMaxSize())

                    if (state.document.pageCount > 1) {
                        Surface(
                            color = Color.Black.copy(alpha = 0.62f),
                            contentColor = Color.White,
                            shape = CircleShape,
                            modifier = Modifier.align(Alignment.BottomStart).padding(start = 16.dp, bottom = 28.dp),
                        ) {
                            Text(
                                "Page $currentPage of ${state.document.pageCount}",
                                style = MaterialTheme.typography.labelMedium,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

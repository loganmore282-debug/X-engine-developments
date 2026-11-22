package com.shulenotes.app.ui.note

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import com.shulenotes.app.ui.components.shimmer
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.data.NoteCache
import com.shulenotes.app.ui.components.Notifier
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.main.notifySaved
import com.shulenotes.app.ui.main.pagesLabel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteDetailScreen(noteId: String, startPage: Int, viewModel: NoteViewModel, onBack: () -> Unit, onAskAi: () -> Unit) {
    com.shulenotes.app.ui.components.SecureWindow()
    LaunchedEffect(noteId) { viewModel.load(noteId) }

    val note = viewModel.note
    val state = viewModel.pdfState
    val savedIds by ShuleApp.session.savedNoteIds.collectAsState(initial = emptySet())
    val saved = noteId in savedIds
    val downloadedIds by Downloads.ids.collectAsState()
    val downloaded = noteId in downloadedIds
    val pageMarks by ShuleApp.session.pageBookmarks.collectAsState(initial = emptySet())
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val focus = LocalFocusManager.current

    // Searching inside the document: the results page sits over the document, which
    // stays where it was underneath.
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    BackHandler(enabled = searching) { searching = false }
    LaunchedEffect(searching) {
        if (searching) {
            viewModel.loadPages(noteId)
            focusRequester.requestFocus()
        }
    }

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
    val pageMarked = "$noteId:$currentPage" in pageMarks

    // Reopen on the page asked for (a bookmarked page), else the page the student stopped
    // at, and keep that page up to date. collectLatest restarts the wait on every change,
    // so only a page the student rests on for a moment is stored.
    val ready = state as? PdfLoadState.Ready
    LaunchedEffect(ready) {
        if (ready != null) {
            val pageCount = ready.document.pageCount
            val earlier = ShuleApp.session.recent.first().firstOrNull { it.id == noteId }
            when {
                startPage in 1..pageCount -> listState.scrollToItem(startPage - 1)
                earlier != null && earlier.page in 2..pageCount -> listState.scrollToItem(earlier.page - 1)
            }
            snapshotFlow { currentPage }.collectLatest { page ->
                delay(700)
                ShuleApp.session.recordProgress(noteId, page, pageCount)
                ShuleApp.session.recordPageRead(noteId, page, pageCount)
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surfaceDim,
        topBar = {
            TopAppBar(
                title = {
                    if (searching) {
                        TextField(
                            value = query,
                            onValueChange = { query = it },
                            placeholder = { Text("Search in this document") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = Color.Transparent,
                                unfocusedContainerColor = Color.Transparent,
                                focusedIndicatorColor = Color.Transparent,
                                unfocusedIndicatorColor = Color.Transparent,
                            ),
                            modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
                        )
                    } else {
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
                    }
                },
                navigationIcon = {
                    if (searching) {
                        IconButton(onClick = { searching = false }) {
                            Icon(Icons.Filled.Close, contentDescription = "Close search")
                        }
                    } else {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                },
                actions = {
                    if (!searching) {
                        IconButton(onClick = { searching = true }, enabled = state is PdfLoadState.Ready) {
                            Icon(Icons.Outlined.Search, contentDescription = "Search in this document", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
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
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        floatingActionButton = {
            if (!searching && state is PdfLoadState.Ready && note?.hasAiContext == true) {
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
                // Two pale sheets with a band of light sweeping over them: the reader is already there, the pages follow.
                is PdfLoadState.Loading -> Column(
                    modifier = Modifier.fillMaxSize().padding(12.dp),
                    verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
                ) {
                    repeat(2) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .aspectRatio(0.707f)
                                .clip(androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
                                .background(Color(0xFFEDEDED))
                                .shimmer(),
                        )
                    }
                }

                is PdfLoadState.Locked -> {
                    var showPay by rememberSaveable { mutableStateOf(true) }
                    StateMessage(
                        icon = Icons.Outlined.Lock,
                        title = "This document needs a pass",
                        body = "Choose a pass to read it, search inside it and ask the AI helper about it.",
                        actionLabel = "Choose a pass",
                        onAction = { showPay = true },
                        modifier = Modifier.align(Alignment.Center),
                    )
                    if (showPay) {
                        com.shulenotes.app.ui.components.PaySheet(
                            onDismiss = { showPay = false },
                            onPaid = { viewModel.load(noteId, retry = true) },
                        )
                    }
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

                    // How far through the document the student is.
                    if (state.document.pageCount > 1) {
                        LinearProgressIndicator(
                            progress = { currentPage.toFloat() / state.document.pageCount },
                            modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter),
                            trackColor = Color.Transparent,
                        )
                        Surface(
                            color = Color.Black.copy(alpha = 0.62f),
                            contentColor = Color.White,
                            shape = CircleShape,
                            modifier = Modifier.align(Alignment.BottomStart).padding(start = 16.dp, bottom = 28.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 12.dp, end = 4.dp)) {
                                Text(
                                    "Page $currentPage of ${state.document.pageCount}",
                                    style = MaterialTheme.typography.labelMedium,
                                )
                                IconButton(
                                    onClick = {
                                        scope.launch {
                                            val marked = ShuleApp.session.togglePageBookmark(noteId, currentPage)
                                            if (marked) Notifier.success("Page $currentPage bookmarked") else Notifier.info("Page bookmark removed")
                                        }
                                    },
                                    modifier = Modifier.size(36.dp),
                                ) {
                                    Icon(
                                        imageVector = if (pageMarked) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                                        contentDescription = if (pageMarked) "Remove page bookmark" else "Bookmark this page",
                                        tint = Color.White,
                                        modifier = Modifier.size(20.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (searching) {
                SearchResults(
                    viewModel = viewModel,
                    query = query,
                    onRetry = { viewModel.loadPages(noteId) },
                    onPick = { page ->
                        focus.clearFocus()
                        searching = false
                        scope.launch { listState.scrollToItem(page - 1) }
                    },
                )
            }
        }
    }
}

// The results of searching inside the document: each page that contains the words,
// with the words in bold inside a short piece of the page's own text.
@Composable
private fun SearchResults(viewModel: NoteViewModel, query: String, onRetry: () -> Unit, onPick: (Int) -> Unit) {
    val pages = viewModel.pages
    val hits = remember(pages, query) { if (pages == null) emptyList() else searchPages(pages, query) }
    val highlight = MaterialTheme.colorScheme.tertiaryContainer

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                viewModel.pagesLoading -> Column(modifier = Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(12.dp))
                    Text("Preparing search…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                viewModel.pagesError != null -> StateMessage(
                    icon = Icons.Outlined.CloudOff,
                    title = "Search is not ready",
                    body = viewModel.pagesError.orEmpty(),
                    actionLabel = "Try again",
                    onAction = onRetry,
                    modifier = Modifier.align(Alignment.Center),
                )

                pages != null && pages.none { it.isNotBlank() } -> StateMessage(
                    icon = Icons.Outlined.SearchOff,
                    title = "Nothing to search",
                    body = "This document is a scan with no readable text, so it cannot be searched.",
                    modifier = Modifier.align(Alignment.Center),
                )

                searchNeedle(query).length < 2 -> Text(
                    "Type at least two letters to search every page of this document.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp),
                )

                hits.isEmpty() -> StateMessage(
                    icon = Icons.Outlined.SearchOff,
                    title = "No matches",
                    body = "“${query.trim()}” is not in this document.",
                    modifier = Modifier.align(Alignment.Center),
                )

                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                ) {
                    item(key = "count") {
                        val total = hits.sumOf { it.matches }
                        Text(
                            "$total ${if (total == 1) "match" else "matches"} on ${hits.size} ${if (hits.size == 1) "page" else "pages"}",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                        )
                    }
                    items(hits, key = { it.page }) { hit ->
                        Surface(
                            shape = RoundedCornerShape(16.dp),
                            color = MaterialTheme.colorScheme.surface,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable { onPick(hit.page) },
                        ) {
                            Column(modifier = Modifier.padding(14.dp)) {
                                Text(
                                    "Page ${hit.page}" + if (hit.matches > 1) "  ·  ${hit.matches} matches" else "",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                                Spacer(Modifier.height(4.dp))
                                Text(highlighted(hit.snippet, query, highlight), style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun highlighted(snippet: String, query: String, background: Color): AnnotatedString = buildAnnotatedString {
    val needle = searchNeedle(query)
    val lower = snippet.lowercase()
    var from = 0
    while (needle.isNotEmpty()) {
        val at = lower.indexOf(needle, from)
        if (at < 0) break
        append(snippet.substring(from, at))
        withStyle(SpanStyle(fontWeight = FontWeight.Bold, background = background)) { append(snippet.substring(at, at + needle.length)) }
        from = at + needle.length
    }
    append(snippet.substring(from))
}

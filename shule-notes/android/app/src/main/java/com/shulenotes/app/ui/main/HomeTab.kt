package com.shulenotes.app.ui.main

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import com.shulenotes.app.ui.components.enterOnce
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.Badge
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.shulenotes.app.BuildConfig
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.Announcement
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.data.Note
import com.shulenotes.app.data.RecentNote
import com.shulenotes.app.ui.auth.DOWNLOAD_URL
import com.shulenotes.app.ui.components.AppConfigHolder
import com.shulenotes.app.ui.components.Avatar
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.components.StatusBarIcons
import com.shulenotes.app.ui.components.SubjectTint
import com.shulenotes.app.ui.components.subjectIcon
import com.shulenotes.app.ui.components.subjectTint
import com.shulenotes.app.ui.theme.Poppins
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeTab(
    viewModel: LibraryViewModel,
    userName: String,
    savedIds: Set<String>,
    recent: List<RecentNote>,
    contentPadding: PaddingValues,
    onOpenNote: (String) -> Unit,
    onOpenProfile: () -> Unit,
    onChangeClass: () -> Unit,
    unreadCount: Int,
    onOpenNotifications: () -> Unit,
) {
    // The header is dark green under the status bar, so its icons must be light.
    StatusBarIcons(light = true)

    val visible = viewModel.visibleNotes()
    val downloadedIds by Downloads.ids.collectAsState()

    // A newer build exists (the number comes from the owner's settings, or from the download page).
    val appConfig = AppConfigHolder.config
    val dismissedUpdate by ShuleApp.session.dismissedUpdate.collectAsState(initial = Int.MAX_VALUE)
    val updateAvailable = appConfig.latestVersion > BuildConfig.VERSION_CODE && appConfig.latestVersion > dismissedUpdate
    val uriHandler = LocalUriHandler.current
    val scopeForUpdate = rememberCoroutineScope()

    var sortMenuOpen by remember { mutableStateOf(false) }

    // Recent searches: remembered once the student has stopped typing, offered when the search box is tapped.
    var searchFocused by remember { mutableStateOf(false) }
    val recents by ShuleApp.session.recentSearches.collectAsState(initial = emptyList())
    LaunchedEffect(viewModel.query) {
        delay(1500)
        ShuleApp.session.addRecentSearch(viewModel.query)
    }
    val searching = viewModel.query.isNotBlank()
    val scope = viewModel.scopeClass
    val tiles = viewModel.subjectsInScope()
    val resume = remember(recent, viewModel.notes) {
        recent.firstNotNullOfOrNull { r -> viewModel.notes.firstOrNull { it.id == r.id }?.let { it to r } }
    }
    val showResume = resume != null && !searching && viewModel.selectedSubjectId == null && !viewModel.isLoading

    val pullState = rememberPullToRefreshState()
    var headerPx by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current

    PullToRefreshBox(
        isRefreshing = viewModel.isRefreshing,
        onRefresh = { viewModel.refresh() },
        state = pullState,
        modifier = Modifier.fillMaxSize().padding(contentPadding),
        // The spinner appears BELOW the green header, not on top of the greeting.
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = pullState,
                isRefreshing = viewModel.isRefreshing,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = with(density) { headerPx.toDp() } + 34.dp),
            )
        },
    ) {
        LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item(key = "header") {
                HomeHeader(
                    userName = userName,
                    className = scope,
                    query = viewModel.query,
                    onQuery = { viewModel.updateQuery(it) },
                    onChangeClass = onChangeClass,
                    onOpenProfile = onOpenProfile,
                    unreadCount = unreadCount,
                    onOpenNotifications = onOpenNotifications,
                    onHeight = { headerPx = it },
                    onSearchFocus = { searchFocused = it },
                )
            }

            if (searchFocused && !searching && recents.isNotEmpty()) {
                item(key = "recents") {
                    Column(modifier = Modifier.padding(top = 20.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Recent searches", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                            TextButton(onClick = { scopeForUpdate.launch { ShuleApp.session.clearRecentSearches() } }) { Text("Clear") }
                        }
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 20.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(recents, key = { it }) { word ->
                                FilterChip(selected = false, onClick = { viewModel.updateQuery(word) }, label = { Text(word) })
                            }
                        }
                    }
                }
            }

            if (updateAvailable && !searching) {
                item(key = "update") {
                    UpdateCard(
                        note = appConfig.updateNote,
                        onUpdate = { runCatching { uriHandler.openUri(appConfig.updateUrl.ifBlank { DOWNLOAD_URL }) } },
                        onDismiss = { scopeForUpdate.launch { ShuleApp.session.dismissUpdate(appConfig.latestVersion) } },
                        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 22.dp),
                    )
                }
            }

            val notice = viewModel.announcement
            if (notice != null && !searching) {
                item(key = "announcement") {
                    AnnouncementCard(
                        notice = notice,
                        onDismiss = { viewModel.dismissAnnouncement() },
                        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 22.dp),
                    )
                }
            }

            if (showResume && resume != null) {
                val (note, progress) = resume
                item(key = "resume") {
                    SectionTitle("Continue reading", Modifier.padding(top = 22.dp))
                    ContinueCard(
                        note = note,
                        subjectName = viewModel.subjectName(note.subjectId),
                        tint = subjectTint(note.subjectId, viewModel.subjects),
                        page = progress.page,
                        pageCount = if (progress.pageCount > 0) progress.pageCount else note.pageCount,
                        onClick = { onOpenNote(note.id) },
                    )
                }
            }

            if (tiles.isNotEmpty() && !viewModel.isLoading) {
                item(key = "subjects") {
                    SectionTitle("Subjects", Modifier.padding(top = 22.dp))
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 20.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        item(key = "all") {
                            SubjectTile(
                                label = "All",
                                icon = rememberVectorPainter(Icons.Filled.Apps),
                                tint = SubjectTint(
                                    accent = MaterialTheme.colorScheme.primary,
                                    container = MaterialTheme.colorScheme.primaryContainer,
                                    coverStart = MaterialTheme.colorScheme.primary,
                                    coverEnd = MaterialTheme.colorScheme.primary,
                                    onCover = MaterialTheme.colorScheme.onPrimary,
                                ),
                                isSelected = viewModel.selectedSubjectId == null,
                                onClick = { viewModel.selectSubject(null) },
                            )
                        }
                        items(tiles, key = { it.id }) { subject ->
                            SubjectTile(
                                label = subject.name,
                                icon = painterResource(subjectIcon(subject.name)),
                                tint = subjectTint(subject.id, viewModel.subjects),
                                isSelected = viewModel.selectedSubjectId == subject.id,
                                onClick = { viewModel.selectSubject(subject.id) },
                            )
                        }
                    }
                }
            }

            if (viewModel.hasBothKinds() && !viewModel.isLoading) {
                item(key = "kinds") {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 20.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        listOf<Pair<String?, String>>(null to "All", "notes" to "Notes", "past-paper" to "Past papers").forEach { (kind, label) ->
                            FilterChip(
                                selected = viewModel.kindFilter == kind,
                                onClick = { viewModel.selectKind(kind) },
                                label = { Text(label) },
                            )
                        }
                    }
                }
            }

            item(key = "section") {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        when {
                            searching -> "Search results"
                            viewModel.selectedSubjectId != null -> viewModel.subjectName(viewModel.selectedSubjectId) ?: "Notes"
                            viewModel.kindFilter == "past-paper" -> "Past papers"
                            scope != null -> "Notes for $scope"
                            else -> "All notes"
                        },
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (!viewModel.isLoading && visible.isNotEmpty()) {
                        Text(
                            if (visible.size == 1) "1 document" else "${visible.size} documents",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (visible.size > 1) {
                            Box {
                                TextButton(onClick = { sortMenuOpen = true }) {
                                    Icon(Icons.Outlined.SwapVert, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text(viewModel.sortOrder.label, style = MaterialTheme.typography.labelLarge)
                                }
                                DropdownMenu(expanded = sortMenuOpen, onDismissRequest = { sortMenuOpen = false }) {
                                    SortOrder.values().forEach { order ->
                                        DropdownMenuItem(
                                            text = { Text(order.label) },
                                            onClick = {
                                                viewModel.selectSort(order)
                                                sortMenuOpen = false
                                            },
                                        )
                                    }
                                }
                            }
                        }
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
                        body = "Nothing matches “${viewModel.query.trim()}”" + (if (scope != null) " in $scope." else "."),
                        actionLabel = if (scope != null) "Search every class" else null,
                        onAction = if (scope != null) ({ viewModel.selectClass(null) }) else null,
                    )
                }
                visible.isEmpty() -> item(key = "empty") {
                    StateMessage(
                        icon = Icons.Outlined.Description,
                        title = if (scope != null) "No notes for $scope yet" else "No notes yet",
                        body = "New notes and past papers appear here as soon as they are added.",
                        actionLabel = if (scope != null) "Show every class" else null,
                        onAction = if (scope != null) ({ viewModel.selectClass(null) }) else null,
                    )
                }
                else -> itemsIndexed(visible, key = { _, n -> n.id }) { index, note ->
                    NoteCard(
                        note = note,
                        subjectName = viewModel.subjectName(note.subjectId),
                        tint = subjectTint(note.subjectId, viewModel.subjects),
                        saved = note.id in savedIds,
                        downloaded = note.id in downloadedIds,
                        showClass = scope == null,
                        // Inside the Past papers view every card is one, so the label would only crowd the row.
                        showKind = viewModel.kindFilter == null,
                        onClick = { onOpenNote(note.id) },
                        onToggleSaved = { viewModel.toggleSaved(note.id) },
                        modifier = Modifier
                            .animateItem()
                            .enterOnce(note.id, viewModel.animatedIds, index)
                            .padding(horizontal = 20.dp, vertical = 5.dp),
                    )
                }
            }
        }
    }
}

// Dark green header that runs up under the status bar: greeting, the
// student's class (tap to change it), and the search bar half on, half off.
@Composable
private fun HomeHeader(
    userName: String,
    className: String?,
    query: String,
    onQuery: (String) -> Unit,
    onChangeClass: () -> Unit,
    onOpenProfile: () -> Unit,
    unreadCount: Int,
    onOpenNotifications: () -> Unit,
    onHeight: (Int) -> Unit,
    onSearchFocus: (Boolean) -> Unit,
) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val gradient = Brush.verticalGradient(
        if (dark) listOf(Color(0xFF15553D), Color(0xFF0C3A2A)) else listOf(Color(0xFF1D8059), Color(0xFF0E4D35)),
    )
    val firstName = userName.trim().substringBefore(' ')

    Box(modifier = Modifier.fillMaxWidth().onSizeChanged { onHeight(it.height) }) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp))
                .background(gradient)
                .drawBehind {
                    drawCircle(Color.White.copy(alpha = 0.07f), radius = size.width * 0.34f, center = Offset(size.width * 0.96f, size.height * 0.04f))
                    drawCircle(Color.White.copy(alpha = 0.05f), radius = size.width * 0.24f, center = Offset(size.width * 0.04f, size.height * 0.98f))
                }
                .statusBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 48.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        if (firstName.isEmpty()) "Hello" else "Hello, $firstName",
                        style = MaterialTheme.typography.headlineSmall,
                        color = Color.White,
                        maxLines = 1,
                    )
                    Text(
                        "What are you studying today?",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.78f),
                    )
                }
                Box(
                    modifier = Modifier
                        .size(46.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.14f))
                        .border(1.dp, Color.White.copy(alpha = 0.30f), CircleShape)
                        .clickable(onClickLabel = "Open notifications", onClick = onOpenNotifications),
                    contentAlignment = Alignment.Center,
                ) {
                    BadgedBox(
                        badge = {
                            if (unreadCount > 0) {
                                Badge(containerColor = Color(0xFFFFB020), contentColor = Color(0xFF3A2A00)) {
                                    Text(if (unreadCount > 9) "9+" else unreadCount.toString())
                                }
                            }
                        },
                    ) {
                        Icon(Icons.Outlined.Notifications, contentDescription = "Notifications", tint = Color.White)
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            ClassChip(className = className, onClick = onChangeClass)
        }

        SearchField(
            query = query,
            onQuery = onQuery,
            onFocusChange = onSearchFocus,
            modifier = Modifier.align(Alignment.BottomCenter).offset(y = 26.dp).padding(horizontal = 20.dp),
        )
    }
    Spacer(Modifier.height(30.dp))
}

@Composable
private fun ClassChip(className: String?, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.16f))
            .border(1.dp, Color.White.copy(alpha = 0.3f), CircleShape)
            .clickable(onClickLabel = "Change class", onClick = onClick)
            .padding(start = 14.dp, end = 10.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.School, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            className ?: "All classes",
            color = Color.White,
            fontFamily = Poppins,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.labelLarge,
        )
        Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun SearchField(query: String, onQuery: (String) -> Unit, onFocusChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val focus = LocalFocusManager.current
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 8.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = modifier.fillMaxWidth(),
    ) {
        TextField(
            value = query,
            onValueChange = onQuery,
            placeholder = { Text("Search notes and past papers") },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            trailingIcon = if (query.isNotBlank()) {
                {
                    IconButton(onClick = { onQuery("") }) {
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
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
            modifier = Modifier.fillMaxWidth().onFocusChanged { onFocusChange(it.isFocused) },
        )
    }
}

@Composable
private fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.titleLarge,
        modifier = modifier.padding(start = 20.dp, end = 20.dp, bottom = 12.dp),
    )
}

// A newer version exists. Closing it hides it until an even newer one comes out.
@Composable
private fun UpdateCard(note: String, onUpdate: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.tertiaryContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(start = 16.dp, top = 10.dp, bottom = 10.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.SystemUpdate, contentDescription = null, tint = MaterialTheme.colorScheme.onTertiaryContainer, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("A new version is ready", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onTertiaryContainer)
                if (note.isNotBlank()) {
                    Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onTertiaryContainer)
                }
            }
            TextButton(onClick = onUpdate) { Text("Update") }
            IconButton(onClick = onDismiss) {
                Icon(Icons.Filled.Close, contentDescription = "Dismiss update", tint = MaterialTheme.colorScheme.onTertiaryContainer, modifier = Modifier.size(20.dp))
            }
        }
    }
}

// A message from the owner (set in the admin panel), until the student closes it.
@Composable
private fun AnnouncementCard(notice: Announcement, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 14.dp, end = 4.dp)) {
            Icon(
                Icons.Outlined.Campaign,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier.padding(top = 2.dp).size(24.dp),
            )
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(notice.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
                Spacer(Modifier.height(2.dp))
                Text(notice.message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            IconButton(onClick = onDismiss) {
                Icon(Icons.Filled.Close, contentDescription = "Dismiss", tint = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(20.dp))
            }
        }
    }
}

// The document the student was last reading, with how far they got.
@Composable
private fun ContinueCard(
    note: Note,
    subjectName: String?,
    tint: SubjectTint,
    page: Int,
    pageCount: Int,
    onClick: () -> Unit,
) {
    val fraction = if (pageCount > 0) (page.toFloat() / pageCount).coerceIn(0.04f, 1f) else 0.04f
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val arrowColour = if (dark) Color(0xFF0B0F0D) else tint.coverEnd
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(26.dp),
        color = Color.Transparent,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
    ) {
        Row(
            modifier = Modifier
                .background(Brush.linearGradient(listOf(tint.coverStart, tint.coverEnd)))
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(painterResource(subjectIcon(subjectName)), contentDescription = null, tint = tint.onCover, modifier = Modifier.size(32.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    note.title,
                    style = MaterialTheme.typography.titleMedium,
                    color = tint.onCover,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    if (pageCount > 0) "Page $page of $pageCount" else "Page $page",
                    style = MaterialTheme.typography.bodySmall,
                    color = tint.onCover.copy(alpha = 0.85f),
                )
                Spacer(Modifier.height(10.dp))
                Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(tint.onCover.copy(alpha = 0.25f))) {
                    Box(Modifier.fillMaxWidth(fraction).fillMaxHeight().clip(CircleShape).background(tint.onCover))
                }
            }
            Spacer(Modifier.width(14.dp))
            Box(
                modifier = Modifier.size(44.dp).clip(CircleShape).background(tint.onCover),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.PlayArrow,
                    contentDescription = "Continue reading",
                    tint = arrowColour,
                    modifier = Modifier.size(26.dp),
                )
            }
        }
    }
}

@Composable
private fun SubjectTile(label: String, icon: Painter, tint: SubjectTint, isSelected: Boolean, onClick: () -> Unit) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val iconOnAccent = if (dark) Color(0xFF0B0F0D) else Color.White
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .widthIn(min = 72.dp)
            .clip(RoundedCornerShape(20.dp))
            .clickable(onClick = onClick)
            .semantics { selected = isSelected; role = Role.Tab }
            .padding(horizontal = 2.dp, vertical = 2.dp),
    ) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(if (isSelected) tint.accent else tint.container),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = if (isSelected) iconOnAccent else tint.accent, modifier = Modifier.size(34.dp))
        }
        Spacer(Modifier.height(8.dp))
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
            color = if (isSelected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            softWrap = false,
            modifier = Modifier.padding(bottom = 2.dp),
        )
    }
}

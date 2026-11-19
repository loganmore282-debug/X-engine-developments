package com.shulenotes.app.ui.main

import androidx.activity.compose.BackHandler
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.repeatOnLifecycle
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.RecentNote
import com.shulenotes.app.ui.components.parseIsoMillis
import kotlinx.coroutines.launch

private class MainTab(val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

private val Tabs = listOf(
    MainTab("Home", Icons.Outlined.Home, Icons.Filled.Home),
    MainTab("Saved", Icons.Outlined.BookmarkBorder, Icons.Filled.Bookmark),
    MainTab("Profile", Icons.Outlined.Person, Icons.Filled.Person),
)

@Composable
fun MainScreen(viewModel: LibraryViewModel, onOpenNote: (String) -> Unit, onOpenPage: (String, Int) -> Unit, onSignedOut: () -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var showClassSheet by rememberSaveable { mutableStateOf(false) }
    val savedIds by ShuleApp.session.savedNoteIds.collectAsState(initial = emptySet())
    val recent by ShuleApp.session.recent.collectAsState(initial = emptyList<RecentNote>())
    val userName by ShuleApp.session.userName.collectAsState(initial = "")
    val userContact by ShuleApp.session.userContact.collectAsState(initial = "")
    val userClass by ShuleApp.session.classLevel.collectAsState(initial = "")
    val pushOn by ShuleApp.session.pushEnabled.collectAsState(initial = true)
    val appContext = androidx.compose.ui.platform.LocalContext.current.applicationContext
    // Keep this phone's notification groups in step with the student's class and their switch.
    androidx.compose.runtime.LaunchedEffect(userClass, pushOn) {
        com.shulenotes.app.push.Push.sync(appContext, pushOn, userClass)
    }
    // Android 13 and newer ask once, the first time the student lands on Home.
    val askPermission = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        if (android.os.Build.VERSION.SDK_INT >= 33 && pushOn &&
            androidx.core.content.ContextCompat.checkSelfPermission(appContext, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) runCatching { askPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS) }
    }

    // The bell: how many announcements arrived since the student last opened the page.
    // Until the saved time is read, nothing counts as unread (so no badge flashes up).
    val seenAt by ShuleApp.session.notificationsSeenAt.collectAsState(initial = Long.MAX_VALUE)
    var showNotifications by rememberSaveable { mutableStateOf(false) }
    var seenAtOnOpen by rememberSaveable { mutableStateOf(0L) }
    var showProgress by rememberSaveable { mutableStateOf(false) }
    val studyPages by ShuleApp.session.studyPages.collectAsState(initial = emptySet())
    val finishedNotes by ShuleApp.session.finishedNotes.collectAsState(initial = emptySet())
    val scope = rememberCoroutineScope()
    val unread = viewModel.notifications.count { parseIsoMillis(it.createdAt) > seenAt }

    // While the app is on screen, ask the server every 15 seconds whether the owner changed anything
    // (one tiny request), and reload quietly when so. Stops by itself when the app goes to the background.
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    androidx.compose.runtime.LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while (true) {
                viewModel.checkForChanges()
                kotlinx.coroutines.delay(15_000)
            }
        }
    }

    // The note the student most likely opens next ("Continue reading") is fetched quietly in advance, but only on
    // Wi-Fi or another free connection, and only if it is small: mobile data costs students money.
    val continueId = recent.firstOrNull()?.id
    androidx.compose.runtime.LaunchedEffect(continueId, viewModel.notes.size) {
        val next = continueId?.let { id -> viewModel.notes.firstOrNull { it.id == id } } ?: return@LaunchedEffect
        com.shulenotes.app.data.PdfFetcher.prefetchIfFree(next.id, next.fileSize)
    }

    BackHandler(enabled = tab != 0) { tab = 0 }
    BackHandler(enabled = showNotifications) { showNotifications = false }
    BackHandler(enabled = showProgress) { showProgress = false }

    Box(Modifier.fillMaxSize()) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        // The home header runs up under the status bar, so each tab handles that inset itself.
        contentWindowInsets = WindowInsets(0.dp, 0.dp, 0.dp, 0.dp),
        bottomBar = {
            Column {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
                    Tabs.forEachIndexed { index, item ->
                        NavigationBarItem(
                            selected = tab == index,
                            onClick = { tab = index },
                            icon = { Icon(if (tab == index) item.selectedIcon else item.icon, contentDescription = null) },
                            label = { Text(item.label) },
                            colors = NavigationBarItemDefaults.colors(
                                indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                                selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                selectedTextColor = MaterialTheme.colorScheme.primary,
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        androidx.compose.animation.AnimatedContent(
            targetState = tab,
            transitionSpec = {
                (androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(240, delayMillis = 60)) +
                    androidx.compose.animation.slideInVertically(androidx.compose.animation.core.tween(300)) { it / 30 }) togetherWith
                    androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(120))
            },
            label = "tabs",
        ) { currentTab ->
        when (currentTab) {
            0 -> HomeTab(
                viewModel = viewModel,
                userName = userName,
                savedIds = savedIds,
                recent = recent,
                contentPadding = padding,
                onOpenNote = onOpenNote,
                onOpenProfile = { tab = 2 },
                onChangeClass = { showClassSheet = true },
                unreadCount = unread,
                onOpenNotifications = {
                    seenAtOnOpen = if (seenAt == Long.MAX_VALUE) 0L else seenAt
                    showNotifications = true
                    scope.launch { ShuleApp.session.markNotificationsSeen(System.currentTimeMillis()) }
                },
            )
            1 -> Box(Modifier.statusBarsPadding()) { SavedTab(viewModel, savedIds, padding, onOpenNote, onOpenPage) }
            else -> Box(Modifier.statusBarsPadding()) {
                ProfileTab(
                    viewModel = viewModel,
                    userName = userName,
                    userContact = userContact,
                    userClass = userClass,
                    contentPadding = padding,
                    onChangeClass = { showClassSheet = true },
                    onOpenProgress = { showProgress = true },
                    onSignedOut = onSignedOut,
                )
            }
        }
        }
    }

    if (showProgress) {
        ProgressScreen(
            stats = computeStudyStats(studyPages, finishedNotes, viewModel.notes),
            onBack = { showProgress = false },
        )
    }

    if (showNotifications) {
        NotificationsScreen(
            items = viewModel.notifications,
            seenAtOnOpen = seenAtOnOpen,
            onBack = { showNotifications = false },
        )
    }
    }

    if (showClassSheet) {
        ClassPickerSheet(
            groups = viewModel.levelGroups,
            selected = viewModel.scopeClass,
            onPick = { level ->
                viewModel.selectClass(level)
                showClassSheet = false
            },
            onRetry = { viewModel.refresh() },
            onDismiss = { showClassSheet = false },
        )
    }
}

package com.shulenotes.app.ui.main

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.shulenotes.app.ShuleApp

private class MainTab(val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

private val Tabs = listOf(
    MainTab("Home", Icons.Outlined.Home, Icons.Filled.Home),
    MainTab("Saved", Icons.Outlined.BookmarkBorder, Icons.Filled.Bookmark),
    MainTab("Profile", Icons.Outlined.Person, Icons.Filled.Person),
)

@Composable
fun MainScreen(viewModel: LibraryViewModel, onOpenNote: (String) -> Unit, onSignedOut: () -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val savedIds by ShuleApp.session.savedNoteIds.collectAsState(initial = emptySet())
    val userName by ShuleApp.session.userName.collectAsState(initial = "")
    val userContact by ShuleApp.session.userContact.collectAsState(initial = "")

    BackHandler(enabled = tab != 0) { tab = 0 }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
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
        when (tab) {
            0 -> HomeTab(viewModel, userName, savedIds, padding, onOpenNote, onOpenProfile = { tab = 2 })
            1 -> SavedTab(viewModel, savedIds, padding, onOpenNote)
            else -> ProfileTab(viewModel, userName, userContact, padding, onSignedOut)
        }
    }
}

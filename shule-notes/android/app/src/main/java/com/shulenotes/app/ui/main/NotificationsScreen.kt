package com.shulenotes.app.ui.main

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import com.shulenotes.app.R
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import com.shulenotes.app.ui.components.AppConfigHolder
import com.shulenotes.app.ui.components.SupportDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import com.shulenotes.app.data.Announcement
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.components.StatusBarIcons
import com.shulenotes.app.ui.components.parseIsoMillis
import com.shulenotes.app.ui.components.timeAgo

// The bell's page: every live announcement from the owner, newest first. Items
// that arrived since the student last looked carry a "New" label.
@Composable
fun NotificationsScreen(items: List<Announcement>, seenAtOnOpen: Long, onBack: () -> Unit) {
    // This page has the normal background, so the status bar icons must match it.
    StatusBarIcons(light = MaterialTheme.colorScheme.background.luminance() < 0.5f)
    var showHelp by rememberSaveable { mutableStateOf(false) }
    if (showHelp) {
        SupportDialog(
            title = "Was this not you?",
            intro = "Contact us now. We will reset your password and sign out every other device.",
            config = AppConfigHolder.config,
            onDismiss = { showHelp = false },
        )
    }

    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                    .statusBarsPadding(),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 8.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
                Text("Notifications", style = MaterialTheme.typography.titleLarge)
            }

            if (items.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize()) {
                    StateMessage(
                        icon = Icons.Outlined.NotificationsNone,
                        title = "You're all caught up",
                        body = "News from Shule Notes and alerts about your account will appear here.",
                        modifier = Modifier.align(Alignment.Center),
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(items, key = { (if (it.isSecurity) "s" else "a") + it.id }) { item ->
                        val at = parseIsoMillis(item.createdAt)
                        NotificationCard(
                            item = item,
                            whenText = timeAgo(at),
                            isNew = !item.own && at > seenAtOnOpen,
                            onNotMe = { showHelp = true },
                        )
                    }
                }
            }
        }
        // The Shule Notes mark, very faint, behind everything (it takes no touches, so nothing underneath is affected).
        Image(
            painter = painterResource(R.drawable.logo_mark),
            contentDescription = null,
            alpha = if (dark) 0.07f else 0.06f,
            modifier = (if (items.isEmpty()) Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp) else Modifier.align(Alignment.Center))
                .size(300.dp),
        )
    }
}

@Composable
private fun NotificationCard(item: Announcement, whenText: String, isNew: Boolean, onNotMe: () -> Unit) {
    val security = item.isSecurity
    // Sign-in alerts look different from news: a shield on a soft red-amber tint, so they are never mistaken for an advert.
    val iconBg = if (security) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer
    val iconFg = if (security) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSecondaryContainer
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, if (isNew) MaterialTheme.colorScheme.primary.copy(alpha = 0.45f) else MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(modifier = Modifier.padding(16.dp)) {
            Box(
                modifier = Modifier.size(44.dp).background(iconBg, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (security) Icons.Outlined.Security else Icons.Outlined.Campaign, contentDescription = null, tint = iconFg)
            }
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(item.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f, fill = false))
                    when {
                        item.own -> Tag("This device", MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant)
                        isNew -> Tag("New", MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.onPrimary)
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(item.message, style = MaterialTheme.typography.bodyMedium)
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
                    if (whenText.isNotEmpty()) {
                        Text(whenText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    } else {
                        Spacer(Modifier.weight(1f))
                    }
                    if (security && !item.own) {
                        TextButton(onClick = onNotMe) { Text("Get help") }
                    }
                }
            }
        }
    }
}

@Composable
private fun Tag(text: String, bg: Color, fg: Color) {
    Spacer(Modifier.width(8.dp))
    Surface(shape = CircleShape, color = bg) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = fg, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

package com.shulenotes.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.UriHandler
import com.shulenotes.app.data.AppUpdater
import com.shulenotes.app.data.UpdateState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

// What "Update" does. A web address that is not an app file (the Google Play page, later) opens in the browser;
// the owner's own app file is downloaded and installed from inside the app (see AppUpdater).
fun startUpdate(context: android.content.Context, uriHandler: UriHandler, updateUrl: String) {
    val external = updateUrl.isNotBlank() && !updateUrl.substringBefore('?').endsWith(".apk")
    if (external) {
        runCatching { uriHandler.openUri(updateUrl) }
    } else {
        AppUpdater.start(context)
    }
}

fun updateButtonLabel(state: UpdateState): String = when (state) {
    is UpdateState.Downloading -> "Downloading " + state.percent + "%"
    is UpdateState.ReadyToInstall -> "Install"
    is UpdateState.Failed -> "Try again"
    else -> "Update"
}

// A line saying where the update has got to (null while nothing has happened yet).
fun updateStatusText(state: UpdateState): String? = when (state) {
    is UpdateState.Downloading -> "Downloading the new version…"
    is UpdateState.ReadyToInstall -> "Downloaded. Tap Install to finish."
    is UpdateState.NeedsPermission -> "Allow Shule Notes to install updates on the page that opened, then come back and tap Update again."
    is UpdateState.Failed -> state.message
    else -> null
}

// Shown INSTEAD of the app when the owner has set an oldest allowed version and this
// build is older. The only thing to do is update.
@Composable
fun UpdateRequiredScreen(note: String, onUpdate: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        LogoMark(size = 96.dp)
        Spacer(Modifier.height(24.dp))
        Text("Please update Shule Notes", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            note.ifBlank { "This version is too old to keep working. Update to the newest version to carry on studying." },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
        val state = AppUpdater.state
        updateStatusText(state)?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = if (state is UpdateState.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(bottom = 12.dp),
            )
        }
        if (state is UpdateState.Downloading) {
            androidx.compose.material3.LinearProgressIndicator(
                progress = state.percent / 100f,
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
            )
        }
        PrimaryButton(
            text = if (state is UpdateState.Idle || state is UpdateState.NeedsPermission) "Update now" else updateButtonLabel(state),
            loadingText = "Downloading…",
            loading = false,
            enabled = state !is UpdateState.Downloading,
            onClick = onUpdate,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

// Shown instead of the app when this copy was re-signed by someone else (an edited or pirated copy).
@Composable
fun ModifiedAppScreen(onGetOfficial: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        LogoMark(size = 96.dp)
        Spacer(Modifier.height(24.dp))
        Text("This copy is not official", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            "This copy of Shule Notes was changed after it was made, so it cannot be trusted with your account. Install the official app to carry on studying.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
        PrimaryButton(text = "Get the official app", loadingText = "Get the official app", loading = false, onClick = onGetOfficial, modifier = Modifier.fillMaxWidth())
    }
}

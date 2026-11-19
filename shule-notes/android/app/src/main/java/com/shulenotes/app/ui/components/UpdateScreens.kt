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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

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
        PrimaryButton(text = "Update now", loadingText = "Update now", loading = false, onClick = onUpdate, modifier = Modifier.fillMaxWidth())
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

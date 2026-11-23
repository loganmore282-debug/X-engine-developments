package com.shulenotes.app.ui.components

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.AppConfig

// The owner's settings (support contacts, AI on/off), fetched once and kept
// for the session. A failed load keeps the defaults so nothing breaks.
object AppConfigHolder {
    var config by mutableStateOf(AppConfig())
        private set

    suspend fun refresh() {
        try {
            ApiClient.service.config().config?.let { config = it }
        } catch (e: Exception) {
            // keep what we have
        }
    }
}

// Who to contact: call, WhatsApp, email. Used from Help & support and from
// "Forgot password?" -- there is no SMS provider, so the owner resets a password by hand.
@Composable
fun SupportDialog(title: String, intro: String, config: AppConfig, onDismiss: () -> Unit) {
    val context = LocalContext.current
    fun open(intent: Intent) {
        try { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: ActivityNotFoundException) { }
    }
    fun digits(value: String) = value.filter { it.isDigit() }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                Text(intro, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(12.dp))
                if (!config.hasSupport) {
                    Text("Contact details have not been added yet. Please ask your teacher or school.", style = MaterialTheme.typography.bodyMedium)
                }
                if (config.supportPhone.isNotBlank()) {
                    ContactRow(Icons.Outlined.Call, "Call", config.supportPhone) {
                        open(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + config.supportPhone.filter { c -> c.isDigit() || c == '+' })))
                    }
                }
                if (config.supportWhatsapp.isNotBlank()) {
                    ContactRow(Icons.Outlined.ChatBubbleOutline, "WhatsApp", config.supportWhatsapp) {
                        open(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + digits(config.supportWhatsapp))))
                    }
                }
                if (config.supportEmail.isNotBlank()) {
                    ContactRow(Icons.Outlined.Email, "Email", config.supportEmail) {
                        open(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + config.supportEmail)))
                    }
                }
                if (config.supportHours.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Schedule, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(config.supportHours, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun ContactRow(icon: ImageVector, label: String, value: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(14.dp))
        Column {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

// Straight to WhatsApp or the dialler from a Profile row (no dialog in between).
fun openWhatsApp(context: android.content.Context, number: String) {
    val digits = number.filter { it.isDigit() }
    try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: ActivityNotFoundException) { }
}

fun dialNumber(context: android.content.Context, number: String) {
    val clean = number.filter { it.isDigit() || it == '+' }
    try { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$clean")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: ActivityNotFoundException) { }
}

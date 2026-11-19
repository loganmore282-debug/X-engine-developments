package com.shulenotes.app.ui.main

import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import com.shulenotes.app.ui.components.ProfileAvatar
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.RateReview
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PrivacyTip
import androidx.compose.material.icons.outlined.School
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.shulenotes.app.BuildConfig
import com.shulenotes.app.ShuleApp
import kotlinx.coroutines.launch
import com.shulenotes.app.ui.auth.DOWNLOAD_URL
import com.shulenotes.app.ui.auth.PRIVACY_URL
import com.shulenotes.app.ui.auth.TERMS_URL
import com.shulenotes.app.ui.components.AppConfigHolder
import com.shulenotes.app.ui.components.SupportDialog
import com.shulenotes.app.ui.components.Avatar
import com.shulenotes.app.ui.components.ShuleTextField

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileTab(
    viewModel: LibraryViewModel,
    userName: String,
    userContact: String,
    userClass: String,
    contentPadding: PaddingValues,
    onChangeClass: () -> Unit,
    onOpenProgress: () -> Unit,
    onSignedOut: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    var editName by rememberSaveable { mutableStateOf(false) }
    var changePassword by rememberSaveable { mutableStateOf(false) }
    var showHelp by rememberSaveable { mutableStateOf(false) }
    var showAppearance by rememberSaveable { mutableStateOf(false) }
    var showFeedback by rememberSaveable { mutableStateOf(false) }
    var showPhotoSheet by rememberSaveable { mutableStateOf(false) }
    val pickPhoto = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia(),
    ) { uri -> if (uri != null) viewModel.uploadAvatar(uri) }
    val avatarVersion by ShuleApp.session.avatarVersion.collectAsState(initial = 0L)
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val themeMode by ShuleApp.session.themeMode.collectAsState(initial = "system")
    val pushOn by ShuleApp.session.pushEnabled.collectAsState(initial = true)
    val askPermission = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(28.dp))
        Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            // The photo, with a small camera badge: tapping either opens the photo options.
            Box(modifier = Modifier.size(104.dp).clickable(onClickLabel = "Change profile photo") { showPhotoSheet = true }) {
                ProfileAvatar(size = 104.dp, modifier = Modifier.border(3.dp, MaterialTheme.colorScheme.surface, CircleShape))
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary)
                        .border(2.dp, MaterialTheme.colorScheme.background, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    if (viewModel.isSavingAvatar) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    } else {
                        Icon(Icons.Outlined.PhotoCamera, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(18.dp))
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            Text(userName.ifBlank { "Student" }, style = MaterialTheme.typography.titleLarge, maxLines = 1)
            if (userContact.isNotBlank()) {
                Text(userContact, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (userClass.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                    Text(
                        userClass,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
            }
        }
        Spacer(Modifier.height(4.dp))

        SectionLabel("Study")
        SettingsCard {
            SettingsRow(Icons.Outlined.School, "My class", trailingText = userClass.ifBlank { "Not chosen" }, onClick = onChangeClass)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(Icons.Outlined.Insights, "My progress", onClick = onOpenProgress)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(
                Icons.Outlined.Palette, "Appearance",
                trailingText = when (themeMode) { "light" -> "Light"; "dark" -> "Dark"; else -> "System default" },
            ) { showAppearance = true }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(Icons.Outlined.Notifications, "Notifications", trailingText = if (pushOn) "On" else "Off") {
                scope.launch { ShuleApp.session.setPushEnabled(!pushOn) }
                if (!pushOn && android.os.Build.VERSION.SDK_INT >= 33) runCatching { askPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS) }
            }
        }

        SectionLabel("Account details")
        SettingsCard {
            SettingsRow(Icons.Outlined.Person, "Change my name") { viewModel.clearProfileError(); editName = true }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(Icons.Outlined.Lock, "Change password") { viewModel.clearPasswordErrors(); changePassword = true }
        }

        SectionLabel("Help and about")
        SettingsCard {
            SettingsRow(Icons.Outlined.HelpOutline, "Help and support") { showHelp = true }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(Icons.Outlined.RateReview, "Send feedback") { viewModel.clearFeedbackError(); showFeedback = true }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(Icons.Outlined.Share, "Share Shule Notes") {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "Study with Shule Notes: notes and past papers for every class, with an AI study helper.\n$DOWNLOAD_URL")
                }
                runCatching { context.startActivity(Intent.createChooser(send, "Share Shule Notes")) }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(Icons.Outlined.Description, "Terms of use") { runCatching { uriHandler.openUri(TERMS_URL) } }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(Icons.Outlined.PrivacyTip, "Privacy policy") { runCatching { uriHandler.openUri(PRIVACY_URL) } }
        }

        Spacer(Modifier.height(28.dp))
        OutlinedButton(
            onClick = { confirmLogout = true },
            shape = RoundedCornerShape(16.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.55f)),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text("Log out", style = MaterialTheme.typography.titleSmall)
        }
        Spacer(Modifier.height(6.dp))
        TextButton(
            onClick = { viewModel.clearDeleteAccountError(); confirmDelete = true },
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text("Delete account", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        }
        Text(
            "Shule Notes  ·  Version ${BuildConfig.VERSION_NAME}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 2.dp),
        )
        Spacer(Modifier.height(24.dp))
    }

    if (showPhotoSheet) {
        ModalBottomSheet(onDismissRequest = { showPhotoSheet = false }, containerColor = MaterialTheme.colorScheme.surface) {
            Column(modifier = Modifier.padding(bottom = 24.dp)) {
                Text("Profile photo", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                SettingsRow(Icons.Outlined.PhotoLibrary, "Choose from your photos") {
                    showPhotoSheet = false
                    pickPhoto.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
                if (avatarVersion > 0) {
                    SettingsRow(Icons.Outlined.Delete, "Remove my photo", color = MaterialTheme.colorScheme.error) {
                        showPhotoSheet = false
                        viewModel.removeAvatar()
                    }
                }
            }
        }
    }

    if (showFeedback) {
        var kind by rememberSaveable { mutableStateOf("problem") }
        var message by rememberSaveable { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { if (!viewModel.isSendingFeedback) showFeedback = false },
            title = { Text("Send feedback") },
            text = {
                Column {
                    Text("Something not working, or an idea to make it better? Tell us.", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(6.dp)) {
                        listOf("problem" to "Problem", "idea" to "Idea", "other" to "Other").forEach { (value, label) ->
                            FilterChip(selected = kind == value, onClick = { kind = value }, label = { Text(label) })
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = message,
                        onValueChange = { message = it.take(1000); viewModel.clearFeedbackError() },
                        label = { Text("Your message") },
                        minLines = 4,
                        maxLines = 6,
                        isError = viewModel.feedbackError != null,
                        supportingText = viewModel.feedbackError?.let { error -> { Text(error) } },
                        enabled = !viewModel.isSendingFeedback,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.sendFeedback(kind, message) { showFeedback = false; message = "" } },
                    enabled = !viewModel.isSendingFeedback,
                ) { Text(if (viewModel.isSendingFeedback) "Sending…" else "Send") }
            },
            dismissButton = { TextButton(onClick = { showFeedback = false }, enabled = !viewModel.isSendingFeedback) { Text("Cancel") } },
        )
    }

    if (showAppearance) {
        AlertDialog(
            onDismissRequest = { showAppearance = false },
            title = { Text("Appearance") },
            text = {
                Column {
                    listOf("system" to "System default", "light" to "Light", "dark" to "Dark").forEach { (mode, label) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    scope.launch { ShuleApp.session.setThemeMode(mode) }
                                    showAppearance = false
                                }
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = themeMode == mode, onClick = null)
                            Spacer(Modifier.width(12.dp))
                            Text(label, style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showAppearance = false }) { Text("Close") } },
        )
    }

    if (showHelp) {
        SupportDialog(
            title = "Help and support",
            intro = "Questions, a problem with a note, or a forgotten password? Reach us here.",
            config = AppConfigHolder.config,
            onDismiss = { showHelp = false },
        )
    }

    if (editName) {
        var name by rememberSaveable { mutableStateOf(userName) }
        AlertDialog(
            onDismissRequest = { if (!viewModel.isSavingProfile) editName = false },
            title = { Text("Change my name") },
            text = {
                ShuleTextField(
                    value = name,
                    onValueChange = { name = it; viewModel.clearProfileError() },
                    label = "Full name",
                    leadingIcon = Icons.Outlined.Edit,
                    error = viewModel.profileError,
                    enabled = !viewModel.isSavingProfile,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                )
            },
            confirmButton = {
                Button(onClick = { viewModel.saveName(name) { editName = false } }, enabled = !viewModel.isSavingProfile) {
                    Text(if (viewModel.isSavingProfile) "Saving…" else "Save")
                }
            },
            dismissButton = { TextButton(onClick = { editName = false }, enabled = !viewModel.isSavingProfile) { Text("Cancel") } },
        )
    }

    if (changePassword) {
        var current by rememberSaveable { mutableStateOf("") }
        var next by rememberSaveable { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { if (!viewModel.isSavingProfile) changePassword = false },
            title = { Text("Change password") },
            text = {
                Column {
                    ShuleTextField(
                        value = current,
                        onValueChange = { current = it; viewModel.clearPasswordErrors() },
                        label = "Current password",
                        leadingIcon = Icons.Outlined.Lock,
                        isPassword = true,
                        error = viewModel.currentPasswordError,
                        enabled = !viewModel.isSavingProfile,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    )
                    Spacer(Modifier.height(12.dp))
                    ShuleTextField(
                        value = next,
                        onValueChange = { next = it; viewModel.clearPasswordErrors() },
                        label = "New password",
                        leadingIcon = Icons.Outlined.Lock,
                        isPassword = true,
                        error = viewModel.passwordFormError,
                        supportingText = "At least 6 characters",
                        enabled = !viewModel.isSavingProfile,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    )
                }
            },
            confirmButton = {
                Button(onClick = { viewModel.changePassword(current, next) { changePassword = false } }, enabled = !viewModel.isSavingProfile) {
                    Text(if (viewModel.isSavingProfile) "Saving…" else "Change password")
                }
            },
            dismissButton = { TextButton(onClick = { changePassword = false }, enabled = !viewModel.isSavingProfile) { Text("Cancel") } },
        )
    }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Log out?") },
            text = { Text("You will need your phone number and password to sign in again.") },
            confirmButton = {
                TextButton(onClick = { confirmLogout = false; viewModel.logout(onSignedOut) }) { Text("Log out") }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Cancel") } },
        )
    }

    if (confirmDelete) {
        var password by rememberSaveable { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { if (!viewModel.isDeletingAccount) confirmDelete = false },
            title = { Text("Delete your account?") },
            text = {
                Column {
                    Text("This permanently removes your account and cannot be undone. Enter your password to confirm.")
                    Spacer(Modifier.height(14.dp))
                    ShuleTextField(
                        value = password,
                        onValueChange = { password = it; viewModel.clearDeleteAccountError() },
                        label = "Password",
                        leadingIcon = Icons.Outlined.Lock,
                        isPassword = true,
                        error = viewModel.deleteAccountError,
                        enabled = !viewModel.isDeletingAccount,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.deleteAccount(password, onSignedOut) },
                    enabled = !viewModel.isDeletingAccount,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                ) {
                    Text(if (viewModel.isDeletingAccount) "Deleting…" else "Delete account")
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }, enabled = !viewModel.isDeletingAccount) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 4.dp, top = 24.dp, bottom = 8.dp),
    )
}

@Composable
private fun SettingsCard(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(content = content)
    }
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    label: String,
    color: Color = MaterialTheme.colorScheme.onSurface,
    trailingText: String? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, color = color, modifier = Modifier.weight(1f))
        if (trailingText != null) {
            Text(trailingText, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (onClick != null) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

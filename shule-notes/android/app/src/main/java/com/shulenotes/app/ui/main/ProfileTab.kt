package com.shulenotes.app.ui.main

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PrivacyTip
import androidx.compose.material.icons.outlined.School
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.shulenotes.app.BuildConfig
import com.shulenotes.app.ui.auth.PRIVACY_URL
import com.shulenotes.app.ui.auth.TERMS_URL
import com.shulenotes.app.ui.components.AppConfigHolder
import com.shulenotes.app.ui.components.SupportDialog
import com.shulenotes.app.ui.components.Avatar
import com.shulenotes.app.ui.components.ShuleTextField

@Composable
fun ProfileTab(
    viewModel: LibraryViewModel,
    userName: String,
    userContact: String,
    userClass: String,
    contentPadding: PaddingValues,
    onChangeClass: () -> Unit,
    onSignedOut: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    var editName by rememberSaveable { mutableStateOf(false) }
    var changePassword by rememberSaveable { mutableStateOf(false) }
    var showHelp by rememberSaveable { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(contentPadding)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(16.dp))
        Text("Profile", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))

        SettingsCard {
            Row(modifier = Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(name = userName, size = 60.dp)
                Spacer(Modifier.width(16.dp))
                Column {
                    Text(userName.ifBlank { "Student" }, style = MaterialTheme.typography.titleLarge, maxLines = 1)
                    if (userContact.isNotBlank()) {
                        Text(
                            userContact,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }

        SectionLabel("Study")
        SettingsCard {
            SettingsRow(Icons.Outlined.School, "My class", trailingText = userClass.ifBlank { "Not chosen" }, onClick = onChangeClass)
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
            SettingsRow(Icons.Outlined.Description, "Terms of use") { runCatching { uriHandler.openUri(TERMS_URL) } }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(Icons.Outlined.PrivacyTip, "Privacy policy") { runCatching { uriHandler.openUri(PRIVACY_URL) } }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(Icons.Outlined.Info, "App version", trailingText = BuildConfig.VERSION_NAME)
        }

        SectionLabel("Account")
        SettingsCard {
            SettingsRow(Icons.AutoMirrored.Filled.Logout, "Log out") { confirmLogout = true }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 56.dp))
            SettingsRow(Icons.Outlined.Delete, "Delete account", color = MaterialTheme.colorScheme.error) {
                viewModel.clearDeleteAccountError()
                confirmDelete = true
            }
        }
        Spacer(Modifier.height(24.dp))
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

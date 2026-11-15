package com.shulenotes.app.ui.auth

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.shulenotes.app.BuildConfig
import com.shulenotes.app.ui.components.ErrorBanner
import com.shulenotes.app.ui.components.PrimaryButton
import com.shulenotes.app.ui.components.ShuleTextField

val PRIVACY_URL = BuildConfig.API_BASE_URL.trimEnd('/') + "/privacy"

@Composable
fun RegisterScreen(viewModel: AuthViewModel, onRegistered: () -> Unit, onGoToLogin: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val focus = LocalFocusManager.current
    val uriHandler = LocalUriHandler.current
    val submit = {
        focus.clearFocus()
        viewModel.register(name, phone, password, onRegistered)
    }

    AuthFrame(onBack = onGoToLogin) {
        Text("Create your account", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(6.dp))
        Text(
            "Notes, past papers and an AI study helper, all in one place.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(28.dp))

        ShuleTextField(
            value = name,
            onValueChange = { name = it; viewModel.clearError() },
            label = "Full name",
            leadingIcon = Icons.Outlined.Person,
            enabled = !viewModel.isLoading,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
        )
        Spacer(Modifier.height(14.dp))
        ShuleTextField(
            value = phone,
            onValueChange = { phone = it; viewModel.clearError() },
            label = "Phone number",
            leadingIcon = Icons.Outlined.Phone,
            enabled = !viewModel.isLoading,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
        )
        Spacer(Modifier.height(14.dp))
        ShuleTextField(
            value = password,
            onValueChange = { password = it; viewModel.clearError() },
            label = "Password",
            leadingIcon = Icons.Outlined.Lock,
            isPassword = true,
            supportingText = "At least 6 characters",
            enabled = !viewModel.isLoading,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
        )

        viewModel.errorMessage?.let {
            Spacer(Modifier.height(10.dp))
            ErrorBanner(it)
        }

        Spacer(Modifier.height(20.dp))
        PrimaryButton(text = "Create account", loadingText = "Creating your account…", loading = viewModel.isLoading, onClick = submit)

        Spacer(Modifier.height(14.dp))
        Text(
            text = buildAnnotatedString {
                append("By creating an account you agree to our ")
                withStyle(SpanStyle(color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)) {
                    append("Privacy Policy")
                }
                append(".")
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .clickable { runCatching { uriHandler.openUri(PRIVACY_URL) } }
                .padding(vertical = 6.dp),
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Already have an account?",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = onGoToLogin, enabled = !viewModel.isLoading) { Text("Sign in") }
        }
    }
}

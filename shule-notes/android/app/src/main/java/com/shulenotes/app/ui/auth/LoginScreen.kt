package com.shulenotes.app.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.shulenotes.app.ui.components.LogoMark
import com.shulenotes.app.ui.components.PrimaryButton
import com.shulenotes.app.ui.components.ShuleTextField
import com.shulenotes.app.ui.components.Wordmark

// Shared frame for the sign-in and sign-up screens: scrolls, and keeps the
// focused field above the keyboard.
@Composable
fun AuthFrame(onBack: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack, modifier = Modifier.padding(top = 4.dp).offset(x = (-12).dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
        } else {
            Spacer(Modifier.height(40.dp))
        }
        content()
        Spacer(Modifier.height(24.dp))
    }
}

// Logo in the middle at the top, then the screen's title and one line under it.
@Composable
fun AuthHeader(logoSize: Dp, title: String, subtitle: String) {
    Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        LogoMark(size = logoSize)
        Spacer(Modifier.height(10.dp))
        Wordmark(fontSize = 26)
        Spacer(Modifier.height(24.dp))
        Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(4.dp))
        Text(
            subtitle,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
fun LoginScreen(viewModel: AuthViewModel, onLoggedIn: () -> Unit, onGoToRegister: () -> Unit) {
    var phone by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val focus = LocalFocusManager.current
    val submit = {
        focus.clearFocus()
        viewModel.login(phone, password, onLoggedIn)
    }

    AuthFrame {
        AuthHeader(logoSize = 112.dp, title = "Welcome back", subtitle = "Sign in to carry on studying.")

        ShuleTextField(
            value = phone,
            onValueChange = { phone = it; viewModel.clearPhoneError() },
            label = "Phone number",
            error = viewModel.phoneError,
            leadingIcon = Icons.Outlined.Phone,
            enabled = !viewModel.isLoading,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
        )
        Spacer(Modifier.height(14.dp))
        ShuleTextField(
            value = password,
            onValueChange = { password = it; viewModel.clearPasswordError() },
            label = "Password",
            error = viewModel.passwordError,
            leadingIcon = Icons.Outlined.Lock,
            isPassword = true,
            enabled = !viewModel.isLoading,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
        )

        Spacer(Modifier.height(24.dp))
        PrimaryButton(text = "Sign in", loadingText = "Signing in…", loading = viewModel.isLoading, onClick = submit)

        Spacer(Modifier.height(16.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "New to Shule Notes?",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = onGoToRegister, enabled = !viewModel.isLoading) { Text("Create an account") }
        }
    }
}

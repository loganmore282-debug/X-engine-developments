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
import androidx.compose.material.icons.outlined.Person
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
import androidx.compose.ui.unit.dp
import com.shulenotes.app.ui.components.ErrorBanner
import com.shulenotes.app.ui.components.LogoMark
import com.shulenotes.app.ui.components.PrimaryButton
import com.shulenotes.app.ui.components.ShuleTextField

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
            Spacer(Modifier.height(12.dp))
        } else {
            Spacer(Modifier.height(64.dp))
        }
        content()
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
fun LoginScreen(viewModel: AuthViewModel, onLoggedIn: () -> Unit, onGoToRegister: () -> Unit) {
    var identifier by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    val focus = LocalFocusManager.current
    val submit = {
        focus.clearFocus()
        viewModel.login(identifier, password, onLoggedIn)
    }

    AuthFrame {
        LogoMark(size = 68.dp)
        Spacer(Modifier.height(28.dp))
        Text("Welcome back", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(6.dp))
        Text(
            "Sign in to carry on studying with Shule Notes.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(32.dp))

        ShuleTextField(
            value = identifier,
            onValueChange = { identifier = it; viewModel.clearError() },
            label = "Phone number or email",
            leadingIcon = Icons.Outlined.Person,
            enabled = !viewModel.isLoading,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
        )
        Spacer(Modifier.height(14.dp))
        ShuleTextField(
            value = password,
            onValueChange = { password = it; viewModel.clearError() },
            label = "Password",
            leadingIcon = Icons.Outlined.Lock,
            isPassword = true,
            enabled = !viewModel.isLoading,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
        )

        viewModel.errorMessage?.let {
            Spacer(Modifier.height(14.dp))
            ErrorBanner(it)
        }

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

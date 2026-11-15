package com.shulenotes.app.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.shulenotes.app.data.TokenStore

@Composable
fun LoginScreen(
    viewModel: AuthViewModel,
    tokenStore: TokenStore,
    onLoggedIn: () -> Unit,
    onGoToRegister: () -> Unit,
) {
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Shule Notes", style = MaterialTheme.typography.headlineMedium)
            Text("Notes, papers and revision -- with an AI helper.", style = MaterialTheme.typography.bodyMedium)

            androidx.compose.foundation.layout.Spacer(modifier = Modifier.height(24.dp))

            OutlinedTextField(
                value = identifier,
                onValueChange = { identifier = it; viewModel.clearError() },
                label = { Text("Phone number or email") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it; viewModel.clearError() },
                label = { Text("Password") },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )

            viewModel.errorMessage?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
            }

            Button(
                onClick = { viewModel.login(identifier, password, tokenStore, onLoggedIn) },
                enabled = !viewModel.isLoading,
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            ) {
                if (viewModel.isLoading) {
                    CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
                }
                Text("Sign in")
            }

            TextButton(
                onClick = onGoToRegister,
                modifier = Modifier.fillMaxWidth(),
                enabled = !viewModel.isLoading,
            ) {
                Text("New here? Create an account", textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
    }
}

package com.shulenotes.app.ui.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.AuthResponse
import com.shulenotes.app.data.serverMessage
import kotlinx.coroutines.launch
import java.io.IOException

class AuthViewModel : ViewModel() {
    var isLoading by mutableStateOf(false)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set

    fun clearError() { errorMessage = null }

    fun login(phone: String, password: String, onSuccess: () -> Unit) {
        if (phone.isBlank() || password.isBlank()) {
            errorMessage = "Enter your phone number and your password."
            return
        }
        submit("We could not sign you in. Please try again.", onSuccess) {
            ApiClient.service.login(mapOf("phone" to phone.trim(), "password" to password))
        }
    }

    fun register(name: String, phone: String, password: String, onSuccess: () -> Unit) {
        when {
            name.isBlank() -> { errorMessage = "Enter your full name."; return }
            phone.isBlank() -> { errorMessage = "Enter your phone number."; return }
            password.length < 6 -> { errorMessage = "Choose a password with at least 6 characters."; return }
        }
        submit("We could not create your account. Please try again.", onSuccess) {
            ApiClient.service.register(mapOf("name" to name.trim(), "phone" to phone.trim(), "password" to password))
        }
    }

    private fun submit(fallback: String, onSuccess: () -> Unit, call: suspend () -> AuthResponse) {
        if (isLoading) return
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val res = call()
                val token = res.token
                if (res.status == "success" && token != null) {
                    ShuleApp.session.saveSession(token, res.user)
                    onSuccess()
                } else {
                    errorMessage = res.message ?: fallback
                }
            } catch (e: IOException) {
                errorMessage = "No connection. Check your internet and try again."
            } catch (e: Exception) {
                errorMessage = e.serverMessage() ?: fallback
            } finally {
                isLoading = false
            }
        }
    }
}

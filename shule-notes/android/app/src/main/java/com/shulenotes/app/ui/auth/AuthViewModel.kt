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
import com.shulenotes.app.ui.components.Notifier
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.IOException

// A mistake in one field is shown under that field (nameError, phoneError,
// passwordError). Anything the server or the network says goes to the
// floating notice instead.
class AuthViewModel : ViewModel() {
    var isLoading by mutableStateOf(false)
        private set
    var nameError by mutableStateOf<String?>(null)
        private set
    var phoneError by mutableStateOf<String?>(null)
        private set
    var passwordError by mutableStateOf<String?>(null)
        private set

    fun clearNameError() { nameError = null }

    fun clearPhoneError() { phoneError = null }

    fun clearPasswordError() { passwordError = null }

    fun login(phone: String, password: String, onSuccess: () -> Unit) {
        phoneError = if (phone.isBlank()) "Enter your phone number" else null
        passwordError = if (password.isBlank()) "Enter your password" else null
        if (phoneError != null || passwordError != null) return
        submit("We could not sign you in. Please try again.", onSuccess, isLogin = true) {
            ApiClient.service.login(mapOf("phone" to phone.trim(), "password" to password))
        }
    }

    fun register(name: String, phone: String, password: String, onSuccess: () -> Unit) {
        nameError = if (name.isBlank()) "Enter your full name" else null
        phoneError = if (phone.isBlank()) "Enter your phone number" else null
        passwordError = if (password.length < 6) "Use at least 6 characters" else null
        if (nameError != null || phoneError != null || passwordError != null) return
        submit("We could not create your account. Please try again.", onSuccess, isLogin = false) {
            ApiClient.service.register(mapOf("name" to name.trim(), "phone" to phone.trim(), "password" to password))
        }
    }

    private fun submit(fallback: String, onSuccess: () -> Unit, isLogin: Boolean, call: suspend () -> AuthResponse) {
        if (isLoading) return
        viewModelScope.launch {
            isLoading = true
            try {
                val res = call()
                val token = res.token
                if (res.status == "success" && token != null) {
                    ShuleApp.session.saveSession(token, res.user)
                    onSuccess()
                } else {
                    Notifier.error(res.message ?: fallback)
                }
            } catch (e: IOException) {
                Notifier.error("No connection. Check your internet and try again.")
            } catch (e: Exception) {
                // The sign-in was refused: outline both fields, since the
                // server rightly does not say which of the two was wrong.
                if (isLogin && (e as? HttpException)?.code() == 401) {
                    phoneError = ""
                    passwordError = ""
                }
                Notifier.error(e.serverMessage() ?: fallback)
            } finally {
                isLoading = false
            }
        }
    }
}

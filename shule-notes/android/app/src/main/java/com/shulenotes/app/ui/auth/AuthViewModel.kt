package com.shulenotes.app.ui.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.TokenStore
import kotlinx.coroutines.launch
import java.io.IOException

class AuthViewModel : ViewModel() {
    var isLoading by mutableStateOf(false)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set

    fun clearError() { errorMessage = null }

    fun login(identifier: String, password: String, tokenStore: TokenStore, onSuccess: () -> Unit) {
        if (identifier.isBlank() || password.isBlank()) {
            errorMessage = "Enter your phone/email and password"
            return
        }
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val res = ApiClient.service.login(mapOf("identifier" to identifier, "password" to password))
                val token = res.token
                if (res.status == "success" && token != null) {
                    tokenStore.saveToken(token)
                    onSuccess()
                } else {
                    errorMessage = res.message ?: "Could not sign in"
                }
            } catch (e: IOException) {
                errorMessage = "Could not reach the server. Check your connection and try again."
            } catch (e: Exception) {
                errorMessage = "Something went wrong. Please try again."
            } finally {
                isLoading = false
            }
        }
    }

    fun register(name: String, phone: String, password: String, tokenStore: TokenStore, onSuccess: () -> Unit) {
        if (name.isBlank() || phone.isBlank() || password.length < 6) {
            errorMessage = "Fill in your name, phone number, and a password of at least 6 characters"
            return
        }
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val res = ApiClient.service.register(mapOf("name" to name, "phone" to phone, "password" to password))
                val token = res.token
                if (res.status == "success" && token != null) {
                    tokenStore.saveToken(token)
                    onSuccess()
                } else {
                    errorMessage = res.message ?: "Could not create the account"
                }
            } catch (e: IOException) {
                errorMessage = "Could not reach the server. Check your connection and try again."
            } catch (e: Exception) {
                errorMessage = "Something went wrong. Please try again."
            } finally {
                isLoading = false
            }
        }
    }
}

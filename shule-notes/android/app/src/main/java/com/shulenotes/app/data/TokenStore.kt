package com.shulenotes.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "shule_prefs")
private val TOKEN_KEY = stringPreferencesKey("auth_token")

// Persisted copy (survives app restart) plus an in-memory mirror
// (SessionHolder) the network layer reads synchronously -- an OkHttp
// interceptor cannot suspend to read DataStore on every single request.
class TokenStore(private val context: Context) {
    val tokenFlow: Flow<String?> = context.dataStore.data.map { it[TOKEN_KEY] }

    suspend fun saveToken(token: String) {
        context.dataStore.edit { it[TOKEN_KEY] = token }
        SessionHolder.token = token
    }

    suspend fun clearToken() {
        context.dataStore.edit { it.remove(TOKEN_KEY) }
        SessionHolder.token = null
    }

    // Called once at app start, before any screen can make a request, so
    // SessionHolder is never stale relative to what was actually saved.
    suspend fun primeSessionHolder() {
        SessionHolder.token = tokenFlow.first()
    }
}

object SessionHolder {
    @Volatile var token: String? = null
}

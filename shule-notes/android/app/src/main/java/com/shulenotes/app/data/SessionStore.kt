package com.shulenotes.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "shule_prefs")
private val TOKEN_KEY = stringPreferencesKey("auth_token")
private val NAME_KEY = stringPreferencesKey("user_name")
private val CONTACT_KEY = stringPreferencesKey("user_contact")
private val SAVED_KEY = stringSetPreferencesKey("saved_notes")

// Everything the app remembers on the phone: the sign-in token, who is
// signed in, and which notes they bookmarked. The token also has an
// in-memory mirror (SessionHolder) because an OkHttp interceptor cannot
// suspend to read DataStore on every request.
class SessionStore(private val context: Context) {
    val userName: Flow<String> = context.dataStore.data.map { it[NAME_KEY].orEmpty() }
    val userContact: Flow<String> = context.dataStore.data.map { it[CONTACT_KEY].orEmpty() }
    val savedNoteIds: Flow<Set<String>> = context.dataStore.data.map { it[SAVED_KEY] ?: emptySet() }

    suspend fun saveSession(token: String, user: User?) {
        context.dataStore.edit {
            it[TOKEN_KEY] = token
            it[NAME_KEY] = user?.name.orEmpty()
            it[CONTACT_KEY] = user?.phone ?: user?.email ?: ""
        }
        SessionHolder.token = token
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
        SessionHolder.token = null
    }

    // Called once at app start, before any screen can make a request.
    suspend fun primeSessionHolder() {
        SessionHolder.token = context.dataStore.data.first()[TOKEN_KEY]
    }

    suspend fun toggleSaved(noteId: String) {
        context.dataStore.edit {
            val current = it[SAVED_KEY] ?: emptySet()
            it[SAVED_KEY] = if (noteId in current) current - noteId else current + noteId
        }
    }
}

object SessionHolder {
    @Volatile var token: String? = null

    // Set by the network layer when the server rejects the saved token (it
    // expired, or the account was removed); the nav graph reacts by signing out.
    val expired = MutableStateFlow(false)
}

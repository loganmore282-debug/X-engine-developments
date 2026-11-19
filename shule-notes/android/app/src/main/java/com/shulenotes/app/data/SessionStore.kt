package com.shulenotes.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.gson.Gson
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "shule_prefs")
private val TOKEN_KEY = stringPreferencesKey("auth_token")
private val NAME_KEY = stringPreferencesKey("user_name")
private val CONTACT_KEY = stringPreferencesKey("user_contact")
private val CLASS_KEY = stringPreferencesKey("class_level")
private val SAVED_KEY = stringSetPreferencesKey("saved_notes")
private val RECENT_KEY = stringPreferencesKey("recent_notes")
private val DISMISSED_KEY = stringPreferencesKey("dismissed_announcement")

// One document the student has opened, and how far they got in it.
data class RecentNote(val id: String, val page: Int, val pageCount: Int, val at: Long)

private val gson = Gson()

private fun parseRecent(json: String?): List<RecentNote> = try {
    if (json.isNullOrBlank()) emptyList() else gson.fromJson(json, Array<RecentNote>::class.java).toList()
} catch (e: Exception) {
    emptyList()
}

// Everything the app remembers on the phone: the sign-in token, who is
// signed in and their class, which notes they bookmarked, and where they
// stopped reading. The token also has an in-memory mirror (SessionHolder)
// because an OkHttp interceptor cannot suspend to read DataStore on every request.
class SessionStore(private val context: Context) {
    val userName: Flow<String> = context.dataStore.data.map { it[NAME_KEY].orEmpty() }
    val userContact: Flow<String> = context.dataStore.data.map { it[CONTACT_KEY].orEmpty() }
    val classLevel: Flow<String> = context.dataStore.data.map { it[CLASS_KEY].orEmpty() }
    val savedNoteIds: Flow<Set<String>> = context.dataStore.data.map { it[SAVED_KEY] ?: emptySet() }
    val dismissedAnnouncement: Flow<String> = context.dataStore.data.map { it[DISMISSED_KEY].orEmpty() }
    val recent: Flow<List<RecentNote>> = context.dataStore.data.map { parseRecent(it[RECENT_KEY]) }

    suspend fun saveSession(token: String, user: User?) {
        context.dataStore.edit {
            it[TOKEN_KEY] = token
            it[NAME_KEY] = user?.name.orEmpty()
            it[CONTACT_KEY] = user?.phone.orEmpty()
            it[CLASS_KEY] = user?.classLevel.orEmpty()
        }
        SessionHolder.token = token
    }

    suspend fun setName(name: String) {
        context.dataStore.edit { it[NAME_KEY] = name }
    }

    suspend fun dismissAnnouncement(id: String) {
        context.dataStore.edit { it[DISMISSED_KEY] = id }
    }

    suspend fun setClassLevel(level: String) {
        context.dataStore.edit { it[CLASS_KEY] = level }
    }

    // Signing out forgets the account but keeps the bookmarks, which are
    // only note ids; deleting the account wipes everything.
    suspend fun clear(keepSaved: Boolean = true) {
        context.dataStore.edit {
            if (keepSaved) {
                it.remove(TOKEN_KEY); it.remove(NAME_KEY); it.remove(CONTACT_KEY); it.remove(CLASS_KEY); it.remove(RECENT_KEY)
            } else {
                it.clear()
            }
        }
        SessionHolder.token = null
    }

    // Called once at app start, before any screen can make a request.
    suspend fun primeSessionHolder() {
        SessionHolder.token = context.dataStore.data.first()[TOKEN_KEY]
    }

    // Returns true when the note is saved after the call, false when it was removed.
    suspend fun toggleSaved(noteId: String): Boolean {
        var nowSaved = false
        context.dataStore.edit {
            val current = it[SAVED_KEY] ?: emptySet()
            nowSaved = noteId !in current
            it[SAVED_KEY] = if (nowSaved) current + noteId else current - noteId
        }
        return nowSaved
    }

    // The most recently read document goes first; only the last few are kept.
    suspend fun recordProgress(noteId: String, page: Int, pageCount: Int) {
        context.dataStore.edit {
            val others = parseRecent(it[RECENT_KEY]).filter { r -> r.id != noteId }
            val list = (listOf(RecentNote(noteId, page, pageCount, System.currentTimeMillis())) + others).take(8)
            it[RECENT_KEY] = gson.toJson(list)
        }
    }
}

object SessionHolder {
    @Volatile var token: String? = null

    // Set by the network layer when the server rejects the saved token (it
    // expired, or the account was removed); the nav graph signs the user out.
    val expired = MutableStateFlow(false)
}

package com.shulenotes.app.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
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
private val LIBRARY_KEY = stringPreferencesKey("library_cache")
private val SEEN_KEY = longPreferencesKey("notifications_seen_at")
private val THEME_KEY = stringPreferencesKey("theme_mode")
private val DISMISSED_UPDATE_KEY = intPreferencesKey("dismissed_update")
private val SEARCHES_KEY = stringPreferencesKey("recent_searches")
private val STUDY_KEY = stringSetPreferencesKey("study_pages")
private val FINISHED_KEY = stringSetPreferencesKey("finished_notes")
private val AVATAR_KEY = longPreferencesKey("avatar_version")
private val INTRO_SEEN_KEY = booleanPreferencesKey("intro_seen")
private val PUSH_ON_KEY = booleanPreferencesKey("push_enabled")
private val PUSH_TOPICS_KEY = stringSetPreferencesKey("push_topics")
private val PAGE_MARKS_KEY = stringSetPreferencesKey("page_bookmarks")

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
    // When the student last opened the notifications page (epoch milliseconds); newer items are "unread".
    val notificationsSeenAt: Flow<Long> = context.dataStore.data.map { it[SEEN_KEY] ?: 0L }
    // "system", "light" or "dark".
    val themeMode: Flow<String> = context.dataStore.data.map { it[THEME_KEY] ?: "system" }
    // Bookmarked pages, each stored as "noteId:page".
    val pageBookmarks: Flow<Set<String>> = context.dataStore.data.map { it[PAGE_MARKS_KEY] ?: emptySet() }
    // 0 means no photo of their own (the Shule Notes logo is shown instead).
    val avatarVersion: Flow<Long> = context.dataStore.data.map { it[AVATAR_KEY] ?: 0L }
    // The introduction is shown once, before the first sign-in.
    val introSeen: Flow<Boolean> = context.dataStore.data.map { it[INTRO_SEEN_KEY] ?: false }
    // Whether the student wants phone notifications (on unless they turned it off).
    val pushEnabled: Flow<Boolean> = context.dataStore.data.map { it[PUSH_ON_KEY] ?: true }
    // The notification groups this phone is subscribed to right now ("all", "class_senior_2").
    val pushTopics: Flow<Set<String>> = context.dataStore.data.map { it[PUSH_TOPICS_KEY] ?: emptySet() }
    // The newest version the student has already been told about and closed the banner for.
    val dismissedUpdate: Flow<Int> = context.dataStore.data.map { it[DISMISSED_UPDATE_KEY] ?: 0 }
    // Newest first, at most 8.
    val recentSearches: Flow<List<String>> = context.dataStore.data.map { prefs ->
        (prefs[SEARCHES_KEY] ?: "").split('\n').filter { it.isNotBlank() }
    }
    // Pages the student has read, each stored as "day|noteId|page" (about five weeks kept).
    val studyPages: Flow<Set<String>> = context.dataStore.data.map { it[STUDY_KEY] ?: emptySet() }
    // Notes read to their last page.
    val finishedNotes: Flow<Set<String>> = context.dataStore.data.map { it[FINISHED_KEY] ?: emptySet() }
    val libraryCache: Flow<String> = context.dataStore.data.map { it[LIBRARY_KEY].orEmpty() }
    val dismissedAnnouncement: Flow<String> = context.dataStore.data.map { it[DISMISSED_KEY].orEmpty() }
    val recent: Flow<List<RecentNote>> = context.dataStore.data.map { parseRecent(it[RECENT_KEY]) }

    suspend fun saveSession(token: String, user: User?) {
        context.dataStore.edit {
            it[TOKEN_KEY] = token
            it[NAME_KEY] = user?.name.orEmpty()
            it[CONTACT_KEY] = user?.phone.orEmpty()
            it[CLASS_KEY] = user?.classLevel.orEmpty()
            it[AVATAR_KEY] = user?.avatarVersion ?: 0L
        }
        SessionHolder.token = token
    }

    suspend fun setName(name: String) {
        context.dataStore.edit { it[NAME_KEY] = name }
    }

    // True when the page is bookmarked after the call, false when the bookmark was removed.
    suspend fun togglePageBookmark(noteId: String, page: Int): Boolean {
        var nowMarked = false
        context.dataStore.edit {
            val key = "$noteId:$page"
            val current = it[PAGE_MARKS_KEY] ?: emptySet()
            nowMarked = key !in current
            it[PAGE_MARKS_KEY] = if (nowMarked) current + key else current - key
        }
        return nowMarked
    }

    suspend fun dismissUpdate(version: Int) {
        context.dataStore.edit { it[DISMISSED_UPDATE_KEY] = version }
    }

    suspend fun addRecentSearch(query: String) {
        val clean = query.trim().replace('\n', ' ').take(60)
        if (clean.length < 3) return
        context.dataStore.edit {
            val current = (it[SEARCHES_KEY] ?: "").split('\n').filter { s -> s.isNotBlank() }
            val next = (listOf(clean) + current.filter { s -> !s.equals(clean, ignoreCase = true) }).take(8)
            it[SEARCHES_KEY] = next.joinToString("\n")
        }
    }

    suspend fun clearRecentSearches() {
        context.dataStore.edit { it.remove(SEARCHES_KEY) }
    }

    // Called when the student rests on a page of a note: feeds "My progress".
    suspend fun recordPageRead(noteId: String, page: Int, pageCount: Int) {
        val now = System.currentTimeMillis()
        val today = dayKey(now)
        val cutoff = dayKey(now - 35L * 24 * 60 * 60 * 1000)
        context.dataStore.edit {
            val kept = (it[STUDY_KEY] ?: emptySet()).filter { entry -> entry.substringBefore('|') >= cutoff }.toMutableSet()
            kept.add("$today|$noteId|$page")
            it[STUDY_KEY] = kept
            if (pageCount > 0 && page >= pageCount) it[FINISHED_KEY] = (it[FINISHED_KEY] ?: emptySet()) + noteId
        }
    }

    suspend fun markNotificationsSeen(at: Long) {
        context.dataStore.edit { it[SEEN_KEY] = at }
    }

    suspend fun setThemeMode(mode: String) {
        context.dataStore.edit { it[THEME_KEY] = mode }
    }

    suspend fun saveLibrary(json: String) {
        context.dataStore.edit { it[LIBRARY_KEY] = json }
    }

    suspend fun dismissAnnouncement(id: String) {
        context.dataStore.edit { it[DISMISSED_KEY] = id }
    }

    suspend fun setAvatarVersion(version: Long) {
        context.dataStore.edit { if (version > 0) it[AVATAR_KEY] = version else it.remove(AVATAR_KEY) }
    }

    suspend fun setIntroSeen() {
        context.dataStore.edit { it[INTRO_SEEN_KEY] = true }
    }

    suspend fun setPushEnabled(on: Boolean) {
        context.dataStore.edit { it[PUSH_ON_KEY] = on }
    }

    suspend fun currentPushTopics(): Set<String> = pushTopics.first()

    suspend fun setPushTopics(topics: Set<String>) {
        context.dataStore.edit { it[PUSH_TOPICS_KEY] = topics }
    }

    suspend fun setClassLevel(level: String) {
        context.dataStore.edit { it[CLASS_KEY] = level }
    }

    // Signing out forgets the account but keeps the bookmarks, which are
    // only note ids; deleting the account wipes everything.
    suspend fun clear(keepSaved: Boolean = true) {
        AccessHolder.clear()
        context.dataStore.edit {
            if (keepSaved) {
                it.remove(TOKEN_KEY); it.remove(NAME_KEY); it.remove(CONTACT_KEY); it.remove(CLASS_KEY); it.remove(AVATAR_KEY); it.remove(RECENT_KEY); it.remove(LIBRARY_KEY); it.remove(SEEN_KEY); it.remove(SEARCHES_KEY); it.remove(STUDY_KEY); it.remove(FINISHED_KEY)
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

// "2026-11-19" in the phone's own time zone.
fun dayKey(millis: Long): String =
    java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date(millis))

object SessionHolder {
    @Volatile var token: String? = null

    // Set by the network layer when the server rejects the saved token (it
    // expired, or the account was removed); the nav graph signs the user out.
    val expired = MutableStateFlow(false)
    // Why the server refused the saved sign-in, when it said (another device signed in); null = the usual "sign in again".
    @Volatile var expiredMessage: String? = null
}

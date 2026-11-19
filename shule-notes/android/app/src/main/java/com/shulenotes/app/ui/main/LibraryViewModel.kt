package com.shulenotes.app.ui.main

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.LevelGroup
import com.shulenotes.app.data.Note
import com.shulenotes.app.data.NoteCache
import com.shulenotes.app.data.Subject
import com.shulenotes.app.data.serverMessage
import com.shulenotes.app.ui.components.Notifier
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.io.IOException

fun notifySaved(nowSaved: Boolean) {
    if (nowSaved) Notifier.success("Added to Saved") else Notifier.info("Removed from Saved")
}

// Backs the three main tabs. The whole library is loaded once and filtered
// on the phone, so switching class, subject or typing a search is instant.
class LibraryViewModel : ViewModel() {
    var subjects by mutableStateOf<List<Subject>>(emptyList())
        private set
    var notes by mutableStateOf<List<Note>>(emptyList())
        private set
    var levelGroups by mutableStateOf<List<LevelGroup>>(emptyList())
        private set

    // The class whose notes are shown; null means every class. It starts as
    // the student's own class, and picking another class also saves it.
    var scopeClass by mutableStateOf<String?>(null)
        private set
    private var scopeReady = false

    var selectedSubjectId by mutableStateOf<String?>(null)
        private set
    var query by mutableStateOf("")
        private set
    var isLoading by mutableStateOf(true)
        private set
    var isRefreshing by mutableStateOf(false)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set

    var isDeletingAccount by mutableStateOf(false)
        private set
    var deleteAccountError by mutableStateOf<String?>(null)
        private set

    init { load(initial = true) }

    fun refresh() = load(initial = false)

    private fun load(initial: Boolean) {
        viewModelScope.launch {
            if (initial) isLoading = true else isRefreshing = true
            errorMessage = null
            try {
                val loadedSubjects = ApiClient.service.subjects().subjects ?: emptyList()
                val loadedNotes = ApiClient.service.notes().notes ?: emptyList()
                // The class list failing must not stop the notes from showing.
                val loadedLevels = try { ApiClient.service.levels().groups ?: emptyList() } catch (e: Exception) { levelGroups }
                subjects = loadedSubjects
                notes = loadedNotes
                levelGroups = loadedLevels
                NoteCache.subjects = loadedSubjects
                NoteCache.put(loadedNotes)
                if (!scopeReady) {
                    scopeReady = true
                    scopeClass = ShuleApp.session.classLevel.first().ifBlank { null }
                }
                if (subjectsInScope().none { it.id == selectedSubjectId }) selectedSubjectId = null
            } catch (e: IOException) {
                loadFailed("No connection. Check your internet and try again.")
            } catch (e: Exception) {
                loadFailed(e.serverMessage() ?: "Something went wrong loading your notes.")
            } finally {
                isLoading = false
                isRefreshing = false
            }
        }
    }

    // With nothing on screen the failure fills the screen with a retry button;
    // when notes are already showing, a passing notice is enough.
    private fun loadFailed(message: String) {
        if (notes.isEmpty()) errorMessage = message else Notifier.error(message)
    }

    fun selectSubject(subjectId: String?) { selectedSubjectId = subjectId }

    fun updateQuery(value: String) { query = value }

    // A note with no class, or with a class the list no longer knows (saved
    // before the list existed), is shown to everyone rather than hidden.
    private fun inScope(note: Note): Boolean {
        val scope = scopeClass ?: return true
        val noteClass = note.classLevel
        if (noteClass.isNullOrBlank() || noteClass == scope) return true
        return levelGroups.none { group -> group.levels.any { it.id == noteClass } }
    }

    fun scopedNotes(): List<Note> = notes.filter { inScope(it) }

    // Only subjects that have notes for the class on screen, so no tile leads to an empty page.
    fun subjectsInScope(): List<Subject> {
        val ids = scopedNotes().mapNotNull { it.subjectId }.toSet()
        return subjects.filter { it.id in ids }
    }

    fun visibleNotes(): List<Note> {
        val words = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        return scopedNotes().filter { note ->
            (selectedSubjectId == null || note.subjectId == selectedSubjectId) &&
                words.all { word ->
                    note.title.lowercase().contains(word) ||
                        note.description.orEmpty().lowercase().contains(word) ||
                        note.classLevel.orEmpty().lowercase().contains(word)
                }
        }
    }

    fun selectClass(level: String?) {
        scopeClass = level
        if (subjectsInScope().none { it.id == selectedSubjectId }) selectedSubjectId = null
        if (level == null) return
        viewModelScope.launch {
            ShuleApp.session.setClassLevel(level)
            try {
                ApiClient.service.setClassLevel(mapOf("classLevel" to level))
            } catch (e: Exception) {
                Notifier.error("Your class could not be saved online. Check your internet.")
            }
        }
    }

    fun subjectName(subjectId: String?): String? = subjects.firstOrNull { it.id == subjectId }?.name

    fun toggleSaved(noteId: String) {
        viewModelScope.launch { notifySaved(ShuleApp.session.toggleSaved(noteId)) }
    }

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            // Best effort: the phone forgets the session even if the server cannot be reached.
            try { ApiClient.service.logout() } catch (e: Exception) { }
            ShuleApp.session.clear()
            NoteCache.clear()
            onDone()
        }
    }

    fun clearDeleteAccountError() { deleteAccountError = null }

    fun deleteAccount(password: String, onDone: () -> Unit) {
        if (isDeletingAccount) return
        if (password.isBlank()) {
            deleteAccountError = "Enter your password"
            return
        }
        viewModelScope.launch {
            isDeletingAccount = true
            deleteAccountError = null
            try {
                ApiClient.service.deleteAccount(mapOf("password" to password))
                ShuleApp.session.clear(keepSaved = false)
                NoteCache.clear()
                onDone()
                Notifier.success("Your account has been deleted")
            } catch (e: IOException) {
                deleteAccountError = "No connection. Try again."
            } catch (e: Exception) {
                deleteAccountError = e.serverMessage() ?: "We could not delete the account. Please try again."
            } finally {
                isDeletingAccount = false
            }
        }
    }
}

package com.shulenotes.app.ui.main

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.Note
import com.shulenotes.app.data.NoteCache
import com.shulenotes.app.data.Subject
import com.shulenotes.app.data.serverMessage
import com.shulenotes.app.ui.components.Notifier
import kotlinx.coroutines.launch
import java.io.IOException

fun notifySaved(nowSaved: Boolean) {
    if (nowSaved) Notifier.success("Added to Saved") else Notifier.info("Removed from Saved")
}

// Backs the three main tabs. The whole library is loaded once and filtered
// on the phone, so switching subject or typing a search is instant.
class LibraryViewModel : ViewModel() {
    var subjects by mutableStateOf<List<Subject>>(emptyList())
        private set
    var notes by mutableStateOf<List<Note>>(emptyList())
        private set
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
                subjects = loadedSubjects
                notes = loadedNotes
                NoteCache.subjects = loadedSubjects
                NoteCache.put(loadedNotes)
                if (loadedSubjects.none { it.id == selectedSubjectId }) selectedSubjectId = null
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

    fun visibleNotes(): List<Note> {
        val words = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        return notes.filter { note ->
            (selectedSubjectId == null || note.subjectId == selectedSubjectId) &&
                words.all { word ->
                    note.title.lowercase().contains(word) ||
                        note.description.orEmpty().lowercase().contains(word) ||
                        note.classLevel.orEmpty().lowercase().contains(word)
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
                ShuleApp.session.clear()
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

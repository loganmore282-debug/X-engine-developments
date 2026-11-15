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
import kotlinx.coroutines.launch
import java.io.IOException

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
                errorMessage = "No connection. Check your internet and try again."
            } catch (e: Exception) {
                errorMessage = e.serverMessage() ?: "Something went wrong loading your notes."
            } finally {
                isLoading = false
                isRefreshing = false
            }
        }
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
        viewModelScope.launch { ShuleApp.session.toggleSaved(noteId) }
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
            deleteAccountError = "Enter your password to confirm."
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
            } catch (e: IOException) {
                deleteAccountError = "No connection. Check your internet and try again."
            } catch (e: Exception) {
                deleteAccountError = e.serverMessage() ?: "We could not delete the account. Please try again."
            } finally {
                isDeletingAccount = false
            }
        }
    }
}

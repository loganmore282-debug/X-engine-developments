package com.shulenotes.app.ui.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.Note
import com.shulenotes.app.data.Subject
import kotlinx.coroutines.launch
import java.io.IOException

class HomeViewModel : ViewModel() {
    var subjects by mutableStateOf<List<Subject>>(emptyList())
        private set
    var notes by mutableStateOf<List<Note>>(emptyList())
        private set
    var selectedSubjectId by mutableStateOf<String?>(null)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val subjectsRes = ApiClient.service.subjects()
                subjects = subjectsRes.subjects ?: emptyList()
                loadNotes(selectedSubjectId)
            } catch (e: IOException) {
                errorMessage = "Could not reach the server. Pull down to try again."
            } catch (e: Exception) {
                errorMessage = "Something went wrong loading your notes."
            } finally {
                isLoading = false
            }
        }
    }

    fun selectSubject(subjectId: String?) {
        selectedSubjectId = subjectId
        viewModelScope.launch { loadNotes(subjectId) }
    }

    private suspend fun loadNotes(subjectId: String?) {
        try {
            val res = ApiClient.service.notes(subjectId)
            notes = res.notes ?: emptyList()
        } catch (e: Exception) {
            errorMessage = "Could not load notes."
        }
    }
}

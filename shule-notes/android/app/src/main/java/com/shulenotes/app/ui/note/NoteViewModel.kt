package com.shulenotes.app.ui.note

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.Note
import com.shulenotes.app.data.NoteCache
import com.shulenotes.app.data.serverMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

sealed class PdfLoadState {
    object Loading : PdfLoadState()
    data class Ready(val document: PdfDocument) : PdfLoadState()
    data class Failed(val message: String) : PdfLoadState()
}

private class UnreadablePdfException : Exception()

// AndroidViewModel because the downloaded PDF is kept in the app's cache directory.
class NoteViewModel(application: Application) : AndroidViewModel(application) {
    var note by mutableStateOf<Note?>(null)
        private set
    var pdfState by mutableStateOf<PdfLoadState>(PdfLoadState.Loading)
        private set

    private var loadedNoteId: String? = null

    fun load(noteId: String, retry: Boolean = false) {
        if (!retry && loadedNoteId == noteId) return
        loadedNoteId = noteId
        note = NoteCache.get(noteId)
        pdfState = PdfLoadState.Loading
        viewModelScope.launch {
            if (note == null) {
                // Reached after the app was restored from the background with an empty cache.
                try {
                    note = ApiClient.service.note(noteId).note?.also { NoteCache.put(listOf(it)) }
                } catch (e: Exception) { }
            }
            pdfState = try {
                PdfLoadState.Ready(withContext(Dispatchers.IO) { openPdf(noteId) })
            } catch (e: UnreadablePdfException) {
                PdfLoadState.Failed("This document could not be opened. It may be damaged.")
            } catch (e: IOException) {
                PdfLoadState.Failed("We could not download this document. Check your internet and try again.")
            } catch (e: Exception) {
                PdfLoadState.Failed(e.serverMessage() ?: "We could not open this document. Please try again.")
            }
        }
    }

    // A note's file never changes once uploaded, so a copy already on the
    // phone is reused: reopening a document is instant and works offline.
    private suspend fun openPdf(noteId: String): PdfDocument {
        val dir = File(getApplication<Application>().cacheDir, "notes").apply { mkdirs() }
        val safeId = noteId.filter { it.isLetterOrDigit() }
        val target = File(dir, "$safeId.pdf")
        if (target.length() == 0L) {
            val partial = File(dir, "$safeId.part")
            ApiClient.service.noteFile(noteId).use { body ->
                body.byteStream().use { input ->
                    partial.outputStream().use { output -> input.copyTo(output) }
                }
            }
            if (!partial.renameTo(target)) throw IOException("could not save the document")
        }
        return try {
            PdfDocument(target)
        } catch (e: Exception) {
            target.delete()
            throw UnreadablePdfException()
        }
    }

    override fun onCleared() {
        super.onCleared()
        (pdfState as? PdfLoadState.Ready)?.document?.close()
    }
}

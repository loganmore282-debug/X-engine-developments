package com.shulenotes.app.ui.note

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.Gson
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.data.Note
import com.shulenotes.app.data.NoteCache
import com.shulenotes.app.data.PdfFetcher
import com.shulenotes.app.data.serverMessage
import com.shulenotes.app.ui.components.Notifier
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

    // The text of every page, loaded the first time the student opens search on this note.
    var pages by mutableStateOf<List<String>?>(null)
        private set
    var pagesLoading by mutableStateOf(false)
        private set
    var pagesError by mutableStateOf<String?>(null)
        private set

    private var loadedNoteId: String? = null

    fun load(noteId: String, retry: Boolean = false) {
        if (!retry && loadedNoteId == noteId) return
        loadedNoteId = noteId
        pages = null
        pagesError = null
        note = NoteCache.get(noteId)
        pdfState = PdfLoadState.Loading
        viewModelScope.launch {
            // The note's details (title and so on) are fetched alongside the PDF, never before it.
            if (note == null) {
                launch {
                    try {
                        note = ApiClient.service.note(noteId).note?.also { NoteCache.put(listOf(it)) }
                    } catch (e: Exception) { }
                }
            }
            pdfState = try {
                val document = withContext(Dispatchers.IO) { openPdf(noteId) }
                // The rest of the pages are measured in the background; the first page shows straight away.
                viewModelScope.launch(Dispatchers.IO) { runCatching { document.measureRemaining() } }
                PdfLoadState.Ready(document)
            } catch (e: UnreadablePdfException) {
                PdfLoadState.Failed("This document could not be opened. It may be damaged.")
            } catch (e: IOException) {
                PdfLoadState.Failed("We could not download this document. Check your internet and try again.")
            } catch (e: Exception) {
                PdfLoadState.Failed(e.serverMessage() ?: "We could not open this document. Please try again.")
            }
        }
    }

    // A note's file never changes once uploaded, so a copy already on the phone is reused: reopening a
    // document is instant and works offline. A copy the student downloaded on purpose is tried first; a
    // copy that is already being fetched in the background (see PdfFetcher) is joined, not fetched again.
    private suspend fun openPdf(noteId: String): PdfDocument {
        val downloaded = Downloads.file(noteId)
        if (downloaded.length() > 0L) {
            try {
                return PdfDocument(downloaded)
            } catch (e: Exception) {
                downloaded.delete()
                Downloads.refresh()
            }
        }
        val target = PdfFetcher.ensure(noteId)
        return try {
            PdfDocument(target)
        } catch (e: Exception) {
            target.delete()
            throw UnreadablePdfException()
        }
    }

    // Page text for searching inside the document. Kept on the phone after the first
    // time, so searching a note you have used before works without internet.
    fun loadPages(noteId: String) {
        if (pages != null || pagesLoading) return
        pagesLoading = true
        pagesError = null
        viewModelScope.launch {
            try {
                val file = Downloads.pagesFile(noteId)
                val saved = withContext(Dispatchers.IO) {
                    if (file.length() > 0L) runCatching { Gson().fromJson(file.readText(), Array<String>::class.java).toList() }.getOrNull() else null
                }
                if (saved != null) {
                    pages = saved
                } else {
                    val fetched = ApiClient.service.notePages(noteId).pages ?: emptyList()
                    withContext(Dispatchers.IO) { runCatching { file.writeText(Gson().toJson(fetched)) } }
                    pages = fetched
                }
            } catch (e: IOException) {
                pagesError = "Searching a note needs internet the first time. Check your connection and try again."
            } catch (e: Exception) {
                pagesError = e.serverMessage() ?: "Search is not available for this document."
            } finally {
                pagesLoading = false
            }
        }
    }

    // Keep this note for offline reading, or remove it from the phone again.
    fun toggleDownload(noteId: String) {
        viewModelScope.launch {
            if (Downloads.has(noteId)) {
                withContext(Dispatchers.IO) { Downloads.remove(noteId) }
                Notifier.info("Removed from downloads")
            } else {
                val cached = PdfFetcher.cacheFile(noteId)
                if (cached.length() > 0L) {
                    try {
                        withContext(Dispatchers.IO) { Downloads.save(noteId, cached) }
                        Notifier.success("Saved for offline reading")
                    } catch (e: Exception) {
                        Notifier.error("Could not save this document. Is the phone's storage full?")
                    }
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        (pdfState as? PdfLoadState.Ready)?.document?.close()
    }
}

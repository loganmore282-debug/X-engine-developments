package com.shulenotes.app.ui.note

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.data.ApiClient
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

// AndroidViewModel, not a plain ViewModel -- downloading and caching the PDF
// needs the app's own cache directory.
class NoteViewModel(application: Application) : AndroidViewModel(application) {
    var pdfState by mutableStateOf<PdfLoadState>(PdfLoadState.Loading)
        private set

    private var loadedNoteId: String? = null

    fun loadNote(noteId: String) {
        if (loadedNoteId == noteId && pdfState is PdfLoadState.Ready) return
        loadedNoteId = noteId
        pdfState = PdfLoadState.Loading
        viewModelScope.launch {
            try {
                val cacheFile = File(getApplication<Application>().cacheDir, "note-$noteId.pdf")
                withContext(Dispatchers.IO) {
                    val body = ApiClient.service.noteFile(noteId)
                    body.byteStream().use { input ->
                        cacheFile.outputStream().use { output -> input.copyTo(output) }
                    }
                }
                val document = withContext(Dispatchers.IO) { PdfDocument(cacheFile) }
                pdfState = PdfLoadState.Ready(document)
            } catch (e: IOException) {
                pdfState = PdfLoadState.Failed("Could not download this document. Check your connection.")
            } catch (e: Exception) {
                pdfState = PdfLoadState.Failed("Could not open this document.")
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        (pdfState as? PdfLoadState.Ready)?.document?.close()
    }
}

package com.shulenotes.app.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File

// Notes the student chose to keep for offline reading. Unlike the cache (which the
// phone may clear when it needs space), these live in the app's own files folder
// until the student removes them. A note's file never changes once uploaded, so a
// downloaded copy never goes out of date.
object Downloads {
    private var dir: File? = null
    private val _ids = MutableStateFlow<Set<String>>(emptySet())

    // The ids of every downloaded note, so any screen can show a "downloaded" mark.
    val ids: StateFlow<Set<String>> = _ids

    fun init(context: Context) {
        dir = File(context.filesDir, "downloads").apply { mkdirs() }
        refresh()
    }

    private fun folder(): File = dir ?: throw IllegalStateException("Downloads.init was not called")

    private fun safe(id: String) = id.filter { it.isLetterOrDigit() }

    fun file(noteId: String): File = File(folder(), safe(noteId) + ".pdf")

    fun has(noteId: String): Boolean = file(noteId).length() > 0L

    fun refresh() {
        _ids.value = folder().listFiles()
            ?.filter { it.extension == "pdf" && it.length() > 0L }
            ?.map { it.nameWithoutExtension }
            ?.toSet()
            ?: emptySet()
    }

    // Copies an already-downloaded PDF in, so nothing is fetched twice.
    fun save(noteId: String, source: File) {
        val target = file(noteId)
        val partial = File(folder(), safe(noteId) + ".part")
        source.copyTo(partial, overwrite = true)
        if (!partial.renameTo(target)) {
            partial.copyTo(target, overwrite = true)
            partial.delete()
        }
        refresh()
    }

    fun remove(noteId: String) {
        file(noteId).delete()
        refresh()
    }

    fun clearAll() {
        folder().listFiles()?.forEach { it.delete() }
        refresh()
    }
}

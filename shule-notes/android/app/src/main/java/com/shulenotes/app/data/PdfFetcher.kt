package com.shulenotes.app.data

import android.content.Context
import android.net.ConnectivityManager
import com.shulenotes.app.ShuleApp
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException

// Gets a note's PDF onto the phone, once. Opening a note and an early "prefetch" share the same download,
// so a document that is already on its way is joined, never fetched twice, and the download carries on even
// if the student leaves the screen. A copy that is already on the phone is used at once.
object PdfFetcher {
    private val lock = Any()
    private val running = HashMap<String, Deferred<File>>()
    private var purged = false

    // Copies from before every PDF carried the owner's footer have no ".s1" in their name: dropped once.
    fun cacheFile(noteId: String): File {
        val dir = File(ShuleApp.appContext.cacheDir, "notes").apply { mkdirs() }
        if (!purged) {
            purged = true
            dir.listFiles()?.filter { it.extension == "pdf" && !it.name.endsWith(".s1.pdf") }?.forEach { it.delete() }
        }
        return File(dir, noteId.filter { it.isLetterOrDigit() } + ".s1.pdf")
    }

    fun isOnPhone(noteId: String): Boolean = Downloads.has(noteId) || cacheFile(noteId).length() > 0L

    suspend fun ensure(noteId: String): File {
        val target = cacheFile(noteId)
        if (target.length() > 0L) return target
        val job = synchronized(lock) {
            running.getOrPut(noteId) {
                ShuleApp.appScope.async { download(noteId, target) }.also { d ->
                    d.invokeOnCompletion { synchronized(lock) { running.remove(noteId) } }
                }
            }
        }
        return job.await()
    }

    private suspend fun download(noteId: String, target: File): File {
        val partial = File(target.parentFile, target.nameWithoutExtension + ".part")
        try {
            ApiClient.service.noteFile(noteId).use { body ->
                body.byteStream().use { input -> partial.outputStream().use { output -> input.copyTo(output, 64 * 1024) } }
            }
            if (!partial.renameTo(target)) throw IOException("could not save the document")
            return target
        } catch (e: Exception) {
            partial.delete()
            throw e
        }
    }

    // Starts fetching in the background (nothing waits for it). Used for the note a student is most likely to open next.
    fun prefetch(noteId: String) {
        if (isOnPhone(noteId)) return
        ShuleApp.appScope.launch { runCatching { ensure(noteId) } }
    }

    // Only on Wi-Fi or other free connections, and only for small files: mobile data costs students money.
    fun prefetchIfFree(noteId: String, sizeBytes: Long) {
        if (sizeBytes <= 0L || sizeBytes > 6L * 1024 * 1024) return
        val cm = ShuleApp.appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        if (cm.isActiveNetworkMetered) return
        prefetch(noteId)
    }
}

package com.shulenotes.app.ui.note

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.LruCache
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import java.io.File

// Wraps the platform's own PdfRenderer, so the app needs no third-party PDF
// library. PdfRenderer allows only ONE open page at a time and is not
// thread-safe, so every use of it here is @Synchronized.
class PdfDocument(file: File) {
    private val fileDescriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer = PdfRenderer(fileDescriptor)
    private var closed = false

    val pageCount: Int = renderer.pageCount

    // Width divided by height for each page, so the reader can lay the pages out at their final size before
    // they are drawn. Only the FIRST page is measured before the document opens (a 200 page file used to be
    // read page by page up front, which was seconds of waiting): the others start with its shape and are
    // measured in the background by measureRemaining(), which is almost always unchanged.
    val aspectRatios: FloatArray = FloatArray(pageCount) { 0.707f }
    // Changes whenever a measured page turned out to have a different shape, so the layout updates.
    var layoutVersion by mutableIntStateOf(0)
        private set

    init {
        if (pageCount > 0) {
            val first = measure(0)
            aspectRatios.fill(first)
        }
    }

    @Synchronized
    private fun measure(index: Int): Float {
        if (closed) return 0.707f
        val page = renderer.openPage(index)
        try {
            return if (page.height > 0) page.width.toFloat() / page.height else 0.707f
        } finally {
            page.close()
        }
    }

    // Run on a background thread right after the document opens.
    fun measureRemaining() {
        var changed = false
        for (i in 1 until pageCount) {
            if (closed) return
            val ratio = measure(i) // takes the lock for one page only, so drawing is never held up for long
            if (kotlin.math.abs(ratio - aspectRatios[i]) > 0.003f) { aspectRatios[i] = ratio; changed = true }
            if (changed && i % 12 == 0) { layoutVersion++; changed = false }
        }
        if (changed) layoutVersion++
    }

    // Pages already drawn at a given width are kept (up to about 28 MB), so scrolling back is instant.
    private val drawn = object : LruCache<String, Bitmap>(28 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }

    fun cachedPage(index: Int, widthPx: Int): Bitmap? = drawn.get("$index:$widthPx")

    // Null once the document has been closed (the reader was left mid-render).
    @Synchronized
    fun renderPage(index: Int, widthPx: Int, keep: Boolean = true): Bitmap? {
        if (closed) return null
        val key = "$index:$widthPx"
        if (keep) drawn.get(key)?.let { return it }
        val page = renderer.openPage(index)
        try {
            val safeWidth = widthPx.coerceAtLeast(1)
            val heightPx = (safeWidth.toFloat() / page.width * page.height).toInt().coerceAtLeast(1)
            val bitmap = Bitmap.createBitmap(safeWidth, heightPx, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            if (keep) drawn.put(key, bitmap)
            return bitmap
        } finally {
            page.close()
        }
    }

    @Synchronized
    fun close() {
        if (closed) return
        closed = true
        drawn.evictAll()
        renderer.close()
        fileDescriptor.close()
    }
}

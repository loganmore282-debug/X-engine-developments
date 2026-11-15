package com.shulenotes.app.ui.note

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File

// Wraps the platform's own PdfRenderer, so the app needs no third-party PDF
// library. PdfRenderer allows only ONE open page at a time and is not
// thread-safe, so every use of it here is @Synchronized.
class PdfDocument(file: File) {
    private val fileDescriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer = PdfRenderer(fileDescriptor)
    private var closed = false

    val pageCount: Int = renderer.pageCount

    // Width divided by height for each page, read once up front so the reader
    // can lay every page out at its final size before it has been drawn.
    val aspectRatios: FloatArray = FloatArray(pageCount) { index ->
        val page = renderer.openPage(index)
        try {
            if (page.height > 0) page.width.toFloat() / page.height else 0.707f
        } finally {
            page.close()
        }
    }

    // Null once the document has been closed (the reader was left mid-render).
    @Synchronized
    fun renderPage(index: Int, widthPx: Int): Bitmap? {
        if (closed) return null
        val page = renderer.openPage(index)
        try {
            val safeWidth = widthPx.coerceAtLeast(1)
            val heightPx = (safeWidth.toFloat() / page.width * page.height).toInt().coerceAtLeast(1)
            val bitmap = Bitmap.createBitmap(safeWidth, heightPx, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            return bitmap
        } finally {
            page.close()
        }
    }

    @Synchronized
    fun close() {
        if (closed) return
        closed = true
        renderer.close()
        fileDescriptor.close()
    }
}

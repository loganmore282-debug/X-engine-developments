package com.shulenotes.app.ui.note

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File

// Wraps the platform's own PdfRenderer (API 21+) -- no third-party PDF
// library, which keeps the APK smaller and avoids depending on an AAR whose
// exact current Maven coordinates this environment cannot verify.
//
// PdfRenderer only lets ONE page be open at a time and is not safe to call
// concurrently from multiple threads -- @Synchronized serializes renderPage()
// calls, which is enough here since the UI only ever renders one visible
// page at a time anyway.
class PdfDocument(file: File) {
    private val fileDescriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer = PdfRenderer(fileDescriptor)

    val pageCount: Int get() = renderer.pageCount

    @Synchronized
    fun renderPage(index: Int, widthPx: Int): Bitmap {
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

    fun close() {
        renderer.close()
        fileDescriptor.close()
    }
}

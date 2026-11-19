package com.shulenotes.app.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import kotlin.math.min

// Turns whatever picture the student picked into a small square JPEG (512 pixels, about 50 KB),
// the right way up. Phone photos are often stored sideways with a "rotate me" note, which is honoured here.
object AvatarImage {
    private const val SIDE = 512

    fun prepare(context: Context, uri: Uri): ByteArray? = try {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            null
        } else {
            var sample = 1
            while (min(bounds.outWidth, bounds.outHeight) / (sample * 2) >= SIDE) sample *= 2
            val decoded = resolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
            }
            if (decoded == null) {
                null
            } else {
                val orientation = resolver.openInputStream(uri)?.use {
                    ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
                } ?: ExifInterface.ORIENTATION_NORMAL
                val upright = rotate(decoded, orientation)
                val edge = min(upright.width, upright.height)
                val square = Bitmap.createBitmap(upright, (upright.width - edge) / 2, (upright.height - edge) / 2, edge, edge)
                val final = Bitmap.createScaledBitmap(square, SIDE, SIDE, true)
                ByteArrayOutputStream().use { out ->
                    final.compress(Bitmap.CompressFormat.JPEG, 85, out)
                    out.toByteArray()
                }
            }
        }
    } catch (e: Exception) {
        null
    }

    private fun rotate(bitmap: Bitmap, orientation: Int): Bitmap {
        val m = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, m, true)
    }
}

package com.shulenotes.app

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest

// Checks that this copy of the app was signed with the owner's key. Anyone who edits the app (to remove
// a limit, or change what it does) has to sign it again with a key of their own, and then this check fails.
// It is a speed bump, not a wall: the real protection is that the SERVER decides everything that matters
// (who is signed in, how many AI questions, and later who has paid), so an edited app gains nothing.
object Integrity {
    // False only when a signing key is required (release builds) and this copy was signed by another one.
    fun signatureOk(context: Context): Boolean {
        val expected = BuildConfig.EXPECTED_CERT_SHA256.lowercase().replace(":", "").trim()
        if (expected.isEmpty()) return true
        return try {
            signers(context).any { sha256Hex(it) == expected }
        } catch (e: Exception) {
            false
        }
    }

    @Suppress("DEPRECATION")
    private fun signers(context: Context): List<ByteArray> {
        val pm = context.packageManager
        return if (Build.VERSION.SDK_INT >= 28) {
            val info = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo
            info?.apkContentsSigners?.map { it.toByteArray() } ?: emptyList()
        } else {
            pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures?.map { it.toByteArray() } ?: emptyList()
        }
    }

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}

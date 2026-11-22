package com.shulenotes.app.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.shulenotes.app.ShuleApp
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

// Whether the owner has switched payments on, and until when THIS student has a pass. The server is what
// really decides (it answers 402 for a locked document); this only decides what the app shows. It is kept
// on the phone so a locked document stays locked offline too.
object AccessHolder {
    private val prefs get() = ShuleApp.appContext.getSharedPreferences("access", Context.MODE_PRIVATE)

    var enabled by mutableStateOf(false)
        private set
    var untilMs by mutableStateOf(0L)
        private set
    // The server's clock minus the phone's, so a wrong phone clock cannot unlock anything on screen.
    private var offsetMs = 0L

    init {
        enabled = prefs.getBoolean("enabled", false)
        untilMs = prefs.getLong("until", 0L)
        offsetMs = prefs.getLong("offset", 0L)
    }

    val active: Boolean get() = untilMs > System.currentTimeMillis() + offsetMs

    // True when this document cannot be opened with the student's current pass.
    fun locked(free: Boolean): Boolean = enabled && !active && !free

    suspend fun refresh() {
        try {
            update(ApiClient.service.plans())
        } catch (e: Exception) {
            // keep what we have
        }
    }

    fun update(r: PlansResponse) {
        enabled = r.enabled
        untilMs = parseIso(r.accessUntil)
        val server = parseIso(r.serverTime)
        offsetMs = if (server > 0L) server - System.currentTimeMillis() else 0L
        save()
    }

    fun applyUntil(iso: String?) {
        val t = parseIso(iso)
        if (t > untilMs) untilMs = t
        save()
    }

    fun clear() {
        enabled = false
        untilMs = 0L
        offsetMs = 0L
        save()
    }

    private fun save() {
        prefs.edit().putBoolean("enabled", enabled).putLong("until", untilMs).putLong("offset", offsetMs).apply()
    }

    // The server writes dates like 2026-11-20T10:00:00.000Z.
    fun parseIso(value: String?): Long {
        if (value.isNullOrBlank()) return 0L
        return try {
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(value)?.time ?: 0L
        } catch (e: Exception) {
            0L
        }
    }
}

package com.shulenotes.app.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.shulenotes.app.ShuleApp
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

// Whether the owner has switched payments on, and which passes THIS student holds. A pass opens ONE class
// (the owner's rule): an S.4 pass opens S.4 notes and notes for all classes, not S.5. The server is what really
// decides (it answers 402 for a locked document); this only decides what the app shows. Kept on the phone so a
// locked document stays locked offline too.
object AccessHolder {
    private val prefs get() = ShuleApp.appContext.getSharedPreferences("access", Context.MODE_PRIVATE)

    var enabled by mutableStateOf(false)
        private set
    // class -> end of its pass (ms). The key "" is an old pass that opens every class.
    var passes by mutableStateOf<Map<String, Long>>(emptyMap())
        private set
    // The class on Home (the student's own, or the one they switched to): the pass card and Profile speak about it.
    var homeClass by mutableStateOf<String?>(null)
    // Every class in the list: a note whose class is not one of them counts as "all classes" (as on the server).
    var knownLevels: Set<String> = emptySet()
    // The server's clock minus the phone's, so a wrong phone clock cannot unlock anything on screen.
    private var offsetMs = 0L

    init {
        enabled = prefs.getBoolean("enabled", false)
        passes = decode(prefs.getString("passes", "") ?: "")
        // A phone that saved the old single date keeps it until the server answers again.
        val legacy = prefs.getLong("until", 0L)
        if (passes.isEmpty() && legacy > 0L) passes = mapOf("" to legacy)
        offsetMs = prefs.getLong("offset", 0L)
    }

    private fun now() = System.currentTimeMillis() + offsetMs

    // When the pass that opens this class ends (0 = none). A blank class: the latest of any pass.
    fun untilFor(classLevel: String?): Long {
        val all = passes[""] ?: 0L
        if (classLevel.isNullOrBlank()) return passes.values.maxOrNull() ?: 0L
        return maxOf(all, passes[classLevel] ?: 0L)
    }

    // The pass for the class on Home.
    val untilMs: Long get() = untilFor(homeClass)
    val active: Boolean get() = untilMs > now()

    // True when this document cannot be opened with the student's passes.
    fun locked(free: Boolean, noteClass: String? = null): Boolean {
        if (!enabled || free) return false
        val level = noteClass?.takeIf { it.isNotBlank() && (knownLevels.isEmpty() || it in knownLevels) }
        return untilFor(level) <= now()
    }

    suspend fun refresh() {
        try {
            update(ApiClient.service.plans(homeClass))
        } catch (e: Exception) {
            // keep what we have
        }
    }

    fun update(r: PlansResponse) {
        enabled = r.enabled
        val list = r.passes
        passes = if (list != null) {
            list.associate { (it.classLevel ?: "") to parseIso(it.until) }.filterValues { it > 0L }
        } else {
            // An older server: one date for everything.
            parseIso(r.accessUntil).let { if (it > 0L) mapOf("" to it) else emptyMap() }
        }
        val server = parseIso(r.serverTime)
        offsetMs = if (server > 0L) server - System.currentTimeMillis() else 0L
        save()
    }

    // Straight after a payment, before the full refresh arrives.
    fun applyUntil(iso: String?, classLevel: String? = homeClass) {
        val t = parseIso(iso)
        val key = classLevel ?: ""
        if (t > (passes[key] ?: 0L)) passes = passes + (key to t)
        save()
    }

    fun clear() {
        enabled = false
        passes = emptyMap()
        offsetMs = 0L
        save()
    }

    private fun save() {
        prefs.edit().putBoolean("enabled", enabled).putString("passes", encode(passes)).remove("until").putLong("offset", offsetMs).apply()
    }

    // "Senior 4=1795400000000;=1795000000000" (class names never contain ';' or '=').
    private fun encode(m: Map<String, Long>) = m.entries.joinToString(";") { "${it.key}=${it.value}" }
    private fun decode(s: String): Map<String, Long> = s.split(';').mapNotNull { part ->
        val i = part.lastIndexOf('=')
        if (i < 0) null else part.substring(i + 1).toLongOrNull()?.let { part.substring(0, i) to it }
    }.toMap()

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

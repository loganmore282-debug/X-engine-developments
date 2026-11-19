package com.shulenotes.app.ui.components

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// The server sends times like 2026-11-19T09:11:58.578Z.
fun parseIsoMillis(value: String?): Long {
    if (value.isNullOrBlank()) return 0L
    for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
        try {
            val format = SimpleDateFormat(pattern, Locale.US)
            format.timeZone = TimeZone.getTimeZone("UTC")
            val parsed = format.parse(value)
            if (parsed != null) return parsed.time
        } catch (e: Exception) {
            // try the next pattern
        }
    }
    return 0L
}

// "Just now", "5 min ago", "2 hours ago", "Yesterday", "3 days ago", then a plain date.
fun timeAgo(millis: Long, now: Long = System.currentTimeMillis()): String {
    if (millis <= 0L) return ""
    val diff = (now - millis).coerceAtLeast(0L)
    val minute = 60_000L
    val hour = 60 * minute
    val day = 24 * hour
    return when {
        diff < minute -> "Just now"
        diff < hour -> "${diff / minute} min ago"
        diff < day -> if (diff / hour == 1L) "1 hour ago" else "${diff / hour} hours ago"
        diff < 2 * day -> "Yesterday"
        diff < 7 * day -> "${diff / day} days ago"
        else -> SimpleDateFormat("d MMM yyyy", Locale.getDefault()).format(Date(millis))
    }
}

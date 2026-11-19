package com.shulenotes.app.ui.note

// One page of a document that contains what the student searched for.
data class SearchHit(val page: Int, val snippet: String, val matches: Int)

private val spaces = Regex("\\s+")

// The words as they are compared: trimmed, single-spaced, lower case. The highlighting uses the same.
fun searchNeedle(query: String): String = query.trim().replace(spaces, " ").lowercase()

// Finds the pages (1-based) that contain `query`, in page order, each with a short
// piece of the surrounding text. Needs at least two letters so a single keystroke
// does not match half the document.
fun searchPages(pages: List<String>, query: String, limit: Int = 60): List<SearchHit> {
    val needle = searchNeedle(query)
    if (needle.length < 2) return emptyList()
    val hits = ArrayList<SearchHit>()
    for ((index, raw) in pages.withIndex()) {
        val text = raw.replace(spaces, " ")
        val lower = text.lowercase()
        val first = lower.indexOf(needle)
        if (first < 0) continue
        var count = 0
        var from = first
        while (from >= 0) {
            count++
            from = lower.indexOf(needle, from + needle.length)
        }
        val start = (first - 40).coerceAtLeast(0)
        val end = (first + needle.length + 70).coerceAtMost(text.length)
        val snippet = (if (start > 0) "\u2026" else "") + text.substring(start, end).trim() + (if (end < text.length) "\u2026" else "")
        hits.add(SearchHit(index + 1, snippet, count))
        if (hits.size >= limit) break
    }
    return hits
}

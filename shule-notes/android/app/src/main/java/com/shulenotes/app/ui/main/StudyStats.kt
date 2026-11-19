package com.shulenotes.app.ui.main

import com.shulenotes.app.data.Note
import com.shulenotes.app.data.dayKey
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

// One bar of the weekly chart.
data class DayCount(val label: String, val pages: Int, val isToday: Boolean)

data class StudyStats(
    val streak: Int,
    val pagesToday: Int,
    val pagesThisWeek: Int,
    val notesOpened: Int,
    val notesFinished: Int,
    val subjectsStudied: Int,
    val week: List<DayCount>,
)

// Works out the "My progress" numbers from what the phone recorded:
// entries are "day|noteId|page", finished is the ids of notes read to the last page.
fun computeStudyStats(entries: Set<String>, finished: Set<String>, notes: List<Note>, now: Long = System.currentTimeMillis()): StudyStats {
    val pagesByDay = HashMap<String, Int>()
    val openedIds = HashSet<String>()
    for (entry in entries) {
        val parts = entry.split('|')
        if (parts.size < 3) continue
        pagesByDay[parts[0]] = (pagesByDay[parts[0]] ?: 0) + 1
        openedIds.add(parts[1])
    }
    openedIds.addAll(finished)

    val dayMillis = 24L * 60 * 60 * 1000
    fun keyFor(daysAgo: Int) = dayKey(now - daysAgo * dayMillis)

    // The last seven days, oldest first, ending today.
    val weekdayFormat = SimpleDateFormat("EEE", Locale.getDefault())
    val week = (6 downTo 0).map { ago ->
        val at = now - ago * dayMillis
        DayCount(
            label = weekdayFormat.format(Date(at)).take(3),
            pages = pagesByDay[dayKey(at)] ?: 0,
            isToday = ago == 0,
        )
    }

    // Days in a row with some reading, counting back from today (or from yesterday if
    // today has none yet, so a streak is not lost before the student opens the app).
    var streak = 0
    var ago = if ((pagesByDay[keyFor(0)] ?: 0) > 0) 0 else 1
    while ((pagesByDay[keyFor(ago)] ?: 0) > 0) {
        streak++
        ago++
    }

    val subjects = notes.filter { it.id in openedIds }.mapNotNull { it.subjectId }.toSet()
    return StudyStats(
        streak = streak,
        pagesToday = pagesByDay[keyFor(0)] ?: 0,
        pagesThisWeek = week.sumOf { it.pages },
        notesOpened = openedIds.size,
        notesFinished = finished.size,
        subjectsStudied = subjects.size,
        week = week,
    )
}

package com.shulenotes.app.data

import java.util.concurrent.ConcurrentHashMap

// What the library screen last loaded, so the reader and chat screens can
// show a note's title and subject immediately instead of refetching them.
object NoteCache {
    private val notes = ConcurrentHashMap<String, Note>()

    @Volatile var subjects: List<Subject> = emptyList()

    fun put(list: List<Note>) = list.forEach { notes[it.id] = it }

    fun get(id: String): Note? = notes[id]

    fun subjectName(subjectId: String?): String? =
        if (subjectId == null) null else subjects.firstOrNull { it.id == subjectId }?.name

    fun clear() {
        notes.clear()
        subjects = emptyList()
    }
}

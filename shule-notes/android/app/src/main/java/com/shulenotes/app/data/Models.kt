package com.shulenotes.app.data

// Mirrors server.js's JSON shapes exactly -- field names here must match the
// backend's publicUser()/publicNote() output, or Gson silently leaves a
// field null instead of failing loudly.

data class User(
    val id: String,
    val name: String,
    val phone: String?,
    val email: String?,
)

data class AuthResponse(
    val status: String,
    val token: String?,
    val user: User?,
    val message: String?,
)

data class SimpleResponse(
    val status: String,
    val message: String?,
)

data class Subject(
    val id: String,
    val name: String,
    val classLevel: String?,
)

data class SubjectsResponse(
    val status: String,
    val subjects: List<Subject>?,
    val message: String?,
)

data class Note(
    val id: String,
    val subjectId: String?,
    val title: String,
    val description: String?,
    val classLevel: String?,
    val pageCount: Int,
    val fileSize: Long,
    val uploadedAt: String?,
    val hasAiContext: Boolean,
)

data class NotesResponse(
    val status: String,
    val notes: List<Note>?,
    val message: String?,
)

data class NoteResponse(
    val status: String,
    val note: Note?,
    val message: String?,
)

// role is "user" or "assistant" -- sent back to the server verbatim as the
// chat's own history, so the AI remembers earlier turns about this document.
data class ChatTurn(
    val role: String,
    val content: String,
)

data class AskRequest(
    val noteId: String,
    val question: String,
    val history: List<ChatTurn>,
)

data class AskResponse(
    val status: String,
    val answer: String?,
    val message: String?,
)

package com.shulenotes.app.data

// Mirrors server.js's JSON shapes exactly -- field names here must match the
// backend's publicUser()/publicNote() output, or Gson silently leaves a
// field null instead of failing loudly.

data class User(
    val id: String,
    val name: String,
    val phone: String?,
    val classLevel: String?,
)

data class UserResponse(
    val status: String,
    val user: User?,
    val message: String?,
)

data class Level(
    val id: String,
    val name: String,
    val short: String,
)

data class LevelGroup(
    val id: String,
    val name: String,
    val levels: List<Level>,
)

data class LevelsResponse(
    val status: String,
    val groups: List<LevelGroup>?,
    val message: String?,
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

// What the owner sets in the admin panel: whether the AI helper is on, and
// how to reach support. Every field has a default so a failed load leaves the app usable.
data class AppConfig(
    val aiEnabled: Boolean = true,
    val supportPhone: String = "",
    val supportWhatsapp: String = "",
    val supportEmail: String = "",
    val supportHours: String = "",
) {
    val hasSupport: Boolean get() = supportPhone.isNotBlank() || supportWhatsapp.isNotBlank() || supportEmail.isNotBlank()
}

data class ConfigResponse(
    val status: String,
    val config: AppConfig?,
    val message: String?,
)

data class Announcement(
    val id: String,
    val title: String,
    val message: String,
)

data class AnnouncementResponse(
    val status: String,
    val announcement: Announcement?,
    val message: String?,
)

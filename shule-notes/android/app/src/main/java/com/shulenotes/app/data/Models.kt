package com.shulenotes.app.data

// Mirrors server.js's JSON shapes exactly -- field names here must match the
// backend's publicUser()/publicNote() output, or Gson silently leaves a
// field null instead of failing loudly.

data class User(
    val id: String,
    val name: String,
    val phone: String?,
    val classLevel: String?,
    // 0 or missing: no photo. Changes whenever the photo does, so the phone knows to fetch it again.
    val avatarVersion: Long? = null,
)

data class SyncResponse(val status: String, val revision: Long = 0L)

data class Slide(val id: String, val title: String, val text: String, val imageUrl: String?)

// `configured` is false until the owner makes a first slide: then the app shows its own introduction.
data class SlidesResponse(val status: String, val configured: Boolean = false, val slides: List<Slide> = emptyList())

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
    // "notes" or "past-paper"; absent from servers older than this feature.
    val kind: String? = null,
    // How many times students opened it (for the "Most read" order).
    val views: Int = 0,
    val pageCount: Int,
    val fileSize: Long,
    val uploadedAt: String?,
    val hasAiContext: Boolean,
    // Free to read with no pass (the owner marked it as a sample).
    val free: Boolean = false,
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
    // The newest and the oldest allowed app version numbers (0 = none), and where Update goes.
    val latestVersion: Int = 0,
    val minVersion: Int = 0,
    val updateUrl: String = "",
    val updateNote: String = "",
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
    val createdAt: String? = null,
    // "security" for the student's own sign-in alerts (GET /notices); null for the owner's announcements.
    val kind: String? = null,
    // A sign-in alert caused by THIS phone: shown as "This device" and never counted as unread.
    val own: Boolean = false,
) {
    val isSecurity: Boolean get() = kind == "security"
}

data class NoticesResponse(
    val status: String,
    val notices: List<Announcement>?,
    val message: String?,
)

// One row of Profile > Payment history.
data class PaymentRecord(
    val id: String,
    val planName: String?,
    val classLevel: String? = null,
    val amount: Long = 0,
    val gift: Boolean = false,
    val status: String?,
    val createdAt: String?,
    val accessUntil: String?,
    val phone: String?,
)

data class PaymentHistoryResponse(
    val status: String,
    val payments: List<PaymentRecord>?,
    val message: String?,
)

data class AnnouncementsResponse(
    val status: String,
    val announcements: List<Announcement>?,
    val message: String?,
)

data class AnnouncementResponse(
    val status: String,
    val announcement: Announcement?,
    val message: String?,
)

// The last library the phone downloaded. Kept on the phone so Home shows
// straight away on the next launch, while a fresh copy loads in the background.
data class LibrarySnapshot(
    val subjects: List<Subject>,
    val notes: List<Note>,
    val levelGroups: List<LevelGroup>,
)

// The text of every page of a note (index 0 is page 1), for searching inside a document.
data class PagesResponse(
    val status: String,
    val pages: List<String>?,
    val message: String?,
)

// ── Passes and payments (MarzPay mobile money) ──
data class Plan(val id: String, val name: String, val price: Int, val minutes: Int)

// One live pass: the class it opens (null = every class) and when it ends.
data class PassInfo(val classLevel: String?, val until: String?)

data class PlansResponse(
    val status: String,
    val enabled: Boolean = false,
    val plans: List<Plan>? = null,
    // The class the answer is about (the one asked for, or the student's own).
    val classLevel: String? = null,
    val passes: List<PassInfo>? = null,
    val accessUntil: String? = null,
    val hasAccess: Boolean = false,
    val serverTime: String? = null,
    val phone: String? = null,
    val message: String? = null,
)

data class PaymentInfo(
    val classLevel: String? = null,
    val id: String,
    val status: String,
    val planName: String? = null,
    val amount: Int = 0,
    val message: String? = null,
    val accessUntil: String? = null,
)

data class PaymentResponse(
    val status: String,
    val payment: PaymentInfo?,
    val message: String?,
)

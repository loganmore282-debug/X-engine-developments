package com.shulenotes.app.ui.main

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.Announcement
import com.google.gson.Gson
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.data.LevelGroup
import com.shulenotes.app.data.LibrarySnapshot
import com.shulenotes.app.data.Note
import com.shulenotes.app.data.NoteCache
import com.shulenotes.app.data.Subject
import com.shulenotes.app.data.serverMessage
import com.shulenotes.app.ui.components.AppConfigHolder
import com.shulenotes.app.ui.components.Notifier
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import com.shulenotes.app.data.AvatarImage
import java.io.IOException

// How the list on Home is ordered.
enum class SortOrder(val label: String) {
    NEWEST("Newest"),
    MOST_READ("Most read"),
    A_TO_Z("A to Z"),
}

fun notifySaved(nowSaved: Boolean) {
    if (nowSaved) Notifier.success("Added to Saved") else Notifier.info("Removed from Saved")
}

// Backs the three main tabs. The whole library is loaded once and filtered
// on the phone, so switching class, subject or typing a search is instant.
class LibraryViewModel : ViewModel() {
    var subjects by mutableStateOf<List<Subject>>(emptyList())
        private set
    var notes by mutableStateOf<List<Note>>(emptyList())
        private set
    var levelGroups by mutableStateOf<List<LevelGroup>>(emptyList())
        private set

    // The class whose notes are shown; null means every class. It starts as
    // the student's own class, and picking another class also saves it.
    var scopeClass by mutableStateOf<String?>(null)
        private set
    private var scopeReady = false

    var selectedSubjectId by mutableStateOf<String?>(null)
        private set

    var sortOrder by mutableStateOf(SortOrder.NEWEST)
        private set

    // null shows everything; "notes" or "past-paper" narrows the list.
    var kindFilter by mutableStateOf<String?>(null)
        private set
    var query by mutableStateOf("")
        private set
    var isLoading by mutableStateOf(true)
        private set
    var isRefreshing by mutableStateOf(false)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set

    // The owner's message, shown on Home until the student closes it.
    var announcement by mutableStateOf<Announcement?>(null)
        private set

    // Everything in the bell's inbox: the owner's live announcements, newest first.
    var notifications by mutableStateOf<List<Announcement>>(emptyList())
        private set

    // Notes whose entrance animation has already played this session (so scrolling back never replays it).
    val animatedIds = mutableSetOf<String>()

    var isSavingAvatar by mutableStateOf(false)
        private set
    var isSendingFeedback by mutableStateOf(false)
        private set
    var feedbackError by mutableStateOf<String?>(null)
        private set

    var isSavingProfile by mutableStateOf(false)
        private set
    var profileError by mutableStateOf<String?>(null)
        private set

    var isDeletingAccount by mutableStateOf(false)
        private set
    var deleteAccountError by mutableStateOf<String?>(null)
        private set

    init {
        viewModelScope.launch {
            // Show the library from the last visit at once; the fresh copy replaces it a moment later.
            val hadCache = restoreCached()
            load(initial = !hadCache, silent = hadCache)
        }
    }

    fun refresh() = load(initial = false)

    // The owner's last change, as the server numbers it. A different number means something was added,
    // edited, hidden or deleted in the admin panel, so the library is reloaded quietly (no spinner, no error).
    private var lastRevision = -1L
    suspend fun checkForChanges() {
        val now = try { ApiClient.service.sync().revision } catch (e: Exception) { return }
        val changed = lastRevision >= 0 && now != lastRevision
        lastRevision = now
        if (changed) load(initial = false, silent = true)
    }

    private suspend fun restoreCached(): Boolean = try {
        val json = ShuleApp.session.libraryCache.first()
        val snapshot = if (json.isBlank()) null else Gson().fromJson(json, LibrarySnapshot::class.java)
        if (snapshot == null || snapshot.notes.isEmpty()) {
            false
        } else {
            subjects = snapshot.subjects
            notes = snapshot.notes
            levelGroups = snapshot.levelGroups
            com.shulenotes.app.data.AccessHolder.knownLevels = snapshot.levelGroups.flatMap { g -> g.levels.map { it.id } }.toSet()
            NoteCache.subjects = snapshot.subjects
            NoteCache.put(snapshot.notes)
            initScope()
            isLoading = false
            true
        }
    } catch (e: Exception) {
        false
    }

    private suspend fun initScope() {
        if (!scopeReady) {
            scopeReady = true
            scopeClass = ShuleApp.session.classLevel.first().ifBlank { null }
            com.shulenotes.app.data.AccessHolder.homeClass = scopeClass
        }
    }

    // Everything the Home screen needs is asked for AT THE SAME TIME. The server is far
    // away, so each round trip costs real time; five in a row (as before) made the
    // screen wait five times as long as one.
    private fun load(initial: Boolean, silent: Boolean = false) {
        viewModelScope.launch {
            if (!silent) { if (initial) isLoading = true else isRefreshing = true }
            errorMessage = null
            try {
                val dismissed = ShuleApp.session.dismissedAnnouncement.first()
                coroutineScope {
                    val subjectsCall = async { ApiClient.service.subjects().subjects ?: emptyList() }
                    val notesCall = async { ApiClient.service.notes().notes ?: emptyList() }
                    // These three are nice to have: failing must not stop the notes from showing.
                    val levelsCall = async { try { ApiClient.service.levels().groups ?: emptyList() } catch (e: Exception) { levelGroups } }
                    val notificationsCall = async { try { ApiClient.service.announcements().announcements ?: emptyList() } catch (e: Exception) { notifications.filter { !it.isSecurity } } }
                    val noticesCall = async { try { ApiClient.service.notices().notices ?: emptyList() } catch (e: Exception) { notifications.filter { it.isSecurity } } }
                    val configCall = async { AppConfigHolder.refresh() }
                    val accessCall = async { com.shulenotes.app.data.AccessHolder.refresh() }

                    val loadedSubjects = subjectsCall.await()
                    val loadedNotes = notesCall.await()
                    val loadedLevels = levelsCall.await()
                    subjects = loadedSubjects
                    notes = loadedNotes
                    levelGroups = loadedLevels
                    com.shulenotes.app.data.AccessHolder.knownLevels = loadedLevels.flatMap { g -> g.levels.map { it.id } }.toSet()
                    NoteCache.subjects = loadedSubjects
                    NoteCache.put(loadedNotes)
                    initScope()
                    if (subjectsInScope().none { it.id == selectedSubjectId }) selectedSubjectId = null
                    val ownerNews = notificationsCall.await()
                    // The owner's announcements and the student's own sign-in alerts, in one list, newest first.
                    notifications = (ownerNews + noticesCall.await()).sortedByDescending { com.shulenotes.app.ui.components.parseIsoMillis(it.createdAt) }
                    announcement = ownerNews.firstOrNull()?.takeIf { it.id != dismissed }
                    configCall.await()
                    accessCall.await()
                    ShuleApp.session.saveLibrary(Gson().toJson(LibrarySnapshot(loadedSubjects, loadedNotes, loadedLevels)))
                }
            } catch (e: IOException) {
                if (!silent) loadFailed("No connection. Check your internet and try again.")
            } catch (e: Exception) {
                if (!silent) loadFailed(e.serverMessage() ?: "Something went wrong loading your notes.")
            } finally {
                isLoading = false
                isRefreshing = false
            }
        }
    }

    fun dismissAnnouncement() {
        val id = announcement?.id ?: return
        announcement = null
        viewModelScope.launch { ShuleApp.session.dismissAnnouncement(id) }
    }

    fun clearFeedbackError() { feedbackError = null }

    // type: "problem", "idea" or "other".
    fun sendFeedback(type: String, message: String, onDone: () -> Unit) {
        if (isSendingFeedback) return
        if (message.trim().length < 5) { feedbackError = "Please write a little more"; return }
        viewModelScope.launch {
            isSendingFeedback = true
            feedbackError = null
            try {
                ApiClient.service.sendFeedback(
                    mapOf(
                        "type" to type,
                        "message" to message.trim(),
                        "appVersion" to com.shulenotes.app.BuildConfig.VERSION_NAME,
                        "device" to "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}",
                    ),
                )
                Notifier.success("Thank you. We read every message.")
                onDone()
            } catch (e: IOException) {
                feedbackError = "No connection. Try again when you are online."
            } catch (e: Exception) {
                feedbackError = e.serverMessage() ?: "We could not send that. Please try again."
            } finally {
                isSendingFeedback = false
            }
        }
    }

    fun clearProfileError() { profileError = null }

    fun saveName(name: String, onDone: () -> Unit) {
        if (isSavingProfile) return
        val clean = name.trim()
        if (clean.isEmpty()) { profileError = "Enter your name"; return }
        viewModelScope.launch {
            isSavingProfile = true
            try {
                val user = ApiClient.service.updateProfile(mapOf("name" to clean)).user
                ShuleApp.session.setName(user?.name ?: clean)
                Notifier.success("Name updated")
                onDone()
            } catch (e: IOException) {
                profileError = "No connection. Try again."
            } catch (e: Exception) {
                profileError = e.serverMessage() ?: "We could not save your name."
            } finally {
                isSavingProfile = false
            }
        }
    }

    // With nothing on screen the failure fills the screen with a retry button;
    // when notes are already showing, a passing notice is enough.
    private fun loadFailed(message: String) {
        if (notes.isEmpty()) errorMessage = message else Notifier.error(message)
    }

    fun selectSubject(subjectId: String?) { selectedSubjectId = subjectId }

    fun selectKind(kind: String?) { kindFilter = kind }

    fun selectSort(order: SortOrder) { sortOrder = order }

    // True when the class on screen has both ordinary notes and past papers, so the filter is worth showing.
    fun hasBothKinds(): Boolean {
        val kinds = scopedNotes().map { it.kind ?: "notes" }.toSet()
        return kinds.size > 1
    }

    fun updateQuery(value: String) { query = value }

    // A note with no class, or with a class the list no longer knows (saved
    // before the list existed), is shown to everyone rather than hidden.
    private fun inScope(note: Note): Boolean {
        val scope = scopeClass ?: return true
        val noteClass = note.classLevel
        if (noteClass.isNullOrBlank() || noteClass == scope) return true
        return levelGroups.none { group -> group.levels.any { it.id == noteClass } }
    }

    fun scopedNotes(): List<Note> = notes.filter { inScope(it) }

    // Only subjects that have notes for the class on screen, so no tile leads to an empty page.
    fun subjectsInScope(): List<Subject> {
        val ids = scopedNotes().mapNotNull { it.subjectId }.toSet()
        return subjects.filter { it.id in ids }
    }

    fun visibleNotes(): List<Note> {
        val words = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val matching = scopedNotes().filter { note ->
            (selectedSubjectId == null || note.subjectId == selectedSubjectId) &&
                (kindFilter == null || (note.kind ?: "notes") == kindFilter) &&
                words.all { word ->
                    note.title.lowercase().contains(word) ||
                        note.description.orEmpty().lowercase().contains(word) ||
                        note.classLevel.orEmpty().lowercase().contains(word)
                }
        }
        return when (sortOrder) {
            SortOrder.NEWEST -> matching.sortedByDescending { it.uploadedAt.orEmpty() }
            SortOrder.MOST_READ -> matching.sortedWith(compareByDescending<Note> { it.views }.thenByDescending { it.uploadedAt.orEmpty() })
            SortOrder.A_TO_Z -> matching.sortedBy { it.title.lowercase() }
        }
    }

    fun selectClass(level: String?) {
        scopeClass = level
        // The pass card follows the class on screen ("every class" keeps the last one).
        if (level != null) {
            com.shulenotes.app.data.AccessHolder.homeClass = level
            viewModelScope.launch { com.shulenotes.app.data.AccessHolder.refresh() }
        }
        if (subjectsInScope().none { it.id == selectedSubjectId }) selectedSubjectId = null
        if (level == null) return
        viewModelScope.launch {
            ShuleApp.session.setClassLevel(level)
            try {
                ApiClient.service.setClassLevel(mapOf("classLevel" to level))
            } catch (e: Exception) {
                Notifier.error("Your class could not be saved online. Check your internet.")
            }
        }
    }

    fun subjectName(subjectId: String?): String? = subjects.firstOrNull { it.id == subjectId }?.name

    fun toggleSaved(noteId: String) {
        viewModelScope.launch { notifySaved(ShuleApp.session.toggleSaved(noteId)) }
    }

    // A new profile photo: shrunk and straightened on the phone, then sent. The server answers with the
    // new version number, which is what makes every place that shows the photo switch to it.
    fun uploadAvatar(uri: android.net.Uri) {
        if (isSavingAvatar) return
        viewModelScope.launch {
            isSavingAvatar = true
            try {
                val bytes = withContext(Dispatchers.IO) { AvatarImage.prepare(ShuleApp.appContext, uri) }
                if (bytes == null) {
                    Notifier.error("We could not read that picture. Try another one.")
                } else {
                    val part = MultipartBody.Part.createFormData("photo", "photo.jpg", bytes.toRequestBody("image/jpeg".toMediaType()))
                    val result = ApiClient.service.uploadAvatar(part)
                    ShuleApp.session.setAvatarVersion(result.user?.avatarVersion ?: 0L)
                    Notifier.success("Profile photo updated")
                }
            } catch (e: IOException) {
                Notifier.error("No connection. Try again.")
            } catch (e: Exception) {
                Notifier.error(e.serverMessage() ?: "We could not save your photo. Please try again.")
            } finally {
                isSavingAvatar = false
            }
        }
    }

    fun removeAvatar() {
        if (isSavingAvatar) return
        viewModelScope.launch {
            isSavingAvatar = true
            try {
                ApiClient.service.removeAvatar()
                ShuleApp.session.setAvatarVersion(0L)
                Notifier.success("Profile photo removed")
            } catch (e: IOException) {
                Notifier.error("No connection. Try again.")
            } catch (e: Exception) {
                Notifier.error(e.serverMessage() ?: "We could not remove your photo. Please try again.")
            } finally {
                isSavingAvatar = false
            }
        }
    }

    // Logging out is instant: the phone forgets the account and leaves the screen at once. Telling the
    // server and leaving the notification groups can take a while on a poor connection, so they happen
    // afterwards in the background (the server also forgets the session on its own when it expires).
    fun logout(onDone: () -> Unit) {
        val token = com.shulenotes.app.data.SessionHolder.token
        viewModelScope.launch {
            val topics = try { ShuleApp.session.currentPushTopics() } catch (e: Exception) { emptySet() }
            ShuleApp.session.clear()
            NoteCache.clear()
            onDone()
            ShuleApp.appScope.launch {
                if (token != null) try { kotlinx.coroutines.withTimeout(15_000) { ApiClient.service.logout("Bearer $token") } } catch (e: Exception) { }
                try { kotlinx.coroutines.withTimeout(15_000) { com.shulenotes.app.push.Push.leaveTopics(ShuleApp.appContext, topics) } } catch (e: Exception) { }
            }
        }
    }

    fun clearDeleteAccountError() { deleteAccountError = null }

    fun deleteAccount(password: String, onDone: () -> Unit) {
        if (isDeletingAccount) return
        if (password.isBlank()) {
            deleteAccountError = "Enter your password"
            return
        }
        viewModelScope.launch {
            isDeletingAccount = true
            deleteAccountError = null
            try {
                ApiClient.service.deleteAccount(mapOf("password" to password))
                val topics = try { ShuleApp.session.currentPushTopics() } catch (e: Exception) { emptySet() }
                ShuleApp.appScope.launch { try { kotlinx.coroutines.withTimeout(15_000) { com.shulenotes.app.push.Push.leaveTopics(ShuleApp.appContext, topics) } } catch (e: Exception) { } }
                ShuleApp.session.clear(keepSaved = false)
                Downloads.clearAll()
                NoteCache.clear()
                onDone()
                Notifier.success("Your account has been deleted")
            } catch (e: IOException) {
                deleteAccountError = "No connection. Try again."
            } catch (e: Exception) {
                deleteAccountError = e.serverMessage() ?: "We could not delete the account. Please try again."
            } finally {
                isDeletingAccount = false
            }
        }
    }
}

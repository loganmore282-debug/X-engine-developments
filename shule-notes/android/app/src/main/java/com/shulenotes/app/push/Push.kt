package com.shulenotes.app.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.shulenotes.app.ShuleApp
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

// Phone notifications. Everyone is subscribed to "all" and to a topic for their class, using the
// same names the server sends to (backend/push.js topicFor). Without google-services.json the app
// has no Firebase project, and every call here quietly does nothing.
object Push {
    const val CHANNEL_ID = "announcements"

    fun topicForClass(classLevel: String): String =
        "class_" + classLevel.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_')

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, "Announcements", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "News and reminders from Shule Notes"
        }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun available(context: Context): Boolean =
        runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)

    private suspend fun <T> Task<T>.await(): Boolean = suspendCoroutine { cont -> addOnCompleteListener { cont.resume(it.isSuccessful) } }

    // Leaves the given groups (used when someone logs out or deletes their account). Slow if the network is, so
    // it is always run in the background, never while the person waits.
    suspend fun leaveTopics(context: Context, topics: Set<String>) {
        if (topics.isEmpty() || !available(context)) return
        val messaging = FirebaseMessaging.getInstance()
        for (topic in topics) messaging.unsubscribeFromTopic(topic).await()
        runCatching { ShuleApp.session.setPushTopics(emptySet()) }
    }

    // Makes this phone's subscriptions match what the student wants: nothing when notifications are
    // off or nobody is signed in, otherwise "all" plus their class.
    suspend fun sync(context: Context, enabled: Boolean, classLevel: String) {
        if (!available(context)) return
        val wanted = if (!enabled) emptySet() else buildSet {
            add("all")
            if (classLevel.isNotBlank()) add(topicForClass(classLevel))
        }
        val store = ShuleApp.session
        val have = runCatching { store.currentPushTopics() }.getOrDefault(emptySet())
        if (wanted == have) return
        val messaging = FirebaseMessaging.getInstance()
        val kept = HashSet<String>()
        for (topic in have - wanted) if (!messaging.unsubscribeFromTopic(topic).await()) kept.add(topic)
        for (topic in wanted - have) if (messaging.subscribeToTopic(topic).await()) kept.add(topic)
        store.setPushTopics(kept + (have intersect wanted))
    }
}

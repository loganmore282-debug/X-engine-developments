package com.shulenotes.app.data

import com.shulenotes.app.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

// One open line to the server (GET /live, Server-Sent Events) while the app is on screen, so things happen the moment
// they happen: the owner's changes ("revision"), a sign-in on another device ("signed_out"), a new sign-in alert
// ("notice"), a pass added or removed ("access"), a payment decided ("payment"). If the line drops it reconnects by
// itself after 1 second, then a little longer each time (up to 15 seconds).
object LiveEvents {
    // The server sends a heartbeat every 25 seconds, so a read that waits 90 seconds means the line is dead.
    private val client by lazy { ApiClient.client.newBuilder().readTimeout(90, TimeUnit.SECONDS).build() }

    private enum class Ended { DROPPED, SIGNED_OUT }

    // Runs until the coroutine is cancelled (the app left the screen) or the student is signed out.
    // onEvent is called on the main thread.
    suspend fun run(onEvent: suspend (event: String, data: JSONObject) -> Unit) {
        var retry = 1000L
        while (coroutineContext.isActive) {
            if (SessionHolder.token == null) return
            val ended = listenOnce(onEvent) { retry = 1000L }
            if (ended == Ended.SIGNED_OUT) return
            delay(retry)
            retry = (retry * 2).coerceAtMost(15_000L)
        }
    }

    private suspend fun listenOnce(onEvent: suspend (String, JSONObject) -> Unit, onOpen: () -> Unit): Ended = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(BuildConfig.API_BASE_URL.trimEnd('/') + "/live")
            .header("Accept", "text/event-stream")
            .build()
        val call = client.newCall(request)
        // Leaving the screen cancels the coroutine; that must also close the connection (a blocked read wakes up).
        val stop = coroutineContext[Job]?.invokeOnCompletion { call.cancel() }
        try {
            call.execute().use { response ->
                // A 401 is handled by ApiClient's interceptor: it signs the student out with the server's reason.
                if (response.code == 401) return@use Ended.SIGNED_OUT
                val source = response.body?.source()
                if (!response.isSuccessful || source == null) return@use Ended.DROPPED
                onOpen()
                var event = ""
                val data = StringBuilder()
                while (true) {
                    val line = source.readUtf8Line() ?: break
                    when {
                        line.isEmpty() -> {
                            if (event.isNotEmpty()) {
                                val json = runCatching { JSONObject(data.toString().ifBlank { "{}" }) }.getOrDefault(JSONObject())
                                val name = event
                                withContext(Dispatchers.Main) { onEvent(name, json) }
                                if (name == "signed_out") return@use Ended.SIGNED_OUT
                            }
                            event = ""
                            data.setLength(0)
                        }
                        line.startsWith("event:") -> event = line.substring(6).trim()
                        line.startsWith("data:") -> data.append(line.substring(5).trim())
                        else -> Unit // comments (": ping") and "retry:" lines
                    }
                }
                Ended.DROPPED
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Ended.DROPPED // the network dropped: the loop reconnects
        } finally {
            stop?.dispose()
        }
    }
}

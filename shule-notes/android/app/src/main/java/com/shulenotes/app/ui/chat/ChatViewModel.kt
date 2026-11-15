package com.shulenotes.app.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.data.AskRequest
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.ChatTurn
import com.shulenotes.app.data.serverMessage
import kotlinx.coroutines.launch
import java.io.IOException

data class DisplayMessage(val role: String, val content: String, val isError: Boolean = false)

// Keeps the last MAX_HISTORY turns and resends them with every question --
// the server has no memory of its own between requests. Capped so a long
// chat session does not grow the request (and the Claude bill) without
// bound.
private const val MAX_HISTORY = 8

class ChatViewModel(private val noteId: String) : ViewModel() {
    var messages by mutableStateOf<List<DisplayMessage>>(emptyList())
        private set
    var isSending by mutableStateOf(false)
        private set

    fun ask(question: String) {
        val q = question.trim()
        if (q.isBlank() || isSending) return
        // Taken before the new question is added: the server appends the
        // question itself, so including it here would send it twice.
        val history = messages
            .filter { !it.isError }
            .takeLast(MAX_HISTORY)
            .map { ChatTurn(it.role, it.content) }
        messages = messages + DisplayMessage("user", q)
        isSending = true
        viewModelScope.launch {
            try {
                val res = ApiClient.service.askAi(AskRequest(noteId = noteId, question = q, history = history))
                if (res.status == "success" && res.answer != null) {
                    messages = messages + DisplayMessage("assistant", res.answer)
                } else {
                    messages = messages + DisplayMessage("assistant", res.message ?: "Could not answer that.", isError = true)
                }
            } catch (e: IOException) {
                messages = messages + DisplayMessage("assistant", "Could not reach the AI helper. Check your connection.", isError = true)
            } catch (e: Exception) {
                messages = messages + DisplayMessage("assistant", e.serverMessage() ?: "Something went wrong answering that.", isError = true)
            } finally {
                isSending = false
            }
        }
    }
}

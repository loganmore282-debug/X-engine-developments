package com.shulenotes.app.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.AskRequest
import com.shulenotes.app.data.ChatTurn
import com.shulenotes.app.data.serverMessage
import kotlinx.coroutines.launch
import java.io.IOException

data class DisplayMessage(val role: String, val content: String, val isError: Boolean = false)

// The server keeps no memory between requests, so the last MAX_HISTORY turns
// are resent with every question. Capped so a long chat does not grow the
// request (and the Claude bill) without bound.
private const val MAX_HISTORY = 8

class ChatViewModel(private val noteId: String) : ViewModel() {
    var messages by mutableStateOf<List<DisplayMessage>>(emptyList())
        private set
    var isSending by mutableStateOf(false)
        private set

    // Answers (by position) whose "typing" reveal has already played: scrolling back or turning the phone shows them whole.
    val revealed = mutableSetOf<Int>()

    fun ask(question: String) {
        val q = question.trim()
        if (q.isBlank() || isSending) return
        // Taken before the new question is added: the server appends the
        // question itself, so including it here would send it twice. A
        // question whose answer failed is dropped along with its error, so
        // the history always alternates student, helper.
        val history = answeredTurns().takeLast(MAX_HISTORY).map { ChatTurn(it.role, it.content) }
        messages = messages + DisplayMessage("user", q)
        isSending = true
        viewModelScope.launch {
            val reply = try {
                val res = ApiClient.service.askAi(AskRequest(noteId = noteId, question = q, history = history))
                if (res.status == "success" && !res.answer.isNullOrBlank()) {
                    DisplayMessage("assistant", res.answer.trim())
                } else {
                    DisplayMessage("assistant", res.message ?: "The helper could not answer that. Try asking it differently.", isError = true)
                }
            } catch (e: IOException) {
                DisplayMessage("assistant", "No connection. Check your internet and ask again.", isError = true)
            } catch (e: Exception) {
                DisplayMessage("assistant", e.serverMessage() ?: "Something went wrong. Please ask again.", isError = true)
            }
            messages = messages + reply
            isSending = false
        }
    }

    private fun answeredTurns(): List<DisplayMessage> {
        val turns = mutableListOf<DisplayMessage>()
        var i = 0
        while (i + 1 < messages.size) {
            val question = messages[i]
            val answer = messages[i + 1]
            if (question.role == "user" && answer.role == "assistant" && !answer.isError) {
                turns += question
                turns += answer
            }
            i += 2
        }
        return turns
    }
}

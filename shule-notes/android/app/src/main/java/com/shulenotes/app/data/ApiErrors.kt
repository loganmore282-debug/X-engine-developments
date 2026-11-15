package com.shulenotes.app.data

import com.google.gson.Gson
import retrofit2.HttpException

// Retrofit throws HttpException for every non-2xx reply, which would hide the
// server's own message (a wrong password, the AI daily limit) behind a
// generic one.
fun Throwable.serverMessage(): String? {
    val body = (this as? HttpException)?.response()?.errorBody()?.string() ?: return null
    return try {
        Gson().fromJson(body, SimpleResponse::class.java)?.message
    } catch (e: Exception) {
        null
    }
}

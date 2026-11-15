package com.shulenotes.app.data

import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

interface ApiService {
    @POST("auth/register")
    suspend fun register(@Body body: Map<String, String>): AuthResponse

    @POST("auth/login")
    suspend fun login(@Body body: Map<String, String>): AuthResponse

    @POST("auth/logout")
    suspend fun logout(): SimpleResponse

    @POST("auth/delete-account")
    suspend fun deleteAccount(@Body body: Map<String, String>): SimpleResponse

    @GET("subjects")
    suspend fun subjects(): SubjectsResponse

    @GET("notes")
    suspend fun notes(@Query("subjectId") subjectId: String? = null): NotesResponse

    @GET("notes/{id}")
    suspend fun note(@Path("id") id: String): NoteResponse

    // Streamed, not buffered into memory -- a PDF can be tens of MB and this
    // response is written straight to a local file by the caller.
    @Streaming
    @GET("notes/{id}/file")
    suspend fun noteFile(@Path("id") id: String): ResponseBody

    @POST("ai/ask")
    suspend fun askAi(@Body body: AskRequest): AskResponse
}

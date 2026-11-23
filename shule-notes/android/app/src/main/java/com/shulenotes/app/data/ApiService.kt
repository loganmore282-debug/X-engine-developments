package com.shulenotes.app.data

import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.Multipart
import retrofit2.http.Part
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

    // The token is passed in by hand: the phone has already forgotten it by the time this is sent.
    @POST("auth/logout")
    suspend fun logout(@retrofit2.http.Header("Authorization") bearer: String): SimpleResponse

    @GET("levels")
    suspend fun levels(): LevelsResponse

    @POST("auth/class-level")
    suspend fun setClassLevel(@Body body: Map<String, String>): UserResponse

    @POST("auth/delete-account")
    suspend fun deleteAccount(@Body body: Map<String, String>): SimpleResponse

    @POST("auth/update-profile")
    suspend fun updateProfile(@Body body: Map<String, String>): UserResponse

    @Multipart
    @POST("auth/avatar")
    suspend fun uploadAvatar(@Part photo: MultipartBody.Part): UserResponse

    @POST("auth/avatar/remove")
    suspend fun removeAvatar(): UserResponse

    @GET("onboarding")
    suspend fun onboarding(): SlidesResponse

    @POST("feedback")
    suspend fun sendFeedback(@Body body: Map<String, String>): SimpleResponse

    @GET("sync")
    suspend fun sync(): SyncResponse

    @GET("config")
    suspend fun config(): ConfigResponse

    @GET("announcements")
    suspend fun announcements(): AnnouncementsResponse

    @GET("notices")
    suspend fun notices(): NoticesResponse

    @GET("payments/mine")
    suspend fun myPayments(): PaymentHistoryResponse

    @GET("announcement")
    suspend fun announcement(): AnnouncementResponse

    @GET("subjects")
    suspend fun subjects(): SubjectsResponse

    @GET("notes")
    suspend fun notes(@Query("subjectId") subjectId: String? = null): NotesResponse

    @GET("notes/{id}")
    suspend fun note(@Path("id") id: String): NoteResponse

    @GET("notes/{id}/pages")
    suspend fun notePages(@Path("id") id: String): PagesResponse

    // Streamed, not buffered into memory -- a PDF can be tens of MB and this
    // response is written straight to a local file by the caller.
    @Streaming
    @GET("notes/{id}/file")
    suspend fun noteFile(@Path("id") id: String): ResponseBody

    @GET("payments/plans")
    suspend fun plans(@Query("classLevel") classLevel: String? = null): PlansResponse

    @POST("payments/start")
    suspend fun startPayment(@Body body: Map<String, String>): PaymentResponse

    @GET("payments/{id}/status")
    suspend fun paymentStatus(@Path("id") id: String): PaymentResponse

    @POST("ai/ask")
    suspend fun askAi(@Body body: AskRequest): AskResponse
}

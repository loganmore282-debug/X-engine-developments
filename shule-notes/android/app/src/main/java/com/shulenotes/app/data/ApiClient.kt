package com.shulenotes.app.data

import com.shulenotes.app.BuildConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    // Reads SessionHolder synchronously -- never a suspend/blocking DataStore
    // read inside an interceptor, which runs on OkHttp's own dispatcher
    // thread, not a coroutine.
    private val authInterceptor = Interceptor { chain ->
        val token = SessionHolder.token
        val request = if (token != null) {
            chain.request().newBuilder().addHeader("Authorization", "Bearer $token").build()
        } else {
            chain.request()
        }
        val response = chain.proceed(request)
        if (token != null && response.code == 401) {
            // The server says WHY when another device signed in; that reason is shown after the sign-out.
            val body = try { response.peekBody(2048).string() } catch (e: Exception) { "" }
            SessionHolder.expiredMessage = if (body.contains("signed_in_elsewhere")) "You were signed out because this account was opened on another device." else null
            SessionHolder.expired.value = true
        }
        response
    }

    private val logging = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
    }

    // Shared with the image loader, so a profile photo is fetched with the signed-in token.
    val client: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .addInterceptor(logging)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS) // the AI endpoint can take a while to answer
        .writeTimeout(60, TimeUnit.SECONDS) // PDF uploads happen from the admin panel, not this app, but kept generous
        .build()

    val service: ApiService by lazy {
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL.trimEnd('/') + "/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }
}

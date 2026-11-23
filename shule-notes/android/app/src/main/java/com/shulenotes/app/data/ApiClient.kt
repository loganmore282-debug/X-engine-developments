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
            // The server's own words, which name the device that took over ("...opened on Chrome on Windows").
            SessionHolder.expiredMessage = if (body.contains("signed_in_elsewhere")) {
                runCatching { org.json.JSONObject(body).optString("message") }.getOrNull()?.takeIf { it.isNotBlank() }
                    ?: "You were signed out because this account was opened on another device."
            } else null
            SessionHolder.expired.value = true
        }
        response
    }

    private val logging = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
    }

    // Names this phone to the server ("ShuleNotes/1.0.41 (Android 14; samsung SM-A155F)") so a sign-in alert can say
    // which device opened the account. Only plain ASCII is allowed in a header.
    private val deviceName: String by lazy {
        val raw = "ShuleNotes/${BuildConfig.VERSION_NAME} (Android ${android.os.Build.VERSION.RELEASE}; ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL})"
        raw.filter { it.code in 0x20..0x7E }.take(160)
    }
    private val deviceInterceptor = Interceptor { chain ->
        chain.proceed(chain.request().newBuilder().header("User-Agent", deviceName).build())
    }

    // Shared with the image loader, so a profile photo is fetched with the signed-in token.
    val client: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(deviceInterceptor)
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

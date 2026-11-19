package com.shulenotes.app

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.data.SessionStore

class ShuleApp : Application(), ImageLoaderFactory {
    override fun onCreate() {
        super.onCreate()
        session = SessionStore(this)
        appContext = applicationContext
        Downloads.init(this)
        com.shulenotes.app.push.Push.createChannel(this)
    }

    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .okHttpClient(ApiClient.client)
        .crossfade(true)
        .build()

    companion object {
        lateinit var session: SessionStore
            private set
        lateinit var appContext: android.content.Context
            private set
    }
}

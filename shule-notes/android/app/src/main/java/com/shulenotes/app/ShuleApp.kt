package com.shulenotes.app

import android.app.Application
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.data.SessionStore

class ShuleApp : Application() {
    override fun onCreate() {
        super.onCreate()
        session = SessionStore(this)
        appContext = applicationContext
        Downloads.init(this)
        com.shulenotes.app.push.Push.createChannel(this)
    }

    companion object {
        lateinit var session: SessionStore
            private set
        lateinit var appContext: android.content.Context
            private set
    }
}

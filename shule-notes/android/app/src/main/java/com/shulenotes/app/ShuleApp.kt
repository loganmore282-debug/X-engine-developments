package com.shulenotes.app

import android.app.Application
import com.shulenotes.app.data.Downloads
import com.shulenotes.app.data.SessionStore

class ShuleApp : Application() {
    override fun onCreate() {
        super.onCreate()
        session = SessionStore(this)
        Downloads.init(this)
    }

    companion object {
        lateinit var session: SessionStore
            private set
    }
}

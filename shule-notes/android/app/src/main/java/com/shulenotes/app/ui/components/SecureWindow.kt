package com.shulenotes.app.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import com.shulenotes.app.BuildConfig

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

// While this screen is showing, the phone will not take screenshots or record the screen, and the app's
// preview in the recent-apps list is blank. Used on the reader and the AI chat, where the owner's notes are.
@Composable
fun SecureWindow() {
    if (!BuildConfig.SECURE_SCREENS) return
    val context = LocalContext.current
    DisposableEffect(Unit) {
        val window = context.activity()?.window
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

package com.shulenotes.app.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

// A screen with a dark header under the status bar needs light clock and
// battery icons; they go back to what they were when the screen leaves.
@Composable
fun StatusBarIcons(light: Boolean) {
    val view = LocalView.current
    DisposableEffect(light) {
        val window = view.context.findActivity()?.window
        if (window == null) {
            onDispose { }
        } else {
            val controller = WindowCompat.getInsetsController(window, view)
            val previous = controller.isAppearanceLightStatusBars
            controller.isAppearanceLightStatusBars = !light
            onDispose { controller.isAppearanceLightStatusBars = previous }
        }
    }
}

package com.shulenotes.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.shulenotes.app.data.SessionHolder
import kotlinx.coroutines.flow.first
import com.shulenotes.app.ui.auth.DOWNLOAD_URL
import com.shulenotes.app.ui.components.AppConfigHolder
import com.shulenotes.app.ui.components.NotifierHost
import com.shulenotes.app.ui.components.UpdateRequiredScreen
import com.shulenotes.app.ui.nav.Routes
import com.shulenotes.app.ui.nav.ShuleNavGraph
import com.shulenotes.app.ui.theme.ShuleNotesTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            var startDestination by remember { mutableStateOf<String?>(null) }
            // "system", "light" or "dark" (Profile, Appearance).
            var themeMode by remember { mutableStateOf("system") }

            // The saved sign-in is read from disk BEFORE the first screen is
            // chosen, so someone already signed in never sees the sign-in
            // screen flash, and no request goes out without its token.
            LaunchedEffect(Unit) {
                ShuleApp.session.primeSessionHolder()
                themeMode = ShuleApp.session.themeMode.first()
                startDestination = when {
                    SessionHolder.token == null -> Routes.LOGIN
                    ShuleApp.session.classLevel.first().isBlank() -> Routes.CLASS
                    else -> Routes.MAIN
                }
            }

            LaunchedEffect(Unit) { ShuleApp.session.themeMode.collect { themeMode = it } }
            // The owner's settings (needs no sign-in): they can require everyone to be on a recent version.
            LaunchedEffect(Unit) { AppConfigHolder.refresh() }
            val appConfig = AppConfigHolder.config
            val mustUpdate = appConfig.minVersion > BuildConfig.VERSION_CODE
            val uriHandler = LocalUriHandler.current
            val dark = when (themeMode) {
                "dark" -> true
                "light" -> false
                else -> isSystemInDarkTheme()
            }
            // Clock and battery icons must suit the chosen theme, not only the phone's own.
            val view = LocalView.current
            SideEffect {
                val controller = WindowCompat.getInsetsController(window, view)
                controller.isAppearanceLightStatusBars = !dark
                controller.isAppearanceLightNavigationBars = !dark
            }

            ShuleNotesTheme(darkTheme = dark) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    if (mustUpdate) {
                        UpdateRequiredScreen(
                            note = appConfig.updateNote,
                            onUpdate = { runCatching { uriHandler.openUri(appConfig.updateUrl.ifBlank { DOWNLOAD_URL }) } },
                        )
                    } else {
                        startDestination?.let { ShuleNavGraph(startDestination = it) }
                    }
                    NotifierHost()
                }
            }
        }
    }
}

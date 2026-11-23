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
import androidx.compose.runtime.DisposableEffect
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
import com.shulenotes.app.ui.splash.SplashScreen
import androidx.compose.runtime.saveable.rememberSaveable
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
                    // The introduction is for someone new: signed out and never shown it.
                    SessionHolder.token == null && !ShuleApp.session.introSeen.first() -> Routes.INTRO
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
            // A copy signed by anyone but the owner (see Integrity) does not run.
            val tampered = remember { !Integrity.signatureOk(applicationContext) }
            val uriHandler = LocalUriHandler.current
            val dark = when (themeMode) {
                "dark" -> true
                "light" -> false
                else -> isSystemInDarkTheme()
            }
            // Clock and battery icons must suit the chosen theme, not only the phone's own.
            val view = LocalView.current
            // Runs only when the theme changes (not on every redraw), and BEFORE a screen's own setting, so a
            // dark-green screen such as the splash or the introduction can keep its light clock and battery icons.
            DisposableEffect(dark, view) {
                val controller = WindowCompat.getInsetsController(window, view)
                controller.isAppearanceLightStatusBars = !dark
                controller.isAppearanceLightNavigationBars = !dark
                onDispose { }
            }

            ShuleNotesTheme(darkTheme = dark) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    // The splash holds for at least a moment (so it reads as a launch screen, not a flicker) and
                    // for as long as the saved sign-in is still being read; then the app fades in.
                    var splashTimeUp by rememberSaveable { mutableStateOf(false) }
                    LaunchedEffect(Unit) { kotlinx.coroutines.delay(1400); splashTimeUp = true }
                    val ready = splashTimeUp && startDestination != null
                    androidx.compose.animation.Crossfade(targetState = ready, animationSpec = androidx.compose.animation.core.tween(380), label = "splash") { isReady ->
                    if (tampered) {
                        com.shulenotes.app.ui.components.ModifiedAppScreen(onGetOfficial = { runCatching { uriHandler.openUri(DOWNLOAD_URL) } })
                    } else if (!isReady) {
                        SplashScreen()
                    } else if (mustUpdate) {
                        UpdateRequiredScreen(
                            note = appConfig.updateNote,
                            onUpdate = { com.shulenotes.app.ui.components.startUpdate(applicationContext, uriHandler, appConfig.updateUrl) },
                        )
                    } else {
                        startDestination?.let { ShuleNavGraph(startDestination = it) }
                    }
                    }
                    NotifierHost()
                }
            }
        }
    }
}

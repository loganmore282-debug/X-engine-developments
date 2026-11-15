package com.shulenotes.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.shulenotes.app.data.SessionHolder
import com.shulenotes.app.ui.nav.Routes
import com.shulenotes.app.ui.nav.ShuleNavGraph
import com.shulenotes.app.ui.theme.ShuleNotesTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            var startDestination by remember { mutableStateOf<String?>(null) }

            // The saved sign-in is read from disk BEFORE the first screen is
            // chosen, so someone already signed in never sees the sign-in
            // screen flash, and no request goes out without its token.
            LaunchedEffect(Unit) {
                ShuleApp.session.primeSessionHolder()
                startDestination = if (SessionHolder.token != null) Routes.MAIN else Routes.LOGIN
            }

            ShuleNotesTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    startDestination?.let { ShuleNavGraph(startDestination = it) }
                }
            }
        }
    }
}

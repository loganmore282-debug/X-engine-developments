package com.shulenotes.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import com.shulenotes.app.data.TokenStore
import com.shulenotes.app.ui.nav.ShuleNavGraph
import com.shulenotes.app.ui.theme.ShuleNotesTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val tokenStore = TokenStore(applicationContext)

        setContent {
            var startDestination by remember { mutableStateOf<String?>(null) }

            // SessionHolder (read synchronously by every network request) must
            // be primed from disk BEFORE the nav graph decides whether the
            // member is already signed in -- otherwise the very first screen
            // after a cold start could flash the login screen for someone who
            // is already logged in, or call an authenticated endpoint with no
            // token attached yet.
            androidx.compose.runtime.LaunchedEffect(Unit) {
                tokenStore.primeSessionHolder()
                startDestination = if (com.shulenotes.app.data.SessionHolder.token != null) "home" else "login"
            }

            ShuleNotesTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val dest = startDestination
                    if (dest != null) {
                        ShuleNavGraph(tokenStore = tokenStore, startDestination = dest)
                    }
                }
            }
        }
    }
}

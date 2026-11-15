package com.shulenotes.app.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.NoteCache
import com.shulenotes.app.data.SessionHolder
import com.shulenotes.app.ui.auth.LoginScreen
import com.shulenotes.app.ui.auth.RegisterScreen
import com.shulenotes.app.ui.chat.AiChatScreen
import com.shulenotes.app.ui.components.Notifier
import com.shulenotes.app.ui.main.MainScreen
import com.shulenotes.app.ui.note.NoteDetailScreen

object Routes {
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val MAIN = "main"
    const val NOTE = "note/{noteId}"
    const val CHAT = "chat/{noteId}"
}

@Composable
fun ShuleNavGraph(startDestination: String) {
    val navController = rememberNavController()
    val toMain = { navController.navigate(Routes.MAIN) { popUpTo(0) } }
    val toLogin = { navController.navigate(Routes.LOGIN) { popUpTo(0) } }

    // The server rejected the saved sign-in (it expired, or the account is gone).
    val expired by SessionHolder.expired.collectAsState()
    LaunchedEffect(expired) {
        if (expired) {
            ShuleApp.session.clear()
            NoteCache.clear()
            SessionHolder.expired.value = false
            toLogin()
            Notifier.info("Please sign in again")
        }
    }

    NavHost(navController = navController, startDestination = startDestination) {
        composable(Routes.LOGIN) {
            LoginScreen(
                viewModel = viewModel(),
                onLoggedIn = toMain,
                onGoToRegister = { navController.navigate(Routes.REGISTER) { launchSingleTop = true } },
            )
        }
        composable(Routes.REGISTER) {
            RegisterScreen(
                viewModel = viewModel(),
                onRegistered = toMain,
                onGoToLogin = { navController.popBackStack() },
            )
        }
        composable(Routes.MAIN) {
            MainScreen(
                viewModel = viewModel(),
                onOpenNote = { noteId -> navController.navigate("note/$noteId") { launchSingleTop = true } },
                onSignedOut = toLogin,
            )
        }
        composable(Routes.NOTE) { entry ->
            val noteId = entry.arguments?.getString("noteId").orEmpty()
            NoteDetailScreen(
                noteId = noteId,
                viewModel = viewModel(),
                onBack = { navController.popBackStack() },
                onAskAi = { navController.navigate("chat/$noteId") { launchSingleTop = true } },
            )
        }
        composable(Routes.CHAT) { entry ->
            val noteId = entry.arguments?.getString("noteId").orEmpty()
            AiChatScreen(noteId = noteId, onBack = { navController.popBackStack() })
        }
    }
}

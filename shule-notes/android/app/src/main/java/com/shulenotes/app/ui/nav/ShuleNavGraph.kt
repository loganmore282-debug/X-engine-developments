package com.shulenotes.app.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.shulenotes.app.data.Note
import com.shulenotes.app.data.TokenStore
import com.shulenotes.app.ui.auth.AuthViewModel
import com.shulenotes.app.ui.auth.LoginScreen
import com.shulenotes.app.ui.auth.RegisterScreen
import com.shulenotes.app.ui.chat.AiChatScreen
import com.shulenotes.app.ui.home.HomeScreen
import com.shulenotes.app.ui.home.HomeViewModel
import com.shulenotes.app.ui.note.NoteDetailScreen
import com.shulenotes.app.ui.note.NoteViewModel
import kotlinx.coroutines.launch
import java.net.URLDecoder
import java.net.URLEncoder

private object Routes {
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val HOME = "home"
    const val NOTE_DETAIL = "note/{noteId}/{noteTitle}/{hasAi}"
    const val CHAT = "chat/{noteId}/{noteTitle}"
}

private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
private fun dec(s: String) = URLDecoder.decode(s, "UTF-8")

@Composable
fun ShuleNavGraph(tokenStore: TokenStore, startDestination: String) {
    val navController: NavHostController = rememberNavController()

    NavHost(navController = navController, startDestination = startDestination) {
        composable(Routes.LOGIN) {
            val vm: AuthViewModel = viewModel()
            LoginScreen(
                viewModel = vm,
                tokenStore = tokenStore,
                onLoggedIn = {
                    navController.navigate(Routes.HOME) { popUpTo(0) }
                },
                onGoToRegister = { navController.navigate(Routes.REGISTER) },
            )
        }
        composable(Routes.REGISTER) {
            val vm: AuthViewModel = viewModel()
            RegisterScreen(
                viewModel = vm,
                tokenStore = tokenStore,
                onRegistered = {
                    navController.navigate(Routes.HOME) { popUpTo(0) }
                },
                onGoToLogin = { navController.popBackStack() },
            )
        }
        composable(Routes.HOME) {
            val vm: HomeViewModel = viewModel()
            val scope = rememberCoroutineScope()
            HomeScreen(
                viewModel = vm,
                onOpenNote = { note: Note ->
                    navController.navigate("note/${enc(note.id)}/${enc(note.title)}/${note.hasAiContext}")
                },
                onLogout = {
                    scope.launch { tokenStore.clearToken() }
                    navController.navigate(Routes.LOGIN) { popUpTo(0) }
                },
            )
        }
        composable(
            route = Routes.NOTE_DETAIL,
            arguments = listOf(
                navArgument("noteId") { type = NavType.StringType },
                navArgument("noteTitle") { type = NavType.StringType },
                navArgument("hasAi") { type = NavType.BoolType },
            ),
        ) { backStackEntry ->
            val noteId = backStackEntry.arguments?.getString("noteId").orEmpty()
            val noteTitle = dec(backStackEntry.arguments?.getString("noteTitle").orEmpty())
            val hasAi = backStackEntry.arguments?.getBoolean("hasAi") ?: false
            val note = Note(
                id = noteId, subjectId = null, title = noteTitle, description = null,
                classLevel = null, pageCount = 0, fileSize = 0, uploadedAt = null, hasAiContext = hasAi,
            )
            val vm: NoteViewModel = viewModel()
            NoteDetailScreen(
                note = note,
                viewModel = vm,
                onBack = { navController.popBackStack() },
                onAskAi = { navController.navigate("chat/${enc(noteId)}/${enc(noteTitle)}") },
            )
        }
        composable(
            route = Routes.CHAT,
            arguments = listOf(
                navArgument("noteId") { type = NavType.StringType },
                navArgument("noteTitle") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            val noteId = backStackEntry.arguments?.getString("noteId").orEmpty()
            val noteTitle = dec(backStackEntry.arguments?.getString("noteTitle").orEmpty())
            AiChatScreen(noteId = noteId, noteTitle = noteTitle, onBack = { navController.popBackStack() })
        }
    }
}

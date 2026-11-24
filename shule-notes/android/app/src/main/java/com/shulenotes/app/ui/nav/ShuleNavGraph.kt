package com.shulenotes.app.ui.nav

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.IntOffset
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.NoteCache
import com.shulenotes.app.data.SessionHolder
import com.shulenotes.app.ui.auth.LoginScreen
import com.shulenotes.app.ui.auth.RegisterScreen
import com.shulenotes.app.ui.chat.AiChatScreen
import com.shulenotes.app.ui.components.Notifier
import com.shulenotes.app.ui.main.ChooseClassScreen
import com.shulenotes.app.ui.main.MainScreen
import com.shulenotes.app.ui.onboarding.IntroScreen
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import com.shulenotes.app.ui.note.NoteDetailScreen

object Routes {
    const val INTRO = "intro"
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val CLASS = "class"
    const val MAIN = "main"
    const val NOTE = "note/{noteId}?page={page}"
    const val CHAT = "chat/{noteId}"
}

@Composable
fun ShuleNavGraph(startDestination: String) {
    val navController = rememberNavController()
    val toMain = { navController.navigate(Routes.MAIN) { popUpTo(0) } }
    val toLogin = { navController.navigate(Routes.LOGIN) { popUpTo(0) } }
    // After signing out the introduction comes first again, then the sign-in screen.
    val toIntro = { navController.navigate(Routes.INTRO) { popUpTo(0) } }
    val scope = rememberCoroutineScope()
    // Someone who has not chosen a class yet is asked before seeing any notes.
    val afterSignIn: () -> Unit = {
        scope.launch {
            val needsClass = ShuleApp.session.classLevel.first().isBlank()
            navController.navigate(if (needsClass) Routes.CLASS else Routes.MAIN) { popUpTo(0) }
        }
    }

    // The server rejected the saved sign-in (it expired, or the account is gone).
    val expired by SessionHolder.expired.collectAsState()
    LaunchedEffect(expired) {
        if (expired) {
            ShuleApp.session.clear()
            NoteCache.clear()
            SessionHolder.expired.value = false
            toIntro()
            Notifier.info(SessionHolder.expiredMessage ?: "Please sign in again")
            SessionHolder.expiredMessage = null
        }
    }

    // One motion for every screen: the new one slides in from the right while fading up, the old one drifts
    // left and fades; going back reverses it.
    val slide = tween<IntOffset>(durationMillis = 340, easing = FastOutSlowInEasing)
    val fade = tween<Float>(durationMillis = 260, easing = FastOutSlowInEasing)
    NavHost(
        navController = navController,
        startDestination = startDestination,
        enterTransition = { slideInHorizontally(slide) { it / 5 } + fadeIn(fade) },
        exitTransition = { slideOutHorizontally(slide) { -it / 8 } + fadeOut(tween(200)) },
        popEnterTransition = { slideInHorizontally(slide) { -it / 8 } + fadeIn(fade) },
        popExitTransition = { slideOutHorizontally(slide) { it / 5 } + fadeOut(tween(200)) },
    ) {
        composable(Routes.INTRO) {
            IntroScreen(onFinished = {
                scope.launch {
                    ShuleApp.session.setIntroSeen()
                    toLogin()
                }
            })
        }
        composable(Routes.LOGIN) {
            LoginScreen(
                viewModel = viewModel(),
                onLoggedIn = afterSignIn,
                onGoToRegister = { navController.navigate(Routes.REGISTER) { launchSingleTop = true } },
            )
        }
        composable(Routes.REGISTER) {
            RegisterScreen(
                viewModel = viewModel(),
                onRegistered = afterSignIn,
                onGoToLogin = { navController.popBackStack() },
            )
        }
        composable(Routes.CLASS) {
            ChooseClassScreen(viewModel = viewModel(), onDone = toMain)
        }
        composable(Routes.MAIN) {
            MainScreen(
                viewModel = viewModel(),
                onOpenNote = { noteId -> navController.navigate("note/$noteId") { launchSingleTop = true } },
                onOpenPage = { noteId, page -> navController.navigate("note/$noteId?page=$page") { launchSingleTop = true } },
                onSignedOut = toIntro,
            )
        }
        composable(
            Routes.NOTE,
            arguments = listOf(
                navArgument("noteId") { type = NavType.StringType },
                navArgument("page") { type = NavType.IntType; defaultValue = 0 },
            ),
        ) { entry ->
            val noteId = entry.arguments?.getString("noteId").orEmpty()
            val page = entry.arguments?.getInt("page") ?: 0
            NoteDetailScreen(
                noteId = noteId,
                startPage = page,
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

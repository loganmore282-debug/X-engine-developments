package com.shulenotes.app.ui.chat

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import com.shulenotes.app.data.NoteCache
import kotlinx.coroutines.delay

class ChatViewModelFactory(private val noteId: String) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        @Suppress("UNCHECKED_CAST")
        return ChatViewModel(noteId) as T
    }
}

private val Suggestions = listOf(
    "Summarise this document",
    "What are the key points to remember?",
    "Give me five practice questions",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiChatScreen(
    noteId: String,
    onBack: () -> Unit,
    viewModel: ChatViewModel = viewModel(factory = ChatViewModelFactory(noteId)),
) {
    com.shulenotes.app.ui.components.SecureWindow()
    var input by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()
    val noteTitle = NoteCache.get(noteId)?.title
    val rowCount = viewModel.messages.size + if (viewModel.isSending) 1 else 0

    LaunchedEffect(rowCount) {
        if (rowCount > 0) listState.animateScrollToItem(rowCount - 1)
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        modifier = Modifier.imePadding(),
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Study helper", style = MaterialTheme.typography.titleMedium)
                        if (noteTitle != null) {
                            Text(
                                noteTitle,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        bottomBar = {
            Column(modifier = Modifier.background(MaterialTheme.colorScheme.surface)) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 14.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    TextField(
                        value = input,
                        onValueChange = { input = it },
                        placeholder = { Text("Ask about this document") },
                        maxLines = 4,
                        shape = RoundedCornerShape(26.dp),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                        ),
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    FilledIconButton(
                        onClick = {
                            val question = input
                            input = ""
                            viewModel.ask(question)
                        },
                        enabled = !viewModel.isSending && input.isNotBlank(),
                        modifier = Modifier.padding(bottom = 4.dp).size(48.dp),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
                    }
                }
            }
        },
    ) { padding ->
        if (viewModel.messages.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(36.dp))
                HelperBadge(size = 64)
                Spacer(Modifier.height(20.dp))
                Text("Ask about this document", style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
                Spacer(Modifier.height(6.dp))
                Text(
                    "The helper answers from this document only. Check anything important against your notes.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(28.dp))
                Suggestions.forEach { suggestion ->
                    Surface(
                        onClick = { viewModel.ask(suggestion) },
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp),
                    ) {
                        Text(
                            suggestion,
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 15.dp),
                        )
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                itemsIndexed(viewModel.messages) { index, message ->
                    ChatBubble(
                        message = message,
                        // A fresh answer types itself in, word by word; one already seen (scrolling back, turning the phone) is shown whole.
                        reveal = message.role == "assistant" && !message.isError && index !in viewModel.revealed,
                        onRevealStarted = { viewModel.revealed.add(index) },
                    )
                }
                if (viewModel.isSending) {
                    item(key = "thinking") { ThinkingBubble() }
                }
            }
        }
    }
}

@Composable
private fun HelperBadge(size: Int, pulse: Boolean = false) {
    if (pulse) {
        // While the helper is working, its badge breathes gently (only this one: a resting badge costs no animation).
        val transition = rememberInfiniteTransition(label = "badge")
        val breathing by transition.animateFloat(
            initialValue = 1f,
            targetValue = 1.16f,
            animationSpec = infiniteRepeatable(tween(850, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            label = "badge-scale",
        )
        BadgeBox(size, breathing)
    } else {
        BadgeBox(size, 1f)
    }
}

@Composable
private fun BadgeBox(size: Int, scale: Float) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape((size * 0.32f).dp))
            .background(MaterialTheme.colorScheme.secondaryContainer),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Filled.AutoAwesome,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.size((size * 0.5f).dp),
        )
    }
}

@Composable
private fun ChatBubble(message: DisplayMessage, reveal: Boolean = false, onRevealStarted: () -> Unit = {}) {
    val isUser = message.role == "user"
    val maxWidth = (LocalConfiguration.current.screenWidthDp * 0.8f).dp
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Top,
    ) {
        if (!isUser) {
            HelperBadge(size = 32)
            Spacer(Modifier.width(8.dp))
        }
        Surface(
            color = when {
                message.isError -> MaterialTheme.colorScheme.errorContainer
                isUser -> MaterialTheme.colorScheme.primary
                else -> MaterialTheme.colorScheme.surface
            },
            contentColor = when {
                message.isError -> MaterialTheme.colorScheme.onErrorContainer
                isUser -> MaterialTheme.colorScheme.onPrimary
                else -> MaterialTheme.colorScheme.onSurface
            },
            border = if (isUser || message.isError) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            shape = if (isUser) RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp) else RoundedCornerShape(6.dp, 20.dp, 20.dp, 20.dp),
            modifier = Modifier.widthIn(max = maxWidth),
        ) {
            SelectionContainer {
                RevealText(
                    text = message.content,
                    animate = reveal,
                    onStarted = onRevealStarted,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
        }
    }
}

// An answer types itself in, a few words at a time, instead of appearing all at once.
@Composable
private fun RevealText(text: String, animate: Boolean, onStarted: () -> Unit, modifier: Modifier = Modifier) {
    // Decided once per answer: it must not change halfway (the screen marks the answer as seen as soon as it starts).
    val playing = remember(text) { animate }
    var shown by remember(text) { mutableStateOf(if (playing) 0 else text.length) }
    LaunchedEffect(text) {
        if (playing) {
            onStarted()
            val step = maxOf(3, text.length / 60)
            while (shown < text.length) {
                var next = minOf(text.length, shown + step)
                // finish the word it is in, so letters never flicker in the middle of a word
                while (next < text.length && !text[next].isWhitespace()) next++
                shown = next
                delay(22)
            }
        }
    }
    Text(text.substring(0, minOf(shown, text.length)), style = MaterialTheme.typography.bodyLarge, modifier = modifier)
}

// While the helper works: its badge breathes, a line of status text changes by itself, and three placeholder
// lines pulse one after another, like the answer being drawn.
@Composable
private fun ThinkingBubble() {
    val phrases = listOf("Reading the document…", "Finding the right pages…", "Working out the answer…", "Writing it clearly…")
    var phrase by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(2300)
            phrase = (phrase + 1) % phrases.size
        }
    }
    Row(verticalAlignment = Alignment.Top) {
        HelperBadge(size = 32, pulse = true)
        Spacer(Modifier.width(8.dp))
        Surface(
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            shape = RoundedCornerShape(6.dp, 20.dp, 20.dp, 20.dp),
        ) {
            Column(
                modifier = Modifier.width(236.dp).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Crossfade(targetState = phrase, animationSpec = tween(350), label = "thinking-phrase") { index ->
                    Text(
                        phrases[index],
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                SkeletonLine(fraction = 0.96f, startDelay = 0)
                SkeletonLine(fraction = 0.82f, startDelay = 160)
                SkeletonLine(fraction = 0.58f, startDelay = 320)
            }
        }
    }
}

@Composable
private fun SkeletonLine(fraction: Float, startDelay: Int) {
    val transition = rememberInfiniteTransition(label = "skeleton")
    val alpha by transition.animateFloat(
        initialValue = 0.06f,
        targetValue = 0.2f,
        animationSpec = infiniteRepeatable(tween(850, delayMillis = startDelay, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "skeleton-alpha",
    )
    Box(
        modifier = Modifier
            .fillMaxWidth(fraction)
            .height(10.dp)
            .clip(RoundedCornerShape(5.dp))
            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = alpha)),
    )
}

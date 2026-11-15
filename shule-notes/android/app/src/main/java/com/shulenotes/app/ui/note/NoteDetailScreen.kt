package com.shulenotes.app.ui.note

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.shulenotes.app.data.Note

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteDetailScreen(
    note: Note,
    viewModel: NoteViewModel,
    onBack: () -> Unit,
    onAskAi: () -> Unit,
) {
    LaunchedEffect(note.id) { viewModel.loadNote(note.id) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(note.title, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        floatingActionButton = {
            if (note.hasAiContext) {
                ExtendedFloatingActionButton(
                    onClick = onAskAi,
                    // Material hides the text from screen readers and expects the icon to carry the label.
                    icon = { Icon(Icons.Filled.Chat, contentDescription = "Ask AI") },
                    text = { Text("Ask AI") },
                )
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
            when (val state = viewModel.pdfState) {
                is PdfLoadState.Loading -> Text("Opening document…")
                is PdfLoadState.Failed -> Text(state.message)
                is PdfLoadState.Ready -> PdfPagesView(document = state.document, modifier = Modifier.fillMaxSize())
            }
        }
    }
}

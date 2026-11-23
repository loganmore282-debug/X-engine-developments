package com.shulenotes.app.ui.main

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shulenotes.app.ShuleApp
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.LevelGroup
import com.shulenotes.app.data.serverMessage
import com.shulenotes.app.ui.components.LogoMark
import com.shulenotes.app.ui.components.PrimaryButton
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.components.Notifier
import com.shulenotes.app.ui.theme.Poppins
import kotlinx.coroutines.launch
import java.io.IOException

private const val PER_ROW = 3

// "P1 - P7", "S1 - S4": the range a group covers, from its first and last class.
private fun rangeOf(group: LevelGroup): String =
    if (group.levels.size < 2) group.levels.firstOrNull()?.short.orEmpty()
    else "${group.levels.first().short} – ${group.levels.last().short}"

// Every class, grouped, as a grid of tappable cards. Used on the first-run
// screen and inside the sheet that changes the class later.
@Composable
fun LevelGroups(groups: List<LevelGroup>, selected: String?, onSelect: (String) -> Unit) {
    groups.forEachIndexed { index, group ->
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = if (index == 0) 4.dp else 22.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(group.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Text(rangeOf(group), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        group.levels.chunked(PER_ROW).forEach { rowLevels ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(10.dp),
            ) {
                rowLevels.forEach { level ->
                    LevelCard(
                        short = level.short,
                        name = level.name,
                        selected = selected == level.id,
                        onClick = { onSelect(level.id) },
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(PER_ROW - rowLevels.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun LevelCard(short: String, name: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(18.dp),
        color = if (selected) scheme.primaryContainer else scheme.surface,
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) scheme.primary else scheme.outlineVariant),
        modifier = modifier.height(76.dp).semantics { this.selected = selected; role = Role.RadioButton },
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    short,
                    fontFamily = Poppins,
                    fontWeight = FontWeight.Bold,
                    fontSize = 22.sp,
                    color = if (selected) scheme.onPrimaryContainer else scheme.onSurface,
                )
                Text(
                    name,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (selected) scheme.onPrimaryContainer else scheme.onSurfaceVariant,
                )
            }
            if (selected) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = scheme.primary,
                    modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).size(18.dp),
                )
            }
        }
    }
}

// The bottom sheet that changes which class's notes are shown.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClassPickerSheet(
    groups: List<LevelGroup>,
    selected: String?,
    onPick: (String?) -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .navigationBarsPadding(),
        ) {
            Text("Choose your class", style = MaterialTheme.typography.headlineSmall)
            Text(
                "You will see the notes for this class.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp, bottom = 14.dp),
            )
            if (groups.isEmpty()) {
                StateMessage(
                    icon = Icons.Outlined.CloudOff,
                    title = "Classes did not load",
                    body = "Check your internet and try again.",
                    actionLabel = "Try again",
                    onAction = onRetry,
                )
            } else {
                LevelGroups(groups = groups, selected = selected, onSelect = { onPick(it) })
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(top = 24.dp, bottom = 16.dp))
                OutlinedButton(
                    onClick = { onPick(null) },
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) { Text("Show notes from every class") }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

class ChooseClassViewModel : ViewModel() {
    var groups by mutableStateOf<List<LevelGroup>>(emptyList())
        private set
    var loading by mutableStateOf(true)
        private set
    var failed by mutableStateOf(false)
        private set
    var selected by mutableStateOf<String?>(null)
        private set
    var saving by mutableStateOf(false)
        private set

    init { load() }

    fun load() {
        viewModelScope.launch {
            loading = true
            failed = false
            try {
                groups = ApiClient.service.levels().groups ?: emptyList()
                failed = groups.isEmpty()
            } catch (e: Exception) {
                failed = true
            } finally {
                loading = false
            }
        }
    }

    fun select(level: String) { selected = level }

    fun save(onDone: () -> Unit) {
        val level = selected ?: return
        if (saving) return
        viewModelScope.launch {
            saving = true
            try {
                ApiClient.service.setClassLevel(mapOf("classLevel" to level))
                ShuleApp.session.setClassLevel(level)
                onDone()
            } catch (e: IOException) {
                Notifier.error("No connection. Check your internet and try again.")
            } catch (e: Exception) {
                Notifier.error(e.serverMessage() ?: "We could not save your class. Please try again.")
            } finally {
                saving = false
            }
        }
    }
}

// Shown once, right after the first sign-in: which class is the student in.
@Composable
fun ChooseClassScreen(viewModel: ChooseClassViewModel, onDone: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding(),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Spacer(Modifier.height(28.dp))
            LogoMark(size = 56.dp)
            Spacer(Modifier.height(22.dp))
            Text("Which class are you in?", style = MaterialTheme.typography.headlineMedium)
            Text(
                "We will show you the notes and exams for your class. You can change this at any time.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp, bottom = 18.dp),
            )
            when {
                viewModel.loading -> Box(Modifier.fillMaxWidth().padding(vertical = 56.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                viewModel.failed -> StateMessage(
                    icon = Icons.Outlined.CloudOff,
                    title = "Classes did not load",
                    body = "Check your internet and try again.",
                    actionLabel = "Try again",
                    onAction = { viewModel.load() },
                )
                else -> LevelGroups(groups = viewModel.groups, selected = viewModel.selected, onSelect = { viewModel.select(it) })
            }
            Spacer(Modifier.height(24.dp))
        }
        Surface(color = MaterialTheme.colorScheme.background, shadowElevation = 8.dp) {
            Column(modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp, vertical = 14.dp)) {
                PrimaryButton(
                    text = viewModel.selected?.let { "Continue as $it" } ?: "Choose your class",
                    loadingText = "Saving…",
                    loading = viewModel.saving,
                    enabled = viewModel.selected != null,
                    onClick = { viewModel.save(onDone) },
                )
            }
        }
    }
}

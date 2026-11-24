package com.shulenotes.app.ui.main

import androidx.compose.foundation.BorderStroke
import com.shulenotes.app.ui.components.subjectTint
import com.shulenotes.app.ui.components.subjectIcon
import com.shulenotes.app.data.Subject
import com.shulenotes.app.data.Note
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.collectAsState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.Crossfade
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
    // Which level tab is open (Primary / O-Level / A-Level).
    var groupIndex by mutableStateOf(0)
        private set
    // The library, only to show what the chosen class will get (real counts); best effort, never blocks choosing.
    var notes by mutableStateOf<List<Note>>(emptyList())
        private set
    var subjects by mutableStateOf<List<Subject>>(emptyList())
        private set

    init { load() }

    fun openGroup(index: Int) { groupIndex = index }

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
        viewModelScope.launch {
            try {
                notes = ApiClient.service.notes().notes ?: emptyList()
                subjects = ApiClient.service.subjects().subjects ?: emptyList()
            } catch (_: Exception) { /* the preview just says new notes will appear */ }
        }
    }

    fun select(level: String) {
        selected = level
        groups.indexOfFirst { g -> g.levels.any { it.id == level } }.takeIf { it >= 0 }?.let { groupIndex = it }
    }

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

// Shown once, right after the first sign-in: which class is the student in. One level at a time (Primary / O-Level /
// A-Level), big class tiles, and a live preview of what that class will get (real counts from the library).
@Composable
fun ChooseClassScreen(viewModel: ChooseClassViewModel, onDone: () -> Unit) {
    val name by ShuleApp.session.userName.collectAsState(initial = "")
    val first = name.trim().substringBefore(' ')
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
            Spacer(Modifier.height(24.dp))
            LogoMark(size = 52.dp)
            Spacer(Modifier.height(18.dp))
            if (first.isNotEmpty()) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)) {
                    Text(
                        "Welcome, $first",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
                Spacer(Modifier.height(12.dp))
            }
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
                else -> {
                    val groups = viewModel.groups
                    val index = viewModel.groupIndex.coerceIn(0, groups.size - 1)
                    LevelTabs(groups = groups, index = index, onPick = { viewModel.openGroup(it) })
                    Spacer(Modifier.height(14.dp))
                    Crossfade(targetState = index, label = "level") { at ->
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            groups[at].levels.chunked(4).forEach { rowLevels ->
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                                    rowLevels.forEach { level ->
                                        ClassDisc(
                                            short = level.short,
                                            name = level.name,
                                            selected = viewModel.selected == level.id,
                                            onClick = { viewModel.select(level.id) },
                                            modifier = Modifier.weight(1f),
                                        )
                                    }
                                    // A short last row keeps every tile the same size.
                                    repeat(4 - rowLevels.size) { Spacer(Modifier.weight(1f)) }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    ClassPreview(viewModel)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
        Surface(color = MaterialTheme.colorScheme.background, shadowElevation = 8.dp) {
            Column(modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp, vertical = 14.dp)) {
                PrimaryButton(
                    text = viewModel.selected?.let { "Start with $it" } ?: "Choose your class",
                    loadingText = "Saving…",
                    loading = viewModel.saving,
                    enabled = viewModel.selected != null,
                    onClick = { viewModel.save(onDone) },
                )
            }
        }
    }
}

// Primary | O-Level | A-Level, with the classes each covers.
@Composable
private fun LevelTabs(groups: List<LevelGroup>, index: Int, onPick: (Int) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Surface(shape = RoundedCornerShape(18.dp), color = scheme.surfaceVariant.copy(alpha = 0.55f), modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            groups.forEachIndexed { n, group ->
                val on = n == index
                val fill by animateColorAsState(if (on) scheme.surface else Color.Transparent, label = "tab")
                Surface(
                    onClick = { onPick(n) },
                    shape = RoundedCornerShape(14.dp),
                    color = fill,
                    shadowElevation = if (on) 2.dp else 0.dp,
                    modifier = Modifier.weight(1f).semantics { selected = on; role = Role.Tab },
                ) {
                    Column(modifier = Modifier.padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            group.name,
                            fontFamily = Poppins,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp,
                            color = if (on) scheme.onSurface else scheme.onSurfaceVariant,
                        )
                        Text(rangeOf(group), style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

// One class: a big tile, every one the same size.
@Composable
private fun ClassDisc(short: String, name: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    val fill by animateColorAsState(if (selected) scheme.primary else scheme.surface, label = "fill")
    val ink = if (selected) scheme.onPrimary else scheme.onSurface
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = fill,
        border = BorderStroke(if (selected) 0.dp else 1.5.dp, scheme.outlineVariant),
        shadowElevation = if (selected) 6.dp else 0.dp,
        modifier = modifier.height(84.dp).semantics { this.selected = selected; role = Role.RadioButton },
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(short, fontFamily = Poppins, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = ink)
                Text(name, fontSize = 11.sp, color = if (selected) scheme.onPrimary.copy(alpha = 0.85f) else scheme.onSurfaceVariant)
            }
            if (selected) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = scheme.onPrimary,
                    modifier = Modifier.align(Alignment.TopEnd).padding(7.dp).size(18.dp),
                )
            }
        }
    }
}

// What the chosen class will get, counted from the real library (nothing is invented).
@Composable
private fun ClassPreview(viewModel: ChooseClassViewModel) {
    val scheme = MaterialTheme.colorScheme
    val picked = viewModel.selected
    val known = viewModel.groups.flatMap { g -> g.levels.map { it.id } }.toSet()
    val list = if (picked == null) emptyList() else viewModel.notes.filter { n ->
        val c = n.classLevel
        c.isNullOrBlank() || c == picked || c !in known
    }
    val subs = viewModel.subjects.filter { s -> list.any { it.subjectId == s.id } }
    val exams = list.count { it.kind == "past-paper" }
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = scheme.primary.copy(alpha = 0.07f),
        border = BorderStroke(1.dp, scheme.outlineVariant),
        modifier = Modifier.fillMaxWidth().animateContentSize(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (picked == null) {
                Text(
                    "Pick your class to see what is waiting for you.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = scheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                )
            } else if (list.isEmpty()) {
                Text(picked, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text(
                    "New notes and exams for this class appear here the moment they are added.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = scheme.onSurfaceVariant,
                )
            } else {
                Text(picked, fontFamily = Poppins, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text(
                    (if (list.size == 1) "1 document" else "${list.size} documents") +
                        (if (exams > 0) " · " + (if (exams == 1) "1 exam" else "$exams exams") else "") +
                        " · " + (if (subs.size == 1) "1 subject" else "${subs.size} subjects"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = scheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    subs.take(5).forEach { s ->
                        val tint = subjectTint(s.id, viewModel.subjects)
                        Box(
                            modifier = Modifier.size(40.dp).clip(RoundedCornerShape(13.dp)).background(tint.container),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(painterResource(subjectIcon(s.name)), contentDescription = s.name, tint = tint.accent, modifier = Modifier.size(24.dp))
                        }
                    }
                    if (subs.size > 5) {
                        Box(
                            modifier = Modifier.height(40.dp).clip(RoundedCornerShape(13.dp)).background(scheme.surfaceVariant).padding(horizontal = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text("+${subs.size - 5}", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant) }
                    }
                }
            }
        }
    }
}

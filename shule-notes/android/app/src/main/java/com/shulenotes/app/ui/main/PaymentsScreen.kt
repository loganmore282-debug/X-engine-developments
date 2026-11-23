package com.shulenotes.app.ui.main

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.PaymentRecord
import com.shulenotes.app.data.serverMessage
import com.shulenotes.app.ui.components.StateMessage
import com.shulenotes.app.ui.components.StatusBarIcons
import com.shulenotes.app.ui.components.parseIsoMillis
import java.io.IOException
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// Profile > Payment history: every pass the student bought (or was given), newest first, with a clear status.
// Read straight from the server, so it is the same on the website and on any phone.
@Composable
fun PaymentsScreen(onBack: () -> Unit) {
    StatusBarIcons(light = MaterialTheme.colorScheme.background.luminance() < 0.5f)
    var rows by remember { mutableStateOf<List<PaymentRecord>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        error = null
        try {
            rows = ApiClient.service.myPayments().payments ?: emptyList()
        } catch (e: IOException) {
            error = "No connection. Check your internet and try again."
        } catch (e: Exception) {
            error = e.serverMessage() ?: "Could not load your payments."
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 8.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            Text("Payment history", style = MaterialTheme.typography.titleLarge)
        }

        val list = rows
        when {
            error != null && list == null -> Box(Modifier.fillMaxSize()) {
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    StateMessage(icon = Icons.Outlined.ErrorOutline, title = "Could not load", body = error ?: "")
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { attempt++ }) { Text("Try again") }
                }
            }
            list == null -> Box(Modifier.fillMaxSize()) { CircularProgressIndicator(Modifier.align(Alignment.Center)) }
            list.isEmpty() -> Box(Modifier.fillMaxSize()) {
                StateMessage(
                    icon = Icons.AutoMirrored.Outlined.ReceiptLong,
                    title = "No payments yet",
                    body = "When you buy a pass with mobile money, it appears here with its date and amount.",
                    modifier = Modifier.align(Alignment.Center),
                )
            }
            else -> {
                val total = list.filter { it.status == "paid" && !it.gift }.sumOf { it.amount }
                LazyColumn(
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    item(key = "total") {
                        Surface(
                            shape = RoundedCornerShape(22.dp),
                            color = MaterialTheme.colorScheme.primaryContainer,
                            modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
                        ) {
                            Column(Modifier.padding(20.dp)) {
                                Text("Total paid", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                                Text(ugx(total), style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                                val count = list.count { it.status == "paid" }
                                Text(
                                    if (count == 1) "1 pass" else "$count passes",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f),
                                )
                            }
                        }
                    }
                    items(list, key = { it.id }) { PaymentRow(it) }
                }
            }
        }
    }
}

@Composable
private fun PaymentRow(p: PaymentRecord) {
    val (icon, tint, label) = statusLook(p)
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(42.dp).background(tint.copy(alpha = 0.14f), CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp)) }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text((p.planName ?: "Pass") + "  ·  " + (p.classLevel ?: "All classes"), style = MaterialTheme.typography.titleSmall)
                Text(
                    dateLabel(p.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (p.status == "paid" && p.accessUntil != null) {
                    Text(
                        "Gave access until " + dateLabel(p.accessUntil),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(if (p.gift) "Free" else ugx(p.amount), style = MaterialTheme.typography.titleSmall)
                Text(label, style = MaterialTheme.typography.labelMedium, color = tint)
            }
        }
    }
}

private data class Look(val icon: ImageVector, val tint: Color, val label: String)

@Composable
private fun statusLook(p: PaymentRecord): Look {
    val green = Color(0xFF1E9E63)
    return when {
        p.gift -> Look(Icons.Outlined.CardGiftcard, Color(0xFF7C4DFF), "Gift")
        p.status == "paid" -> Look(Icons.Outlined.CheckCircle, green, "Paid")
        p.status == "failed" -> Look(Icons.Outlined.ErrorOutline, MaterialTheme.colorScheme.error, "Did not go through")
        p.status == "expired" -> Look(Icons.Outlined.ErrorOutline, MaterialTheme.colorScheme.onSurfaceVariant, "Not completed")
        else -> Look(Icons.Outlined.HourglassEmpty, Color(0xFFE09A00), "Waiting")
    }
}

// Full numbers with the currency, never shortened: "UGX 12,500".
private fun ugx(amount: Long): String = "UGX " + NumberFormat.getIntegerInstance(Locale.US).format(amount)

private fun dateLabel(iso: String?): String {
    val ms = parseIsoMillis(iso)
    if (ms <= 0L) return ""
    return SimpleDateFormat("d MMM yyyy, HH:mm", Locale.getDefault()).format(Date(ms))
}

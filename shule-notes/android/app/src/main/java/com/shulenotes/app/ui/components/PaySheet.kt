package com.shulenotes.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shulenotes.app.data.AccessHolder
import com.shulenotes.app.data.ApiClient
import com.shulenotes.app.data.Plan
import com.shulenotes.app.data.serverMessage
import com.shulenotes.app.ui.theme.Poppins
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class PayStep { CHOOSE, WAITING, DONE, FAILED }

fun ugx(amount: Int): String = "UGX " + String.format(Locale.US, "%,d", amount)

private fun lengthLabel(minutes: Int): String = when {
    minutes < 1440 -> "${(minutes + 30) / 60} hours of reading"
    minutes < 2880 -> "24 hours of reading"
    else -> "${(minutes + 720) / 1440} days of reading"
}

// "today at 14:30" for a pass ending within a day, otherwise the date.
fun passUntilLabel(untilMs: Long): String {
    val date = Date(untilMs)
    return if (untilMs - System.currentTimeMillis() < 24L * 3600 * 1000) {
        "today at " + SimpleDateFormat("HH:mm", Locale.getDefault()).format(date)
    } else {
        SimpleDateFormat("d MMM yyyy", Locale.getDefault()).format(date)
    }
}

// Choose a pass, enter the mobile money number, approve on the phone: the access appears by itself.
// The server sets the price and checks with MarzPay; nothing here can unlock a document.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaySheet(onDismiss: () -> Unit, onPaid: () -> Unit = {}) {
    val scope = rememberCoroutineScope()
    var plans by remember { mutableStateOf<List<Plan>?>(null) }
    var enabled by remember { mutableStateOf(true) }
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    var phone by rememberSaveable { mutableStateOf("") }
    var step by remember { mutableStateOf(PayStep.CHOOSE) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var paymentId by remember { mutableStateOf<String?>(null) }
    var failMessage by remember { mutableStateOf<String?>(null) }
    var paidUntilMs by remember { mutableStateOf(0L) }

    LaunchedEffect(Unit) {
        try {
            val r = ApiClient.service.plans()
            AccessHolder.update(r)
            val list = r.plans ?: emptyList()
            plans = list
            enabled = r.enabled
            if (phone.isBlank()) phone = r.phone.orEmpty()
            if (picked == null) picked = (list.getOrNull(2) ?: list.firstOrNull())?.id
        } catch (e: Exception) {
            error = e.serverMessage() ?: "We could not load the passes. Check your internet and try again."
        }
    }

    // While the student approves on the phone: ask every 3 seconds (the server asks MarzPay), for up to 3 minutes.
    LaunchedEffect(step, paymentId) {
        val id = paymentId
        if (step != PayStep.WAITING || id == null) return@LaunchedEffect
        var tries = 0
        while (tries < 60) {
            delay(3000)
            tries++
            try {
                val p = ApiClient.service.paymentStatus(id).payment
                if (p?.status == "paid") {
                    AccessHolder.applyUntil(p.accessUntil)
                    paidUntilMs = AccessHolder.parseIso(p.accessUntil)
                    step = PayStep.DONE
                    scope.launch { AccessHolder.refresh() }
                    onPaid()
                    return@LaunchedEffect
                }
                if (p?.status == "failed") {
                    failMessage = p.message
                    step = PayStep.FAILED
                    return@LaunchedEffect
                }
            } catch (e: Exception) {
                // a blip: try again
            }
        }
        failMessage = null
        step = PayStep.FAILED
    }

    val chosen = plans?.firstOrNull { it.id == picked }

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
            when (step) {
                PayStep.CHOOSE -> {
                    Text("Choose a pass", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "Pay once with mobile money and read everything for as long as the pass lasts.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 2.dp, bottom = 16.dp),
                    )
                    val list = plans
                    if (list == null && error == null) {
                        CircularProgressIndicator(modifier = Modifier.padding(vertical = 28.dp).align(Alignment.CenterHorizontally))
                    }
                    if (list != null && !enabled) {
                        Text("Payments are not open yet. Please try again later.", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 12.dp))
                    }
                    list?.forEach { p ->
                        val selected = p.id == picked
                        Surface(
                            onClick = { picked = p.id },
                            shape = RoundedCornerShape(18.dp),
                            color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                            border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
                        ) {
                            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(selected = selected, onClick = null)
                                Spacer(Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(p.name, style = MaterialTheme.typography.titleMedium)
                                    Text(lengthLabel(p.minutes), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Text(ugx(p.price), fontFamily = Poppins, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
                            }
                        }
                    }
                    if (list != null) {
                        Spacer(Modifier.height(6.dp))
                        ShuleTextField(
                            value = phone,
                            onValueChange = { phone = it.take(16) },
                            label = "MTN or Airtel mobile money number",
                            leadingIcon = Icons.Outlined.Call,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        )
                    }
                    if (error != null) {
                        Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
                    }
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton(
                        text = if (chosen != null) "Pay ${ugx(chosen.price)}" else "Pay",
                        loadingText = "Starting…",
                        loading = busy,
                        enabled = chosen != null && enabled,
                        onClick = {
                            val plan = chosen ?: return@PrimaryButton
                            busy = true
                            error = null
                            scope.launch {
                                try {
                                    val r = ApiClient.service.startPayment(mapOf("planId" to plan.id, "phone" to phone))
                                    paymentId = r.payment?.id
                                    step = PayStep.WAITING
                                } catch (e: java.io.IOException) {
                                    error = "No connection. Check your internet and try again."
                                } catch (e: Exception) {
                                    error = e.serverMessage() ?: "We could not start the payment. Please try again."
                                } finally {
                                    busy = false
                                }
                            }
                        },
                    )
                    Text(
                        "You will get a prompt on this number to approve with your PIN. Paying again adds time on top of what you have left.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    )
                }

                PayStep.WAITING -> Column(modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Approve on your phone", style = MaterialTheme.typography.headlineSmall)
                    Spacer(Modifier.height(24.dp))
                    CircularProgressIndicator(modifier = Modifier.size(44.dp))
                    Spacer(Modifier.height(20.dp))
                    Text("Check your phone", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Enter your mobile money PIN to approve ${if (chosen != null) ugx(chosen.price) else "the payment"}. This screen updates by itself.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 6.dp, bottom = 20.dp),
                    )
                    OutlinedButton(onClick = onDismiss, shape = RoundedCornerShape(14.dp)) { Text("Close, I will approve later") }
                }

                PayStep.DONE -> Column(modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(64.dp))
                    Spacer(Modifier.height(14.dp))
                    Text("Payment received", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        if (paidUntilMs > 0L) "Your pass lasts until ${passUntilLabel(paidUntilMs)}." else "Your pass is active.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 4.dp, bottom = 20.dp),
                    )
                    PrimaryButton(text = "Start reading", onClick = onDismiss)
                }

                PayStep.FAILED -> Column(modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (failMessage != null) "The payment did not go through" else "We did not see the payment", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                    Text(
                        failMessage ?: "If you approved it, your access appears within a minute or two. If not, nothing was taken.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 6.dp, bottom = 20.dp),
                    )
                    PrimaryButton(text = "Try again", onClick = { error = null; step = PayStep.CHOOSE })
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

// A card on Home: "Get a pass" for a student without one, or when theirs ends. Shows nothing while payments are off.
@Composable
fun PassBanner(modifier: Modifier = Modifier) {
    if (!AccessHolder.enabled) return
    var open by rememberSaveable { mutableStateOf(false) }
    val active = AccessHolder.active
    Surface(
        onClick = { open = true },
        shape = RoundedCornerShape(22.dp),
        color = if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.secondaryContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Lock, contentDescription = null, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(if (active) "Your pass is active" else "Get a pass to read everything", style = MaterialTheme.typography.titleSmall)
                Text(
                    if (active) "Until ${passUntilLabel(AccessHolder.untilMs)}. Tap to add more time." else "Pay with MTN or Airtel mobile money.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Icon(Icons.Outlined.ChevronRight, contentDescription = null)
        }
    }
    if (open) PaySheet(onDismiss = { open = false })
}

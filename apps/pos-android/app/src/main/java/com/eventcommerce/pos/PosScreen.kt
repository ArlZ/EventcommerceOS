package com.eventcommerce.pos

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.domain.CachedMenu
import com.eventcommerce.pos.domain.LocalOrder
import com.eventcommerce.pos.domain.LocalPaymentAttempt
import com.eventcommerce.pos.domain.PaymentAttemptState
import com.eventcommerce.pos.sync.PosPaymentCoordinator
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun PosScreen(
  repository: LocalPosRepository,
  paymentCoordinator: PosPaymentCoordinator? = null,
) {
  var menu by remember { mutableStateOf<CachedMenu?>(null) }
  var order by remember { mutableStateOf<LocalOrder?>(null) }
  var history by remember { mutableStateOf<List<LocalOrder>>(emptyList()) }
  var unresolvedPayments by remember { mutableStateOf<List<LocalPaymentAttempt>>(emptyList()) }
  var failedPayments by remember { mutableStateOf<List<LocalPaymentAttempt>>(emptyList()) }
  var outboxCount by remember { mutableStateOf(0) }
  var selectedCategory by remember { mutableStateOf("All") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var paymentNotice by remember { mutableStateOf<String?>(null) }
  var confirmClear by remember { mutableStateOf(false) }
  var paymentOrderId by remember { mutableStateOf<String?>(null) }
  var resumeAttemptId by remember { mutableStateOf<String?>(null) }
  var payerPhone by remember { mutableStateOf("2547") }
  val scope = rememberCoroutineScope()

  suspend fun refresh() {
    menu = repository.menuForSale()
    order = repository.currentOpenOrder()
    history = repository.history(5)
    unresolvedPayments = repository.unresolvedPayments()
    failedPayments = repository.failedPayments(5)
    outboxCount = repository.outboxCount()
  }

  fun mutate(action: suspend () -> Unit) {
    if (busy) return
    scope.launch {
      busy = true
      error = null
      runCatching {
        action()
        refresh()
      }.onFailure { failure -> error = failure.message ?: "Local transaction failed" }
      busy = false
    }
  }

  fun refreshPaymentRail() {
    val coordinator = paymentCoordinator ?: return
    scope.launch {
      runCatching { coordinator.refreshUnresolved() }
      refresh()
    }
  }

  LaunchedEffect(Unit) {
    runCatching {
      repository.ensureDevelopmentMenu()
      refresh()
    }.onFailure { failure -> error = failure.message ?: "Unable to open local POS" }
  }

  LaunchedEffect(paymentCoordinator) {
    val coordinator = paymentCoordinator ?: return@LaunchedEffect
    while (true) {
      delay(5_000)
      runCatching { coordinator.refreshUnresolved() }
      refresh()
    }
  }

  MaterialTheme {
    Surface(modifier = Modifier.fillMaxSize()) {
      Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
      ) {
        Text("Event Commerce POS", style = MaterialTheme.typography.headlineMedium)
        Text("Offline ordering ready • SQLite is authoritative until sync")
        menu?.let { active ->
          Text("Menu v${active.version} • ${active.currency} • ${active.items.size} items")
        }
        if (paymentCoordinator == null) {
          Text("M-PESA rail offline • ordering and cash remain available")
        }
        error?.let { Text("Error: $it", color = MaterialTheme.colorScheme.error) }
        paymentNotice?.let { Text(it) }

        val categories = listOf("All") + (menu?.items?.map { it.category }?.distinct()?.sorted() ?: emptyList())
        Row(
          modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
          horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          categories.forEach { category ->
            if (category == selectedCategory) {
              Button(onClick = { selectedCategory = category }) { Text(category) }
            } else {
              OutlinedButton(onClick = { selectedCategory = category }) { Text(category) }
            }
          }
        }

        val visibleItems = menu?.items
          ?.filter { selectedCategory == "All" || it.category == selectedCategory }
          ?.sortedWith(compareByDescending<com.eventcommerce.pos.domain.MenuCandidateItem> { it.favourite }.thenBy { it.sortOrder })
          ?: emptyList()

        LazyVerticalGrid(
          columns = GridCells.Adaptive(minSize = 150.dp),
          modifier = Modifier.fillMaxWidth().heightIn(min = 180.dp, max = 310.dp),
          horizontalArrangement = Arrangement.spacedBy(8.dp),
          verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          items(visibleItems, key = { it.itemId }) { item ->
            Button(
              onClick = { mutate { repository.addItem(item.itemId) } },
              enabled = !busy,
              modifier = Modifier.height(92.dp),
            ) {
              Column {
                Text(if (item.favourite) "★ ${item.name}" else item.name)
                Text(formatMinor(item.priceMinor, menu?.currency ?: ""))
              }
            }
          }
        }

        Card(modifier = Modifier.fillMaxWidth()) {
          Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Text("Current order", style = MaterialTheme.typography.titleLarge)
            val current = order
            if (current == null || current.items.isEmpty()) {
              Text("Tap a product to start a locally durable order.")
            } else {
              current.items.forEach { line ->
                Row(
                  modifier = Modifier.fillMaxWidth(),
                  horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                  Column(modifier = Modifier.weight(1f)) {
                    Text(line.name)
                    Text("${line.quantity} × ${formatMinor(line.unitPriceMinor, current.currency)}")
                  }
                  Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedButton(
                      onClick = { mutate { repository.removeItem(line.menuItemId) } },
                      enabled = !busy,
                    ) { Text("−") }
                    Button(
                      onClick = { mutate { repository.addItem(line.menuItemId) } },
                      enabled = !busy,
                    ) { Text("+") }
                  }
                }
              }
              Text("Total: ${formatMinor(current.totalMinor, current.currency)}", style = MaterialTheme.typography.titleLarge)
              Button(
                onClick = {
                  if (paymentCoordinator == null) {
                    error = "M-PESA is unavailable. Ordering is still available."
                  } else {
                    payerPhone = "2547"
                    paymentOrderId = current.id
                  }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(56.dp),
              ) {
                Text("Pay with M-PESA")
              }
              OutlinedButton(
                onClick = { mutate { repository.recordCashPayment(current.id) } },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
              ) {
                Text("Record cash payment (dev) • Close order")
              }
              OutlinedButton(
                onClick = { confirmClear = true },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
              ) {
                Text("Clear current order")
              }
            }
          }
        }

        if (unresolvedPayments.isNotEmpty()) {
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
          ) {
            Text("Payments in progress", style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = { refreshPaymentRail() }) { Text("Refresh") }
          }
          unresolvedPayments.take(4).forEach { payment ->
            PaymentStatusCard(
              payment = payment,
              onResume = {
                payerPhone = "2547"
                resumeAttemptId = payment.attemptId
              },
            )
          }
        }

        if (failedPayments.isNotEmpty()) {
          Text("Payment attention", style = MaterialTheme.typography.titleMedium)
          failedPayments.take(3).forEach { payment ->
            Card(modifier = Modifier.fillMaxWidth()) {
              Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("${payment.state} • ${formatMinor(payment.amountMinor, payment.currency)}")
                Text("Order ${payment.orderId.take(8)} • no payment is pending on this attempt")
                OutlinedButton(
                  onClick = {
                    mutate { repository.resumeOrderAfterFailedPayment(payment.attemptId) }
                  },
                  enabled = !busy,
                ) { Text("Return order to cart") }
              }
            }
          }
        }

        Spacer(modifier = Modifier.height(2.dp))
        Text("Local transaction history", style = MaterialTheme.typography.titleMedium)
        if (history.isEmpty()) {
          Text("No closed local orders yet.")
        } else {
          history.forEach { closed ->
            Text("${closed.id.take(8)} • ${formatMinor(closed.totalMinor, closed.currency)} • CLOSED")
          }
        }
        Text("Durable local outbox events retained: $outboxCount")
      }
    }
  }

  if (confirmClear) {
    AlertDialog(
      onDismissRequest = { confirmClear = false },
      title = { Text("Clear current order?") },
      text = { Text("This removes all items from the still-open local order.") },
      confirmButton = {
        TextButton(onClick = {
          confirmClear = false
          mutate { repository.clearCurrentOrder() }
        }) { Text("Clear") }
      },
      dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Keep order") } },
    )
  }

  val targetOrderId = paymentOrderId
  if (targetOrderId != null) {
    PhoneDialog(
      title = "Send M-PESA prompt",
      phone = payerPhone,
      onPhoneChange = { payerPhone = it },
      onDismiss = { paymentOrderId = null },
      onConfirm = {
        val coordinator = paymentCoordinator
        val phone = payerPhone
        paymentOrderId = null
        if (coordinator == null) {
          error = "M-PESA is unavailable"
        } else {
          scope.launch {
            error = null
            paymentNotice = null
            val attempt = runCatching {
              coordinator.validatePayerMsisdn(phone)
              busy = true
              coordinator.beginMpesa(targetOrderId)
            }.onFailure { failure ->
              error = failure.message ?: "Unable to start payment"
            }.getOrNull()
            busy = false
            refresh()
            if (attempt != null) {
              paymentNotice = "M-PESA request started. You can serve the next customer while it completes."
              scope.launch {
                runCatching { coordinator.relayMpesa(attempt.attemptId, phone) }
                refresh()
              }
            }
          }
        }
      },
    )
  }

  val targetAttemptId = resumeAttemptId
  if (targetAttemptId != null) {
    PhoneDialog(
      title = "Resume unknown M-PESA request",
      phone = payerPhone,
      onPhoneChange = { payerPhone = it },
      onDismiss = { resumeAttemptId = null },
      onConfirm = {
        val coordinator = paymentCoordinator
        val phone = payerPhone
        resumeAttemptId = null
        if (coordinator == null) {
          error = "M-PESA is unavailable"
        } else {
          scope.launch {
            error = null
            runCatching {
              coordinator.validatePayerMsisdn(phone)
              coordinator.resumeUnknownInitiation(targetAttemptId, phone)
              refresh()
            }.onFailure { failure -> error = failure.message ?: "Unable to resume payment" }
          }
        }
      },
    )
  }
}

@Composable
private fun PaymentStatusCard(
  payment: LocalPaymentAttempt,
  onResume: () -> Unit,
) {
  Card(modifier = Modifier.fillMaxWidth()) {
    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text("${payment.state} • ${formatMinor(payment.amountMinor, payment.currency)}")
      Text("Order ${payment.orderId.take(8)} • ${payment.maskedPayerReference ?: "payer not stored"}")
      when (payment.state) {
        PaymentAttemptState.INITIATED ->
          Text("Sending request. The order is safely suspended; the POS can keep selling.")
        PaymentAttemptState.PENDING ->
          Text("Waiting for provider confirmation. Do not start another M-PESA payment for this order.")
        PaymentAttemptState.UNKNOWN -> {
          if (payment.providerRequestId == null) {
            Text("Provider truth is unknown. Check status before resending any prompt.")
            OutlinedButton(onClick = onResume) { Text("Resume safely") }
          } else {
            Text("Provider accepted the attempt; reconciliation is running. Do not retry.")
          }
        }
        else -> Unit
      }
    }
  }
}

@Composable
private fun PhoneDialog(
  title: String,
  phone: String,
  onPhoneChange: (String) -> Unit,
  onDismiss: () -> Unit,
  onConfirm: () -> Unit,
) {
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Use 254XXXXXXXXX. The full number is sent only for this request and is not stored locally.")
        OutlinedTextField(
          value = phone,
          onValueChange = onPhoneChange,
          label = { Text("M-PESA phone") },
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
          singleLine = true,
        )
      }
    },
    confirmButton = { TextButton(onClick = onConfirm) { Text("Send prompt") } },
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
  )
}

private fun formatMinor(amountMinor: Long, currency: String): String {
  val whole = amountMinor / 100
  val fraction = (amountMinor % 100).toString().padStart(2, '0')
  return "$currency $whole.$fraction"
}

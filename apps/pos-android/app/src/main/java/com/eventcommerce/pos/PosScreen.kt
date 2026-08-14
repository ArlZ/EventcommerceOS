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
import androidx.compose.ui.unit.dp
import com.eventcommerce.pos.data.LocalPaymentAttempt
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.domain.CachedMenu
import com.eventcommerce.pos.domain.LocalOrder
import com.eventcommerce.pos.domain.OrderState
import com.eventcommerce.pos.payments.PaymentCoordinator
import kotlinx.coroutines.launch

@Composable
fun PosScreen(repository: LocalPosRepository, payments: PaymentCoordinator) {
  var menu by remember { mutableStateOf<CachedMenu?>(null) }
  var order by remember { mutableStateOf<LocalOrder?>(null) }
  var paymentAttempt by remember { mutableStateOf<LocalPaymentAttempt?>(null) }
  var history by remember { mutableStateOf<List<LocalOrder>>(emptyList()) }
  var outboxCount by remember { mutableStateOf(0) }
  var selectedCategory by remember { mutableStateOf("All") }
  var customerPhone by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var confirmClear by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()

  suspend fun refresh() {
    menu = repository.menuForSale()
    order = repository.currentOpenOrder()
    paymentAttempt = order?.let { repository.paymentAttemptsForOrder(it.id).lastOrNull() }
    history = repository.history(5)
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

  LaunchedEffect(Unit) {
    runCatching {
      repository.ensureDevelopmentMenu()
      refresh()
    }.onFailure { failure -> error = failure.message ?: "Unable to open local POS" }
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
        error?.let { Text("Error: $it", color = MaterialTheme.colorScheme.error) }

        val current = order
        val orderEditable = current == null || current.state == OrderState.OPEN
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
          modifier = Modifier.fillMaxWidth().heightIn(min = 200.dp, max = 360.dp),
          horizontalArrangement = Arrangement.spacedBy(8.dp),
          verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          items(visibleItems, key = { it.itemId }) { item ->
            Button(
              onClick = { mutate { repository.addItem(item.itemId) } },
              enabled = !busy && orderEditable,
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
                      enabled = !busy && current.state == OrderState.OPEN,
                    ) { Text("−") }
                    Button(
                      onClick = { mutate { repository.addItem(line.menuItemId) } },
                      enabled = !busy && current.state == OrderState.OPEN,
                    ) { Text("+") }
                  }
                }
              }
              Text("Total: ${formatMinor(current.totalMinor, current.currency)}", style = MaterialTheme.typography.titleLarge)

              if (current.state == OrderState.OPEN) {
                OutlinedTextField(
                  value = customerPhone,
                  onValueChange = { customerPhone = it },
                  label = { Text("M-PESA phone") },
                  singleLine = true,
                  enabled = !busy,
                  modifier = Modifier.fillMaxWidth(),
                )
                Button(
                  onClick = {
                    mutate {
                      payments.startMpesa(current.id, customerPhone)
                      customerPhone = ""
                    }
                  },
                  enabled = !busy && customerPhone.isNotBlank(),
                  modifier = Modifier.fillMaxWidth().height(56.dp),
                ) {
                  Text("Pay with M-PESA")
                }
                Button(
                  onClick = { mutate { repository.recordCashPayment(current.id) } },
                  enabled = !busy,
                  modifier = Modifier.fillMaxWidth().height(56.dp),
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
              } else {
                val attempt = paymentAttempt
                Text("Payment state: ${attempt?.state?.name ?: "PENDING"}")
                when (attempt?.state?.name) {
                  "UNKNOWN" -> Text("Payment result is uncertain. Do not ask the customer to pay again until reconciled.")
                  "PENDING", "INITIATED", "CREATED" -> Text("Waiting for payment confirmation.")
                }
                if (attempt != null) {
                  OutlinedButton(
                    onClick = { mutate { payments.reconcile(attempt.id) } },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                  ) {
                    Text("Check payment status")
                  }
                }
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
}

private fun formatMinor(amountMinor: Long, currency: String): String {
  val whole = amountMinor / 100
  val fraction = (amountMinor % 100).toString().padStart(2, '0')
  return "$currency $whole.$fraction"
}

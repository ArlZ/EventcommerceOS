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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.eventcommerce.pos.data.LocalPaymentAttempt
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.domain.CachedMenu
import com.eventcommerce.pos.domain.LocalOrder
import com.eventcommerce.pos.domain.OrderState
import com.eventcommerce.pos.payments.EdgePaymentRailAvailability
import com.eventcommerce.pos.payments.PaymentCoordinator
import kotlinx.coroutines.launch

@Composable
fun PosScreen(
  repository: LocalPosRepository,
  payments: PaymentCoordinator,
  modifier: Modifier = Modifier,
) {
  var menu by remember { mutableStateOf<CachedMenu?>(null) }
  var order by remember { mutableStateOf<LocalOrder?>(null) }
  var paymentAttempt by remember { mutableStateOf<LocalPaymentAttempt?>(null) }
  var paymentRails by remember { mutableStateOf<List<EdgePaymentRailAvailability>>(emptyList()) }
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

  fun rail(providerId: String): EdgePaymentRailAvailability? =
    paymentRails.firstOrNull { it.providerId == providerId }

  fun mutate(action: suspend () -> Unit) {
    if (busy) return
    scope.launch {
      busy = true
      error = null
      runCatching {
        action()
        refresh()
      }.onFailure { failure -> error = failure.message ?: "Unable to complete that action" }
      busy = false
    }
  }

  LaunchedEffect(Unit) {
    runCatching {
      repository.ensureDevelopmentMenu()
      refresh()
    }.onFailure { failure -> error = failure.message ?: "Unable to open this register" }
    paymentRails = payments.railAvailability()
  }

  Surface(modifier = modifier.fillMaxSize()) {
    Column(
      modifier = Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = 16.dp, vertical = 12.dp),
      verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Column {
          Text("Take order", style = MaterialTheme.typography.headlineMedium)
          Text(
            "Tap products, confirm the total, then choose payment.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        menu?.let { active ->
          Text(
            "${active.currency} • menu ${active.version}",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }

      error?.let {
        Surface(
          color = MaterialTheme.colorScheme.errorContainer,
          shape = MaterialTheme.shapes.medium,
        ) {
          Text(
            it,
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            color = MaterialTheme.colorScheme.onErrorContainer,
            fontWeight = FontWeight.SemiBold,
          )
        }
      }

      Card(modifier = Modifier.fillMaxWidth()) {
        Column(
          modifier = Modifier.fillMaxWidth().padding(12.dp),
          verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
          ) {
            Text("Payment methods", style = MaterialTheme.typography.titleSmall)
            TextButton(
              onClick = { mutate { paymentRails = payments.railAvailability() } },
              enabled = !busy,
            ) {
              Text("Refresh")
            }
          }
          PaymentRailLine("M-PESA", rail("mpesa"))
          PaymentRailLine("Card • Pesapal Sabi", rail("pesapal_sabi"))
          Text(
            "If an electronic method is unavailable, ordering still works on this register.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }

      val current = order
      val orderEditable = current == null || current.state == OrderState.OPEN
      val categories = listOf("All") +
        (menu?.items?.map { it.category }?.distinct()?.sorted() ?: emptyList())

      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Products", style = MaterialTheme.typography.titleMedium)
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
      }

      val visibleItems = menu?.items
        ?.filter { selectedCategory == "All" || it.category == selectedCategory }
        ?.sortedWith(
          compareByDescending<com.eventcommerce.pos.domain.MenuCandidateItem> { it.favourite }
            .thenBy { it.sortOrder },
        )
        ?: emptyList()

      LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 142.dp),
        modifier = Modifier.fillMaxWidth().heightIn(min = 210.dp, max = 340.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        items(visibleItems, key = { it.itemId }) { item ->
          Button(
            onClick = { mutate { repository.addItem(item.itemId) } },
            enabled = !busy && orderEditable,
            modifier = Modifier.height(96.dp),
          ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
              Text(
                if (item.favourite) "★ ${item.name}" else item.name,
                fontWeight = FontWeight.SemiBold,
              )
              Text(formatMinor(item.priceMinor, menu?.currency ?: ""))
            }
          }
        }
      }

      Card(modifier = Modifier.fillMaxWidth()) {
        Column(
          modifier = Modifier.fillMaxWidth().padding(16.dp),
          verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
          Text("Current order", style = MaterialTheme.typography.titleLarge)
          if (current == null || current.items.isEmpty()) {
            Text(
              "No items yet. Tap a product above to start the order.",
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          } else {
            current.items.forEachIndexed { index, line ->
              if (index > 0) HorizontalDivider()
              Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
              ) {
                Column(modifier = Modifier.weight(1f)) {
                  Text(line.name, fontWeight = FontWeight.SemiBold)
                  Text(
                    "${line.quantity} × ${formatMinor(line.unitPriceMinor, current.currency)}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                  )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                  OutlinedButton(
                    onClick = { mutate { repository.removeItem(line.menuItemId) } },
                    enabled = !busy && current.state == OrderState.OPEN,
                    modifier = Modifier.height(48.dp),
                  ) {
                    Text("−")
                  }
                  Button(
                    onClick = { mutate { repository.addItem(line.menuItemId) } },
                    enabled = !busy && current.state == OrderState.OPEN,
                    modifier = Modifier.height(48.dp),
                  ) {
                    Text("+")
                  }
                }
              }
            }

            HorizontalDivider()
            Row(
              modifier = Modifier.fillMaxWidth(),
              horizontalArrangement = Arrangement.SpaceBetween,
            ) {
              Text("Total", style = MaterialTheme.typography.titleLarge)
              Text(
                formatMinor(current.totalMinor, current.currency),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
              )
            }

            if (current.state == OrderState.OPEN) {
              Text("Choose payment", style = MaterialTheme.typography.titleMedium)
              OutlinedTextField(
                value = customerPhone,
                onValueChange = { customerPhone = it },
                label = { Text("M-PESA phone number") },
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
                enabled = !busy && customerPhone.isNotBlank() && rail("mpesa")?.available == true,
                modifier = Modifier.fillMaxWidth().height(60.dp),
              ) {
                Text("Send M-PESA prompt")
              }
              Button(
                onClick = { mutate { payments.startCard(current.id) } },
                enabled = !busy && rail("pesapal_sabi")?.available == true,
                modifier = Modifier.fillMaxWidth().height(60.dp),
              ) {
                Text("Pay by card • Pesapal Sabi")
              }
              OutlinedButton(
                onClick = { mutate { repository.recordCashPayment(current.id) } },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(56.dp),
              ) {
                Text("Record cash • pilot")
              }
              TextButton(
                onClick = { confirmClear = true },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
              ) {
                Text("Clear this order")
              }
            } else {
              PaymentStateCard(paymentAttempt)
              paymentAttempt?.let { attempt ->
                if (attempt.providerId == "pesapal_sabi") {
                  Text(
                    "Sabi reference: ${attempt.id}",
                    style = MaterialTheme.typography.bodySmall,
                  )
                  Text(
                    "Enter this reference on the Sabi charge. Card details and PIN stay on the terminal.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                  )
                }
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

      if (history.isNotEmpty()) {
        Card(modifier = Modifier.fillMaxWidth()) {
          Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Text("Recent completed orders", style = MaterialTheme.typography.titleMedium)
            history.forEach { closed ->
              Text(
                "${closed.id.take(8)} • ${formatMinor(closed.totalMinor, closed.currency)}",
                style = MaterialTheme.typography.bodyMedium,
              )
            }
          }
        }
      }

      if (outboxCount > 0) {
        Text(
          "$outboxCount sale update(s) waiting to sync. They remain stored on this register.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      Spacer(modifier = Modifier.height(12.dp))
    }
  }

  if (confirmClear) {
    AlertDialog(
      onDismissRequest = { confirmClear = false },
      title = { Text("Clear this order?") },
      text = { Text("This removes all items from the open order before payment starts.") },
      confirmButton = {
        TextButton(
          onClick = {
            confirmClear = false
            mutate { repository.clearCurrentOrder() }
          },
        ) {
          Text("Clear order")
        }
      },
      dismissButton = {
        TextButton(onClick = { confirmClear = false }) {
          Text("Keep order")
        }
      },
    )
  }
}

@Composable
private fun PaymentRailLine(label: String, rail: EdgePaymentRailAvailability?) {
  val available = rail?.available == true
  Row(
    modifier = Modifier.fillMaxWidth(),
    horizontalArrangement = Arrangement.SpaceBetween,
  ) {
    Text(label)
    Text(
      when {
        rail == null -> "Checking"
        available -> "Available"
        else -> "Unavailable"
      },
      fontWeight = FontWeight.SemiBold,
      color = if (available) {
        MaterialTheme.colorScheme.primary
      } else {
        MaterialTheme.colorScheme.onSurfaceVariant
      },
    )
  }
}

@Composable
private fun PaymentStateCard(attempt: LocalPaymentAttempt?) {
  val state = attempt?.state?.name ?: "PENDING"
  val unknown = state == "UNKNOWN"
  Surface(
    color = if (unknown) {
      MaterialTheme.colorScheme.errorContainer
    } else {
      MaterialTheme.colorScheme.secondaryContainer
    },
    shape = MaterialTheme.shapes.medium,
  ) {
    Column(
      modifier = Modifier.fillMaxWidth().padding(14.dp),
      verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
      Text(
        when (state) {
          "SUCCESS" -> "Payment confirmed"
          "FAILED" -> "Payment failed"
          "UNKNOWN" -> "Payment not yet confirmed"
          else -> "Waiting for payment confirmation"
        },
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
      )
      Text(
        when (state) {
          "SUCCESS" -> "The payment provider has confirmed this payment."
          "FAILED" -> "The provider reported that this payment did not complete."
          "UNKNOWN" -> "Do not ask the customer to pay again. Check status until provider truth is known."
          else -> "Keep this order open while the provider responds. Do not start a second charge."
        },
        style = MaterialTheme.typography.bodyMedium,
      )
    }
  }
}

private fun formatMinor(amountMinor: Long, currency: String): String {
  val whole = amountMinor / 100
  val fraction = (amountMinor % 100).toString().padStart(2, '0')
  return "$currency $whole.$fraction"
}

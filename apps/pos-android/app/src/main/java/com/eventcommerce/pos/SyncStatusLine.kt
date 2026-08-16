package com.eventcommerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.eventcommerce.pos.data.DeviceSyncProvisioningStore
import com.eventcommerce.pos.data.DeviceSyncStateStore
import com.eventcommerce.pos.data.SyncQueueStore
import kotlinx.coroutines.delay

private data class SyncStatusView(
  val headline: String,
  val detail: String,
  val hasError: Boolean,
)

@Composable
fun SyncStatusLine(
  queue: SyncQueueStore,
  state: DeviceSyncStateStore,
  provisioning: DeviceSyncProvisioningStore,
) {
  var status by remember {
    mutableStateOf(
      SyncStatusView(
        headline = "Checking event connection…",
        detail = "Sales remain stored on this register while status loads.",
        hasError = false,
      ),
    )
  }

  LaunchedEffect(Unit) {
    while (true) {
      runCatching {
        val health = state.health()
        val pending = queue.countAfter(health.acknowledgedThroughSequence)
        val provisioned = provisioning.current() != null
        status = when {
          !provisioned -> SyncStatusView(
            headline = "Register setup required",
            detail = "Connect this register to Event Edge before trading.",
            hasError = true,
          )
          health.lastError != null -> SyncStatusView(
            headline = "Connection issue • keep selling",
            detail = "$pending sale update(s) waiting safely on this register. ${health.lastError}",
            hasError = true,
          )
          pending > 0 || health.edgeBacklogCount > 0 -> SyncStatusView(
            headline = "Selling safely • syncing in background",
            detail = "$pending register update(s) waiting • ${health.edgeBacklogCount} at Event Edge",
            hasError = false,
          )
          else -> SyncStatusView(
            headline = "Connected • sales synced",
            detail = "Event Edge has acknowledged register sequence ${health.acknowledgedThroughSequence}.",
            hasError = false,
          )
        }
      }
      delay(2_000)
    }
  }

  Surface(
    color = if (status.hasError) {
      MaterialTheme.colorScheme.errorContainer
    } else {
      MaterialTheme.colorScheme.secondaryContainer
    },
  ) {
    Row(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
      horizontalArrangement = Arrangement.SpaceBetween,
    ) {
      Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(status.headline, style = MaterialTheme.typography.labelLarge)
        Text(status.detail, style = MaterialTheme.typography.bodySmall)
      }
    }
  }
}

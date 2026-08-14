package com.eventcommerce.pos

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.eventcommerce.pos.data.DeviceSyncProvisioningStore
import com.eventcommerce.pos.data.DeviceSyncStateStore
import com.eventcommerce.pos.data.SyncQueueStore
import kotlinx.coroutines.delay

@Composable
fun SyncStatusLine(
  queue: SyncQueueStore,
  state: DeviceSyncStateStore,
  provisioning: DeviceSyncProvisioningStore,
) {
  var label by remember { mutableStateOf("Sync status loading") }
  LaunchedEffect(Unit) {
    while (true) {
      runCatching {
        val health = state.health()
        val pending = queue.countAfter(health.acknowledgedThroughSequence)
        val mode = if (provisioning.current() == null) "not provisioned" else "active"
        label = "Edge sync $mode • pending $pending • ack ${health.acknowledgedThroughSequence} • edge backlog ${health.edgeBacklogCount}" +
          (health.lastError?.let { " • error $it" } ?: "")
      }
      delay(2_000)
    }
  }
  Text(label)
}

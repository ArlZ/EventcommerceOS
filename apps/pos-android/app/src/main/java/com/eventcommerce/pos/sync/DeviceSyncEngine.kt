package com.eventcommerce.pos.sync

import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.DeviceSyncStateStore

class DeviceSyncEngine(
  db: AppDatabase,
  private val transport: DeviceEdgeTransport,
  private val state: DeviceSyncStateStore = DeviceSyncStateStore(db),
  private val clock: () -> Long = { System.currentTimeMillis() },
) {
  private val events = db.pendingEvents()

  suspend fun syncOnce(batchSize: Int = 50): DeviceSyncResult {
    val before = state.health()
    val all = events.events().sortedBy { it.sequence }
    val highestLocalSequence = all.maxOfOrNull { it.sequence } ?: 0L
    val pending = all
      .filter { it.sequence > before.acknowledgedThroughSequence }
      .take(batchSize.coerceIn(1, 100))

    if (pending.isEmpty()) {
      return DeviceSyncResult(
        attempted = 0,
        remaining = 0,
        acceptedThroughSequence = before.acknowledgedThroughSequence,
        edgeBacklogCount = before.edgeBacklogCount,
      )
    }

    val deviceIds = pending.map { it.deviceId }.distinct()
    require(deviceIds.size == 1) { "one POS database must contain one device identity" }
    val deviceId = deviceIds.single()

    return try {
      val acknowledgement = transport.send(deviceId, pending)
      require(acknowledgement.deviceId == deviceId) { "Edge acknowledged the wrong device" }
      require(acknowledgement.acceptedThroughSequence >= before.acknowledgedThroughSequence) {
        "Edge watermark moved backwards"
      }
      require(acknowledgement.acceptedThroughSequence <= highestLocalSequence) {
        "Edge watermark exceeds the highest local sequence"
      }
      state.recordSuccess(
        acknowledgement.acceptedThroughSequence,
        acknowledgement.edgeBacklogCount,
        clock(),
      )
      DeviceSyncResult(
        attempted = pending.size,
        remaining = all.count { it.sequence > acknowledgement.acceptedThroughSequence },
        acceptedThroughSequence = acknowledgement.acceptedThroughSequence,
        edgeBacklogCount = acknowledgement.edgeBacklogCount,
      )
    } catch (error: Throwable) {
      state.recordError(error.message ?: "Edge sync failed")
      throw error
    }
  }
}

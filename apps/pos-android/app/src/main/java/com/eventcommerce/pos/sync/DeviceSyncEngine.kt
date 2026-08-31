package com.eventcommerce.pos.sync

import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.DeviceSyncStateStore
import com.eventcommerce.pos.data.LocalDeviceState
import com.eventcommerce.pos.data.SyncQueueStore

class DeviceSyncEngine(
  db: AppDatabase,
  private val transport: DeviceEdgeTransport,
  private val state: DeviceSyncStateStore = DeviceSyncStateStore(db),
  private val clock: () -> Long = { System.currentTimeMillis() },
) {
  private val queue = SyncQueueStore(db)
  private val deviceState = LocalDeviceState(db)

  suspend fun syncOnce(batchSize: Int = 50): DeviceSyncResult {
    val before = state.health()
    val highestLocalSequence = queue.highestSequence()
    val pending = queue.pendingAfter(
      before.acknowledgedThroughSequence,
      batchSize.coerceIn(1, 100),
    )

    if (pending.isEmpty()) {
      val statusTransport = transport as? DeviceEdgeStatusTransport
      val deviceId = deviceState.existingId()
      if (statusTransport == null || deviceId == null) {
        return DeviceSyncResult(
          attempted = 0,
          remaining = 0,
          acceptedThroughSequence = before.acknowledgedThroughSequence,
          edgeBacklogCount = before.edgeBacklogCount,
        )
      }

      return try {
        val acknowledgement = statusTransport.status(deviceId)
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
        if (acknowledgement.hasConflict) {
          throw IllegalStateException("Edge reconciliation required before sync can advance")
        }
        DeviceSyncResult(
          attempted = 0,
          remaining = 0,
          acceptedThroughSequence = acknowledgement.acceptedThroughSequence,
          edgeBacklogCount = acknowledgement.edgeBacklogCount,
        )
      } catch (error: Throwable) {
        state.recordError(error.message ?: "Edge sync failed")
        throw error
      }
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
      if (acknowledgement.hasConflict) {
        throw IllegalStateException("Edge reconciliation required before sync can advance")
      }
      DeviceSyncResult(
        attempted = pending.size,
        remaining = queue.countAfter(acknowledgement.acceptedThroughSequence),
        acceptedThroughSequence = acknowledgement.acceptedThroughSequence,
        edgeBacklogCount = acknowledgement.edgeBacklogCount,
      )
    } catch (error: Throwable) {
      state.recordError(error.message ?: "Edge sync failed")
      throw error
    }
  }
}

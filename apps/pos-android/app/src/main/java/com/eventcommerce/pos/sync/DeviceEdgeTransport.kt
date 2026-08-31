package com.eventcommerce.pos.sync

import com.eventcommerce.pos.data.OutboxEventEntity

data class DeviceEdgeAck(
  val deviceId: String,
  val acceptedThroughSequence: Long,
  val edgeBacklogCount: Int,
  val hasConflict: Boolean = false,
)

fun interface DeviceEdgeTransport {
  suspend fun send(deviceId: String, events: List<OutboxEventEntity>): DeviceEdgeAck
}

interface DeviceEdgeStatusTransport {
  suspend fun status(deviceId: String): DeviceEdgeAck
}

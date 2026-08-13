package com.eventcommerce.pos.sync

import com.eventcommerce.pos.data.OutboxEventEntity

data class DeviceEdgeAck(
  val deviceId: String,
  val acceptedThroughSequence: Long,
  val edgeBacklogCount: Int,
)

fun interface DeviceEdgeTransport {
  suspend fun send(deviceId: String, events: List<OutboxEventEntity>): DeviceEdgeAck
}

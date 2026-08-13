package com.eventcommerce.pos.sync

data class DeviceSyncResult(
  val attempted: Int,
  val remaining: Int,
  val acceptedThroughSequence: Long,
  val edgeBacklogCount: Int,
)

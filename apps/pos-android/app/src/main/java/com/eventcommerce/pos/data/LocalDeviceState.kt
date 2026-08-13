package com.eventcommerce.pos.data

import java.util.UUID

class LocalDeviceState(
  db: AppDatabase,
  private val idFactory: () -> String = { UUID.randomUUID().toString() },
) {
  private val metadata = db.localMetadata()

  suspend fun id(): String {
    metadata.find(ID_KEY)?.value?.let { return it }
    val created = idFactory()
    metadata.put(LocalMetadataEntity(ID_KEY, created))
    return created
  }

  suspend fun nextSequence(): Long {
    val current = metadata.find(SEQUENCE_KEY)?.value?.toLongOrNull() ?: 0L
    val next = Math.addExact(current, 1L)
    metadata.put(LocalMetadataEntity(SEQUENCE_KEY, next.toString()))
    return next
  }

  companion object {
    private const val ID_KEY = "device_id"
    private const val SEQUENCE_KEY = "device_sequence"
  }
}

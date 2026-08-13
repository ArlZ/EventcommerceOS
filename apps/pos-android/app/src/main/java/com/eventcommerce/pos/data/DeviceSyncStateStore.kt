package com.eventcommerce.pos.data

data class LocalSyncHealth(
  val acknowledgedThroughSequence: Long,
  val lastSuccessAtEpochMs: Long?,
  val edgeBacklogCount: Int,
  val lastError: String?,
)

class DeviceSyncStateStore(db: AppDatabase) {
  private val metadata = db.localMetadata()

  suspend fun health(): LocalSyncHealth = LocalSyncHealth(
    acknowledgedThroughSequence = metadata.find(WATERMARK)?.value?.toLongOrNull() ?: 0L,
    lastSuccessAtEpochMs = metadata.find(LAST_SUCCESS)?.value?.toLongOrNull(),
    edgeBacklogCount = metadata.find(EDGE_BACKLOG)?.value?.toIntOrNull() ?: 0,
    lastError = metadata.find(LAST_ERROR)?.value?.takeIf { it.isNotBlank() },
  )

  suspend fun recordSuccess(
    acceptedThroughSequence: Long,
    edgeBacklogCount: Int,
    nowEpochMs: Long,
  ) {
    val current = health().acknowledgedThroughSequence
    require(acceptedThroughSequence >= current) { "sync watermark cannot move backwards" }
    metadata.put(LocalMetadataEntity(WATERMARK, acceptedThroughSequence.toString()))
    metadata.put(LocalMetadataEntity(LAST_SUCCESS, nowEpochMs.toString()))
    metadata.put(LocalMetadataEntity(EDGE_BACKLOG, edgeBacklogCount.coerceAtLeast(0).toString()))
    metadata.put(LocalMetadataEntity(LAST_ERROR, ""))
  }

  suspend fun recordError(message: String) {
    metadata.put(LocalMetadataEntity(LAST_ERROR, message.take(300)))
  }

  companion object {
    private const val WATERMARK = "sync_ack_watermark"
    private const val LAST_SUCCESS = "sync_last_success_ms"
    private const val EDGE_BACKLOG = "sync_edge_backlog"
    private const val LAST_ERROR = "sync_last_error"
  }
}

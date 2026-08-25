package com.eventcommerce.pos

import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.DeviceSyncStateStore
import com.eventcommerce.pos.data.LocalDeviceState
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.data.SyncQueueStore
import org.json.JSONObject

data class PilotDiagnosticsSnapshot(
  val generatedAtEpochMs: Long,
  val releaseCommit: String,
  val appVersionName: String,
  val appVersionCode: Int,
  val deviceId: String?,
  val activeMenuVersion: Long?,
  val closedOrderCount: Int,
  val highestLocalSequence: Long,
  val acknowledgedThroughSequence: Long,
  val pendingAfterAcknowledgement: Int,
  val edgeBacklogCount: Int,
  val lastSyncSuccessAtEpochMs: Long?,
  val hasSyncError: Boolean,
) {
  fun toJson(): String = JSONObject()
    .put("schemaVersion", 1)
    .put("generatedAtEpochMs", generatedAtEpochMs)
    .put("releaseCommit", releaseCommit)
    .put("appVersionName", appVersionName)
    .put("appVersionCode", appVersionCode)
    .put("deviceId", deviceId ?: JSONObject.NULL)
    .put("activeMenuVersion", activeMenuVersion ?: JSONObject.NULL)
    .put("closedOrderCount", closedOrderCount)
    .put("highestLocalSequence", highestLocalSequence)
    .put("acknowledgedThroughSequence", acknowledgedThroughSequence)
    .put("pendingAfterAcknowledgement", pendingAfterAcknowledgement)
    .put("edgeBacklogCount", edgeBacklogCount)
    .put("lastSyncSuccessAtEpochMs", lastSyncSuccessAtEpochMs ?: JSONObject.NULL)
    .put("hasSyncError", hasSyncError)
    .toString(2)
}

class PilotDiagnosticsCollector(
  private val db: AppDatabase,
  private val repository: LocalPosRepository,
  private val releaseCommit: String = BuildConfig.RELEASE_COMMIT,
  private val appVersionName: String = BuildConfig.VERSION_NAME,
  private val appVersionCode: Int = BuildConfig.VERSION_CODE,
  private val clock: () -> Long = { System.currentTimeMillis() },
) {
  private val deviceState = LocalDeviceState(db)
  private val syncState = DeviceSyncStateStore(db)
  private val queue = SyncQueueStore(db)

  suspend fun snapshot(): PilotDiagnosticsSnapshot {
    val health = syncState.health()
    val watermark = health.acknowledgedThroughSequence
    return PilotDiagnosticsSnapshot(
      generatedAtEpochMs = clock(),
      releaseCommit = releaseCommit,
      appVersionName = appVersionName,
      appVersionCode = appVersionCode,
      deviceId = deviceState.existingId(),
      activeMenuVersion = repository.activeMenu()?.version,
      closedOrderCount = repository.closedOrderCount(),
      highestLocalSequence = queue.highestSequence(),
      acknowledgedThroughSequence = watermark,
      pendingAfterAcknowledgement = queue.countAfter(watermark),
      edgeBacklogCount = health.edgeBacklogCount,
      lastSyncSuccessAtEpochMs = health.lastSuccessAtEpochMs,
      hasSyncError = health.lastError != null,
    )
  }
}

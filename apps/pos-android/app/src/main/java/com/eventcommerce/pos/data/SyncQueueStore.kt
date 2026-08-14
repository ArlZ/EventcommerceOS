package com.eventcommerce.pos.data

import androidx.sqlite.db.SimpleSQLiteQuery
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SyncQueueStore(private val db: AppDatabase) {
  private val deviceState = LocalDeviceState(db)

  suspend fun pendingAfter(watermark: Long, limit: Int): List<OutboxEventEntity> {
    val deviceId = deviceState.existingId() ?: return emptyList()
    return withContext(Dispatchers.IO) {
      val query = SimpleSQLiteQuery(
        """SELECT eventInstanceId, eventId, eventType, aggregateType, aggregateId,
           eventVersion, deviceId, sequence, occurredAtEpochMs, idempotencyKey,
           payloadJson, sentAtEpochMs
           FROM outbox_events
           WHERE deviceId = ? AND sequence > ?
           ORDER BY sequence ASC LIMIT ?""",
        arrayOf(deviceId, watermark, limit.coerceIn(1, 100)),
      )
      db.query(query).use { cursor ->
        buildList {
          while (cursor.moveToNext()) {
            add(
              OutboxEventEntity(
                eventInstanceId = cursor.getString(0),
                eventId = cursor.getString(1),
                eventType = cursor.getString(2),
                aggregateType = cursor.getString(3),
                aggregateId = cursor.getString(4),
                eventVersion = cursor.getInt(5),
                deviceId = cursor.getString(6),
                sequence = cursor.getLong(7),
                occurredAtEpochMs = cursor.getLong(8),
                idempotencyKey = cursor.getString(9),
                payloadJson = cursor.getString(10),
                sentAtEpochMs = if (cursor.isNull(11)) null else cursor.getLong(11),
              ),
            )
          }
        }
      }
    }
  }

  suspend fun countAfter(watermark: Long): Int {
    val deviceId = deviceState.existingId() ?: return 0
    return withContext(Dispatchers.IO) {
      db.query(
        SimpleSQLiteQuery(
          "SELECT COUNT(*) FROM outbox_events WHERE deviceId = ? AND sequence > ?",
          arrayOf(deviceId, watermark),
        ),
      ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else 0 }
    }
  }

  suspend fun highestSequence(): Long {
    val deviceId = deviceState.existingId() ?: return 0L
    return withContext(Dispatchers.IO) {
      db.query(
        SimpleSQLiteQuery(
          "SELECT COALESCE(MAX(sequence), 0) FROM outbox_events WHERE deviceId = ?",
          arrayOf(deviceId),
        ),
      ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
    }
  }
}

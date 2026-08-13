package com.eventcommerce.pos.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface PendingEventDao {
  @Insert(onConflict = OnConflictStrategy.ABORT)
  suspend fun insert(value: OutboxEventEntity)

  @Query("SELECT COUNT(*) FROM outbox_events")
  suspend fun countAll(): Int

  @Query("SELECT * FROM outbox_events ORDER BY sequence ASC")
  suspend fun events(): List<OutboxEventEntity>
}

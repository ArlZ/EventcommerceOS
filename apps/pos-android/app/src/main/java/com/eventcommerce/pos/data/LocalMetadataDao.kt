package com.eventcommerce.pos.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface LocalMetadataDao {
  @Query("SELECT * FROM local_metadata WHERE `key` = :key LIMIT 1")
  suspend fun find(key: String): LocalMetadataEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun put(value: LocalMetadataEntity)
}

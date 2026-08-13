package com.eventcommerce.pos.data

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(entities = [LocalMetadataEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
  abstract fun localMetadata(): LocalMetadataDao
}

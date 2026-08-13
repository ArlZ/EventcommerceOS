package com.eventcommerce.pos.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "local_metadata")
data class LocalMetadataEntity(@PrimaryKey val key: String, val value: String)

package com.eventcommerce.pos.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface MenuDao {
  @Query("SELECT * FROM menu_versions WHERE isActive = 1 ORDER BY version DESC LIMIT 1")
  suspend fun activeVersion(): MenuVersionEntity?

  @Query("SELECT * FROM menu_versions WHERE version = :version LIMIT 1")
  suspend fun version(version: Long): MenuVersionEntity?

  @Query("SELECT * FROM menu_items WHERE menuVersion = :version ORDER BY favourite DESC, sortOrder ASC, name ASC")
  suspend fun items(version: Long): List<MenuItemEntity>

  @Query("SELECT * FROM menu_items WHERE menuVersion = :version AND itemId = :itemId LIMIT 1")
  suspend fun item(version: Long, itemId: String): MenuItemEntity?

  @Query("UPDATE menu_versions SET isActive = 0 WHERE isActive = 1")
  suspend fun deactivateActive()

  @Insert(onConflict = OnConflictStrategy.ABORT)
  suspend fun insertVersion(value: MenuVersionEntity)

  @Insert(onConflict = OnConflictStrategy.ABORT)
  suspend fun insertItems(values: List<MenuItemEntity>)

  @Query("DELETE FROM menu_items WHERE menuVersion = :version")
  suspend fun deleteItems(version: Long)

  @Query("DELETE FROM menu_versions WHERE version = :version")
  suspend fun deleteVersion(version: Long)
}

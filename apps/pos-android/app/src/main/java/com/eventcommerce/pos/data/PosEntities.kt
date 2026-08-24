package com.eventcommerce.pos.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "menu_versions")
data class MenuVersionEntity(
  @PrimaryKey val version: Long,
  val eventId: String,
  val salesLocationId: String,
  val menuId: String,
  val activatedAtEpochMs: Long,
  val sourceActor: String,
  val currency: String,
  val checksum: String,
  val isActive: Boolean,
  val installedAtEpochMs: Long,
)

@Entity(tableName = "menu_items", primaryKeys = ["menuVersion", "itemId"])
data class MenuItemEntity(
  val menuVersion: Long,
  val itemId: String,
  val skuId: String,
  val name: String,
  val category: String,
  val priceMinor: Long,
  val favourite: Boolean,
  val sortOrder: Int,
)

@Entity(tableName = "pos_orders")
data class OrderEntity(
  @PrimaryKey val id: String,
  val eventId: String,
  val salesLocationId: String,
  val deviceId: String,
  val menuVersion: Long,
  val state: String,
  val currency: String,
  val subtotalMinor: Long,
  val totalMinor: Long,
  val createdAtEpochMs: Long,
  val updatedAtEpochMs: Long,
  val closedAtEpochMs: Long?,
)

@Entity(tableName = "order_items")
data class OrderItemEntity(
  @PrimaryKey val id: String,
  val orderId: String,
  val menuItemId: String,
  val skuId: String,
  val name: String,
  val unitPriceMinor: Long,
  val quantity: Int,
  val lineTotalMinor: Long,
)

@Entity(
  tableName = "outbox_events",
  indices = [Index(value = ["deviceId", "sequence"], unique = true)],
)
data class OutboxEventEntity(
  @PrimaryKey val eventInstanceId: String,
  val eventId: String,
  val eventType: String,
  val aggregateType: String,
  val aggregateId: String,
  val eventVersion: Int,
  val deviceId: String,
  val sequence: Long,
  val occurredAtEpochMs: Long,
  val idempotencyKey: String,
  val payloadJson: String,
  val sentAtEpochMs: Long?,
)

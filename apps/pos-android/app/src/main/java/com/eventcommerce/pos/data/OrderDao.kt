package com.eventcommerce.pos.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface OrderDao {
  @Query("SELECT * FROM pos_orders WHERE state = 'OPEN' ORDER BY createdAtEpochMs DESC LIMIT 1")
  suspend fun openOrder(): OrderEntity?

  @Query("SELECT * FROM pos_orders WHERE id = :orderId LIMIT 1")
  suspend fun order(orderId: String): OrderEntity?

  @Query("SELECT * FROM pos_orders WHERE state = 'PAYMENT_PENDING' ORDER BY updatedAtEpochMs ASC")
  suspend fun paymentPendingOrders(): List<OrderEntity>

  @Insert(onConflict = OnConflictStrategy.ABORT)
  suspend fun insertOrder(value: OrderEntity)

  @Update
  suspend fun updateOrder(value: OrderEntity)

  @Query("SELECT * FROM order_items WHERE orderId = :orderId AND quantity > 0 ORDER BY name ASC")
  suspend fun orderItems(orderId: String): List<OrderItemEntity>

  @Query("SELECT * FROM order_items WHERE orderId = :orderId AND menuItemId = :menuItemId LIMIT 1")
  suspend fun orderItem(orderId: String, menuItemId: String): OrderItemEntity?

  @Insert(onConflict = OnConflictStrategy.ABORT)
  suspend fun insertOrderItem(value: OrderItemEntity)

  @Update
  suspend fun updateOrderItem(value: OrderItemEntity)

  @Query("UPDATE order_items SET quantity = 0, lineTotalMinor = 0 WHERE orderId = :orderId")
  suspend fun clearOrderItems(orderId: String)

  @Query("SELECT * FROM pos_orders WHERE state = 'CLOSED' ORDER BY closedAtEpochMs DESC LIMIT :limit")
  suspend fun closedOrders(limit: Int): List<OrderEntity>

  @Query("SELECT COUNT(*) FROM pos_orders WHERE state = 'CLOSED'")
  suspend fun closedOrderCount(): Int
}

package com.eventcommerce.pos.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface PaymentDao {
  @Insert(onConflict = OnConflictStrategy.ABORT)
  suspend fun insert(value: PaymentAttemptEntity)

  @Update
  suspend fun update(value: PaymentAttemptEntity)

  @Query("SELECT * FROM payment_attempts WHERE attemptId = :attemptId LIMIT 1")
  suspend fun attempt(attemptId: String): PaymentAttemptEntity?

  @Query("SELECT * FROM payment_attempts WHERE initiationIdempotencyKey = :idempotencyKey LIMIT 1")
  suspend fun byIdempotencyKey(idempotencyKey: String): PaymentAttemptEntity?

  @Query(
    "SELECT * FROM payment_attempts WHERE orderId = :orderId ORDER BY createdAtEpochMs DESC",
  )
  suspend fun forOrder(orderId: String): List<PaymentAttemptEntity>

  @Query(
    "SELECT * FROM payment_attempts WHERE state IN ('INITIATED','PENDING','UNKNOWN') ORDER BY updatedAtEpochMs ASC",
  )
  suspend fun unresolved(): List<PaymentAttemptEntity>

  @Query(
    "SELECT * FROM payment_attempts WHERE state IN ('FAILED','EXPIRED') ORDER BY updatedAtEpochMs DESC LIMIT :limit",
  )
  suspend fun terminalFailures(limit: Int): List<PaymentAttemptEntity>
}

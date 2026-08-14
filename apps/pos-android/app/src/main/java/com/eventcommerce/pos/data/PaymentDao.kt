package com.eventcommerce.pos.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface PaymentDao {
  @Insert(onConflict = OnConflictStrategy.ABORT)
  suspend fun insertAttempt(attempt: PaymentAttemptEntity)

  @Update
  suspend fun updateAttempt(attempt: PaymentAttemptEntity)

  @Query("SELECT * FROM payment_attempts WHERE id = :id LIMIT 1")
  suspend fun attempt(id: String): PaymentAttemptEntity?

  @Query("SELECT * FROM payment_attempts WHERE idempotencyKey = :key LIMIT 1")
  suspend fun attemptByIdempotencyKey(key: String): PaymentAttemptEntity?

  @Query("SELECT * FROM payment_attempts WHERE orderId = :orderId ORDER BY createdAtEpochMs")
  suspend fun attemptsForOrder(orderId: String): List<PaymentAttemptEntity>

  @Query("SELECT * FROM payment_attempts WHERE state IN ('PENDING','UNKNOWN') ORDER BY updatedAtEpochMs")
  suspend fun unresolvedAttempts(): List<PaymentAttemptEntity>
}

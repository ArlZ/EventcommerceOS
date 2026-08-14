package com.eventcommerce.pos.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
  tableName = "payment_attempts",
  indices = [
    Index(value = ["idempotencyKey"], unique = true),
    Index(value = ["orderId"]),
  ],
)
data class PaymentAttemptEntity(
  @PrimaryKey val id: String,
  val paymentId: String,
  val eventId: String,
  val orderId: String,
  val providerId: String,
  val idempotencyKey: String,
  val amountMinor: Long,
  val currency: String,
  val state: String,
  val providerReference: String?,
  val failureCode: String?,
  val createdAtEpochMs: Long,
  val updatedAtEpochMs: Long,
)

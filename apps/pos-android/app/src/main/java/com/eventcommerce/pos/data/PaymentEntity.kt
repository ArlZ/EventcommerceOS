package com.eventcommerce.pos.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
  tableName = "payment_attempts",
  indices = [
    Index(value = ["initiationIdempotencyKey"], unique = true),
    Index(value = ["paymentId", "clientAttemptId"], unique = true),
    Index(value = ["orderId"]),
  ],
)
data class PaymentAttemptEntity(
  @PrimaryKey val attemptId: String,
  val paymentId: String,
  val clientAttemptId: String,
  val eventId: String,
  val orderId: String,
  val initiationIdempotencyKey: String,
  val provider: String,
  val state: String,
  val amountMinor: Long,
  val currency: String,
  val maskedPayerReference: String?,
  val providerRequestId: String?,
  val providerReceiptReference: String?,
  val reconciliationRequired: Boolean,
  val createdAtEpochMs: Long,
  val updatedAtEpochMs: Long,
)

package com.eventcommerce.pos.domain

enum class PaymentAttemptState {
  INITIATED,
  PENDING,
  SUCCESS,
  FAILED,
  EXPIRED,
  UNKNOWN,
  REVERSED,
}

data class LocalPaymentAttempt(
  val paymentId: String,
  val attemptId: String,
  val clientAttemptId: String,
  val eventId: String,
  val orderId: String,
  val provider: String,
  val state: PaymentAttemptState,
  val amountMinor: Long,
  val currency: String,
  val maskedPayerReference: String?,
  val providerRequestId: String?,
  val providerReceiptReference: String?,
  val reconciliationRequired: Boolean,
  val createdAtEpochMs: Long,
  val updatedAtEpochMs: Long,
)

object PaymentRules {
  fun isUnresolved(state: PaymentAttemptState): Boolean =
    state == PaymentAttemptState.INITIATED ||
      state == PaymentAttemptState.PENDING ||
      state == PaymentAttemptState.UNKNOWN

  fun canStartReplacement(state: PaymentAttemptState): Boolean =
    state == PaymentAttemptState.FAILED || state == PaymentAttemptState.EXPIRED
}

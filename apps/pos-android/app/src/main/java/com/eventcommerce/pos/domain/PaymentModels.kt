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
  val idempotencyKey: String,
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
  private val allowedTransitions = mapOf(
    PaymentAttemptState.INITIATED to setOf(
      PaymentAttemptState.PENDING,
      PaymentAttemptState.SUCCESS,
      PaymentAttemptState.FAILED,
      PaymentAttemptState.UNKNOWN,
    ),
    PaymentAttemptState.PENDING to setOf(
      PaymentAttemptState.SUCCESS,
      PaymentAttemptState.FAILED,
      PaymentAttemptState.EXPIRED,
      PaymentAttemptState.UNKNOWN,
    ),
    PaymentAttemptState.UNKNOWN to setOf(
      PaymentAttemptState.PENDING,
      PaymentAttemptState.SUCCESS,
      PaymentAttemptState.FAILED,
      PaymentAttemptState.EXPIRED,
    ),
    PaymentAttemptState.SUCCESS to setOf(PaymentAttemptState.REVERSED),
    PaymentAttemptState.FAILED to emptySet(),
    PaymentAttemptState.EXPIRED to emptySet(),
    PaymentAttemptState.REVERSED to emptySet(),
  )

  fun requireTransition(from: PaymentAttemptState, to: PaymentAttemptState) {
    if (from == to) return
    require(allowedTransitions.getValue(from).contains(to)) {
      "invalid payment attempt transition $from -> $to"
    }
  }

  fun isUnresolved(state: PaymentAttemptState): Boolean =
    state == PaymentAttemptState.INITIATED ||
      state == PaymentAttemptState.PENDING ||
      state == PaymentAttemptState.UNKNOWN

  fun canStartReplacement(state: PaymentAttemptState): Boolean =
    state == PaymentAttemptState.FAILED || state == PaymentAttemptState.EXPIRED
}

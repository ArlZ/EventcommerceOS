package com.eventcommerce.pos.domain

enum class PaymentAttemptState {
  CREATED,
  INITIATED,
  PENDING,
  SUCCEEDED,
  FAILED,
  UNKNOWN,
}

object PaymentRules {
  private val allowed = mapOf(
    PaymentAttemptState.CREATED to setOf(
      PaymentAttemptState.INITIATED,
      PaymentAttemptState.PENDING,
      PaymentAttemptState.SUCCEEDED,
      PaymentAttemptState.FAILED,
      PaymentAttemptState.UNKNOWN,
    ),
    PaymentAttemptState.INITIATED to setOf(
      PaymentAttemptState.PENDING,
      PaymentAttemptState.SUCCEEDED,
      PaymentAttemptState.FAILED,
      PaymentAttemptState.UNKNOWN,
    ),
    PaymentAttemptState.PENDING to setOf(
      PaymentAttemptState.SUCCEEDED,
      PaymentAttemptState.FAILED,
      PaymentAttemptState.UNKNOWN,
    ),
    PaymentAttemptState.UNKNOWN to setOf(
      PaymentAttemptState.PENDING,
      PaymentAttemptState.SUCCEEDED,
      PaymentAttemptState.FAILED,
    ),
    PaymentAttemptState.SUCCEEDED to emptySet(),
    PaymentAttemptState.FAILED to emptySet(),
  )

  fun canTransition(from: PaymentAttemptState, to: PaymentAttemptState): Boolean =
    from == to || allowed.getValue(from).contains(to)

  fun requireTransition(from: PaymentAttemptState, to: PaymentAttemptState) {
    require(canTransition(from, to)) { "invalid payment attempt transition: $from -> $to" }
  }

  fun stateAfterTransportUncertainty(current: PaymentAttemptState): PaymentAttemptState =
    when (current) {
      PaymentAttemptState.SUCCEEDED, PaymentAttemptState.FAILED -> current
      else -> PaymentAttemptState.UNKNOWN
    }

  fun idempotencyKey(orderId: String, paymentSlot: String, clientAttemptId: String): String {
    require(orderId.isNotBlank() && paymentSlot.isNotBlank() && clientAttemptId.isNotBlank()) {
      "payment idempotency components must not be blank"
    }
    return "PAYMENT:${orderId.trim()}:${paymentSlot.trim()}:${clientAttemptId.trim()}"
  }
}

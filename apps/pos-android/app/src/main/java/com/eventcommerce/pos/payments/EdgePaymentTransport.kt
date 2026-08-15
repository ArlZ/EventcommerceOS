package com.eventcommerce.pos.payments

import com.eventcommerce.pos.data.LocalPaymentAttempt
import com.eventcommerce.pos.domain.PaymentAttemptState

data class EdgePaymentState(
  val state: PaymentAttemptState,
  val providerReference: String?,
  val failureCode: String?,
)

data class EdgePaymentRailAvailability(
  val providerId: String,
  val status: String,
  val detailCode: String?,
) {
  val available: Boolean
    get() = status == "AVAILABLE"
}

interface EdgePaymentTransport {
  suspend fun initiate(attempt: LocalPaymentAttempt, customerPhone: String? = null): EdgePaymentState
  suspend fun reconcile(paymentAttemptId: String): EdgePaymentState
  suspend fun railAvailability(): List<EdgePaymentRailAvailability>
}

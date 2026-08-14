package com.eventcommerce.pos.payments

import com.eventcommerce.pos.data.LocalPaymentAttempt
import com.eventcommerce.pos.domain.PaymentAttemptState

data class EdgePaymentState(
  val state: PaymentAttemptState,
  val providerReference: String?,
  val failureCode: String?,
)

interface EdgePaymentTransport {
  suspend fun initiate(attempt: LocalPaymentAttempt, customerPhone: String): EdgePaymentState
  suspend fun reconcile(paymentAttemptId: String): EdgePaymentState
}

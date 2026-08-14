package com.eventcommerce.pos.payments

import com.eventcommerce.pos.data.LocalPaymentAttempt
import com.eventcommerce.pos.data.LocalPosRepository

class PaymentCoordinator(
  private val repository: LocalPosRepository,
  private val transport: EdgePaymentTransport,
) {
  suspend fun startMpesa(orderId: String, customerPhone: String): LocalPaymentAttempt {
    val attempt = repository.createPaymentAttempt(orderId, "mpesa")
    return initiate(attempt, customerPhone)
  }

  suspend fun startCard(orderId: String): LocalPaymentAttempt {
    val attempt = repository.createPaymentAttempt(orderId, "pesapal_sabi")
    return initiate(attempt)
  }

  suspend fun startExternalTerminal(orderId: String): LocalPaymentAttempt {
    val attempt = repository.createPaymentAttempt(orderId, "external_terminal")
    return initiate(attempt)
  }

  suspend fun reconcile(paymentAttemptId: String): LocalPaymentAttempt {
    return try {
      val result = transport.reconcile(paymentAttemptId)
      repository.applyPaymentState(
        paymentAttemptId,
        result.state,
        result.providerReference,
        result.failureCode,
      )
    } catch (_: Exception) {
      repository.markPaymentTransportUncertain(paymentAttemptId)
    }
  }

  private suspend fun initiate(
    attempt: LocalPaymentAttempt,
    customerPhone: String? = null,
  ): LocalPaymentAttempt {
    return try {
      val result = transport.initiate(attempt, customerPhone)
      repository.applyPaymentState(
        attempt.id,
        result.state,
        result.providerReference,
        result.failureCode,
      )
    } catch (_: Exception) {
      repository.markPaymentTransportUncertain(attempt.id)
    }
  }
}

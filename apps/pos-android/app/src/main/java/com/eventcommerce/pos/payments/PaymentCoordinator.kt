package com.eventcommerce.pos.payments

import com.eventcommerce.pos.data.LocalPaymentAttempt
import com.eventcommerce.pos.data.LocalPosRepository

class PaymentCoordinator(
  private val repository: LocalPosRepository,
  private val transport: EdgePaymentTransport,
) {
  suspend fun startMpesa(orderId: String, customerPhone: String): LocalPaymentAttempt {
    requireRailAvailable("mpesa")
    val attempt = repository.createPaymentAttempt(orderId, "mpesa")
    return initiate(attempt, customerPhone)
  }

  suspend fun startCard(orderId: String): LocalPaymentAttempt {
    requireRailAvailable("pesapal_sabi")
    val attempt = repository.createPaymentAttempt(orderId, "pesapal_sabi")
    return initiate(attempt)
  }

  suspend fun startExternalTerminal(orderId: String): LocalPaymentAttempt {
    requireRailAvailable("external_terminal")
    val attempt = repository.createPaymentAttempt(orderId, "external_terminal")
    return initiate(attempt)
  }

  suspend fun railAvailability(): List<EdgePaymentRailAvailability> {
    return try {
      transport.railAvailability()
    } catch (_: Exception) {
      listOf(
        EdgePaymentRailAvailability("mpesa", "DEGRADED", "EDGE_PAYMENT_HEALTH_UNREACHABLE"),
        EdgePaymentRailAvailability("pesapal_sabi", "DEGRADED", "EDGE_PAYMENT_HEALTH_UNREACHABLE"),
        EdgePaymentRailAvailability("external_terminal", "DEGRADED", "EDGE_PAYMENT_HEALTH_UNREACHABLE"),
      )
    }
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

  private suspend fun requireRailAvailable(providerId: String) {
    val rail = railAvailability().firstOrNull { it.providerId == providerId }
    require(rail?.available == true) {
      "Payment rail $providerId is ${rail?.status ?: "UNAVAILABLE"}; local ordering remains available"
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

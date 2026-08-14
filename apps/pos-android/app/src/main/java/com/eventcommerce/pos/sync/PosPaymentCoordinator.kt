package com.eventcommerce.pos.sync

import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.domain.LocalPaymentAttempt
import com.eventcommerce.pos.domain.PaymentAttemptState

class PosPaymentCoordinator(
  private val repository: LocalPosRepository,
  private val transport: PaymentEdgeTransport,
) {
  suspend fun startMpesa(orderId: String, payerMsisdn: String): LocalPaymentAttempt {
    val attempt = repository.beginMpesaPayment(orderId)
    return relayInitiation(attempt, payerMsisdn)
  }

  suspend fun resumeUnknownInitiation(
    attemptId: String,
    payerMsisdn: String,
  ): LocalPaymentAttempt {
    val local = requireNotNull(repository.paymentAttempt(attemptId)) { "payment attempt not found" }
    require(local.state == PaymentAttemptState.UNKNOWN) { "only an unknown payment can be resumed" }
    require(local.providerRequestId == null) {
      "provider already accepted this attempt; refresh status instead of sending another prompt"
    }
    // First ask Edge by stable attempt ID. If Edge/Cloud already knows it, adopt that truth and
    // do not need the payer phone at all.
    val discovered = runCatching { transport.getAttempt(local) }.getOrNull()
    if (discovered != null) return repository.applyPaymentSnapshot(discovered)
    return relayInitiation(local, payerMsisdn)
  }

  suspend fun refreshUnresolved(): List<LocalPaymentAttempt> {
    val results = mutableListOf<LocalPaymentAttempt>()
    for (local in repository.unresolvedPayments()) {
      val remote = runCatching { transport.getAttempt(local) }.getOrNull()
      if (remote != null) {
        results += repository.applyPaymentSnapshot(remote)
      } else {
        results += local
      }
    }
    return results
  }

  private suspend fun relayInitiation(
    attempt: LocalPaymentAttempt,
    payerMsisdn: String,
  ): LocalPaymentAttempt {
    val masked = maskMsisdn(payerMsisdn)
    return try {
      repository.applyPaymentSnapshot(transport.initiate(attempt, payerMsisdn))
    } catch (_: Throwable) {
      repository.markPaymentTransportUnknown(attempt.attemptId, masked)
    }
  }

  private fun maskMsisdn(value: String): String {
    val compact = value.trim().replace(Regex("[\\s()-]"), "").removePrefix("+")
    require(compact.matches(Regex("254[17]\\d{8}"))) {
      "M-PESA phone must be a Kenyan mobile number in 254XXXXXXXXX format"
    }
    return "254****${compact.takeLast(4)}"
  }
}

package com.eventcommerce.pos.data

import androidx.room.withTransaction
import com.eventcommerce.pos.domain.LocalPaymentAttempt
import com.eventcommerce.pos.domain.PaymentAttemptState
import java.util.UUID

class LocalPaymentStore(
  private val db: AppDatabase,
  private val orders: LocalOrderStore,
  private val clock: () -> Long,
  private val idFactory: () -> String = { UUID.randomUUID().toString() },
) {
  private val dao = db.payments()

  suspend fun beginMpesa(orderId: String): LocalPaymentAttempt {
    val order = requireNotNull(orders.order(orderId)) { "order not found" }
    require(order.state.name == "OPEN") { "M-PESA requires an open order" }
    require(order.totalMinor > 0) { "cannot pay an empty order" }
    require(order.currency == "KES") { "M-PESA currently supports KES orders only" }
    require(order.totalMinor % 100L == 0L) { "M-PESA requires a whole KES order total" }

    val attemptId = idFactory()
    val paymentId = idFactory()
    val clientAttemptId = idFactory()
    val idempotencyKey = "PAYMENT:${order.id}:full:$clientAttemptId"
    val now = clock()

    db.withTransaction {
      // Re-read inside the transaction so a cash close cannot race payment suspension.
      val current = requireNotNull(db.orders().order(orderId)) { "order not found" }
      require(current.state == "OPEN") { "order is no longer open" }
      require(db.payments().forOrder(orderId).none { it.state in UNRESOLVED_STATES }) {
        "order already has an unresolved payment attempt"
      }
      db.payments().insert(
        PaymentAttemptEntity(
          attemptId = attemptId,
          paymentId = paymentId,
          clientAttemptId = clientAttemptId,
          eventId = current.eventId,
          orderId = current.id,
          initiationIdempotencyKey = idempotencyKey,
          provider = "MPESA",
          state = PaymentAttemptState.INITIATED.name,
          amountMinor = current.totalMinor,
          currency = current.currency,
          maskedPayerReference = null,
          providerRequestId = null,
          providerReceiptReference = null,
          reconciliationRequired = true,
          createdAtEpochMs = now,
          updatedAtEpochMs = now,
        ),
      )
    }
    // LocalOrderStore owns order transition/fault-injection semantics. If this fails, the orphan
    // INITIATED attempt remains non-dispatched and can be safely superseded only after cleanup.
    orders.suspendForPayment(orderId)
    return requireNotNull(attempt(attemptId))
  }

  suspend fun applyEdgeSnapshot(snapshot: LocalPaymentAttempt): LocalPaymentAttempt {
    val existing = requireNotNull(dao.attempt(snapshot.attemptId)) { "local payment attempt not found" }
    requireImmutableMatch(existing, snapshot)
    val updated = existing.copy(
      state = snapshot.state.name,
      maskedPayerReference = snapshot.maskedPayerReference ?: existing.maskedPayerReference,
      providerRequestId = snapshot.providerRequestId ?: existing.providerRequestId,
      providerReceiptReference = snapshot.providerReceiptReference ?: existing.providerReceiptReference,
      reconciliationRequired = snapshot.reconciliationRequired,
      updatedAtEpochMs = maxOf(existing.updatedAtEpochMs, snapshot.updatedAtEpochMs, clock()),
    )
    db.withTransaction {
      dao.update(updated)
      if (snapshot.state == PaymentAttemptState.SUCCESS) {
        orders.closeConfirmedMpesa(existing.orderId, existing.attemptId)
      }
    }
    return requireNotNull(attempt(existing.attemptId))
  }

  suspend fun markTransportUnknown(attemptId: String, maskedPayerReference: String?): LocalPaymentAttempt {
    val existing = requireNotNull(dao.attempt(attemptId)) { "local payment attempt not found" }
    if (existing.state !in UNRESOLVED_STATES) return map(existing)
    val updated = existing.copy(
      state = PaymentAttemptState.UNKNOWN.name,
      maskedPayerReference = maskedPayerReference ?: existing.maskedPayerReference,
      reconciliationRequired = true,
      updatedAtEpochMs = clock(),
    )
    dao.update(updated)
    return map(updated)
  }

  suspend fun attempt(attemptId: String): LocalPaymentAttempt? = dao.attempt(attemptId)?.let(::map)

  suspend fun unresolved(): List<LocalPaymentAttempt> = dao.unresolved().map(::map)

  suspend fun failed(limit: Int = 10): List<LocalPaymentAttempt> =
    dao.terminalFailures(limit.coerceIn(1, 50)).map(::map)

  suspend fun forOrder(orderId: String): List<LocalPaymentAttempt> = dao.forOrder(orderId).map(::map)

  suspend fun resumeOrderAfterTerminalFailure(attemptId: String) {
    val attempt = requireNotNull(dao.attempt(attemptId)) { "local payment attempt not found" }
    require(attempt.state == PaymentAttemptState.FAILED.name || attempt.state == PaymentAttemptState.EXPIRED.name) {
      "only a failed or expired payment can return its order to sale"
    }
    orders.resumeAfterFailedPayment(attempt.orderId)
  }

  private fun requireImmutableMatch(existing: PaymentAttemptEntity, snapshot: LocalPaymentAttempt) {
    require(
      existing.paymentId == snapshot.paymentId &&
        existing.clientAttemptId == snapshot.clientAttemptId &&
        existing.eventId == snapshot.eventId &&
        existing.orderId == snapshot.orderId &&
        existing.provider == snapshot.provider &&
        existing.amountMinor == snapshot.amountMinor &&
        existing.currency == snapshot.currency
    ) { "Edge payment snapshot conflicts with local immutable identity" }
  }

  private fun map(row: PaymentAttemptEntity): LocalPaymentAttempt = LocalPaymentAttempt(
    paymentId = row.paymentId,
    attemptId = row.attemptId,
    clientAttemptId = row.clientAttemptId,
    eventId = row.eventId,
    orderId = row.orderId,
    provider = row.provider,
    state = PaymentAttemptState.valueOf(row.state),
    amountMinor = row.amountMinor,
    currency = row.currency,
    maskedPayerReference = row.maskedPayerReference,
    providerRequestId = row.providerRequestId,
    providerReceiptReference = row.providerReceiptReference,
    reconciliationRequired = row.reconciliationRequired,
    createdAtEpochMs = row.createdAtEpochMs,
    updatedAtEpochMs = row.updatedAtEpochMs,
  )

  companion object {
    private val UNRESOLVED_STATES = setOf(
      PaymentAttemptState.INITIATED.name,
      PaymentAttemptState.PENDING.name,
      PaymentAttemptState.UNKNOWN.name,
    )
  }
}

package com.eventcommerce.pos.data

import androidx.room.withTransaction
import com.eventcommerce.pos.domain.LocalPaymentAttempt
import com.eventcommerce.pos.domain.OrderRules
import com.eventcommerce.pos.domain.OrderState
import com.eventcommerce.pos.domain.PaymentAttemptState
import com.eventcommerce.pos.domain.PaymentRules
import java.util.UUID

class LocalPaymentStore(
  private val db: AppDatabase,
  private val orders: LocalOrderStore,
  private val clock: () -> Long,
  private val idFactory: () -> String = { UUID.randomUUID().toString() },
) {
  private val dao = db.payments()

  suspend fun beginMpesa(orderId: String): LocalPaymentAttempt {
    val attemptId = idFactory()
    val newPaymentId = idFactory()
    val clientAttemptId = idFactory()
    val idempotencyKey = "PAYMENT:$orderId:full:$clientAttemptId"
    val now = clock()

    db.withTransaction {
      val current = requireNotNull(db.orders().order(orderId)) { "order not found" }
      require(current.state == OrderState.OPEN.name) { "M-PESA requires an open order" }
      require(db.orders().orderItems(orderId).isNotEmpty()) { "cannot pay an empty order" }
      require(current.totalMinor > 0) { "cannot pay an empty order" }
      require(current.currency == "KES") { "M-PESA currently supports KES orders only" }
      require(current.totalMinor % 100L == 0L) { "M-PESA requires a whole KES order total" }

      val priorAttempts = db.payments().forOrder(orderId)
      require(priorAttempts.none { it.state in UNRESOLVED_STATES }) {
        "order already has an unresolved payment attempt"
      }
      require(priorAttempts.none { it.state == PaymentAttemptState.SUCCESS.name }) {
        "order payment is already settled"
      }
      val priorPaymentIds = priorAttempts.map { it.paymentId }.distinct()
      require(priorPaymentIds.size <= 1) { "order has conflicting logical payment identities" }
      val paymentId = priorPaymentIds.firstOrNull() ?: newPaymentId

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
      OrderRules.requireTransition(OrderState.OPEN, OrderState.PAYMENT_PENDING)
      db.orders().updateOrder(
        current.copy(state = OrderState.PAYMENT_PENDING.name, updatedAtEpochMs = now),
      )
    }
    return requireNotNull(attempt(attemptId))
  }

  suspend fun applyEdgeSnapshot(snapshot: LocalPaymentAttempt): LocalPaymentAttempt {
    db.withTransaction {
      val existing = requireNotNull(dao.attempt(snapshot.attemptId)) { "local payment attempt not found" }
      requireImmutableMatch(existing, snapshot)
      requireProviderReferencesCompatible(existing, snapshot)

      val currentState = PaymentAttemptState.valueOf(existing.state)
      PaymentRules.requireTransition(currentState, snapshot.state)
      val updated = existing.copy(
        state = snapshot.state.name,
        maskedPayerReference = snapshot.maskedPayerReference ?: existing.maskedPayerReference,
        providerRequestId = snapshot.providerRequestId ?: existing.providerRequestId,
        providerReceiptReference = snapshot.providerReceiptReference ?: existing.providerReceiptReference,
        reconciliationRequired = PaymentRules.isUnresolved(snapshot.state),
        updatedAtEpochMs = maxOf(existing.updatedAtEpochMs, snapshot.updatedAtEpochMs, clock()),
      )
      dao.update(updated)
      if (snapshot.state == PaymentAttemptState.SUCCESS) {
        // LocalOrderStore uses a nested Room transaction; Room joins the existing transaction,
        // so payment projection + order close + order outbox commit or roll back together.
        orders.closeConfirmedMpesa(existing.orderId, existing.attemptId)
      }
    }
    return requireNotNull(attempt(snapshot.attemptId))
  }

  suspend fun markTransportUnknown(attemptId: String, maskedPayerReference: String?): LocalPaymentAttempt {
    db.withTransaction {
      val existing = requireNotNull(dao.attempt(attemptId)) { "local payment attempt not found" }
      val currentState = PaymentAttemptState.valueOf(existing.state)
      if (!PaymentRules.isUnresolved(currentState)) return@withTransaction
      PaymentRules.requireTransition(currentState, PaymentAttemptState.UNKNOWN)
      dao.update(
        existing.copy(
          state = PaymentAttemptState.UNKNOWN.name,
          maskedPayerReference = maskedPayerReference ?: existing.maskedPayerReference,
          reconciliationRequired = true,
          updatedAtEpochMs = clock(),
        ),
      )
    }
    return requireNotNull(attempt(attemptId))
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
        existing.initiationIdempotencyKey == snapshot.idempotencyKey &&
        existing.eventId == snapshot.eventId &&
        existing.orderId == snapshot.orderId &&
        existing.provider == snapshot.provider &&
        existing.amountMinor == snapshot.amountMinor &&
        existing.currency == snapshot.currency
    ) { "Edge payment snapshot conflicts with local immutable identity" }
  }

  private fun requireProviderReferencesCompatible(
    existing: PaymentAttemptEntity,
    snapshot: LocalPaymentAttempt,
  ) {
    require(
      existing.providerRequestId == null ||
        snapshot.providerRequestId == null ||
        existing.providerRequestId == snapshot.providerRequestId
    ) { "Edge payment snapshot conflicts with provider request identity" }
    require(
      existing.providerReceiptReference == null ||
        snapshot.providerReceiptReference == null ||
        existing.providerReceiptReference == snapshot.providerReceiptReference
    ) { "Edge payment snapshot conflicts with provider receipt identity" }
  }

  private fun map(row: PaymentAttemptEntity): LocalPaymentAttempt = LocalPaymentAttempt(
    paymentId = row.paymentId,
    attemptId = row.attemptId,
    clientAttemptId = row.clientAttemptId,
    idempotencyKey = row.initiationIdempotencyKey,
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

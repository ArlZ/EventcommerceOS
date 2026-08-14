package com.eventcommerce.pos.data

import androidx.room.withTransaction
import com.eventcommerce.pos.domain.OrderRules
import com.eventcommerce.pos.domain.OrderState
import com.eventcommerce.pos.domain.PaymentAttemptState
import com.eventcommerce.pos.domain.PaymentRules
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class LocalPaymentAttempt(
  val id: String,
  val paymentId: String,
  val eventId: String,
  val orderId: String,
  val providerId: String,
  val idempotencyKey: String,
  val amountMinor: Long,
  val currency: String,
  val state: PaymentAttemptState,
  val providerReference: String?,
  val failureCode: String?,
  val createdAtEpochMs: Long,
  val updatedAtEpochMs: Long,
)

class LocalPaymentStore(
  private val db: AppDatabase,
  private val deviceState: LocalDeviceState,
  private val outbox: LocalOutbox,
  private val clock: () -> Long,
  private val idFactory: () -> String = { UUID.randomUUID().toString() },
  private val faultInjector: TransactionFaultInjector,
) {
  private val payments = db.payments()
  private val orders = db.orders()
  private val mutex = Mutex()

  suspend fun createAttempt(
    orderId: String,
    providerId: String,
    paymentSlot: String = "primary",
    clientAttemptId: String = idFactory(),
  ): LocalPaymentAttempt = mutex.withLock {
    db.withTransaction {
      val order = requireNotNull(orders.order(orderId)) { "order not found" }
      require(providerId.isNotBlank()) { "payment provider must not be blank" }
      val normalizedProvider = providerId.trim().lowercase()
      val key = PaymentRules.idempotencyKey(order.id, paymentSlot, clientAttemptId)

      payments.attemptByIdempotencyKey(key)?.let { existing ->
        require(existing.orderId == order.id) { "payment idempotency key belongs to another order" }
        require(existing.providerId == normalizedProvider) {
          "payment idempotency key belongs to another provider"
        }
        return@withTransaction snapshot(existing)
      }

      require(order.state == OrderState.OPEN.name) { "payment requires an open order" }
      require(order.totalMinor > 0L) { "payment amount must be positive" }
      require(orders.orderItems(orderId).isNotEmpty()) { "cannot pay an empty order" }

      val now = clock()
      val attempt = PaymentAttemptEntity(
        id = idFactory(),
        paymentId = idFactory(),
        eventId = order.eventId,
        orderId = order.id,
        providerId = normalizedProvider,
        idempotencyKey = key,
        amountMinor = order.totalMinor,
        currency = order.currency,
        state = PaymentAttemptState.CREATED.name,
        providerReference = null,
        failureCode = null,
        createdAtEpochMs = now,
        updatedAtEpochMs = now,
      )
      payments.insertAttempt(attempt)

      OrderRules.requireTransition(OrderState.OPEN, OrderState.PAYMENT_PENDING)
      orders.updateOrder(order.copy(state = OrderState.PAYMENT_PENDING.name, updatedAtEpochMs = now))
      outbox.appendPaymentAttempt("PAYMENT_ATTEMPT_CREATED", attempt, deviceState.id())
      faultInjector.beforeCommit("createPaymentAttempt")
      snapshot(attempt)
    }
  }

  suspend fun applyProviderState(
    paymentAttemptId: String,
    nextState: PaymentAttemptState,
    providerReference: String? = null,
    failureCode: String? = null,
  ): LocalPaymentAttempt = mutex.withLock {
    db.withTransaction {
      val current = requireNotNull(payments.attempt(paymentAttemptId)) { "payment attempt not found" }
      val from = PaymentAttemptState.valueOf(current.state)
      PaymentRules.requireTransition(from, nextState)

      val now = clock()
      val updated = current.copy(
        state = nextState.name,
        providerReference = providerReference ?: current.providerReference,
        failureCode = failureCode,
        updatedAtEpochMs = now,
      )
      payments.updateAttempt(updated)
      outbox.appendPaymentAttempt("PAYMENT_ATTEMPT_STATE_CHANGED", updated, deviceState.id())

      val order = requireNotNull(orders.order(current.orderId)) { "payment order not found" }
      when (nextState) {
        PaymentAttemptState.SUCCEEDED -> {
          if (order.state == OrderState.PAYMENT_PENDING.name) {
            OrderRules.requireTransition(OrderState.PAYMENT_PENDING, OrderState.PAID)
            val paid = order.copy(state = OrderState.PAID.name, updatedAtEpochMs = now)
            orders.updateOrder(paid)
            OrderRules.requireTransition(OrderState.PAID, OrderState.CLOSED)
            val closed = paid.copy(
              state = OrderState.CLOSED.name,
              updatedAtEpochMs = now,
              closedAtEpochMs = now,
            )
            orders.updateOrder(closed)
            outbox.appendOrder(
              "ORDER_CLOSED_PROVIDER",
              closed,
              "provider-close:${closed.id}:${updated.paymentId}",
            )
          }
        }
        PaymentAttemptState.FAILED -> {
          if (order.state == OrderState.PAYMENT_PENDING.name) {
            OrderRules.requireTransition(OrderState.PAYMENT_PENDING, OrderState.OPEN)
            orders.updateOrder(order.copy(state = OrderState.OPEN.name, updatedAtEpochMs = now))
          }
        }
        PaymentAttemptState.CREATED,
        PaymentAttemptState.INITIATED,
        PaymentAttemptState.PENDING,
        PaymentAttemptState.UNKNOWN,
        -> Unit
      }

      faultInjector.beforeCommit("applyPaymentState")
      snapshot(updated)
    }
  }

  suspend fun markTransportUncertain(paymentAttemptId: String): LocalPaymentAttempt {
    val current = requireNotNull(payments.attempt(paymentAttemptId)) { "payment attempt not found" }
    val next = PaymentRules.stateAfterTransportUncertainty(PaymentAttemptState.valueOf(current.state))
    return applyProviderState(paymentAttemptId, next, current.providerReference, "TRANSPORT_UNCERTAIN")
  }

  suspend fun attempt(paymentAttemptId: String): LocalPaymentAttempt? =
    payments.attempt(paymentAttemptId)?.let(::snapshot)

  suspend fun attemptsForOrder(orderId: String): List<LocalPaymentAttempt> =
    payments.attemptsForOrder(orderId).map(::snapshot)

  suspend fun unresolved(): List<LocalPaymentAttempt> =
    payments.unresolvedAttempts().map(::snapshot)

  private fun snapshot(entity: PaymentAttemptEntity): LocalPaymentAttempt = LocalPaymentAttempt(
    id = entity.id,
    paymentId = entity.paymentId,
    eventId = entity.eventId,
    orderId = entity.orderId,
    providerId = entity.providerId,
    idempotencyKey = entity.idempotencyKey,
    amountMinor = entity.amountMinor,
    currency = entity.currency,
    state = PaymentAttemptState.valueOf(entity.state),
    providerReference = entity.providerReference,
    failureCode = entity.failureCode,
    createdAtEpochMs = entity.createdAtEpochMs,
    updatedAtEpochMs = entity.updatedAtEpochMs,
  )
}

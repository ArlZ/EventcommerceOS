package com.eventcommerce.pos.data

import com.eventcommerce.pos.domain.CachedMenu
import com.eventcommerce.pos.domain.LocalOrder
import com.eventcommerce.pos.domain.LocalPaymentAttempt
import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.MenuCandidateItem
import com.eventcommerce.pos.domain.MenuIntegrity
import java.util.UUID

class LocalPosRepository(
  db: AppDatabase,
  clock: () -> Long = { System.currentTimeMillis() },
  idFactory: () -> String = { UUID.randomUUID().toString() },
  faultInjector: TransactionFaultInjector = TransactionFaultInjector { _ -> },
) {
  private val menus = LocalMenuStore(db, clock, faultInjector)
  private val deviceState = LocalDeviceState(db, idFactory)
  private val outbox = LocalOutbox(db, deviceState, clock, idFactory)
  private val orders = LocalOrderStore(db, menus, deviceState, outbox, clock, idFactory, faultInjector)
  private val payments = LocalPaymentStore(db, orders, clock, idFactory)

  suspend fun ensureDevelopmentMenu(): CachedMenu = activeMenu() ?: installMenu(developmentMenuCandidate())

  suspend fun installMenu(candidate: MenuCandidate): CachedMenu = menus.install(candidate)

  suspend fun activeMenu(): CachedMenu? = menus.active()

  suspend fun menuForSale(): CachedMenu? {
    val open = orders.current()
    return if (open == null) menus.active() else menus.version(open.menuVersion)
  }

  suspend fun addItem(menuItemId: String, quantityDelta: Int = 1): LocalOrder =
    orders.addItem(menuItemId, quantityDelta)

  suspend fun removeItem(menuItemId: String): LocalOrder = orders.removeItem(menuItemId)

  suspend fun clearCurrentOrder(): LocalOrder? = orders.clear()

  suspend fun recordCashPayment(orderId: String): LocalOrder = orders.recordCash(orderId)

  suspend fun beginMpesaPayment(orderId: String): LocalPaymentAttempt = payments.beginMpesa(orderId)

  suspend fun applyPaymentSnapshot(snapshot: LocalPaymentAttempt): LocalPaymentAttempt =
    payments.applyEdgeSnapshot(snapshot)

  suspend fun markPaymentTransportUnknown(
    attemptId: String,
    maskedPayerReference: String?,
  ): LocalPaymentAttempt = payments.markTransportUnknown(attemptId, maskedPayerReference)

  suspend fun paymentAttempt(attemptId: String): LocalPaymentAttempt? = payments.attempt(attemptId)

  suspend fun unresolvedPayments(): List<LocalPaymentAttempt> = payments.unresolved()

  suspend fun failedPayments(limit: Int = 10): List<LocalPaymentAttempt> = payments.failed(limit)

  suspend fun resumeOrderAfterFailedPayment(attemptId: String) =
    payments.resumeOrderAfterTerminalFailure(attemptId)

  suspend fun currentOpenOrder(): LocalOrder? = orders.current()

  suspend fun paymentPendingOrders(): List<LocalOrder> = orders.paymentPending()

  suspend fun history(limit: Int = 20): List<LocalOrder> = orders.history(limit)

  suspend fun closedOrderCount(): Int = orders.closedCount()

  suspend fun outboxCount(): Int = outbox.count()

  suspend fun outboxCount(orderId: String, eventType: String): Int =
    outbox.events().count { it.aggregateId == orderId && it.eventType == eventType }

  suspend fun allOutboxEvents(): List<OutboxEventEntity> = outbox.events()

  companion object {
    fun developmentMenuCandidate(): MenuCandidate {
      val unsigned = MenuCandidate(
        eventId = "dev-event-offline",
        menuId = "dev-menu-v1",
        version = 1,
        activatedAtEpochMs = 1_700_000_000_000,
        sourceActor = "built-in-task003",
        currency = "KES",
        checksum = "",
        items = listOf(
          MenuCandidateItem("dev-tusker-500", "sku-tusker-500", "Tusker 500ml", "Beer", 25_000, true, 10),
          MenuCandidateItem("dev-whitecap-500", "sku-whitecap-500", "White Cap 500ml", "Beer", 30_000, true, 20),
          MenuCandidateItem("dev-water-500", "sku-water-500", "Water 500ml", "Soft Drinks", 10_000, true, 30),
          MenuCandidateItem("dev-soda-300", "sku-soda-300", "Soda 300ml", "Soft Drinks", 15_000, false, 40),
        ),
      )
      return MenuIntegrity.signed(unsigned)
    }
  }
}

package com.eventcommerce.pos.data

import com.eventcommerce.pos.domain.CachedMenu
import com.eventcommerce.pos.domain.LocalOrder
import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.MenuCandidateItem
import com.eventcommerce.pos.domain.MenuIntegrity
import com.eventcommerce.pos.domain.PaymentAttemptState
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
  private val payments = LocalPaymentStore(db, deviceState, outbox, clock, idFactory, faultInjector)

  suspend fun ensureDevelopmentMenu(): CachedMenu = activeMenu() ?: installMenu(developmentMenuCandidate())

  suspend fun installMenu(candidate: MenuCandidate): CachedMenu = menus.install(candidate)

  suspend fun installProvisionedMenu(
    candidate: MenuCandidate,
    salesLocationId: String,
  ): CachedMenu {
    require(salesLocationId.isNotBlank()) { "sales location assignment must not be blank" }
    val active = activeMenu()
    if (active != null && active.eventId != candidate.eventId) {
      if (active.eventId == DEVELOPMENT_EVENT_ID) {
        require(currentOpenOrder() == null && closedOrderCount() == 0) {
          "development menu has order history; reset this register before provisioning a real event"
        }
        menus.clearAll()
      } else {
        error("register already contains menu history for another event; reset before reprovisioning")
      }
    }
    return menus.install(candidate, salesLocationId)
  }

  suspend fun activeMenu(): CachedMenu? = menus.active()

  suspend fun menuForSale(): CachedMenu? {
    val open = orders.current()
    return if (open == null) menus.active() else menus.version(open.menuVersion)
  }

  suspend fun assignedSalesLocationId(): String? = menus.assignedSalesLocationId()

  suspend fun addItem(menuItemId: String, quantityDelta: Int = 1): LocalOrder =
    orders.addItem(menuItemId, quantityDelta)

  suspend fun removeItem(menuItemId: String): LocalOrder = orders.removeItem(menuItemId)

  suspend fun clearCurrentOrder(): LocalOrder? = orders.clear()

  suspend fun recordCashPayment(orderId: String): LocalOrder = orders.recordCash(orderId)

  suspend fun createPaymentAttempt(
    orderId: String,
    providerId: String,
    paymentSlot: String = "primary",
    clientAttemptId: String = UUID.randomUUID().toString(),
  ): LocalPaymentAttempt = payments.createAttempt(orderId, providerId, paymentSlot, clientAttemptId)

  suspend fun applyPaymentState(
    paymentAttemptId: String,
    state: PaymentAttemptState,
    providerReference: String? = null,
    failureCode: String? = null,
  ): LocalPaymentAttempt = payments.applyProviderState(
    paymentAttemptId,
    state,
    providerReference,
    failureCode,
  )

  suspend fun markPaymentTransportUncertain(paymentAttemptId: String): LocalPaymentAttempt =
    payments.markTransportUncertain(paymentAttemptId)

  suspend fun paymentAttempt(paymentAttemptId: String): LocalPaymentAttempt? =
    payments.attempt(paymentAttemptId)

  suspend fun paymentAttemptsForOrder(orderId: String): List<LocalPaymentAttempt> =
    payments.attemptsForOrder(orderId)

  suspend fun unresolvedPaymentAttempts(): List<LocalPaymentAttempt> = payments.unresolved()

  suspend fun currentOpenOrder(): LocalOrder? = orders.current()

  suspend fun history(limit: Int = 20): List<LocalOrder> = orders.history(limit)

  suspend fun closedOrderCount(): Int = orders.closedCount()

  suspend fun outboxCount(): Int = outbox.count()

  suspend fun outboxCount(orderId: String, eventType: String): Int =
    outbox.events().count { it.aggregateId == orderId && it.eventType == eventType }

  suspend fun allOutboxEvents(): List<OutboxEventEntity> = outbox.events()

  companion object {
    const val DEVELOPMENT_EVENT_ID = "dev-event-offline"

    fun developmentMenuCandidate(): MenuCandidate {
      val unsigned = MenuCandidate(
        eventId = DEVELOPMENT_EVENT_ID,
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

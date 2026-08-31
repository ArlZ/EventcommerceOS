package com.eventcommerce.pos.data

import androidx.room.withTransaction
import com.eventcommerce.pos.domain.CachedMenu
import com.eventcommerce.pos.domain.LocalOrder
import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.MenuCandidateItem
import com.eventcommerce.pos.domain.MenuIntegrity
import com.eventcommerce.pos.domain.PaymentAttemptState
import java.util.UUID

class LocalPosRepository(
  private val db: AppDatabase,
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

  suspend fun activeMenu(): CachedMenu? = menus.active()

  suspend fun activeProductionMenu(): CachedMenu? =
    activeMenu()?.takeUnless { isBuiltInDevelopmentMenu(it) }

  suspend fun hasOpenDevelopmentOrder(): Boolean {
    val open = orders.current() ?: return false
    val pinnedMenu = menus.version(open.menuVersion) ?: return true
    return isBuiltInDevelopmentMenu(pinnedMenu)
  }

  suspend fun retireUnusedDevelopmentMenu(): Boolean = db.withTransaction {
    val active = menus.active() ?: return@withTransaction false
    if (!isBuiltInDevelopmentMenu(active)) return@withTransaction false
    if (db.orders().orderCountForMenuVersion(active.version) > 0) return@withTransaction false
    db.menu().deleteItems(active.version)
    db.menu().deleteVersion(active.version)
    true
  }

  suspend fun menuForSale(): CachedMenu? {
    val open = orders.current()
    return if (open == null) menus.active() else menus.version(open.menuVersion)
  }

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
    private const val DEVELOPMENT_EVENT_ID = "dev-event-offline"
    private const val DEVELOPMENT_MENU_ID = "dev-menu-v1"
    private const val DEVELOPMENT_SOURCE_ACTOR = "built-in-task003"
    private const val DEVELOPMENT_SALES_LOCATION_ID = "dev-main-bar"

    fun isBuiltInDevelopmentMenu(menu: CachedMenu): Boolean =
      menu.eventId == DEVELOPMENT_EVENT_ID &&
        menu.menuId == DEVELOPMENT_MENU_ID &&
        menu.sourceActor == DEVELOPMENT_SOURCE_ACTOR

    fun developmentMenuCandidate(): MenuCandidate {
      val unsigned = MenuCandidate(
        eventId = DEVELOPMENT_EVENT_ID,
        salesLocationId = DEVELOPMENT_SALES_LOCATION_ID,
        menuId = DEVELOPMENT_MENU_ID,
        version = 1,
        activatedAtEpochMs = 1_700_000_000_000,
        sourceActor = DEVELOPMENT_SOURCE_ACTOR,
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

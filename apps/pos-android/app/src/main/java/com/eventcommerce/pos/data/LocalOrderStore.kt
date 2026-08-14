package com.eventcommerce.pos.data

import androidx.room.withTransaction
import com.eventcommerce.pos.domain.LocalOrder
import com.eventcommerce.pos.domain.LocalOrderItem
import com.eventcommerce.pos.domain.OrderRules
import com.eventcommerce.pos.domain.OrderState
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class LocalOrderStore(
  private val db: AppDatabase,
  private val menus: LocalMenuStore,
  private val deviceState: LocalDeviceState,
  private val outbox: LocalOutbox,
  private val clock: () -> Long,
  private val idFactory: () -> String = { UUID.randomUUID().toString() },
  private val faultInjector: TransactionFaultInjector,
) {
  private val dao = db.orders()
  private val mutex = Mutex()

  suspend fun addItem(menuItemId: String, quantityDelta: Int = 1): LocalOrder {
    require(quantityDelta != 0) { "quantity delta must not be zero" }
    return mutex.withLock {
      db.withTransaction {
        val open = dao.openOrder()
        val menu = if (open == null) {
          requireNotNull(menus.active()) { "no active menu is available" }
        } else {
          requireNotNull(menus.version(open.menuVersion)) { "order menu version is unavailable" }
        }
        val selected = requireNotNull(menus.item(menu.version, menuItemId)) { "menu item is unavailable" }
        val now = clock()
        val order = open ?: OrderEntity(
          id = idFactory(),
          eventId = menu.eventId,
          salesLocationId = DEVELOPMENT_SALES_LOCATION_ID,
          deviceId = deviceState.id(),
          menuVersion = menu.version,
          state = OrderState.OPEN.name,
          currency = menu.currency,
          subtotalMinor = 0,
          totalMinor = 0,
          createdAtEpochMs = now,
          updatedAtEpochMs = now,
          closedAtEpochMs = null,
        ).also {
          dao.insertOrder(it)
          outbox.appendOrder("ORDER_OPENED", it, "order-open:${it.id}")
        }

        val existing = dao.orderItem(order.id, selected.itemId)
        val nextQuantity = (existing?.quantity ?: 0) + quantityDelta
        if (nextQuantity <= 0) {
          require(existing != null) { "cannot remove an item that is not in the order" }
          dao.updateOrderItem(existing.copy(quantity = 0, lineTotalMinor = 0))
        } else {
          val lineTotal = OrderRules.lineTotalMinor(selected.priceMinor, nextQuantity)
          if (existing == null) {
            dao.insertOrderItem(
              OrderItemEntity(
                id = idFactory(),
                orderId = order.id,
                menuItemId = selected.itemId,
                skuId = selected.skuId,
                name = selected.name,
                unitPriceMinor = selected.priceMinor,
                quantity = nextQuantity,
                lineTotalMinor = lineTotal,
              ),
            )
          } else {
            dao.updateOrderItem(existing.copy(quantity = nextQuantity, lineTotalMinor = lineTotal))
          }
        }

        val total = OrderRules.totalMinor(dao.orderItems(order.id).map { it.lineTotalMinor })
        val updated = order.copy(subtotalMinor = total, totalMinor = total, updatedAtEpochMs = now)
        dao.updateOrder(updated)
        outbox.appendOrder("ORDER_CHANGED", updated)
        faultInjector.beforeCommit("addItem")
        snapshot(updated)
      }
    }
  }

  suspend fun removeItem(menuItemId: String): LocalOrder = addItem(menuItemId, -1)

  suspend fun clear(): LocalOrder? = mutex.withLock {
    db.withTransaction {
      val order = dao.openOrder() ?: return@withTransaction null
      if (dao.orderItems(order.id).isEmpty()) return@withTransaction snapshot(order)
      dao.clearOrderItems(order.id)
      val updated = order.copy(subtotalMinor = 0, totalMinor = 0, updatedAtEpochMs = clock())
      dao.updateOrder(updated)
      outbox.appendOrder("ORDER_CLEARED", updated)
      faultInjector.beforeCommit("clearOrder")
      snapshot(updated)
    }
  }

  suspend fun recordCash(orderId: String): LocalOrder = mutex.withLock {
    db.withTransaction {
      val order = requireNotNull(dao.order(orderId)) { "order not found" }
      if (order.state == OrderState.CLOSED.name) return@withTransaction snapshot(order)
      require(order.state == OrderState.OPEN.name) { "cash close requires an open order" }
      require(dao.orderItems(order.id).isNotEmpty()) { "cannot close an empty order" }

      OrderRules.requireTransition(OrderState.OPEN, OrderState.PAID)
      val paid = order.copy(state = OrderState.PAID.name, updatedAtEpochMs = clock())
      dao.updateOrder(paid)
      OrderRules.requireTransition(OrderState.PAID, OrderState.CLOSED)
      val closedAt = clock()
      val closed = paid.copy(
        state = OrderState.CLOSED.name,
        updatedAtEpochMs = closedAt,
        closedAtEpochMs = closedAt,
      )
      dao.updateOrder(closed)
      outbox.appendOrder("ORDER_CLOSED_CASH", closed, "cash-close:${closed.id}")
      faultInjector.beforeCommit("recordCashPayment")
      snapshot(closed)
    }
  }

  suspend fun suspendForPayment(orderId: String): LocalOrder = mutex.withLock {
    db.withTransaction {
      val order = requireNotNull(dao.order(orderId)) { "order not found" }
      if (order.state == OrderState.PAYMENT_PENDING.name) return@withTransaction snapshot(order)
      require(order.state == OrderState.OPEN.name) { "M-PESA requires an open order" }
      require(dao.orderItems(order.id).isNotEmpty()) { "cannot pay an empty order" }
      OrderRules.requireTransition(OrderState.OPEN, OrderState.PAYMENT_PENDING)
      val suspended = order.copy(state = OrderState.PAYMENT_PENDING.name, updatedAtEpochMs = clock())
      dao.updateOrder(suspended)
      faultInjector.beforeCommit("suspendForPayment")
      snapshot(suspended)
    }
  }

  suspend fun closeConfirmedMpesa(orderId: String, attemptId: String): LocalOrder = mutex.withLock {
    db.withTransaction {
      val order = requireNotNull(dao.order(orderId)) { "order not found" }
      if (order.state == OrderState.CLOSED.name) return@withTransaction snapshot(order)
      require(order.state == OrderState.PAYMENT_PENDING.name) {
        "confirmed M-PESA close requires a payment-pending order"
      }
      OrderRules.requireTransition(OrderState.PAYMENT_PENDING, OrderState.PAID)
      val paid = order.copy(state = OrderState.PAID.name, updatedAtEpochMs = clock())
      dao.updateOrder(paid)
      OrderRules.requireTransition(OrderState.PAID, OrderState.CLOSED)
      val closedAt = clock()
      val closed = paid.copy(
        state = OrderState.CLOSED.name,
        updatedAtEpochMs = closedAt,
        closedAtEpochMs = closedAt,
      )
      dao.updateOrder(closed)
      outbox.appendOrder(
        "ORDER_CLOSED_MPESA",
        closed,
        "mpesa-close:${closed.id}:$attemptId",
      )
      faultInjector.beforeCommit("closeConfirmedMpesa")
      snapshot(closed)
    }
  }

  suspend fun resumeAfterFailedPayment(orderId: String): LocalOrder = mutex.withLock {
    db.withTransaction {
      require(dao.openOrder() == null) { "finish the current open order before resuming this one" }
      val order = requireNotNull(dao.order(orderId)) { "order not found" }
      if (order.state == OrderState.OPEN.name) return@withTransaction snapshot(order)
      require(order.state == OrderState.PAYMENT_PENDING.name) {
        "only a payment-pending order can be resumed"
      }
      OrderRules.requireTransition(OrderState.PAYMENT_PENDING, OrderState.OPEN)
      val resumed = order.copy(state = OrderState.OPEN.name, updatedAtEpochMs = clock())
      dao.updateOrder(resumed)
      faultInjector.beforeCommit("resumeAfterFailedPayment")
      snapshot(resumed)
    }
  }

  suspend fun current(): LocalOrder? = dao.openOrder()?.let { snapshot(it) }

  suspend fun paymentPending(): List<LocalOrder> = dao.paymentPendingOrders().map { snapshot(it) }

  suspend fun order(orderId: String): LocalOrder? = dao.order(orderId)?.let { snapshot(it) }

  suspend fun history(limit: Int): List<LocalOrder> =
    dao.closedOrders(limit.coerceIn(1, 100)).map { snapshot(it) }

  suspend fun closedCount(): Int = dao.closedOrderCount()

  private suspend fun snapshot(order: OrderEntity): LocalOrder = LocalOrder(
    id = order.id,
    eventId = order.eventId,
    salesLocationId = order.salesLocationId,
    deviceId = order.deviceId,
    menuVersion = order.menuVersion,
    state = OrderState.valueOf(order.state),
    currency = order.currency,
    subtotalMinor = order.subtotalMinor,
    totalMinor = order.totalMinor,
    createdAtEpochMs = order.createdAtEpochMs,
    updatedAtEpochMs = order.updatedAtEpochMs,
    closedAtEpochMs = order.closedAtEpochMs,
    items = dao.orderItems(order.id).map {
      LocalOrderItem(
        id = it.id,
        menuItemId = it.menuItemId,
        skuId = it.skuId,
        name = it.name,
        unitPriceMinor = it.unitPriceMinor,
        quantity = it.quantity,
        lineTotalMinor = it.lineTotalMinor,
      )
    },
  )

  companion object {
    const val DEVELOPMENT_SALES_LOCATION_ID = "dev-main-bar"
  }
}

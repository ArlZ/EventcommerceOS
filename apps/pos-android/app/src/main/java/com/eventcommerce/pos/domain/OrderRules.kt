package com.eventcommerce.pos.domain

object OrderRules {
  fun lineTotalMinor(unitPriceMinor: Long, quantity: Int): Long {
    require(unitPriceMinor >= 0) { "unit price must not be negative" }
    require(quantity > 0) { "quantity must be positive" }
    return Math.multiplyExact(unitPriceMinor, quantity.toLong())
  }

  fun totalMinor(lineTotals: Iterable<Long>): Long =
    lineTotals.fold(0L) { total, line ->
      require(line >= 0) { "line total must not be negative" }
      Math.addExact(total, line)
    }

  fun requireTransition(from: OrderState, to: OrderState) {
    val allowed = when (from) {
      OrderState.DRAFT -> setOf(OrderState.OPEN, OrderState.VOIDED)
      OrderState.OPEN -> setOf(OrderState.PAYMENT_PENDING, OrderState.PAID, OrderState.VOIDED)
      OrderState.PAYMENT_PENDING -> setOf(OrderState.PAID, OrderState.OPEN, OrderState.VOIDED)
      OrderState.PAID -> setOf(OrderState.FULFILLED, OrderState.CLOSED, OrderState.PARTIALLY_REFUNDED, OrderState.REFUNDED)
      OrderState.FULFILLED -> setOf(OrderState.CLOSED, OrderState.PARTIALLY_REFUNDED, OrderState.REFUNDED)
      OrderState.CLOSED -> setOf(OrderState.PARTIALLY_REFUNDED, OrderState.REFUNDED)
      OrderState.PARTIALLY_REFUNDED -> setOf(OrderState.REFUNDED)
      OrderState.VOIDED, OrderState.REFUNDED -> emptySet()
    }
    require(to in allowed) { "invalid order transition: $from -> $to" }
  }
}

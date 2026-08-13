package com.eventcommerce.pos.domain

enum class OrderState {
  DRAFT,
  OPEN,
  PAYMENT_PENDING,
  PAID,
  FULFILLED,
  CLOSED,
  VOIDED,
  PARTIALLY_REFUNDED,
  REFUNDED,
}

data class MenuCandidateItem(
  val itemId: String,
  val skuId: String,
  val name: String,
  val category: String,
  val priceMinor: Long,
  val favourite: Boolean = false,
  val sortOrder: Int = 0,
)

data class MenuCandidate(
  val eventId: String,
  val menuId: String,
  val version: Long,
  val activatedAtEpochMs: Long,
  val sourceActor: String,
  val currency: String,
  val checksum: String,
  val items: List<MenuCandidateItem>,
)

data class CachedMenu(
  val eventId: String,
  val menuId: String,
  val version: Long,
  val activatedAtEpochMs: Long,
  val sourceActor: String,
  val currency: String,
  val checksum: String,
  val items: List<MenuCandidateItem>,
)

data class LocalOrderItem(
  val id: String,
  val menuItemId: String,
  val skuId: String,
  val name: String,
  val unitPriceMinor: Long,
  val quantity: Int,
  val lineTotalMinor: Long,
)

data class LocalOrder(
  val id: String,
  val eventId: String,
  val salesLocationId: String,
  val deviceId: String,
  val menuVersion: Long,
  val state: OrderState,
  val currency: String,
  val subtotalMinor: Long,
  val totalMinor: Long,
  val createdAtEpochMs: Long,
  val updatedAtEpochMs: Long,
  val closedAtEpochMs: Long?,
  val items: List<LocalOrderItem>,
)

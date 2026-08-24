package com.eventcommerce.pos.data

import androidx.room.withTransaction
import com.eventcommerce.pos.domain.CachedMenu
import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.MenuCandidateItem
import com.eventcommerce.pos.domain.MenuIntegrity

class LocalMenuStore(
  private val db: AppDatabase,
  private val clock: () -> Long,
  private val faultInjector: TransactionFaultInjector,
) {
  private val dao = db.menu()
  private val metadata = db.localMetadata()

  suspend fun active(): CachedMenu? = dao.activeVersion()?.let { snapshot(it) }

  suspend fun version(version: Long): CachedMenu? = dao.version(version)?.let { snapshot(it) }

  suspend fun assignedSalesLocationId(): String? =
    metadata.find(SALES_LOCATION_METADATA_KEY)?.value?.takeIf { it.isNotBlank() }

  suspend fun install(candidate: MenuCandidate, salesLocationId: String? = null): CachedMenu {
    MenuIntegrity.validate(candidate)
    val normalizedSalesLocationId = salesLocationId?.trim()?.also {
      require(it.isNotBlank()) { "sales location assignment must not be blank" }
    }
    val current = dao.activeVersion()
    if (current != null && candidate.version == current.version) {
      require(candidate.eventId == current.eventId) { "menu version collides with another event" }
      require(candidate.checksum == current.checksum) { "menu version already exists with different content" }
      if (normalizedSalesLocationId != null) {
        metadata.put(LocalMetadataEntity(SALES_LOCATION_METADATA_KEY, normalizedSalesLocationId))
      }
      return snapshot(current)
    }
    require(current == null || candidate.eventId == current.eventId) {
      "register already contains a menu for another event"
    }
    require(current == null || candidate.version > current.version) { "menu version must advance monotonically" }

    db.withTransaction {
      dao.deactivateActive()
      dao.insertVersion(
        MenuVersionEntity(
          version = candidate.version,
          eventId = candidate.eventId,
          menuId = candidate.menuId,
          activatedAtEpochMs = candidate.activatedAtEpochMs,
          sourceActor = candidate.sourceActor,
          currency = candidate.currency,
          checksum = candidate.checksum,
          isActive = true,
          installedAtEpochMs = clock(),
        ),
      )
      dao.insertItems(candidate.items.map { it.entity(candidate.version) })
      if (normalizedSalesLocationId != null) {
        metadata.put(LocalMetadataEntity(SALES_LOCATION_METADATA_KEY, normalizedSalesLocationId))
      }
      faultInjector.beforeCommit("installMenu")
    }
    return snapshot(requireNotNull(dao.activeVersion()))
  }

  suspend fun clearAll() {
    db.withTransaction {
      dao.deleteAllItems()
      dao.deleteAllVersions()
      faultInjector.beforeCommit("clearMenus")
    }
  }

  suspend fun item(version: Long, itemId: String): MenuItemEntity? = dao.item(version, itemId)

  private suspend fun snapshot(entity: MenuVersionEntity): CachedMenu = CachedMenu(
    eventId = entity.eventId,
    menuId = entity.menuId,
    version = entity.version,
    activatedAtEpochMs = entity.activatedAtEpochMs,
    sourceActor = entity.sourceActor,
    currency = entity.currency,
    checksum = entity.checksum,
    items = dao.items(entity.version).map {
      MenuCandidateItem(it.itemId, it.skuId, it.name, it.category, it.priceMinor, it.favourite, it.sortOrder)
    },
  )

  private fun MenuCandidateItem.entity(version: Long) = MenuItemEntity(
    menuVersion = version,
    itemId = itemId,
    skuId = skuId,
    name = name,
    category = category,
    priceMinor = priceMinor,
    favourite = favourite,
    sortOrder = sortOrder,
  )

  companion object {
    const val SALES_LOCATION_METADATA_KEY = "assigned_sales_location_id"
  }
}

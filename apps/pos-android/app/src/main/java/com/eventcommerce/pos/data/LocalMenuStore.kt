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

  suspend fun install(candidate: MenuCandidate): CachedMenu {
    MenuIntegrity.validate(candidate)
    val current = dao.activeVersion()
    if (current != null && candidate.version == current.version) {
      require(candidate.checksum == current.checksum) { "menu version already exists with different content" }
      db.withTransaction { persistAssignment(candidate) }
      return snapshot(current)
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
      persistAssignment(candidate)
      faultInjector.beforeCommit("installMenu")
    }
    return snapshot(requireNotNull(dao.activeVersion()))
  }

  suspend fun item(version: Long, itemId: String): MenuItemEntity? = dao.item(version, itemId)

  private suspend fun snapshot(entity: MenuVersionEntity): CachedMenu {
    val assignmentEventId = metadata.find(ACTIVE_MENU_EVENT_ID)?.value
    val salesLocationId = metadata.find(ACTIVE_MENU_SALES_LOCATION_ID)?.value
      ?.takeIf { assignmentEventId == entity.eventId && it.isNotBlank() }
    return CachedMenu(
      eventId = entity.eventId,
      salesLocationId = salesLocationId,
      menuId = entity.menuId,
      version = entity.version,
      activatedAtEpochMs = entity.activatedAtEpochMs,
      sourceActor = entity.sourceActor,
      currency = entity.currency,
      checksum = entity.checksum,
      items = dao.items(entity.version).map {
        MenuCandidateItem(
          it.itemId,
          it.skuId,
          it.name,
          it.category,
          it.priceMinor,
          it.favourite,
          it.sortOrder,
        )
      },
    )
  }

  private suspend fun persistAssignment(candidate: MenuCandidate) {
    metadata.put(LocalMetadataEntity(ACTIVE_MENU_EVENT_ID, candidate.eventId))
    metadata.put(LocalMetadataEntity(ACTIVE_MENU_SALES_LOCATION_ID, candidate.salesLocationId))
  }

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
    private const val ACTIVE_MENU_EVENT_ID = "active_menu_event_id"
    private const val ACTIVE_MENU_SALES_LOCATION_ID = "active_menu_sales_location_id"
  }
}

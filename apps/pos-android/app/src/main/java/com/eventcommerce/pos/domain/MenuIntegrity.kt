package com.eventcommerce.pos.domain

import java.util.zip.CRC32

object MenuIntegrity {
  private val currencyPattern = Regex("^[A-Z]{3}$")
  private val checksumPattern = Regex("^[0-9a-f]{8}$")

  fun checksum(candidate: MenuCandidate): String {
    val canonical = buildString {
      appendField(candidate.eventId)
      appendField(candidate.menuId)
      appendField(candidate.version.toString())
      appendField(candidate.activatedAtEpochMs.toString())
      appendField(candidate.sourceActor)
      appendField(candidate.currency)
      candidate.items.sortedBy { it.itemId }.forEach { item ->
        appendField(item.itemId)
        appendField(item.skuId)
        appendField(item.name)
        appendField(item.category)
        appendField(item.priceMinor.toString())
        appendField(if (item.favourite) "1" else "0")
        appendField(item.sortOrder.toString())
      }
    }
    val crc = CRC32()
    crc.update(canonical.toByteArray(Charsets.UTF_8))
    return crc.value.toString(16).padStart(8, '0')
  }

  fun signed(candidate: MenuCandidate): MenuCandidate = candidate.copy(checksum = checksum(candidate))

  fun validate(candidate: MenuCandidate) {
    require(candidate.eventId.isNotBlank()) { "eventId is required" }
    require(candidate.salesLocationId.isNotBlank()) { "salesLocationId is required" }
    require(candidate.menuId.isNotBlank()) { "menuId is required" }
    require(candidate.version > 0) { "menu version must be positive" }
    require(candidate.activatedAtEpochMs > 0) { "menu activation time must be positive" }
    require(candidate.sourceActor.isNotBlank()) { "menu source actor is required" }
    require(currencyPattern.matches(candidate.currency)) { "currency must be a three-letter uppercase code" }
    require(candidate.items.isNotEmpty()) { "menu must contain at least one item" }

    val itemIds = mutableSetOf<String>()
    val skuIds = mutableSetOf<String>()
    candidate.items.forEach { item ->
      require(item.itemId.isNotBlank()) { "menu item id is required" }
      require(item.skuId.isNotBlank()) { "menu item sku id is required" }
      require(item.name.isNotBlank()) { "menu item name is required" }
      require(item.category.isNotBlank()) { "menu item category is required" }
      require(item.priceMinor >= 0) { "menu item price must not be negative" }
      require(itemIds.add(item.itemId)) { "duplicate menu item id: ${item.itemId}" }
      require(skuIds.add(item.skuId)) { "duplicate menu item sku id: ${item.skuId}" }
    }

    require(checksumPattern.matches(candidate.checksum)) { "menu checksum must be eight lowercase hex characters" }
    require(checksum(candidate) == candidate.checksum) { "menu checksum does not match content" }
  }

  private fun StringBuilder.appendField(value: String) {
    append(value.length).append(':').append(value).append('|')
  }
}

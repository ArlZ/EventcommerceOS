package com.eventcommerce.pos.sync

import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.MenuCandidateItem
import com.eventcommerce.pos.domain.MenuIntegrity
import org.json.JSONObject

data class DeliveredMenuSnapshot(
  val salesLocationId: String,
  val candidate: MenuCandidate,
)

object MenuSnapshotJson {
  fun snapshot(text: String): DeliveredMenuSnapshot {
    val value = JSONObject(text)
    val salesLocationId = value.getString("salesLocationId").trim()
    require(salesLocationId.isNotBlank()) { "menu sales location is required" }
    val itemValues = value.getJSONArray("items")
    val items = buildList {
      for (index in 0 until itemValues.length()) {
        val item = itemValues.getJSONObject(index)
        add(
          MenuCandidateItem(
            itemId = item.getString("itemId"),
            skuId = item.getString("skuId"),
            name = item.getString("name"),
            category = item.getString("category"),
            priceMinor = item.getLong("priceMinor"),
            favourite = item.optBoolean("favourite", false),
            sortOrder = item.optInt("sortOrder", 0),
          ),
        )
      }
    }
    val candidate = MenuCandidate(
      eventId = value.getString("eventId"),
      menuId = value.getString("menuId"),
      version = value.getLong("version"),
      activatedAtEpochMs = value.getLong("activatedAtEpochMs"),
      sourceActor = value.getString("sourceActor"),
      currency = value.getString("currency"),
      checksum = value.getString("checksum"),
      items = items,
    )
    MenuIntegrity.validate(candidate)
    return DeliveredMenuSnapshot(salesLocationId, candidate)
  }
}

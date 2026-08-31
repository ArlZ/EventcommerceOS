package com.eventcommerce.pos.menu

import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.MenuCandidateItem
import org.json.JSONObject

object MenuJson {
  fun candidate(text: String): MenuCandidate {
    val value = JSONObject(text)
    val items = value.getJSONArray("items")
    return MenuCandidate(
      eventId = value.getString("eventId"),
      salesLocationId = value.getString("salesLocationId"),
      menuId = value.getString("menuId"),
      version = value.getLong("version"),
      activatedAtEpochMs = value.getLong("activatedAtEpochMs"),
      sourceActor = value.getString("sourceActor"),
      currency = value.getString("currency"),
      checksum = value.getString("checksum"),
      items = List(items.length()) { index ->
        val item = items.getJSONObject(index)
        MenuCandidateItem(
          itemId = item.getString("itemId"),
          skuId = item.getString("skuId"),
          name = item.getString("name"),
          category = item.getString("category"),
          priceMinor = item.getLong("priceMinor"),
          favourite = item.getBoolean("favourite"),
          sortOrder = item.getInt("sortOrder"),
        )
      },
    )
  }
}

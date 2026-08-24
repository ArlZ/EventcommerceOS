package com.eventcommerce.pos.sync

import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.MenuCandidateItem
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

interface PosMenuEdgeTransport {
  suspend fun current(): MenuCandidate
}

fun posMenuCurrentEndpoint(syncEndpoint: String): String {
  val uri = URI(syncEndpoint.trim())
  require(uri.scheme.equals("https", ignoreCase = true)) { "POS menu endpoint must use HTTPS" }
  require(!uri.host.isNullOrBlank()) { "POS menu endpoint must include a host" }
  require(uri.userInfo == null) { "POS menu endpoint must not include user information" }
  require(uri.path == "/sync/device-events") {
    "POS provisioning endpoint must be the Event Edge device sync endpoint"
  }
  return URI(uri.scheme, null, uri.host, uri.port, "/pos-menu/current", null, null).toASCIIString()
}

class HttpsPosMenuEdgeTransport(
  syncEndpoint: String,
  private val provisionedDeviceId: String,
  private val token: String,
) : PosMenuEdgeTransport {
  private val endpoint = posMenuCurrentEndpoint(syncEndpoint)

  init {
    require(provisionedDeviceId.isNotBlank()) { "POS device ID must not be blank" }
    require(token.length >= 32) { "POS device credential must be at least 32 characters" }
  }

  override suspend fun current(): MenuCandidate = withContext(Dispatchers.IO) {
    val connection = URL(endpoint).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = 5_000
      connection.readTimeout = 5_000
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Authorization", "Bearer $token")
      connection.setRequestProperty("X-Device-Id", provisionedDeviceId)
      val code = connection.responseCode
      if (code !in 200..299) throw IllegalStateException("Edge menu returned HTTP $code")
      parsePosMenu(
        connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() },
      )
    } finally {
      connection.disconnect()
    }
  }
}

fun parsePosMenu(text: String): MenuCandidate {
  val value = JSONObject(text)
  val items = value.getJSONArray("items")
  val parsedItems = ArrayList<MenuCandidateItem>(items.length())
  for (index in 0 until items.length()) {
    val item = items.getJSONObject(index)
    parsedItems.add(
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
  return MenuCandidate(
    eventId = value.getString("eventId"),
    menuId = value.getString("menuId"),
    version = value.getLong("version"),
    activatedAtEpochMs = value.getLong("activatedAtEpochMs"),
    sourceActor = value.getString("sourceActor"),
    currency = value.getString("currency"),
    checksum = value.getString("checksum"),
    items = parsedItems,
  )
}

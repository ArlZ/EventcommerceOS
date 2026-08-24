package com.eventcommerce.pos.sync

import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class HttpsMenuEdgeTransport(
  syncEndpoint: String,
  private val provisionedDeviceId: String,
  private val token: String,
) : MenuEdgeTransport {
  private val menuEndpoint: URL

  init {
    require(syncEndpoint.startsWith("https://")) { "POS menu endpoint must use HTTPS" }
    require(provisionedDeviceId.isNotBlank()) { "POS device ID must not be blank" }
    require(token.length >= 32) { "POS device credential must be at least 32 characters" }
    val syncUrl = URL(syncEndpoint)
    menuEndpoint = URL(syncUrl.protocol, syncUrl.host, syncUrl.port, "/pos-menu/current")
    require(menuEndpoint.protocol == "https") { "POS menu endpoint must use HTTPS" }
  }

  override suspend fun current() = withContext(Dispatchers.IO) {
    val connection = menuEndpoint.openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = 5_000
      connection.readTimeout = 5_000
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Authorization", "Bearer $token")
      connection.setRequestProperty("X-Device-Id", provisionedDeviceId)
      val code = connection.responseCode
      if (code !in 200..299) throw IllegalStateException("Event Edge menu returned HTTP $code")
      MenuSnapshotJson.candidate(
        connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() },
      )
    } finally {
      connection.disconnect()
    }
  }
}

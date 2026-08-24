package com.eventcommerce.pos.menu

import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class HttpsEdgeMenuTransport(
  syncEndpoint: String,
  private val provisionedDeviceId: String,
  private val token: String,
) : EdgeMenuTransport {
  private val endpoint = menuEndpoint(syncEndpoint)

  init {
    require(endpoint.startsWith("https://")) { "POS menu endpoint must use HTTPS" }
    require(provisionedDeviceId.isNotBlank()) { "POS device ID must not be blank" }
    require(token.length >= 32) { "POS device credential must be at least 32 characters" }
  }

  override suspend fun current() = withContext(Dispatchers.IO) {
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
      MenuJson.candidate(
        connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() },
      )
    } finally {
      connection.disconnect()
    }
  }

  companion object {
    fun menuEndpoint(syncEndpoint: String): String {
      require(syncEndpoint.startsWith("https://")) { "POS sync endpoint must use HTTPS" }
      val url = URL(syncEndpoint)
      require(url.query.isNullOrEmpty() && url.ref.isNullOrEmpty()) {
        "POS sync endpoint must not contain query or fragment components"
      }
      require(url.path.endsWith("/sync/device-events")) {
        "POS sync endpoint must end with /sync/device-events"
      }
      val basePath = url.path.removeSuffix("/sync/device-events")
      return URL(url.protocol, url.host, url.port, "$basePath/pos-menu/current").toString()
    }
  }
}

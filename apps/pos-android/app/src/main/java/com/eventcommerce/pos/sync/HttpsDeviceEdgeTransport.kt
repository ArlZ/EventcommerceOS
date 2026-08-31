package com.eventcommerce.pos.sync

import com.eventcommerce.pos.data.OutboxEventEntity
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class HttpsDeviceEdgeTransport(
  private val endpoint: String,
  private val provisionedDeviceId: String,
  private val token: String,
) : DeviceEdgeTransport, DeviceEdgeStatusTransport {
  init {
    require(endpoint.startsWith("https://")) { "POS sync endpoint must use HTTPS" }
    require(provisionedDeviceId.isNotBlank()) { "POS device ID must not be blank" }
    require(token.length >= 32) { "POS device credential must be at least 32 characters" }
  }

  override suspend fun send(deviceId: String, events: List<OutboxEventEntity>): DeviceEdgeAck =
    withContext(Dispatchers.IO) {
      require(deviceId == provisionedDeviceId) {
        "local POS device identity does not match provisioned Event Edge identity"
      }
      val connection = URL(endpoint).openConnection() as HttpURLConnection
      try {
        connection.requestMethod = "POST"
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("X-Device-Id", provisionedDeviceId)
        connection.outputStream.bufferedWriter(Charsets.UTF_8).use {
          it.write(SyncJson.request(deviceId, events))
        }
        val code = connection.responseCode
        if (code !in 200..299) throw IllegalStateException("Edge sync returned HTTP $code")
        SyncJson.acknowledgement(
          connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() },
        )
      } finally {
        connection.disconnect()
      }
    }

  override suspend fun status(deviceId: String): DeviceEdgeAck = withContext(Dispatchers.IO) {
    require(deviceId == provisionedDeviceId) {
      "local POS device identity does not match provisioned Event Edge identity"
    }
    val connection = URL(statusEndpoint(endpoint)).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = 5_000
      connection.readTimeout = 5_000
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Authorization", "Bearer $token")
      connection.setRequestProperty("X-Device-Id", provisionedDeviceId)
      val code = connection.responseCode
      if (code !in 200..299) throw IllegalStateException("Edge status returned HTTP $code")
      SyncJson.acknowledgement(
        connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() },
      )
    } finally {
      connection.disconnect()
    }
  }

  companion object {
    fun statusEndpoint(syncEndpoint: String): String {
      require(syncEndpoint.startsWith("https://")) { "POS sync endpoint must use HTTPS" }
      val url = URL(syncEndpoint)
      require(url.query.isNullOrEmpty() && url.ref.isNullOrEmpty()) {
        "POS sync endpoint must not contain query or fragment components"
      }
      require(url.path.endsWith("/sync/device-events")) {
        "POS sync endpoint must end with /sync/device-events"
      }
      val basePath = url.path.removeSuffix("/sync/device-events")
      return URL(url.protocol, url.host, url.port, "$basePath/sync/device-status").toString()
    }
  }
}

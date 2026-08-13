package com.eventcommerce.pos.sync

import com.eventcommerce.pos.data.OutboxEventEntity
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class HttpsDeviceEdgeTransport(private val endpoint: String) : DeviceEdgeTransport {
  init {
    require(endpoint.startsWith("https://")) { "POS sync endpoint must use HTTPS" }
  }

  override suspend fun send(deviceId: String, events: List<OutboxEventEntity>): DeviceEdgeAck =
    withContext(Dispatchers.IO) {
      val connection = URL(endpoint).openConnection() as HttpURLConnection
      try {
        connection.requestMethod = "POST"
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
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
}

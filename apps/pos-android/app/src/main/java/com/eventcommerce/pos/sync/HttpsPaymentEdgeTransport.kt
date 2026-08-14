package com.eventcommerce.pos.sync

import com.eventcommerce.pos.domain.LocalPaymentAttempt
import com.eventcommerce.pos.domain.PaymentAttemptState
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class HttpsPaymentEdgeTransport(
  syncEndpoint: String,
  private val bearerToken: String,
) : PaymentEdgeTransport {
  private val origin: String

  init {
    require(syncEndpoint.startsWith("https://")) { "POS payment endpoint must use HTTPS" }
    require(bearerToken.length >= 32) { "POS payment bearer token is invalid" }
    val uri = URI(syncEndpoint)
    require(uri.host != null) { "POS payment endpoint must have a host" }
    origin = buildString {
      append(uri.scheme)
      append("://")
      append(uri.host)
      if (uri.port != -1) append(":${uri.port}")
    }
  }

  override suspend fun initiate(
    attempt: LocalPaymentAttempt,
    payerMsisdn: String,
  ): LocalPaymentAttempt = withContext(Dispatchers.IO) {
    val normalized = normalizeMsisdn(payerMsisdn)
    val body = JSONObject()
      .put("eventId", attempt.eventId)
      .put("orderId", attempt.orderId)
      .put("paymentId", attempt.paymentId)
      .put("attemptId", attempt.attemptId)
      .put("clientAttemptId", attempt.clientAttemptId)
      .put("idempotencyKey", attempt.idempotencyKey)
      .put("provider", "MPESA")
      .put("amountMinor", attempt.amountMinor)
      .put("currency", attempt.currency)
      .put("payer", JSONObject().put("kind", "MSISDN").put("value", normalized))
    val response = request("POST", "/payments/attempts", body.toString()) ?: error("empty Edge payment response")
    val root = JSONObject(response)
    parseSnapshot(root.getJSONObject("attempt"), attempt)
  }

  override suspend fun getAttempt(localAttempt: LocalPaymentAttempt): LocalPaymentAttempt? =
    withContext(Dispatchers.IO) {
      val path = "/payments/attempts/${encodePathSegment(localAttempt.attemptId)}"
      val connection = open(path)
      try {
        connection.requestMethod = "GET"
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        authenticate(connection)
        val code = connection.responseCode
        if (code == 404) return@withContext null
        if (code !in 200..299) throw IllegalStateException("Edge payment status returned HTTP $code")
        val text = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        parseSnapshot(JSONObject(text), localAttempt)
      } finally {
        connection.disconnect()
      }
    }

  private fun request(method: String, path: String, body: String): String? {
    val connection = open(path)
    try {
      connection.requestMethod = method
      connection.connectTimeout = 5_000
      connection.readTimeout = 5_000
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      authenticate(connection)
      connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body) }
      val code = connection.responseCode
      if (code !in 200..299) throw IllegalStateException("Edge payment returned HTTP $code")
      return connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    } finally {
      connection.disconnect()
    }
  }

  private fun authenticate(connection: HttpURLConnection) {
    connection.setRequestProperty("Authorization", "Bearer $bearerToken")
  }

  private fun open(path: String): HttpURLConnection = URL("$origin$path").openConnection() as HttpURLConnection

  private fun parseSnapshot(json: JSONObject, local: LocalPaymentAttempt): LocalPaymentAttempt {
    val state = runCatching { PaymentAttemptState.valueOf(json.getString("state")) }
      .getOrElse { throw IllegalStateException("Edge returned an invalid payment state") }
    val remoteAttemptId = json.getString("attemptId")
    val remotePaymentId = json.getString("paymentId")
    val remoteClientAttemptId = json.getString("clientAttemptId")
    val remoteEventId = json.getString("eventId")
    val remoteOrderId = json.getString("orderId")
    val remoteAmountMinor = json.getLong("amountMinor")
    val remoteCurrency = json.getString("currency")
    val remoteProvider = json.getString("provider")
    require(
      remoteAttemptId == local.attemptId &&
        remotePaymentId == local.paymentId &&
        remoteClientAttemptId == local.clientAttemptId &&
        remoteEventId == local.eventId &&
        remoteOrderId == local.orderId &&
        remoteAmountMinor == local.amountMinor &&
        remoteCurrency == local.currency &&
        remoteProvider == local.provider
    ) { "Edge payment response conflicts with local immutable identity" }

    val createdAt = parseIsoEpochMs(json.getString("createdAt"), "createdAt")
    val updatedAt = parseIsoEpochMs(json.getString("updatedAt"), "updatedAt")
    return LocalPaymentAttempt(
      paymentId = local.paymentId,
      attemptId = local.attemptId,
      clientAttemptId = local.clientAttemptId,
      idempotencyKey = local.idempotencyKey,
      eventId = local.eventId,
      orderId = local.orderId,
      provider = local.provider,
      state = state,
      amountMinor = local.amountMinor,
      currency = local.currency,
      maskedPayerReference = json.nullableString("maskedPayerReference"),
      providerRequestId = json.nullableString("providerRequestId"),
      providerReceiptReference = json.nullableString("providerReceiptReference"),
      reconciliationRequired = json.getBoolean("reconciliationRequired"),
      createdAtEpochMs = createdAt,
      updatedAtEpochMs = updatedAt,
    )
  }

  private fun JSONObject.nullableString(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

  private fun normalizeMsisdn(value: String): String {
    val compact = value.trim().replace(Regex("[\\s()-]"), "").removePrefix("+")
    require(compact.matches(Regex("254[17]\\d{8}"))) {
      "M-PESA phone must be a Kenyan mobile number in 254XXXXXXXXX format"
    }
    return compact
  }

  private fun parseIsoEpochMs(value: String, label: String): Long =
    runCatching { java.time.Instant.parse(value).toEpochMilli() }
      .getOrElse { throw IllegalStateException("Edge payment $label is invalid") }

  private fun encodePathSegment(value: String): String =
    java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}

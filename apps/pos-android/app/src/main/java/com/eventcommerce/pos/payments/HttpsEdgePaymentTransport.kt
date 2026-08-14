package com.eventcommerce.pos.payments

import com.eventcommerce.pos.data.LocalPaymentAttempt
import com.eventcommerce.pos.domain.PaymentAttemptState
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class HttpsEdgePaymentTransport(private val baseUrl: String) : EdgePaymentTransport {
  init {
    require(baseUrl.startsWith("https://")) { "POS payment endpoint must use HTTPS" }
  }

  override suspend fun initiate(
    attempt: LocalPaymentAttempt,
    customerPhone: String?,
  ): EdgePaymentState = withContext(Dispatchers.IO) {
    if (attempt.providerId == "mpesa") {
      require(!customerPhone.isNullOrBlank()) { "M-PESA customer phone must not be blank" }
    }
    val payload = JSONObject()
      .put("eventId", attempt.eventId)
      .put("paymentId", attempt.paymentId)
      .put("paymentAttemptId", attempt.id)
      .put("orderId", attempt.orderId)
      .put("providerId", attempt.providerId)
      .put("idempotencyKey", attempt.idempotencyKey)
      .put("amountMinor", attempt.amountMinor)
      .put("currency", attempt.currency)
      .put("accountReference", attempt.id)
      .put("description", "Event purchase")
    customerPhone?.trim()?.takeIf { it.isNotEmpty() }?.let { payload.put("customerPhone", it) }
    post("$baseUrl/payments/initiate", payload)
  }

  override suspend fun reconcile(paymentAttemptId: String): EdgePaymentState =
    withContext(Dispatchers.IO) {
      post(
        "$baseUrl/payments/attempts/${urlComponent(paymentAttemptId)}/reconcile",
        JSONObject(),
      )
    }

  override suspend fun railAvailability(): List<EdgePaymentRailAvailability> =
    withContext(Dispatchers.IO) {
      val connection = URL("$baseUrl/payments/providers/availability").openConnection() as HttpURLConnection
      try {
        connection.requestMethod = "GET"
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        connection.setRequestProperty("Accept", "application/json")
        val code = connection.responseCode
        if (code !in 200..299) throw IllegalStateException("Edge payment rail health returned HTTP $code")
        val response = JSONArray(
          connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() },
        )
        buildList {
          for (index in 0 until response.length()) {
            val item = response.getJSONObject(index)
            val status = item.getString("status")
            require(status in setOf("AVAILABLE", "UNCONFIGURED", "DEGRADED")) {
              "Edge returned invalid payment rail status"
            }
            add(
              EdgePaymentRailAvailability(
                providerId = item.getString("providerId"),
                status = status,
                detailCode = if (item.isNull("detailCode")) null else item.getString("detailCode"),
              ),
            )
          }
        }
      } finally {
        connection.disconnect()
      }
    }

  private fun post(url: String, body: JSONObject): EdgePaymentState {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 10_000
      connection.readTimeout = 10_000
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body.toString()) }
      val code = connection.responseCode
      if (code !in 200..299) throw IllegalStateException("Edge payment returned HTTP $code")
      val response = JSONObject(
        connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() },
      )
      val state = PaymentAttemptState.valueOf(response.getString("status"))
      return EdgePaymentState(
        state = state,
        providerReference = response.optString("providerReference").takeIf { it.isNotBlank() },
        failureCode = response.optString("failureCode").takeIf { it.isNotBlank() },
      )
    } finally {
      connection.disconnect()
    }
  }

  private fun urlComponent(value: String): String =
    java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
}

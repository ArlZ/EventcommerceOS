package com.eventcommerce.pos.payments

import com.eventcommerce.pos.data.LocalPaymentAttempt
import com.eventcommerce.pos.domain.PaymentAttemptState
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class HttpsEdgePaymentTransport(private val baseUrl: String) : EdgePaymentTransport {
  init {
    require(baseUrl.startsWith("https://")) { "POS payment endpoint must use HTTPS" }
  }

  override suspend fun initiate(
    attempt: LocalPaymentAttempt,
    customerPhone: String,
  ): EdgePaymentState = withContext(Dispatchers.IO) {
    require(customerPhone.isNotBlank()) { "customer phone must not be blank" }
    val payload = JSONObject()
      .put("eventId", attempt.eventId)
      .put("paymentId", attempt.paymentId)
      .put("paymentAttemptId", attempt.id)
      .put("orderId", attempt.orderId)
      .put("providerId", attempt.providerId)
      .put("idempotencyKey", attempt.idempotencyKey)
      .put("amountMinor", attempt.amountMinor)
      .put("currency", attempt.currency)
      .put("customerPhone", customerPhone.trim())
      .put("accountReference", attempt.orderId)
      .put("description", "Event purchase")
    post("$baseUrl/payments/initiate", payload)
  }

  override suspend fun reconcile(paymentAttemptId: String): EdgePaymentState =
    withContext(Dispatchers.IO) {
      post(
        "$baseUrl/payments/attempts/${urlComponent(paymentAttemptId)}/reconcile",
        JSONObject(),
      )
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

package com.eventcommerce.pos.payments

import com.eventcommerce.pos.data.DeviceSyncProvisioningStore
import com.eventcommerce.pos.data.LocalPaymentAttempt
import java.net.URI

class ProvisionedEdgePaymentTransport(
  private val provisioning: DeviceSyncProvisioningStore,
) : EdgePaymentTransport {
  override suspend fun initiate(
    attempt: LocalPaymentAttempt,
    customerPhone: String,
  ): EdgePaymentState = delegate().initiate(attempt, customerPhone)

  override suspend fun reconcile(paymentAttemptId: String): EdgePaymentState =
    delegate().reconcile(paymentAttemptId)

  private suspend fun delegate(): HttpsEdgePaymentTransport {
    val syncEndpoint = requireNotNull(provisioning.endpoint()) { "Edge endpoint is not provisioned" }
    val uri = URI(syncEndpoint)
    require(uri.scheme == "https") { "POS payment endpoint must use HTTPS" }
    val authority = uri.rawAuthority ?: throw IllegalArgumentException("Edge endpoint has no authority")
    return HttpsEdgePaymentTransport("https://$authority")
  }
}

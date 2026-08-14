package com.eventcommerce.pos.payments

import com.eventcommerce.pos.data.DeviceCredentialStore
import com.eventcommerce.pos.data.DeviceSyncProvisioningStore
import com.eventcommerce.pos.data.LocalPaymentAttempt
import java.net.URI

class ProvisionedEdgePaymentTransport(
  private val provisioning: DeviceSyncProvisioningStore,
  private val credentials: DeviceCredentialStore,
) : EdgePaymentTransport {
  override suspend fun initiate(
    attempt: LocalPaymentAttempt,
    customerPhone: String?,
  ): EdgePaymentState = delegate().initiate(attempt, customerPhone)

  override suspend fun reconcile(paymentAttemptId: String): EdgePaymentState =
    delegate().reconcile(paymentAttemptId)

  override suspend fun railAvailability(): List<EdgePaymentRailAvailability> =
    delegate().railAvailability()

  private suspend fun delegate(): HttpsEdgePaymentTransport {
    val syncEndpoint = requireNotNull(provisioning.endpoint()) { "Edge endpoint is not provisioned" }
    val deviceCredential = requireNotNull(credentials.token()) { "Device credential is not provisioned" }
    val uri = URI(syncEndpoint)
    require(uri.scheme == "https") { "POS payment endpoint must use HTTPS" }
    val authority = uri.rawAuthority ?: throw IllegalArgumentException("Edge endpoint has no authority")
    return HttpsEdgePaymentTransport("https://$authority", deviceCredential)
  }
}

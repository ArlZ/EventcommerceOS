package com.eventcommerce.pos.data

class DeviceSyncProvisioningStore(
  db: AppDatabase,
  private val secrets: DeviceSecretStore,
) {
  private val metadata = db.localMetadata()

  suspend fun endpoint(): String? = metadata.find(EDGE_ENDPOINT)?.value?.takeIf { it.isNotBlank() }

  suspend fun paymentBearerToken(): String? {
    val encrypted = runCatching { secrets.get(EDGE_PAYMENT_BEARER_TOKEN) }.getOrNull()
    if (!encrypted.isNullOrBlank()) return encrypted

    // One-time migration from the Task 006 development implementation, which stored
    // the bearer token in ordinary Room metadata. Never keep the plaintext copy.
    val legacy = metadata.find(EDGE_PAYMENT_BEARER_TOKEN)?.value?.takeIf { it.isNotBlank() }
      ?: return null
    secrets.put(EDGE_PAYMENT_BEARER_TOKEN, legacy)
    metadata.delete(EDGE_PAYMENT_BEARER_TOKEN)
    return legacy
  }

  suspend fun provisionEndpoint(value: String) {
    require(value.startsWith("https://")) { "Edge sync endpoint must use HTTPS" }
    metadata.put(LocalMetadataEntity(EDGE_ENDPOINT, value))
  }

  suspend fun provisionPaymentBearerToken(value: String) {
    val token = value.trim()
    require(token.length >= 32) { "Edge payment bearer token must be at least 32 characters" }
    secrets.put(EDGE_PAYMENT_BEARER_TOKEN, token)
    metadata.delete(EDGE_PAYMENT_BEARER_TOKEN)
  }

  companion object {
    private const val EDGE_ENDPOINT = "sync_edge_endpoint"
    private const val EDGE_PAYMENT_BEARER_TOKEN = "edge_payment_bearer_token"
  }
}

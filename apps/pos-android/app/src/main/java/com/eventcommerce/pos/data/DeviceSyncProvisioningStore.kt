package com.eventcommerce.pos.data

class DeviceSyncProvisioningStore(db: AppDatabase) {
  private val metadata = db.localMetadata()

  suspend fun endpoint(): String? = metadata.find(EDGE_ENDPOINT)?.value?.takeIf { it.isNotBlank() }

  suspend fun paymentBearerToken(): String? =
    metadata.find(EDGE_PAYMENT_BEARER_TOKEN)?.value?.takeIf { it.isNotBlank() }

  suspend fun provisionEndpoint(value: String) {
    require(value.startsWith("https://")) { "Edge sync endpoint must use HTTPS" }
    metadata.put(LocalMetadataEntity(EDGE_ENDPOINT, value))
  }

  suspend fun provisionPaymentBearerToken(value: String) {
    require(value.trim().length >= 32) { "Edge payment bearer token must be at least 32 characters" }
    metadata.put(LocalMetadataEntity(EDGE_PAYMENT_BEARER_TOKEN, value.trim()))
  }

  companion object {
    private const val EDGE_ENDPOINT = "sync_edge_endpoint"
    private const val EDGE_PAYMENT_BEARER_TOKEN = "edge_payment_bearer_token"
  }
}

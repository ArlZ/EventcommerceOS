package com.eventcommerce.pos.data

class DeviceSyncProvisioningStore(db: AppDatabase) {
  private val metadata = db.localMetadata()

  suspend fun endpoint(): String? = metadata.find(EDGE_ENDPOINT)?.value?.takeIf { it.isNotBlank() }

  suspend fun provisionEndpoint(value: String) {
    require(value.startsWith("https://")) { "Edge sync endpoint must use HTTPS" }
    metadata.put(LocalMetadataEntity(EDGE_ENDPOINT, value))
  }

  companion object {
    private const val EDGE_ENDPOINT = "sync_edge_endpoint"
  }
}

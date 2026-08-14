package com.eventcommerce.pos.data

import com.eventcommerce.pos.security.PosDeviceCredentialStore

data class DeviceEdgeProvisioning(
  val endpoint: String,
  val deviceId: String,
  val token: String,
)

class DeviceSyncProvisioningStore(
  db: AppDatabase,
  private val credentials: PosDeviceCredentialStore,
) {
  private val metadata = db.localMetadata()

  suspend fun endpoint(): String? = metadata.find(EDGE_ENDPOINT)?.value?.takeIf { it.isNotBlank() }

  suspend fun provisionedDeviceId(): String? =
    metadata.find(EDGE_DEVICE_ID)?.value?.takeIf { it.isNotBlank() }

  suspend fun current(): DeviceEdgeProvisioning? {
    val endpoint = endpoint() ?: return null
    val deviceId = provisionedDeviceId() ?: return null
    val token = credentials.read()?.takeIf { it.isNotBlank() } ?: return null
    return DeviceEdgeProvisioning(endpoint, deviceId, token)
  }

  suspend fun provision(endpoint: String, deviceId: String, token: String) {
    require(endpoint.startsWith("https://")) { "Edge sync endpoint must use HTTPS" }
    require(deviceId.isNotBlank()) { "POS device ID must not be blank" }
    require(token.length >= 32) { "POS device credential must be at least 32 characters" }
    metadata.put(LocalMetadataEntity(EDGE_ENDPOINT, endpoint))
    metadata.put(LocalMetadataEntity(EDGE_DEVICE_ID, deviceId.trim()))
    credentials.write(token)
  }

  suspend fun clearCredential() {
    credentials.clear()
  }

  companion object {
    private const val EDGE_ENDPOINT = "sync_edge_endpoint"
    private const val EDGE_DEVICE_ID = "sync_edge_device_id"
  }
}

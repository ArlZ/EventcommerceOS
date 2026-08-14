package com.eventcommerce.pos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.DeviceSyncProvisioningStore
import com.eventcommerce.pos.security.PosDeviceCredentialStore
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DeviceProvisioningStoreTest {
  private lateinit var context: Context
  private lateinit var db: AppDatabase
  private lateinit var credentials: FakeCredentialStore
  private lateinit var provisioning: DeviceSyncProvisioningStore

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
      .allowMainThreadQueries()
      .build()
    credentials = FakeCredentialStore()
    provisioning = DeviceSyncProvisioningStore(db, credentials)
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun `stores endpoint and device id in Room while secret stays in secure store`() = runBlocking {
    val token = "pos-device-token-0123456789-abcdefghijklmnopqrstuvwxyz"
    provisioning.provision(
      endpoint = "https://edge.example/sync/device-events",
      deviceId = "device-a",
      token = token,
    )

    assertEquals("https://edge.example/sync/device-events", provisioning.endpoint())
    assertEquals("device-a", provisioning.provisionedDeviceId())
    assertEquals(token, credentials.value)
    assertEquals(token, provisioning.current()?.token)

    val metadataValues = db.localMetadata().all().map { it.value }
    assertEquals(false, metadataValues.contains(token))
  }

  @Test
  fun `credential loss requires reprovisioning but preserves non-secret metadata`() = runBlocking {
    provisioning.provision(
      endpoint = "https://edge.example/sync/device-events",
      deviceId = "device-a",
      token = "pos-device-token-0123456789-abcdefghijklmnopqrstuvwxyz",
    )
    provisioning.clearCredential()

    assertNull(provisioning.current())
    assertEquals("https://edge.example/sync/device-events", provisioning.endpoint())
    assertEquals("device-a", provisioning.provisionedDeviceId())
  }

  @Test
  fun `rejects insecure endpoint and weak credential`() {
    assertThrows(IllegalArgumentException::class.java) {
      runBlocking {
        provisioning.provision(
          endpoint = "http://edge.example/sync/device-events",
          deviceId = "device-a",
          token = "pos-device-token-0123456789-abcdefghijklmnopqrstuvwxyz",
        )
      }
    }
    assertThrows(IllegalArgumentException::class.java) {
      runBlocking {
        provisioning.provision(
          endpoint = "https://edge.example/sync/device-events",
          deviceId = "device-a",
          token = "short",
        )
      }
    }
  }

  private class FakeCredentialStore : PosDeviceCredentialStore {
    var value: String? = null

    override fun write(token: String) {
      value = token
    }

    override fun read(): String? = value

    override fun clear() {
      value = null
    }
  }
}

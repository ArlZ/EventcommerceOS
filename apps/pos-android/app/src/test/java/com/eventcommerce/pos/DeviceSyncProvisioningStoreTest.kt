package com.eventcommerce.pos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.DeviceSecretStore
import com.eventcommerce.pos.data.DeviceSyncProvisioningStore
import com.eventcommerce.pos.data.LocalMetadataEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DeviceSyncProvisioningStoreTest {
  private lateinit var db: AppDatabase
  private lateinit var secrets: FakeSecretStore

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
      .allowMainThreadQueries()
      .build()
    secrets = FakeSecretStore()
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun `legacy plaintext payment token migrates to secret store and is removed from Room`() = runBlocking {
    val token = "0123456789abcdef0123456789abcdef"
    db.localMetadata().put(LocalMetadataEntity("edge_payment_bearer_token", token))
    val provisioning = DeviceSyncProvisioningStore(db, secrets)

    assertEquals(token, provisioning.paymentBearerToken())
    assertEquals(token, secrets.get("edge_payment_bearer_token"))
    assertNull(db.localMetadata().find("edge_payment_bearer_token"))
  }

  @Test
  fun `new payment token is written only to secret store`() = runBlocking {
    val token = "abcdef0123456789abcdef0123456789"
    val provisioning = DeviceSyncProvisioningStore(db, secrets)

    provisioning.provisionPaymentBearerToken(token)

    assertEquals(token, provisioning.paymentBearerToken())
    assertEquals(token, secrets.get("edge_payment_bearer_token"))
    assertNull(db.localMetadata().find("edge_payment_bearer_token"))
  }

  private class FakeSecretStore : DeviceSecretStore {
    private val values = mutableMapOf<String, String>()

    override fun get(key: String): String? = values[key]

    override fun put(key: String, value: String) {
      values[key] = value
    }

    override fun remove(key: String) {
      values.remove(key)
    }
  }
}

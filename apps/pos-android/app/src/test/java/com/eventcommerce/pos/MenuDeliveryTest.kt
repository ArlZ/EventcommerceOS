package com.eventcommerce.pos

import android.content.Context
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.MenuCandidateItem
import com.eventcommerce.pos.domain.MenuIntegrity
import com.eventcommerce.pos.sync.MenuSnapshotJson
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.core.app.ApplicationProvider
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MenuDeliveryTest {
  private lateinit var context: Context
  private lateinit var db: AppDatabase
  private lateinit var repository: LocalPosRepository
  private lateinit var dbName: String

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    dbName = "menu-delivery-${UUID.randomUUID()}.db"
    db = AppDatabase.create(context, dbName)
    repository = LocalPosRepository(db)
  }

  @After
  fun tearDown() {
    runCatching { db.close() }
    context.deleteDatabase(dbName)
  }

  @Test
  fun `edge snapshot JSON validates into the existing menu candidate model`() {
    val json = """
      {
        "eventId":"dev-event-offline",
        "salesLocationId":"sales-1",
        "menuId":"dev-menu-v1",
        "version":1,
        "activatedAtEpochMs":1700000000000,
        "sourceActor":"built-in-task003",
        "currency":"KES",
        "checksum":"01776b48",
        "items":[
          {"itemId":"dev-tusker-500","skuId":"sku-tusker-500","name":"Tusker 500ml","category":"Beer","priceMinor":25000,"favourite":true,"sortOrder":10},
          {"itemId":"dev-whitecap-500","skuId":"sku-whitecap-500","name":"White Cap 500ml","category":"Beer","priceMinor":30000,"favourite":true,"sortOrder":20},
          {"itemId":"dev-water-500","skuId":"sku-water-500","name":"Water 500ml","category":"Soft Drinks","priceMinor":10000,"favourite":true,"sortOrder":30},
          {"itemId":"dev-soda-300","skuId":"sku-soda-300","name":"Soda 300ml","category":"Soft Drinks","priceMinor":15000,"favourite":false,"sortOrder":40}
        ]
      }
    """.trimIndent()

    val parsed = MenuSnapshotJson.candidate(json)
    assertEquals("dev-event-offline", parsed.eventId)
    assertEquals(4, parsed.items.size)
    assertEquals("01776b48", parsed.checksum)
  }

  @Test
  fun `unused development menu can be replaced by first provisioned event menu`() = runBlocking {
    repository.ensureDevelopmentMenu()
    val live = liveMenu(eventId = "event-live", version = 1)

    val installed = repository.installProvisionedMenu(live)

    assertEquals("event-live", installed.eventId)
    assertEquals(1, installed.version)
    assertEquals("event-live", repository.activeMenu()?.eventId)
  }

  @Test
  fun `development order history blocks silent replacement by a live event`() = runBlocking {
    val development = repository.ensureDevelopmentMenu()
    val order = repository.addItem(development.items.first().itemId)
    repository.recordCashPayment(order.id)

    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { repository.installProvisionedMenu(liveMenu("event-live", 1)) }
    }
  }

  @Test
  fun `another real event cannot reuse the register menu store without explicit reset`() = runBlocking {
    repository.installProvisionedMenu(liveMenu("event-one", 1))

    assertThrows(IllegalStateException::class.java) {
      runBlocking { repository.installProvisionedMenu(liveMenu("event-two", 2)) }
    }
  }

  private fun liveMenu(eventId: String, version: Long): MenuCandidate {
    val unsigned = MenuCandidate(
      eventId = eventId,
      menuId = "menu-$eventId",
      version = version,
      activatedAtEpochMs = 1_800_000_000_000,
      sourceActor = "edge-admin",
      currency = "KES",
      checksum = "",
      items = listOf(
        MenuCandidateItem(
          itemId = "water-500",
          skuId = "sku-water-500",
          name = "Water 500ml",
          category = "Soft Drinks",
          priceMinor = 10_000,
          favourite = true,
          sortOrder = 10,
        ),
      ),
    )
    return MenuIntegrity.signed(unsigned)
  }
}

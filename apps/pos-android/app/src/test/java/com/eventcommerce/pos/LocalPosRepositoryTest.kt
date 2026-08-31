package com.eventcommerce.pos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.data.TransactionFaultInjector
import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.MenuCandidateItem
import com.eventcommerce.pos.domain.MenuIntegrity
import com.eventcommerce.pos.domain.OrderState
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LocalPosRepositoryTest {
  private lateinit var context: Context
  private lateinit var db: AppDatabase
  private lateinit var repository: LocalPosRepository
  private lateinit var dbName: String

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    dbName = "task003-${UUID.randomUUID()}.db"
    db = openDatabase()
    repository = LocalPosRepository(db)
  }

  @After
  fun tearDown() {
    runCatching { db.close() }
    context.deleteDatabase(dbName)
  }

  @Test
  fun `one hundred local orders survive repeated restarts without network services`() = runBlocking {
    val itemId = repository.ensureDevelopmentMenu().items.first().itemId

    repeat(100) { index ->
      val open = repository.addItem(itemId)
      val closed = repository.recordCashPayment(open.id)
      assertEquals(OrderState.CLOSED, closed.state)

      if ((index + 1) % 25 == 0 && index < 99) {
        db.close()
        db = openDatabase()
        repository = LocalPosRepository(db)
        assertEquals(index + 1, repository.closedOrderCount())
        assertNull(repository.currentOpenOrder())
      }
    }

    assertEquals(100, repository.closedOrderCount())
    assertEquals(300, repository.outboxCount())
    assertNull(repository.currentOpenOrder())
  }

  @Test
  fun `committed open and closed orders survive database reopen`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    val itemId = menu.items.first().itemId
    val first = repository.addItem(itemId)
    repository.recordCashPayment(first.id)
    val open = repository.addItem(itemId)
    val pendingBeforeRestart = repository.outboxCount()

    db.close()
    db = openDatabase()
    repository = LocalPosRepository(db)

    assertEquals(open.id, repository.currentOpenOrder()?.id)
    assertEquals(1, repository.history().size)
    assertEquals(pendingBeforeRestart, repository.outboxCount())
    val sequences = repository.allOutboxEvents().map { it.sequence }
    assertEquals(sequences.distinct(), sequences)
    assertEquals(sequences.sorted(), sequences)
  }

  @Test
  fun `failure before commit rolls back order and outbox together`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    val failing = LocalPosRepository(
      db = db,
      faultInjector = TransactionFaultInjector { operation ->
        if (operation == "addItem") error("simulated process failure before commit")
      },
    )

    assertThrows(IllegalStateException::class.java) {
      runBlocking { failing.addItem(menu.items.first().itemId) }
    }

    assertNull(repository.currentOpenOrder())
    assertEquals(0, repository.outboxCount())
  }

  @Test
  fun `repeated close is idempotent`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    val open = repository.addItem(menu.items.first().itemId)
    val firstClose = repository.recordCashPayment(open.id)
    val eventCountAfterFirstClose = repository.outboxCount(open.id, "ORDER_CLOSED_CASH")
    val secondClose = repository.recordCashPayment(open.id)

    assertEquals(firstClose.id, secondClose.id)
    assertEquals(OrderState.CLOSED, secondClose.state)
    assertEquals(1, eventCountAfterFirstClose)
    assertEquals(1, repository.outboxCount(open.id, "ORDER_CLOSED_CASH"))
  }

  @Test
  fun `closed order outbox freezes inventory-relevant line snapshot`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    val item = menu.items.first()
    val open = repository.addItem(item.itemId, quantityDelta = 2)
    repository.recordCashPayment(open.id)

    val event = repository.allOutboxEvents()
      .single { it.aggregateId == open.id && it.eventType == "ORDER_CLOSED_CASH" }
    val payload = JSONObject(event.payloadJson)
    val lines = payload.getJSONArray("lines")

    assertEquals(2, event.eventVersion)
    assertEquals(open.eventId, payload.getString("eventId"))
    assertEquals(open.salesLocationId, payload.getString("salesLocationId"))
    assertEquals(1, lines.length())
    assertEquals(item.skuId, lines.getJSONObject(0).getString("skuId"))
    assertEquals(2, lines.getJSONObject(0).getInt("quantity"))
    assertEquals(item.priceMinor, lines.getJSONObject(0).getLong("unitPriceMinor"))
  }


  @Test
  fun `production order uses sales location delivered by Event Edge menu`() = runBlocking {
    val unsigned = MenuCandidate(
      eventId = "event-production",
      salesLocationId = "bar-production",
      menuId = "menu-production",
      version = 11,
      activatedAtEpochMs = 1_787_600_000_000,
      sourceActor = "edge-admin",
      currency = "KES",
      checksum = "",
      items = listOf(
        MenuCandidateItem(
          itemId = "item-water",
          skuId = "sku-water",
          name = "Pilot Water 500ml",
          category = "Beverage",
          priceMinor = 10_000,
        ),
      ),
    )
    val menu = repository.installMenu(MenuIntegrity.signed(unsigned))
    val order = repository.addItem(menu.items.single().itemId)

    assertEquals("event-production", order.eventId)
    assertEquals("bar-production", order.salesLocationId)
  }

  @Test
  fun `idempotent menu refresh updates sales location assignment`() = runBlocking {
    val unsigned = MenuCandidate(
      eventId = "event-production",
      salesLocationId = "bar-one",
      menuId = "menu-production",
      version = 12,
      activatedAtEpochMs = 1_787_600_000_001,
      sourceActor = "edge-admin",
      currency = "KES",
      checksum = "",
      items = listOf(
        MenuCandidateItem(
          itemId = "item-water",
          skuId = "sku-water",
          name = "Pilot Water 500ml",
          category = "Beverage",
          priceMinor = 10_000,
        ),
      ),
    )
    val first = MenuIntegrity.signed(unsigned)
    repository.installMenu(first)
    repository.installMenu(first.copy(salesLocationId = "bar-two"))

    val order = repository.addItem(first.items.single().itemId)
    assertEquals("bar-two", order.salesLocationId)
  }


  @Test
  fun `known legacy production binding is repaired without changing order identity`() = runBlocking {
    val unsigned = MenuCandidate(
      eventId = "event-production",
      salesLocationId = "bar-production",
      menuId = "menu-production",
      version = 13,
      activatedAtEpochMs = 1_787_600_000_002,
      sourceActor = "edge-admin",
      currency = "KES",
      checksum = "",
      items = listOf(
        MenuCandidateItem(
          itemId = "item-water",
          skuId = "sku-water",
          name = "Pilot Water 500ml",
          category = "Beverage",
          priceMinor = 10_000,
        ),
      ),
    )
    val menu = repository.installMenu(MenuIntegrity.signed(unsigned))
    val closed = repository.recordCashPayment(
      repository.addItem(menu.items.single().itemId).id,
    )
    val originalEvents = repository.allOutboxEvents().filter { it.aggregateId == closed.id }

    db.orders().updateOrder(
      requireNotNull(db.orders().order(closed.id)).copy(salesLocationId = "dev-main-bar"),
    )
    originalEvents.forEach { event ->
      val payload = JSONObject(event.payloadJson)
      payload.put("salesLocationId", "dev-main-bar")
      db.pendingEvents().update(event.copy(payloadJson = payload.toString()))
    }

    assertEquals(1, repository.repairLegacyProductionSalesLocation(menu))

    val repaired = requireNotNull(db.orders().order(closed.id))
    assertEquals(closed.id, repaired.id)
    assertEquals("bar-production", repaired.salesLocationId)
    repository.allOutboxEvents()
      .filter { it.aggregateId == closed.id }
      .forEach { event ->
        assertEquals("bar-production", JSONObject(event.payloadJson).getString("salesLocationId"))
      }
  }

  @Test
  fun `invalid menu update leaves last valid menu active`() = runBlocking {
    val active = repository.ensureDevelopmentMenu()
    val invalid = MenuCandidate(
      eventId = active.eventId,
      salesLocationId = requireNotNull(active.salesLocationId),
      menuId = active.menuId,
      version = active.version + 1,
      activatedAtEpochMs = active.activatedAtEpochMs + 1,
      sourceActor = "corrupt-test",
      currency = active.currency,
      checksum = "00000000",
      items = active.items,
    )

    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { repository.installMenu(invalid) }
    }

    val stillActive = repository.activeMenu()
    assertNotNull(stillActive)
    assertEquals(active.version, stillActive?.version)
    assertEquals(active.checksum, stillActive?.checksum)
  }

  @Test
  fun `unused built in development menu is retired before production use`() = runBlocking {
    repository.ensureDevelopmentMenu()

    assertNull(repository.activeProductionMenu())
    assertTrue(repository.retireUnusedDevelopmentMenu())
    assertNull(repository.activeMenu())
    assertFalse(repository.retireUnusedDevelopmentMenu())
  }

  @Test
  fun `development menu referenced by an order is never deleted automatically`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    repository.addItem(menu.items.first().itemId)

    assertFalse(repository.retireUnusedDevelopmentMenu())
    assertNotNull(repository.activeMenu())
    assertNull(repository.activeProductionMenu())
  }

  private fun openDatabase(): AppDatabase =
    Room.databaseBuilder(context, AppDatabase::class.java, dbName)
      .addMigrations(AppDatabase.MIGRATION_1_2)
      .allowMainThreadQueries()
      .build()
}

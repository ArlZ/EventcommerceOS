package com.eventcommerce.pos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.DeviceSyncStateStore
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.sync.DeviceEdgeAck
import com.eventcommerce.pos.sync.DeviceEdgeTransport
import com.eventcommerce.pos.sync.DeviceSyncEngine
import com.eventcommerce.pos.sync.HttpsDeviceEdgeTransport
import com.eventcommerce.pos.sync.SyncJson
import com.eventcommerce.pos.sync.deviceRetryDelayMs
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DeviceSyncEngineTest {
  private lateinit var context: Context
  private lateinit var db: AppDatabase
  private lateinit var repository: LocalPosRepository
  private lateinit var state: DeviceSyncStateStore
  private lateinit var dbName: String

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    dbName = "task004-${UUID.randomUUID()}.db"
    db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
      .addMigrations(AppDatabase.MIGRATION_1_2)
      .allowMainThreadQueries()
      .build()
    repository = LocalPosRepository(db)
    state = DeviceSyncStateStore(db)
  }

  @After
  fun tearDown() {
    db.close()
    context.deleteDatabase(dbName)
  }

  @Test
  fun `lost acknowledgement safely replays durable events and stores later watermark`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    val order = repository.addItem(menu.items.first().itemId)
    repository.recordCashPayment(order.id)
    val highest = repository.allOutboxEvents().maxOf { it.sequence }
    var attempts = 0
    val transport = DeviceEdgeTransport { deviceId, _ ->
      attempts += 1
      if (attempts == 1) error("acknowledgement lost after Edge persisted batch")
      DeviceEdgeAck(deviceId, highest, 0)
    }
    val engine = DeviceSyncEngine(db, transport, state)

    assertThrows(IllegalStateException::class.java) { runBlocking { engine.syncOnce() } }
    assertEquals(0L, state.health().acknowledgedThroughSequence)
    val recovered = engine.syncOnce()
    assertEquals(highest, recovered.acceptedThroughSequence)
    assertEquals(0, recovered.remaining)
    assertEquals(highest, state.health().acknowledgedThroughSequence)
  }

  @Test
  fun `device refuses an Edge watermark beyond its highest durable event`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    repository.addItem(menu.items.first().itemId)
    val highest = repository.allOutboxEvents().maxOf { it.sequence }
    val transport = DeviceEdgeTransport { deviceId, _ -> DeviceEdgeAck(deviceId, highest + 10, 0) }
    val engine = DeviceSyncEngine(db, transport, state)

    assertThrows(IllegalArgumentException::class.java) { runBlocking { engine.syncOnce() } }
    assertEquals(0L, state.health().acknowledgedThroughSequence)
  }

  @Test
  fun `acknowledged events are not sent again`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    repository.addItem(menu.items.first().itemId)
    val highest = repository.allOutboxEvents().maxOf { it.sequence }
    var calls = 0
    val transport = DeviceEdgeTransport { deviceId, _ ->
      calls += 1
      DeviceEdgeAck(deviceId, highest, 4)
    }
    val engine = DeviceSyncEngine(db, transport, state)

    engine.syncOnce()
    val empty = engine.syncOnce()
    assertEquals(1, calls)
    assertEquals(0, empty.attempted)
    assertEquals(4, state.health().edgeBacklogCount)
  }

  @Test
  fun `background sync sends only the bounded unacknowledged batch`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    repeat(25) { repository.addItem(menu.items.first().itemId) }
    val totalEvents = repository.allOutboxEvents().size
    var sentCount = 0
    val transport = DeviceEdgeTransport { deviceId, events ->
      sentCount = events.size
      DeviceEdgeAck(deviceId, events.maxOf { it.sequence }, 0)
    }
    val engine = DeviceSyncEngine(db, transport, state)

    val first = engine.syncOnce(batchSize = 10)

    assertEquals(10, sentCount)
    assertEquals(10, first.attempted)
    assertEquals(totalEvents - 10, first.remaining)
  }

  @Test
  fun `conflict persists safe prefix and enters retry backoff path`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    repeat(3) { repository.addItem(menu.items.first().itemId) }
    val events = repository.allOutboxEvents().sortedBy { it.sequence }
    val safePrefix = events.first().sequence
    val transport = DeviceEdgeTransport { deviceId, _ ->
      DeviceEdgeAck(deviceId, safePrefix, 2, hasConflict = true)
    }
    val engine = DeviceSyncEngine(db, transport, state)

    assertThrows(IllegalStateException::class.java) { runBlocking { engine.syncOnce() } }
    val health = state.health()
    assertEquals(safePrefix, health.acknowledgedThroughSequence)
    assertEquals(2, health.edgeBacklogCount)
    assertEquals("Edge reconciliation required before sync can advance", health.lastError)
  }

  @Test
  fun `Edge response parser detects conflict receipts`() {
    val acknowledgement = SyncJson.acknowledgement(
      """{"deviceId":"device-1","acceptedThroughSequence":0,"edgeBacklogCount":3,"receipts":[{"eventInstanceId":"event-1","status":"CONFLICT"}]}""",
    )

    assertTrue(acknowledgement.hasConflict)
    assertEquals(0L, acknowledgement.acceptedThroughSequence)
    assertEquals(3, acknowledgement.edgeBacklogCount)
  }

  @Test
  fun `retry delay is bounded and HTTPS transport rejects cleartext endpoint`() {
    assertEquals(500L, deviceRetryDelayMs(1, random = { 0.0 }))
    assertEquals(30_000L, deviceRetryDelayMs(30, random = { 1.0 }))
    assertThrows(IllegalArgumentException::class.java) {
      HttpsDeviceEdgeTransport(
        "http://edge.local/sync/device-events",
        "device-1",
        "test-edge-sync-token-0123456789-abcdefghijklmnopqrstuvwxyz",
      )
    }
  }
}

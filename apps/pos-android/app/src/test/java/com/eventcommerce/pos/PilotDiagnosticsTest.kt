package com.eventcommerce.pos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.DeviceSyncStateStore
import com.eventcommerce.pos.data.LocalPosRepository
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PilotDiagnosticsTest {
  private lateinit var context: Context
  private lateinit var db: AppDatabase
  private lateinit var repository: LocalPosRepository
  private lateinit var dbName: String

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    dbName = "pilot-diagnostics-${UUID.randomUUID()}.db"
    db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
      .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3)
      .allowMainThreadQueries()
      .build()
    repository = LocalPosRepository(db)
  }

  @After
  fun tearDown() {
    db.close()
    context.deleteDatabase(dbName)
  }

  @Test
  fun `snapshot reports durable queue and sync state without credentials`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    repeat(2) {
      val order = repository.addItem(menu.items.first().itemId)
      repository.recordCashPayment(order.id)
    }
    DeviceSyncStateStore(db).recordSuccess(
      acceptedThroughSequence = 3,
      edgeBacklogCount = 2,
      nowEpochMs = 1_700_000_000_000,
    )

    val snapshot = PilotDiagnosticsCollector(
      db = db,
      repository = repository,
      releaseCommit = "a".repeat(40),
      appVersionName = "test-version",
      appVersionCode = 99,
      clock = { 1_700_000_123_456 },
    ).snapshot()

    assertEquals(2, snapshot.closedOrderCount)
    assertEquals(6L, snapshot.highestLocalSequence)
    assertEquals(3L, snapshot.acknowledgedThroughSequence)
    assertEquals(3, snapshot.pendingAfterAcknowledgement)
    assertEquals(2, snapshot.edgeBacklogCount)
    assertEquals(1_700_000_000_000, snapshot.lastSyncSuccessAtEpochMs)
    assertFalse(snapshot.hasSyncError)

    val json = JSONObject(snapshot.toJson())
    assertEquals("a".repeat(40), json.getString("releaseCommit"))
    assertEquals("test-version", json.getString("appVersionName"))
    assertEquals(99, json.getInt("appVersionCode"))
    assertEquals(menu.version, json.getLong("activeMenuVersion"))
    assertFalse(json.has("token"))
    assertFalse(json.has("endpoint"))
    assertFalse(json.has("lastError"))
  }
}

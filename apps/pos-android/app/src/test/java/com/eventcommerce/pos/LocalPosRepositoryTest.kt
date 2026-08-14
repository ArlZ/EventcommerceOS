package com.eventcommerce.pos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.data.TransactionFaultInjector
import com.eventcommerce.pos.domain.LocalPaymentAttempt
import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.OrderState
import com.eventcommerce.pos.domain.PaymentAttemptState
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
  fun `M-PESA attempt suspends one order and immediately frees POS for the next customer`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val firstOrder = repository.addItem(item.itemId)
    val attempt = repository.beginMpesaPayment(firstOrder.id)

    assertEquals(PaymentAttemptState.INITIATED, attempt.state)
    assertNull(repository.currentOpenOrder())
    assertEquals(OrderState.PAYMENT_PENDING, repository.paymentPendingOrders().single().state)

    val secondOrder = repository.addItem(item.itemId)
    assertTrue(secondOrder.id != firstOrder.id)
    assertEquals(secondOrder.id, repository.currentOpenOrder()?.id)
    assertEquals(firstOrder.id, repository.paymentPendingOrders().single().id)
  }

  @Test
  fun `pending and unknown M-PESA attempts never close order or create a sale event`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    val attempt = repository.beginMpesaPayment(order.id)

    repository.applyPaymentSnapshot(edgeSnapshot(attempt, PaymentAttemptState.PENDING))
    assertEquals(OrderState.PAYMENT_PENDING, repository.paymentPendingOrders().single().state)
    assertEquals(0, repository.outboxCount(order.id, "ORDER_CLOSED_MPESA"))

    repository.applyPaymentSnapshot(edgeSnapshot(attempt, PaymentAttemptState.UNKNOWN))
    assertEquals(OrderState.PAYMENT_PENDING, repository.paymentPendingOrders().single().state)
    assertEquals(0, repository.outboxCount(order.id, "ORDER_CLOSED_MPESA"))
  }

  @Test
  fun `confirmed M-PESA success closes suspended order exactly once and freezes sale lines`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId, quantityDelta = 2)
    val attempt = repository.beginMpesaPayment(order.id)
    val success = edgeSnapshot(attempt, PaymentAttemptState.SUCCESS)

    repository.applyPaymentSnapshot(success)
    repository.applyPaymentSnapshot(success.copy(updatedAtEpochMs = success.updatedAtEpochMs + 1))

    assertEquals(1, repository.outboxCount(order.id, "ORDER_CLOSED_MPESA"))
    assertTrue(repository.paymentPendingOrders().isEmpty())
    val closed = repository.history().single { it.id == order.id }
    assertEquals(OrderState.CLOSED, closed.state)

    val event = repository.allOutboxEvents()
      .single { it.aggregateId == order.id && it.eventType == "ORDER_CLOSED_MPESA" }
    val lines = JSONObject(event.payloadJson).getJSONArray("lines")
    assertEquals(1, lines.length())
    assertEquals(item.skuId, lines.getJSONObject(0).getString("skuId"))
    assertEquals(2, lines.getJSONObject(0).getInt("quantity"))
  }

  @Test
  fun `stale pending snapshot cannot regress confirmed M-PESA success or reopen duplicate charge risk`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    val attempt = repository.beginMpesaPayment(order.id)
    val success = edgeSnapshot(attempt, PaymentAttemptState.SUCCESS)
    repository.applyPaymentSnapshot(success)

    assertThrows(IllegalArgumentException::class.java) {
      runBlocking {
        repository.applyPaymentSnapshot(
          edgeSnapshot(attempt, PaymentAttemptState.PENDING)
            .copy(updatedAtEpochMs = success.updatedAtEpochMs - 1),
        )
      }
    }
    repository.markPaymentTransportUnknown(attempt.attemptId, "254****5678")

    assertEquals(PaymentAttemptState.SUCCESS, repository.paymentAttempt(attempt.attemptId)?.state)
    assertEquals(1, repository.outboxCount(order.id, "ORDER_CLOSED_MPESA"))
    assertEquals(OrderState.CLOSED, repository.history().single { it.id == order.id }.state)
  }

  @Test
  fun `failure during confirmed M-PESA close rolls back payment projection order and outbox together`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val failing = LocalPosRepository(
      db = db,
      faultInjector = TransactionFaultInjector { operation ->
        if (operation == "closeConfirmedMpesa") error("simulated process death")
      },
    )
    failing.ensureDevelopmentMenu()
    val order = failing.addItem(item.itemId)
    val attempt = failing.beginMpesaPayment(order.id)
    val success = edgeSnapshot(attempt, PaymentAttemptState.SUCCESS)

    assertThrows(IllegalStateException::class.java) {
      runBlocking { failing.applyPaymentSnapshot(success) }
    }

    assertEquals(PaymentAttemptState.INITIATED, failing.paymentAttempt(attempt.attemptId)?.state)
    assertEquals(OrderState.PAYMENT_PENDING, failing.paymentPendingOrders().single().state)
    assertEquals(0, failing.outboxCount(order.id, "ORDER_CLOSED_MPESA"))
  }

  @Test
  fun `unresolved M-PESA payment survives restart without storing payer phone`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    val attempt = repository.beginMpesaPayment(order.id)
    repository.markPaymentTransportUnknown(attempt.attemptId, "254****5678")

    db.close()
    db = openDatabase()
    repository = LocalPosRepository(db)

    val restored = repository.unresolvedPayments().single()
    assertEquals(attempt.attemptId, restored.attemptId)
    assertEquals(PaymentAttemptState.UNKNOWN, restored.state)
    assertEquals("254****5678", restored.maskedPayerReference)
    assertEquals(OrderState.PAYMENT_PENDING, repository.paymentPendingOrders().single().state)

    val cursor = db.openHelper.readableDatabase.query("SELECT * FROM payment_attempts")
    cursor.use {
      assertTrue(it.moveToFirst())
      val values = buildString {
        repeat(it.columnCount) { index ->
          if (!it.isNull(index)) append(it.getString(index))
        }
      }
      assertFalse(values.contains("254712345678"))
    }
  }

  @Test
  fun `failed M-PESA can return suspended order to cart only after provider truth is terminal`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    val attempt = repository.beginMpesaPayment(order.id)
    repository.applyPaymentSnapshot(edgeSnapshot(attempt, PaymentAttemptState.FAILED))

    repository.resumeOrderAfterFailedPayment(attempt.attemptId)
    assertEquals(order.id, repository.currentOpenOrder()?.id)
    assertTrue(repository.paymentPendingOrders().isEmpty())
  }

  @Test
  fun `invalid menu update leaves last valid menu active`() = runBlocking {
    val active = repository.ensureDevelopmentMenu()
    val invalid = MenuCandidate(
      eventId = active.eventId,
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

  private fun edgeSnapshot(
    local: LocalPaymentAttempt,
    state: PaymentAttemptState,
  ): LocalPaymentAttempt = local.copy(
    state = state,
    maskedPayerReference = "254****5678",
    providerRequestId = if (state == PaymentAttemptState.INITIATED) null else "checkout-${local.attemptId}",
    providerReceiptReference = if (state == PaymentAttemptState.SUCCESS) "receipt-${local.attemptId}" else null,
    reconciliationRequired = state == PaymentAttemptState.INITIATED ||
      state == PaymentAttemptState.PENDING ||
      state == PaymentAttemptState.UNKNOWN,
    updatedAtEpochMs = local.updatedAtEpochMs + 1000,
  )

  private fun openDatabase(): AppDatabase =
    Room.databaseBuilder(context, AppDatabase::class.java, dbName)
      .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3)
      .allowMainThreadQueries()
      .build()
}

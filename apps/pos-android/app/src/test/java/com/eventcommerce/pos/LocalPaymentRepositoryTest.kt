package com.eventcommerce.pos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.domain.OrderState
import com.eventcommerce.pos.domain.PaymentAttemptState
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LocalPaymentRepositoryTest {
  private lateinit var context: Context
  private lateinit var db: AppDatabase
  private lateinit var repository: LocalPosRepository
  private lateinit var dbName: String

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    dbName = "task006-${UUID.randomUUID()}.db"
    db = openDatabase()
    repository = LocalPosRepository(db)
  }

  @After
  fun tearDown() {
    runCatching { db.close() }
    context.deleteDatabase(dbName)
  }

  @Test
  fun `payment attempt and unresolved order survive database restart`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    val attempt = repository.createPaymentAttempt(
      orderId = order.id,
      providerId = "mpesa",
      clientAttemptId = "client-attempt-1",
    )
    repository.applyPaymentState(attempt.id, PaymentAttemptState.UNKNOWN, failureCode = "TIMEOUT")

    db.close()
    db = openDatabase()
    repository = LocalPosRepository(db)

    assertEquals(OrderState.PAYMENT_PENDING, repository.currentOpenOrder()?.state)
    assertEquals(PaymentAttemptState.UNKNOWN, repository.paymentAttempt(attempt.id)?.state)
    assertEquals(1, repository.unresolvedPaymentAttempts().size)
  }

  @Test
  fun `same client attempt is idempotent locally`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    val first = repository.createPaymentAttempt(
      order.id,
      "mpesa",
      clientAttemptId = "same-attempt",
    )
    val second = repository.createPaymentAttempt(
      order.id,
      "mpesa",
      clientAttemptId = "same-attempt",
    )

    assertEquals(first.id, second.id)
    assertEquals(first.idempotencyKey, second.idempotencyKey)
    assertEquals(1, repository.paymentAttemptsForOrder(order.id).size)
  }

  @Test
  fun `unknown payment blocks order edits and cash close`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    val firstItem = menu.items.first()
    val secondItem = menu.items.last()
    val order = repository.addItem(firstItem.itemId)
    val attempt = repository.createPaymentAttempt(order.id, "mpesa")
    repository.applyPaymentState(attempt.id, PaymentAttemptState.UNKNOWN)

    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { repository.addItem(secondItem.itemId) }
    }
    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { repository.recordCashPayment(order.id) }
    }
    assertEquals(OrderState.PAYMENT_PENDING, repository.currentOpenOrder()?.state)
  }

  @Test
  fun `definitive failure reopens the same order`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    val attempt = repository.createPaymentAttempt(order.id, "mpesa")

    repository.applyPaymentState(attempt.id, PaymentAttemptState.FAILED, failureCode = "DECLINED")

    assertEquals(OrderState.OPEN, repository.currentOpenOrder()?.state)
    assertEquals(PaymentAttemptState.FAILED, repository.paymentAttempt(attempt.id)?.state)
  }

  @Test
  fun `provider success atomically closes order and emits provider close event`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    val attempt = repository.createPaymentAttempt(order.id, "mpesa")

    val succeeded = repository.applyPaymentState(
      attempt.id,
      PaymentAttemptState.SUCCEEDED,
      providerReference = "checkout-123",
    )

    assertEquals(PaymentAttemptState.SUCCEEDED, succeeded.state)
    assertEquals(1, repository.closedOrderCount())
    assertEquals(1, repository.outboxCount(order.id, "ORDER_CLOSED_PROVIDER"))
    assertNotNull(repository.history().firstOrNull { it.id == order.id })
  }

  @Test
  fun `payment outbox contains no customer phone field`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    val attempt = repository.createPaymentAttempt(order.id, "mpesa")

    val paymentEvent = repository.allOutboxEvents()
      .single { it.aggregateId == attempt.id && it.eventType == "PAYMENT_ATTEMPT_CREATED" }

    assertEquals(false, paymentEvent.payloadJson.contains("customerPhone"))
    assertEquals(false, paymentEvent.payloadJson.contains("2547"))
  }

  private fun openDatabase(): AppDatabase =
    Room.databaseBuilder(context, AppDatabase::class.java, dbName)
      .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3)
      .allowMainThreadQueries()
      .build()
}

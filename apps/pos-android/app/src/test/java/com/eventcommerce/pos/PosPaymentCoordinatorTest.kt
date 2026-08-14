package com.eventcommerce.pos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.domain.LocalPaymentAttempt
import com.eventcommerce.pos.domain.PaymentAttemptState
import com.eventcommerce.pos.sync.PaymentEdgeTransport
import com.eventcommerce.pos.sync.PosPaymentCoordinator
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PosPaymentCoordinatorTest {
  private lateinit var context: Context
  private lateinit var db: AppDatabase
  private lateinit var repository: LocalPosRepository
  private lateinit var transport: FakePaymentEdgeTransport
  private lateinit var coordinator: PosPaymentCoordinator
  private lateinit var dbName: String

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    dbName = "task006-payments-${UUID.randomUUID()}.db"
    db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
      .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3)
      .allowMainThreadQueries()
      .build()
    repository = LocalPosRepository(db)
    transport = FakePaymentEdgeTransport()
    coordinator = PosPaymentCoordinator(repository, transport)
  }

  @After
  fun tearDown() {
    runCatching { db.close() }
    context.deleteDatabase(dbName)
  }

  @Test
  fun `ambiguous first relay becomes UNKNOWN without automatic duplicate initiation`() = runBlocking {
    val order = repository.addItem(repository.ensureDevelopmentMenu().items.first().itemId)
    val attempt = coordinator.beginMpesa(order.id)
    transport.throwInitiate = true

    val result = coordinator.relayMpesa(attempt.attemptId, "254712345678")

    assertEquals(PaymentAttemptState.UNKNOWN, result.state)
    assertEquals(1, transport.initiateCalls)
    assertEquals(0, transport.getCalls)
    assertEquals("254****5678", result.maskedPayerReference)
    assertNull(result.providerRequestId)
  }

  @Test
  fun `resume UNKNOWN replays the same immutable attempt and can recover Edge success without a second payment identity`() = runBlocking {
    val order = repository.addItem(repository.ensureDevelopmentMenu().items.first().itemId)
    val attempt = coordinator.beginMpesa(order.id)
    transport.throwInitiate = true
    coordinator.relayMpesa(attempt.attemptId, "254712345678")
    transport.throwInitiate = false
    transport.remote = edge(attempt, PaymentAttemptState.SUCCESS)

    val recovered = coordinator.resumeUnknownInitiation(attempt.attemptId, "254712345678")

    assertEquals(PaymentAttemptState.SUCCESS, recovered.state)
    assertEquals(attempt.attemptId, recovered.attemptId)
    assertEquals(attempt.idempotencyKey, recovered.idempotencyKey)
    assertEquals(2, transport.initiateCalls)
    assertEquals(0, transport.getCalls)
    assertEquals(1, repository.outboxCount(order.id, "ORDER_CLOSED_MPESA"))
  }

  @Test
  fun `safe retry after terminal failure creates a new attempt under the same logical payment`() = runBlocking {
    val order = repository.addItem(repository.ensureDevelopmentMenu().items.first().itemId)
    val first = coordinator.beginMpesa(order.id)
    repository.applyPaymentSnapshot(edge(first, PaymentAttemptState.FAILED))
    repository.resumeOrderAfterFailedPayment(first.attemptId)

    val retry = coordinator.beginMpesa(order.id)

    assertEquals(first.paymentId, retry.paymentId)
    assertNotEquals(first.attemptId, retry.attemptId)
    assertNotEquals(first.clientAttemptId, retry.clientAttemptId)
    assertNotEquals(first.idempotencyKey, retry.idempotencyKey)
  }

  @Test
  fun `background refresh resolves pending success without needing payer phone again`() = runBlocking {
    val order = repository.addItem(repository.ensureDevelopmentMenu().items.first().itemId)
    val attempt = coordinator.beginMpesa(order.id)
    transport.remote = edge(attempt, PaymentAttemptState.PENDING)
    val pending = coordinator.relayMpesa(attempt.attemptId, "254712345678")
    assertEquals(PaymentAttemptState.PENDING, pending.state)

    transport.remote = edge(attempt, PaymentAttemptState.SUCCESS)
    val refreshed = coordinator.refreshUnresolved().single()

    assertEquals(PaymentAttemptState.SUCCESS, refreshed.state)
    assertEquals(1, transport.initiateCalls)
    assertEquals(1, transport.getCalls)
    assertEquals(1, repository.outboxCount(order.id, "ORDER_CLOSED_MPESA"))
  }

  @Test
  fun `invalid payer is rejected before any Edge call`() = runBlocking {
    assertThrows(IllegalArgumentException::class.java) {
      coordinator.validatePayerMsisdn("0712345678")
    }
    assertEquals(0, transport.initiateCalls)
    assertEquals(0, transport.getCalls)
  }

  @Test
  fun `known provider request on UNKNOWN cannot be re-initiated`() = runBlocking {
    val order = repository.addItem(repository.ensureDevelopmentMenu().items.first().itemId)
    val attempt = coordinator.beginMpesa(order.id)
    repository.applyPaymentSnapshot(
      edge(attempt, PaymentAttemptState.UNKNOWN).copy(providerRequestId = "checkout-known"),
    )

    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { coordinator.resumeUnknownInitiation(attempt.attemptId, "254712345678") }
    }
    assertEquals(0, transport.initiateCalls)
  }

  private fun edge(
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

  private class FakePaymentEdgeTransport : PaymentEdgeTransport {
    var initiateCalls = 0
    var getCalls = 0
    var throwInitiate = false
    var remote: LocalPaymentAttempt? = null

    override suspend fun initiate(
      attempt: LocalPaymentAttempt,
      payerMsisdn: String,
    ): LocalPaymentAttempt {
      initiateCalls += 1
      assertNotNull(payerMsisdn)
      if (throwInitiate) error("simulated lost Edge response")
      return remote ?: attempt.copy(
        state = PaymentAttemptState.PENDING,
        maskedPayerReference = "254****5678",
        providerRequestId = "checkout-${attempt.attemptId}",
        reconciliationRequired = true,
        updatedAtEpochMs = attempt.updatedAtEpochMs + 1,
      )
    }

    override suspend fun getAttempt(localAttempt: LocalPaymentAttempt): LocalPaymentAttempt? {
      getCalls += 1
      return remote
    }
  }
}

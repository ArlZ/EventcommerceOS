package com.eventcommerce.pos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.LocalPaymentAttempt
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.domain.OrderState
import com.eventcommerce.pos.domain.PaymentAttemptState
import com.eventcommerce.pos.payments.EdgePaymentRailAvailability
import com.eventcommerce.pos.payments.EdgePaymentState
import com.eventcommerce.pos.payments.EdgePaymentTransport
import com.eventcommerce.pos.payments.PaymentCoordinator
import java.util.UUID
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
class PaymentCoordinatorTest {
  private lateinit var context: Context
  private lateinit var db: AppDatabase
  private lateinit var repository: LocalPosRepository
  private lateinit var transport: FakeEdgePaymentTransport
  private lateinit var coordinator: PaymentCoordinator
  private lateinit var dbName: String

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    dbName = "task007-coordinator-${UUID.randomUUID()}.db"
    db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
      .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3)
      .allowMainThreadQueries()
      .build()
    repository = LocalPosRepository(db)
    transport = FakeEdgePaymentTransport()
    coordinator = PaymentCoordinator(repository, transport)
  }

  @After
  fun tearDown() {
    runCatching { db.close() }
    context.deleteDatabase(dbName)
  }

  @Test
  fun `degraded card rail leaves local order open and editable`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    transport.rails = listOf(
      EdgePaymentRailAvailability("pesapal_sabi", "DEGRADED", "PROVIDER_OFFLINE"),
    )

    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { coordinator.startCard(order.id) }
    }

    assertEquals(OrderState.OPEN, repository.currentOpenOrder()?.state)
    assertEquals(0, repository.paymentAttemptsForOrder(order.id).size)
  }

  @Test
  fun `unreachable rail health degrades payments without affecting local ordering`() = runBlocking {
    val menu = repository.ensureDevelopmentMenu()
    val order = repository.addItem(menu.items.first().itemId)
    transport.throwOnHealth = true

    val rails = coordinator.railAvailability()
    assertEquals("DEGRADED", rails.first { it.providerId == "pesapal_sabi" }.status)
    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { coordinator.startCard(order.id) }
    }

    repository.addItem(menu.items.last().itemId)
    assertEquals(OrderState.OPEN, repository.currentOpenOrder()?.state)
    assertEquals(2, repository.currentOpenOrder()?.items?.sumOf { it.quantity })
  }

  @Test
  fun `available Sabi rail creates provider-neutral pending attempt without phone`() = runBlocking {
    val item = repository.ensureDevelopmentMenu().items.first()
    val order = repository.addItem(item.itemId)
    transport.rails = listOf(
      EdgePaymentRailAvailability("pesapal_sabi", "AVAILABLE", "SABI_WIRELESS_CONFIGURED"),
    )

    val attempt = coordinator.startCard(order.id)

    assertEquals("pesapal_sabi", attempt.providerId)
    assertEquals(PaymentAttemptState.PENDING, attempt.state)
    assertEquals(attempt.id, transport.lastInitiatedAttempt?.id)
    assertNull(transport.lastCustomerPhone)
    assertEquals(OrderState.PAYMENT_PENDING, repository.currentOpenOrder()?.state)
  }

  private class FakeEdgePaymentTransport : EdgePaymentTransport {
    var rails: List<EdgePaymentRailAvailability> = emptyList()
    var throwOnHealth = false
    var lastInitiatedAttempt: LocalPaymentAttempt? = null
    var lastCustomerPhone: String? = null

    override suspend fun initiate(
      attempt: LocalPaymentAttempt,
      customerPhone: String?,
    ): EdgePaymentState {
      lastInitiatedAttempt = attempt
      lastCustomerPhone = customerPhone
      return EdgePaymentState(
        state = PaymentAttemptState.PENDING,
        providerReference = null,
        failureCode = "AWAITING_SABI_TERMINAL",
      )
    }

    override suspend fun reconcile(paymentAttemptId: String): EdgePaymentState {
      return EdgePaymentState(
        state = PaymentAttemptState.PENDING,
        providerReference = null,
        failureCode = null,
      )
    }

    override suspend fun railAvailability(): List<EdgePaymentRailAvailability> {
      if (throwOnHealth) throw IllegalStateException("Edge unavailable")
      return rails
    }
  }
}

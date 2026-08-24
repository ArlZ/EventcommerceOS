package com.eventcommerce.pos

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.domain.MenuCandidate
import com.eventcommerce.pos.domain.MenuIntegrity
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
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
class ProvisionedMenuStoreTest {
  private lateinit var context: Context
  private lateinit var db: AppDatabase
  private lateinit var repository: LocalPosRepository
  private lateinit var dbName: String

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    dbName = "provisioned-menu-${UUID.randomUUID()}.db"
    db = Room.databaseBuilder(context, AppDatabase::class.java, dbName)
      .allowMainThreadQueries()
      .build()
    repository = LocalPosRepository(db)
  }

  @After
  fun tearDown() {
    runCatching { db.close() }
    context.deleteDatabase(dbName)
  }

  @Test
  fun `first scoped menu can replace exact development version one`() = runBlocking {
    val development = repository.ensureDevelopmentMenu()
    val binding = "a".repeat(64)
    val realMenu = realMenu(version = 1)

    val installed = repository.installProvisionedMenu(realMenu, binding)

    assertEquals(1, installed.version)
    assertEquals("event-live", installed.eventId)
    assertNotNull(repository.activeProvisionedMenu(binding))
    assertNull(repository.activeProvisionedMenu("b".repeat(64)))
    assertEquals(development.version, realMenu.version)
  }

  @Test
  fun `reprovisioned device cannot use previous credential menu offline`() = runBlocking {
    repository.installProvisionedMenu(realMenu(version = 1), "a".repeat(64))

    assertNotNull(repository.activeProvisionedMenu("a".repeat(64)))
    assertNull(repository.activeProvisionedMenu("b".repeat(64)))
  }

  @Test
  fun `authenticated reprovision can restart menu version namespace`() = runBlocking {
    repository.installProvisionedMenu(realMenu(version = 5), "a".repeat(64))
    val nextVenueMenu = realMenu(version = 1).copy(eventId = "event-next", menuId = "menu-next")
    val signedNextVenueMenu = MenuIntegrity.signed(nextVenueMenu.copy(checksum = ""))

    val installed = repository.installProvisionedMenu(signedNextVenueMenu, "b".repeat(64))

    assertEquals(1, installed.version)
    assertEquals("event-next", installed.eventId)
    assertNull(repository.activeProvisionedMenu("a".repeat(64)))
    assertEquals("event-next", repository.activeProvisionedMenu("b".repeat(64))?.eventId)
  }

  @Test
  fun `development menu cannot be replaced while its order is open`() = runBlocking {
    val development = repository.ensureDevelopmentMenu()
    repository.addItem(development.items.first().itemId)

    assertThrows(IllegalArgumentException::class.java) {
      runBlocking {
        repository.installProvisionedMenu(realMenu(version = 1), "a".repeat(64))
      }
    }

    assertEquals(development.checksum, repository.activeMenu()?.checksum)
  }

  private fun realMenu(version: Long): MenuCandidate {
    val development = LocalPosRepository.developmentMenuCandidate()
    return MenuIntegrity.signed(
      development.copy(
        eventId = "event-live",
        menuId = "menu-live",
        version = version,
        sourceActor = "event-edge-admin",
        checksum = "",
      ),
    )
  }
}

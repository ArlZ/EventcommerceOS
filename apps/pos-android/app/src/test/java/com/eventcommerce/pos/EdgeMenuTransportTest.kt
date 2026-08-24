package com.eventcommerce.pos

import com.eventcommerce.pos.domain.MenuIntegrity
import com.eventcommerce.pos.menu.HttpsEdgeMenuTransport
import com.eventcommerce.pos.menu.MenuJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EdgeMenuTransportTest {
  @Test
  fun derivesMenuEndpointFromProvisionedSyncEndpoint() {
    assertEquals(
      "https://edge.example.test/pos-menu/current",
      HttpsEdgeMenuTransport.menuEndpoint("https://edge.example.test/sync/device-events"),
    )
    assertEquals(
      "https://edge.example.test/event-edge/pos-menu/current",
      HttpsEdgeMenuTransport.menuEndpoint(
        "https://edge.example.test/event-edge/sync/device-events",
      ),
    )
  }

  @Test
  fun rejectsAmbiguousSyncEndpoint() {
    assertThrows(IllegalArgumentException::class.java) {
      HttpsEdgeMenuTransport.menuEndpoint("https://edge.example.test/sync")
    }
    assertThrows(IllegalArgumentException::class.java) {
      HttpsEdgeMenuTransport.menuEndpoint(
        "https://edge.example.test/sync/device-events?event=other",
      )
    }
  }

  @Test
  fun parsesEdgeSnapshotIntoIntegrityCompatibleCandidate() {
    val json = """
      {
        "eventId":"event-1",
        "salesLocationId":"bar-1",
        "menuId":"menu-1",
        "version":7,
        "activatedAtEpochMs":1787600000000,
        "sourceActor":"edge-admin",
        "currency":"KES",
        "checksum":"00000000",
        "items":[
          {
            "itemId":"item-1",
            "skuId":"sku-1",
            "name":"Water 500ml",
            "category":"Soft Drinks",
            "priceMinor":10000,
            "favourite":true,
            "sortOrder":10
          }
        ]
      }
    """.trimIndent()

    val parsed = MenuJson.candidate(json)
    val signed = parsed.copy(checksum = MenuIntegrity.checksum(parsed))

    assertEquals("event-1", signed.eventId)
    assertEquals("menu-1", signed.menuId)
    assertEquals(7L, signed.version)
    assertEquals(10000L, signed.items.single().priceMinor)
    MenuIntegrity.validate(signed)
  }
}

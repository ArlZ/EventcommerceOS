package com.eventcommerce.pos.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PosMenuEdgeTransportTest {
  @Test
  fun `menu endpoint stays on provisioned Event Edge origin`() {
    assertEquals(
      "https://edge.example:8443/pos-menu/current",
      posMenuCurrentEndpoint("https://edge.example:8443/sync/device-events?ignored=true#ignored"),
    )
  }

  @Test
  fun `menu endpoint rejects insecure or unexpected provisioning endpoints`() {
    assertThrows(IllegalArgumentException::class.java) {
      posMenuCurrentEndpoint("http://edge.example/sync/device-events")
    }
    assertThrows(IllegalArgumentException::class.java) {
      posMenuCurrentEndpoint("https://edge.example/other")
    }
    assertThrows(IllegalArgumentException::class.java) {
      posMenuCurrentEndpoint("https://user@edge.example/sync/device-events")
    }
  }

  @Test
  fun `provisioning binding changes with credential generation`() {
    val first = posMenuProvisioningBinding(
      "https://edge.example/sync/device-events",
      "device-1",
      "a".repeat(32),
    )
    val second = posMenuProvisioningBinding(
      "https://edge.example/sync/device-events",
      "device-1",
      "b".repeat(32),
    )

    assertEquals(64, first.length)
    assertNotEquals(first, second)
  }
}

package com.eventcommerce.pos

import org.junit.Assert.assertEquals
import org.junit.Test

class LocalStoreStatusTest {
  @Test fun reportsRoomSQLiteReadiness() {
    assertEquals("Room/SQLite configured", LocalStoreStatus.label())
  }
}

package com.eventcommerce.pos.sync

fun interface MenuEdgeTransport {
  suspend fun current(): DeliveredMenuSnapshot
}

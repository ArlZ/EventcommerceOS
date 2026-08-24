package com.eventcommerce.pos.sync

import com.eventcommerce.pos.domain.MenuCandidate

fun interface MenuEdgeTransport {
  suspend fun current(): MenuCandidate
}

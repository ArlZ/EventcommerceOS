package com.eventcommerce.pos.menu

import com.eventcommerce.pos.domain.MenuCandidate

fun interface EdgeMenuTransport {
  suspend fun current(): MenuCandidate
}

package com.eventcommerce.pos.sync

import com.eventcommerce.pos.data.LocalPosRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlin.coroutines.coroutineContext

class MenuRefreshCoordinator(
  private val repository: LocalPosRepository,
  private val transport: MenuEdgeTransport,
  private val successDelayMs: Long = 30_000,
  private val failureDelayMs: Long = 5_000,
) {
  init {
    require(successDelayMs >= 1_000) { "menu refresh interval must be at least one second" }
    require(failureDelayMs >= 1_000) { "menu retry interval must be at least one second" }
  }

  suspend fun refreshOnce() {
    val delivered = transport.current()
    repository.installProvisionedMenu(delivered.candidate, delivered.salesLocationId)
  }

  suspend fun run() {
    while (coroutineContext.isActive) {
      val succeeded = runCatching { refreshOnce() }.isSuccess
      delay(if (succeeded) successDelayMs else failureDelayMs)
    }
  }
}

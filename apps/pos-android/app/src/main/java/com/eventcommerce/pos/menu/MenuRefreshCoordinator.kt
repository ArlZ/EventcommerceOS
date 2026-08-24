package com.eventcommerce.pos.menu

import com.eventcommerce.pos.data.LocalPosRepository
import kotlinx.coroutines.delay

class MenuRefreshCoordinator(
  private val repository: LocalPosRepository,
  private val transport: EdgeMenuTransport,
  private val intervalMs: Long = 30_000,
) {
  init {
    require(intervalMs >= 1_000) { "menu refresh interval must be at least one second" }
  }

  suspend fun refreshOnce(): Boolean {
    val remote = transport.current()
    val local = repository.activeMenu()
    if (local != null && remote.version == local.version && remote.checksum == local.checksum) {
      return false
    }
    repository.installMenu(remote)
    return true
  }

  suspend fun run() {
    while (true) {
      runCatching { refreshOnce() }
      delay(intervalMs)
    }
  }
}

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

  suspend fun refreshOnce(): Long {
    val remote = transport.current()
    repository.installMenu(remote)
    return remote.version
  }

  suspend fun run(onMenuVersion: (Long) -> Unit = {}) {
    while (true) {
      runCatching { refreshOnce() }.onSuccess(onMenuVersion)
      delay(intervalMs)
    }
  }
}

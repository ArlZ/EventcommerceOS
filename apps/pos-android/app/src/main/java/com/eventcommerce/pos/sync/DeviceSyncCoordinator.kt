package com.eventcommerce.pos.sync

import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlin.coroutines.coroutineContext

class DeviceSyncCoordinator(
  private val engine: DeviceSyncEngine,
  private val random: () -> Double = Math::random,
) {
  suspend fun run() {
    var failures = 0
    while (coroutineContext.isActive) {
      try {
        val result = engine.syncOnce()
        failures = 0
        delay(if (result.remaining > 0) 250 else 3_000)
      } catch (_: Throwable) {
        failures += 1
        delay(deviceRetryDelayMs(failures, random))
      }
    }
  }
}

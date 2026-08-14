package com.eventcommerce.pos.sync

fun deviceRetryDelayMs(
  attempt: Int,
  random: () -> Double = Math::random,
  baseMs: Long = 500,
  maxMs: Long = 30_000,
): Long {
  val safeAttempt = attempt.coerceIn(1, 16)
  val exponential = (baseMs * (1L shl (safeAttempt - 1))).coerceAtMost(maxMs)
  val jitter = 0.8 + random().coerceIn(0.0, 1.0) * 0.4
  return (exponential * jitter).toLong().coerceIn(baseMs, maxMs)
}

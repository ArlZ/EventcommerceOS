package com.eventcommerce.pos.data

fun interface TransactionFaultInjector {
  fun beforeCommit(operation: String)
}

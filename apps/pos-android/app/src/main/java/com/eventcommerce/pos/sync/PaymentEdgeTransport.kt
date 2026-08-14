package com.eventcommerce.pos.sync

import com.eventcommerce.pos.domain.LocalPaymentAttempt

interface PaymentEdgeTransport {
  suspend fun initiate(attempt: LocalPaymentAttempt, payerMsisdn: String): LocalPaymentAttempt
  suspend fun getAttempt(localAttempt: LocalPaymentAttempt): LocalPaymentAttempt?
}

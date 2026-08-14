package com.eventcommerce.pos

import com.eventcommerce.pos.domain.PaymentAttemptState
import com.eventcommerce.pos.domain.PaymentRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentRulesTest {
  @Test
  fun unknownCanResolveToProviderTruth() {
    assertTrue(PaymentRules.canTransition(PaymentAttemptState.UNKNOWN, PaymentAttemptState.SUCCEEDED))
    assertTrue(PaymentRules.canTransition(PaymentAttemptState.UNKNOWN, PaymentAttemptState.FAILED))
  }

  @Test
  fun terminalTruthCannotBeOverwritten() {
    assertFalse(PaymentRules.canTransition(PaymentAttemptState.SUCCEEDED, PaymentAttemptState.FAILED))
    assertFalse(PaymentRules.canTransition(PaymentAttemptState.FAILED, PaymentAttemptState.SUCCEEDED))
  }

  @Test
  fun transportUncertaintyDoesNotInventFailure() {
    assertEquals(
      PaymentAttemptState.UNKNOWN,
      PaymentRules.stateAfterTransportUncertainty(PaymentAttemptState.PENDING),
    )
    assertEquals(
      PaymentAttemptState.SUCCEEDED,
      PaymentRules.stateAfterTransportUncertainty(PaymentAttemptState.SUCCEEDED),
    )
  }

  @Test
  fun idempotencyKeyIsStable() {
    assertEquals(
      "PAYMENT:order-1:primary:attempt-1",
      PaymentRules.idempotencyKey("order-1", "primary", "attempt-1"),
    )
  }
}

import type { SimulationResult } from './event-simulation';

export interface ReleaseGateEvaluation {
  automatedInvariantPass: boolean;
  hardFailures: string[];
  warnings: string[];
  pilotEvidenceRequired: string[];
}

const pilotEvidenceRequired = [
  'Measure product-grid and local commit p95 latency on supported Android POS hardware.',
  'Validate access-point roaming, interference and reconnect behavior on the event network.',
  'Restart the selected Event Edge hardware under backlog and verify recovery time.',
  'Exercise M-PESA/Pesapal sandbox or test-terminal paths with real provider timing and callbacks.',
  'Rehearse primary WAN to cellular failover with the production network topology.',
  'Perform and time a database backup/restore rehearsal using the deployment backup mechanism.',
  'Run a controlled live pilot with trained operators before any major-festival deployment.',
];

export function evaluateReleaseGate(
  results: readonly SimulationResult[],
): ReleaseGateEvaluation {
  const hardFailures: string[] = [];
  const warnings: string[] = [];

  for (const result of results) {
    const { metrics } = result;
    const prefix = `${metrics.scenarioName}:`;
    if (
      metrics.generatedOrders !== metrics.durableLocalOrders ||
      metrics.committedOrderDurability !== 1
    ) {
      hardFailures.push(
        `${prefix} locally committed order durability was not 100%.`,
      );
    }
    if (metrics.duplicateBusinessEffects !== 0) {
      hardFailures.push(
        `${prefix} duplicate protected business effects=${metrics.duplicateBusinessEffects}.`,
      );
    }
    if (
      metrics.finalSyncBacklog !== 0 ||
      metrics.cloudOrders !== metrics.generatedOrders
    ) {
      hardFailures.push(
        `${prefix} synchronization did not fully converge (backlog=${metrics.finalSyncBacklog}, cloud=${metrics.cloudOrders}, local=${metrics.generatedOrders}).`,
      );
    }
    if (!metrics.inventoryConverged) {
      hardFailures.push(`${prefix} Edge and Cloud inventory did not converge.`);
    }
    if (metrics.falsePaymentFailures !== 0) {
      hardFailures.push(
        `${prefix} uncertain payments were converted to definitive failure.`,
      );
    }
    if (metrics.paymentUnknownFinal !== 0) {
      hardFailures.push(
        `${prefix} payment uncertainty remained after the configured recovery window.`,
      );
    }
    if (metrics.applicationErrors !== 0) {
      hardFailures.push(
        `${prefix} application errors=${metrics.applicationErrors}.`,
      );
    }
    if (metrics.dashboardLagFinalMs !== 0) {
      hardFailures.push(`${prefix} dashboard did not catch up after convergence.`);
    }
    if (metrics.modeledLocalCommitLatencyP95Ms > 250) {
      hardFailures.push(
        `${prefix} modeled local commit p95 ${metrics.modeledLocalCommitLatencyP95Ms}ms exceeded the engineering envelope.`,
      );
    }
    if (metrics.stockoutObservations > 0) {
      warnings.push(
        `${prefix} observed ${metrics.stockoutObservations} modeled stockout writes; review allocation/profile.`,
      );
    }
    if (metrics.paymentUnknownPeak > 0) {
      warnings.push(
        `${prefix} explicit UNKNOWN peaked at ${metrics.paymentUnknownPeak} (${(
          metrics.paymentUnknownPeakRate * 100
        ).toFixed(1)}%) and recovered without false failure.`,
      );
    }
  }

  return {
    automatedInvariantPass: hardFailures.length === 0,
    hardFailures,
    warnings,
    pilotEvidenceRequired: [...pilotEvidenceRequired],
  };
}

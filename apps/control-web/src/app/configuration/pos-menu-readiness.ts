export type PosMenuInstallStatus = {
  salesLocationId: string;
  installedEdges: readonly unknown[];
};

export function posMenusReadyToOpen(
  activeSalesLocationIds: readonly string[],
  statuses: readonly PosMenuInstallStatus[],
): boolean {
  if (activeSalesLocationIds.length === 0) return false;
  const byLocation = new Map(statuses.map((status) => [status.salesLocationId, status]));
  return activeSalesLocationIds.every(
    (salesLocationId) => (byLocation.get(salesLocationId)?.installedEdges.length ?? 0) > 0,
  );
}

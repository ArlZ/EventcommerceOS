export interface EdgeCloudCredentials {
  edgeId: string;
  headers: Record<string, string>;
}

export function edgeCloudCredentials(expectedEdgeId?: string): EdgeCloudCredentials {
  const edgeId = process.env.EDGE_ID?.trim();
  const token = process.env.EDGE_CLOUD_SYNC_TOKEN?.trim();
  if (!edgeId) throw new Error('EDGE_ID is required for authenticated Cloud transport');
  if (!token || token.length < 32) {
    throw new Error('EDGE_CLOUD_SYNC_TOKEN is required for authenticated Cloud transport');
  }
  if (expectedEdgeId !== undefined && expectedEdgeId !== edgeId) {
    throw new Error('batch edgeId does not match configured EDGE_ID');
  }
  return {
    edgeId,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-edge-id': edgeId,
    },
  };
}

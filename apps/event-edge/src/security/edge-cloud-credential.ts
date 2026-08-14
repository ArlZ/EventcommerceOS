import { parseOpaqueCredential } from '@event-commerce/domain';

export function edgeCloudAuthorizationHeader(): string {
  const token = process.env.EDGE_CLOUD_CREDENTIAL;
  if (!token) throw new Error('EDGE_CLOUD_CREDENTIAL is required');
  try {
    parseOpaqueCredential(token);
  } catch {
    throw new Error('EDGE_CLOUD_CREDENTIAL format is invalid');
  }
  return `Edge ${token}`;
}

export function edgeCloudHeaders(
  additional: Record<string, string> = {},
): Record<string, string> {
  return {
    authorization: edgeCloudAuthorizationHeader(),
    ...additional,
  };
}

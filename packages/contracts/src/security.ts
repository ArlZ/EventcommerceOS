export type SecurityOperatorRole = 'ADMIN' | 'PLATFORM_ADMIN';

export interface IssuedOperatorCredential {
  credentialId: string;
  token: string;
  actorId: string;
  organisationId: string | null;
  role: SecurityOperatorRole;
  label: string;
  expiresAt: string;
}

export interface IssuedDeviceCredential {
  credentialId: string;
  token: string;
  organisationId: string;
  eventId: string;
  salesLocationId: string;
  deviceId: string;
  label: string;
  expiresAt: string;
}

export interface IssuedEdgeCredential {
  credentialId: string;
  token: string;
  organisationId: string;
  eventId: string;
  edgeId: string;
  label: string;
  expiresAt: string;
}

export interface SecurityOperatorSnapshotEntry {
  credentialId: string;
  actorId: string;
  organisationId: string | null;
  role: SecurityOperatorRole;
  secretHash: string;
  expiresAt: string;
}

export interface SecurityDeviceSnapshotEntry {
  credentialId: string;
  organisationId: string;
  eventId: string;
  salesLocationId: string;
  deviceId: string;
  secretHash: string;
  expiresAt: string;
}

export interface EdgeSecuritySnapshot {
  schemaVersion: 1;
  version: number;
  generatedAt: string;
  organisationId: string;
  eventId: string;
  operators: SecurityOperatorSnapshotEntry[];
  devices: SecurityDeviceSnapshotEntry[];
}

export interface SignedEdgeSecuritySnapshot {
  snapshot: EdgeSecuritySnapshot;
  signature: string;
}

export interface AuthenticatedOperatorPrincipal {
  principalType: 'OPERATOR';
  credentialId: string;
  actorId: string;
  organisationId: string | null;
  role: SecurityOperatorRole;
}

export interface AuthenticatedDevicePrincipal {
  principalType: 'DEVICE';
  credentialId: string;
  organisationId: string;
  eventId: string;
  salesLocationId: string;
  deviceId: string;
}

export interface AuthenticatedEdgePrincipal {
  principalType: 'EDGE_SERVICE';
  credentialId: string;
  organisationId: string;
  eventId: string;
  edgeId: string;
}

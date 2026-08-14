import { SetMetadata } from '@nestjs/common';

export type EdgeSecurityRoute =
  | 'OPERATOR'
  | 'DEVICE'
  | 'PUBLIC_HEALTH'
  | 'SNAPSHOT_INSTALL';

export const EDGE_SECURITY_ROUTE = 'event-commerce:edge-security-route';

export const EdgeRoute = (route: EdgeSecurityRoute) =>
  SetMetadata(EDGE_SECURITY_ROUTE, route);

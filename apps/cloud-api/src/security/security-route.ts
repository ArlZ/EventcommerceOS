import { SetMetadata } from '@nestjs/common';

export type CloudSecurityRoute =
  | 'OPERATOR'
  | 'EDGE_SERVICE'
  | 'OPERATOR_OR_EDGE'
  | 'PROVIDER_CALLBACK'
  | 'PUBLIC_HEALTH'
  | 'BOOTSTRAP';

export const CLOUD_SECURITY_ROUTE = 'event-commerce:cloud-security-route';

export const SecurityRoute = (route: CloudSecurityRoute) =>
  SetMetadata(CLOUD_SECURITY_ROUTE, route);

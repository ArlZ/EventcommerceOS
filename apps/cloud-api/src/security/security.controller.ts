import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { adminContextFromHeaders } from '../configuration/admin-context';
import { uuid } from '../configuration/validation';
import { SecurityRoute } from './security-route';
import { CloudSecurityService } from './security.service';
import {
  credentialKind,
  parseBootstrapOperator,
  parseCredentialMutation,
  parseProvisionDevice,
  parseProvisionEdge,
  parseProvisionOperator,
} from './security.validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller('security')
export class SecurityController {
  constructor(private readonly security: CloudSecurityService) {}

  @Post('bootstrap/operator')
  @SecurityRoute('BOOTSTRAP')
  bootstrapOperator(
    @Headers('x-security-bootstrap-secret') bootstrapSecret: string | undefined,
    @Body() body: unknown,
  ) {
    return this.security.bootstrapOperator(bootstrapSecret, parseBootstrapOperator(body));
  }

  @Post('operators')
  provisionOperator(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    return this.security.provisionOperator(
      adminContextFromHeaders(headers),
      parseProvisionOperator(body),
    );
  }

  @Post('events/:eventId/devices')
  provisionDevice(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.security.provisionDevice(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
      parseProvisionDevice(body),
    );
  }

  @Post('events/:eventId/edges')
  provisionEdge(
    @Headers() headers: HeadersRecord,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ) {
    return this.security.provisionEdge(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
      parseProvisionEdge(body),
    );
  }

  @Get('events/:eventId/edge-snapshot')
  edgeSnapshot(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string) {
    return this.security.edgeSnapshot(
      adminContextFromHeaders(headers),
      uuid(eventId, 'eventId'),
    );
  }

  @Post('credentials/:kind/:credentialId/revoke')
  revokeCredential(
    @Headers() headers: HeadersRecord,
    @Param('kind') kindValue: string,
    @Param('credentialId') credentialId: string,
    @Body() body: unknown,
  ) {
    return this.security.revokeCredential(
      adminContextFromHeaders(headers),
      credentialKind(kindValue),
      uuid(credentialId, 'credentialId'),
      parseCredentialMutation(body, false),
    );
  }

  @Post('credentials/:kind/:credentialId/rotate')
  rotateCredential(
    @Headers() headers: HeadersRecord,
    @Param('kind') kindValue: string,
    @Param('credentialId') credentialId: string,
    @Body() body: unknown,
  ) {
    return this.security.rotateCredential(
      adminContextFromHeaders(headers),
      credentialKind(kindValue),
      uuid(credentialId, 'credentialId'),
      parseCredentialMutation(body, true),
    );
  }
}

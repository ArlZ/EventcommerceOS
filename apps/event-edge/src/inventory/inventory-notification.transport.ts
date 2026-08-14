export interface InventoryNotificationMessage {
  channel: 'SMS' | 'WHATSAPP';
  recipientActorId: string;
  payload: Record<string, unknown>;
}

export abstract class InventoryNotificationTransport {
  abstract send(message: InventoryNotificationMessage): Promise<void>;
}

export class StubInventoryNotificationTransport extends InventoryNotificationTransport {
  async send(): Promise<void> {
    throw new Error('external inventory notification provider is not configured');
  }
}

export interface PosMenuItemSnapshot {
  itemId: string;
  skuId: string;
  name: string;
  category: string;
  priceMinor: number;
  favourite: boolean;
  sortOrder: number;
}

export interface PosMenuSnapshot {
  eventId: string;
  salesLocationId: string;
  menuId: string;
  version: number;
  activatedAtEpochMs: number;
  sourceActor: string;
  currency: string;
  checksum: string;
  items: PosMenuItemSnapshot[];
}

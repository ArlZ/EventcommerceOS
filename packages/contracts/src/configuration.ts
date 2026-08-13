export type OrganisationLifecycle = 'ACTIVE' | 'ARCHIVED';
export type EventLifecycle = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
export type RecordLifecycle = 'ACTIVE' | 'ARCHIVED';

export interface OrganisationRecord {
  id: string;
  name: string;
  lifecycle: OrganisationLifecycle;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecord {
  id: string;
  organisationId: string;
  name: string;
  timezone: string;
  lifecycle: EventLifecycle;
  startsAt: string;
  endsAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesLocationRecord {
  id: string;
  organisationId: string;
  eventId: string;
  name: string;
  type: string;
  lifecycle: RecordLifecycle;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryLocationRecord {
  id: string;
  organisationId: string;
  eventId: string;
  name: string;
  type: string;
  lifecycle: RecordLifecycle;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRecord {
  id: string;
  organisationId: string;
  name: string;
  category: string | null;
  lifecycle: RecordLifecycle;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkuRecord {
  id: string;
  organisationId: string;
  productId: string;
  name: string;
  code: string;
  unitName: string;
  lifecycle: RecordLifecycle;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MenuRecord {
  id: string;
  organisationId: string;
  eventId: string;
  name: string;
  lifecycle: RecordLifecycle;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MenuAssignmentRecord {
  id: string;
  organisationId: string;
  menuId: string;
  salesLocationId: string;
  createdAt: string;
}

export interface MenuItemRecord {
  id: string;
  organisationId: string;
  menuId: string;
  skuId: string;
  displayName: string;
  sortOrder: number;
  lifecycle: RecordLifecycle;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MenuItemPriceRecord {
  id: string;
  organisationId: string;
  menuItemId: string;
  salesLocationId: string | null;
  amountMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventConfigurationView {
  organisation: OrganisationRecord;
  events: EventRecord[];
  salesLocations: SalesLocationRecord[];
  inventoryLocations: InventoryLocationRecord[];
  products: ProductRecord[];
  skus: SkuRecord[];
  menus: MenuRecord[];
  menuAssignments: MenuAssignmentRecord[];
  menuItems: MenuItemRecord[];
  menuItemPrices: MenuItemPriceRecord[];
}

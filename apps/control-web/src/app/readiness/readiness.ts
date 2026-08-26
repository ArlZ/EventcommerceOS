import type { EventConfigurationView, EventRecord } from '@event-commerce/contracts';

export type EventReadinessKey =
  | 'event'
  | 'schedule'
  | 'sales-locations'
  | 'inventory-locations'
  | 'catalogue'
  | 'menus';

export type EventReadinessItem = {
  key: EventReadinessKey;
  label: string;
  complete: boolean;
  detail: string;
  href: string;
};

export type EventReadiness = {
  event: EventRecord | null;
  ready: boolean;
  completed: number;
  total: number;
  items: EventReadinessItem[];
};

function validSchedule(event: EventRecord | null): boolean {
  if (!event?.timezone.trim()) return false;
  const startsAt = Date.parse(event.startsAt);
  const endsAt = Date.parse(event.endsAt);
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt > startsAt;
}

export function evaluateEventReadiness(
  configuration: EventConfigurationView,
  eventId: string,
): EventReadiness {
  const event =
    configuration.events.find((candidate) => candidate.id === eventId && candidate.lifecycle !== 'ARCHIVED') ??
    null;
  const eventOpen = Boolean(event && event.lifecycle !== 'CLOSED');

  const salesLocations = configuration.salesLocations.filter(
    (location) => location.eventId === eventId && location.lifecycle !== 'ARCHIVED',
  );
  const inventoryLocations = configuration.inventoryLocations.filter(
    (location) => location.eventId === eventId && location.lifecycle !== 'ARCHIVED',
  );
  const activeSkus = configuration.skus.filter((sku) => sku.lifecycle !== 'ARCHIVED');
  const menus = configuration.menus.filter(
    (menu) => menu.eventId === eventId && menu.lifecycle !== 'ARCHIVED',
  );
  const salesLocationIds = new Set(salesLocations.map((location) => location.id));

  const menuCoverageReady =
    menus.length > 0 &&
    menus.every((menu) => {
      const menuItems = configuration.menuItems.filter(
        (item) => item.menuId === menu.id && item.lifecycle !== 'ARCHIVED',
      );
      const assignments = configuration.menuAssignments.filter(
        (assignment) =>
          assignment.menuId === menu.id && salesLocationIds.has(assignment.salesLocationId),
      );
      const assignedLocationIds = new Set(assignments.map((assignment) => assignment.salesLocationId));
      if (menuItems.length === 0 || assignedLocationIds.size === 0) return false;

      return menuItems.every((item) => {
        const prices = configuration.menuItemPrices.filter((price) => price.menuItemId === item.id);
        if (prices.some((price) => price.salesLocationId === null)) return true;
        return [...assignedLocationIds].every((locationId) =>
          prices.some((price) => price.salesLocationId === locationId),
        );
      });
    });

  const items: EventReadinessItem[] = [
    {
      key: 'event',
      label: 'Event selected and open',
      complete: eventOpen,
      detail: event
        ? event.lifecycle === 'CLOSED'
          ? 'This event is already closed.'
          : `${event.name} is ${event.lifecycle.toLowerCase()} and available for pilot operations.`
        : 'Select or create the event that will be used for the controlled pilot.',
      href: '/configuration',
    },
    {
      key: 'schedule',
      label: 'Trading window is valid',
      complete: eventOpen && validSchedule(event),
      detail: validSchedule(event)
        ? `${event?.timezone ?? ''} • ${event?.startsAt ?? ''} → ${event?.endsAt ?? ''}`
        : 'Set a timezone, start time and end time with the end after the start.',
      href: '/event-schedule',
    },
    {
      key: 'sales-locations',
      label: 'Sales locations configured',
      complete: salesLocations.length > 0,
      detail:
        salesLocations.length > 0
          ? `${salesLocations.length} active sales location${salesLocations.length === 1 ? '' : 's'} configured.`
          : 'Add at least one place where guests will buy.',
      href: '/configuration',
    },
    {
      key: 'inventory-locations',
      label: 'Inventory locations configured',
      complete: inventoryLocations.length > 0,
      detail:
        inventoryLocations.length > 0
          ? `${inventoryLocations.length} active stock location${inventoryLocations.length === 1 ? '' : 's'} configured.`
          : 'Add at least one location where opening stock can be held and counted.',
      href: '/configuration',
    },
    {
      key: 'catalogue',
      label: 'Sellable catalogue exists',
      complete: activeSkus.length > 0,
      detail:
        activeSkus.length > 0
          ? `${activeSkus.length} active SKU${activeSkus.length === 1 ? '' : 's'} available to menu configuration.`
          : 'Create at least one active SKU before publishing a menu.',
      href: '/configuration',
    },
    {
      key: 'menus',
      label: 'Menus are assigned and fully priced',
      complete: menuCoverageReady,
      detail: menuCoverageReady
        ? `${menus.length} active menu${menus.length === 1 ? '' : 's'} have items, location assignments and complete price coverage.`
        : 'Every active event menu needs an item, a sales-location assignment and a usable price for every assigned location.',
      href: '/configuration',
    },
  ];

  const completed = items.filter((item) => item.complete).length;
  return {
    event,
    ready: completed === items.length,
    completed,
    total: items.length,
    items,
  };
}

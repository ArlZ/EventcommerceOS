import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Put } from '@nestjs/common';
import { ConfigurationService } from './configuration.service';
import { adminContextFromHeaders } from './admin-context';
import {
  bodyObject,
  eventLifecycle,
  integer,
  inventoryLocationType,
  isoTimestamp,
  optionalString,
  price,
  recordLifecycle,
  requiredString,
  requiredUuid,
  salesLocationType,
  timezone,
  uuid,
} from './validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller()
export class ConfigurationController {
  constructor(private readonly configuration: ConfigurationService) {}

  @Post('organisations')
  createOrganisation(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    return this.configuration.createOrganisation(adminContextFromHeaders(headers, false), requiredString(bodyObject(body), 'name'));
  }

  @Get('organisations/:organisationId')
  getOrganisation(@Headers() headers: HeadersRecord, @Param('organisationId') organisationId: string) {
    return this.configuration.getOrganisation(adminContextFromHeaders(headers), uuid(organisationId, 'organisationId'));
  }

  @Patch('organisations/:organisationId')
  updateOrganisation(@Headers() headers: HeadersRecord, @Param('organisationId') organisationId: string, @Body() body: unknown) {
    const input = bodyObject(body);
    const name = optionalString(input, 'name');
    const lifecycle = input.lifecycle === undefined ? undefined : recordLifecycle(input.lifecycle);
    return this.configuration.updateOrganisation(adminContextFromHeaders(headers), uuid(organisationId, 'organisationId'), {
      ...(name ? { name } : {}),
      ...(lifecycle ? { lifecycle } : {}),
    });
  }

  @Post('events')
  createEvent(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const input = bodyObject(body);
    return this.configuration.createEvent(adminContextFromHeaders(headers), {
      organisationId: requiredUuid(input, 'organisationId'),
      name: requiredString(input, 'name'),
      timezone: timezone(requiredString(input, 'timezone')),
      startsAt: isoTimestamp(requiredString(input, 'startsAt'), 'startsAt'),
      endsAt: isoTimestamp(requiredString(input, 'endsAt'), 'endsAt'),
    });
  }

  @Patch('events/:eventId')
  updateEvent(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string, @Body() body: unknown) {
    const input = bodyObject(body);
    const name = optionalString(input, 'name');
    const timezoneValue = optionalString(input, 'timezone');
    const startsAt = optionalString(input, 'startsAt');
    const endsAt = optionalString(input, 'endsAt');
    const lifecycle = input.lifecycle === undefined ? undefined : eventLifecycle(input.lifecycle);
    return this.configuration.updateEvent(adminContextFromHeaders(headers), uuid(eventId, 'eventId'), {
      ...(name ? { name } : {}),
      ...(timezoneValue ? { timezone: timezone(timezoneValue) } : {}),
      ...(startsAt ? { startsAt: isoTimestamp(startsAt, 'startsAt') } : {}),
      ...(endsAt ? { endsAt: isoTimestamp(endsAt, 'endsAt') } : {}),
      ...(lifecycle ? { lifecycle } : {}),
    });
  }

  @Post('events/:eventId/sales-locations')
  createSalesLocation(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string, @Body() body: unknown) {
    const input = bodyObject(body);
    return this.configuration.createSalesLocation(adminContextFromHeaders(headers), uuid(eventId, 'eventId'), {
      name: requiredString(input, 'name'),
      type: salesLocationType(requiredString(input, 'type')),
    });
  }

  @Patch('sales-locations/:id')
  updateSalesLocation(@Headers() headers: HeadersRecord, @Param('id') id: string, @Body() body: unknown) {
    const input = bodyObject(body);
    const name = optionalString(input, 'name');
    const type = optionalString(input, 'type');
    const lifecycle = input.lifecycle === undefined ? undefined : recordLifecycle(input.lifecycle);
    return this.configuration.updateSalesLocation(adminContextFromHeaders(headers), uuid(id), {
      ...(name ? { name } : {}),
      ...(type ? { type: salesLocationType(type) } : {}),
      ...(lifecycle ? { lifecycle } : {}),
    });
  }

  @Post('events/:eventId/inventory-locations')
  createInventoryLocation(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string, @Body() body: unknown) {
    const input = bodyObject(body);
    return this.configuration.createInventoryLocation(adminContextFromHeaders(headers), uuid(eventId, 'eventId'), {
      name: requiredString(input, 'name'),
      type: inventoryLocationType(requiredString(input, 'type')),
    });
  }

  @Patch('inventory-locations/:id')
  updateInventoryLocation(@Headers() headers: HeadersRecord, @Param('id') id: string, @Body() body: unknown) {
    const input = bodyObject(body);
    const name = optionalString(input, 'name');
    const type = optionalString(input, 'type');
    const lifecycle = input.lifecycle === undefined ? undefined : recordLifecycle(input.lifecycle);
    return this.configuration.updateInventoryLocation(adminContextFromHeaders(headers), uuid(id), {
      ...(name ? { name } : {}),
      ...(type ? { type: inventoryLocationType(type) } : {}),
      ...(lifecycle ? { lifecycle } : {}),
    });
  }

  @Post('products')
  createProduct(@Headers() headers: HeadersRecord, @Body() body: unknown) {
    const input = bodyObject(body);
    const category = optionalString(input, 'category');
    return this.configuration.createProduct(adminContextFromHeaders(headers), {
      organisationId: requiredUuid(input, 'organisationId'),
      name: requiredString(input, 'name'),
      ...(category ? { category } : {}),
    });
  }

  @Patch('products/:id')
  updateProduct(@Headers() headers: HeadersRecord, @Param('id') id: string, @Body() body: unknown) {
    const input = bodyObject(body);
    const name = optionalString(input, 'name');
    const category = optionalString(input, 'category');
    const lifecycle = input.lifecycle === undefined ? undefined : recordLifecycle(input.lifecycle);
    return this.configuration.updateProduct(adminContextFromHeaders(headers), uuid(id), {
      ...(name ? { name } : {}),
      ...(category ? { category } : {}),
      ...(lifecycle ? { lifecycle } : {}),
    });
  }

  @Post('products/:productId/skus')
  createSku(@Headers() headers: HeadersRecord, @Param('productId') productId: string, @Body() body: unknown) {
    const input = bodyObject(body);
    return this.configuration.createSku(adminContextFromHeaders(headers), uuid(productId, 'productId'), {
      name: requiredString(input, 'name'),
      code: requiredString(input, 'code'),
      unitName: requiredString(input, 'unitName'),
    });
  }

  @Patch('skus/:id')
  updateSku(@Headers() headers: HeadersRecord, @Param('id') id: string, @Body() body: unknown) {
    const input = bodyObject(body);
    const name = optionalString(input, 'name');
    const code = optionalString(input, 'code');
    const unitName = optionalString(input, 'unitName');
    const lifecycle = input.lifecycle === undefined ? undefined : recordLifecycle(input.lifecycle);
    return this.configuration.updateSku(adminContextFromHeaders(headers), uuid(id), {
      ...(name ? { name } : {}), ...(code ? { code } : {}), ...(unitName ? { unitName } : {}), ...(lifecycle ? { lifecycle } : {}),
    });
  }

  @Post('events/:eventId/menus')
  createMenu(@Headers() headers: HeadersRecord, @Param('eventId') eventId: string, @Body() body: unknown) {
    return this.configuration.createMenu(adminContextFromHeaders(headers), uuid(eventId, 'eventId'), requiredString(bodyObject(body), 'name'));
  }

  @Patch('menus/:id')
  updateMenu(@Headers() headers: HeadersRecord, @Param('id') id: string, @Body() body: unknown) {
    const input = bodyObject(body);
    const name = optionalString(input, 'name');
    const lifecycle = input.lifecycle === undefined ? undefined : recordLifecycle(input.lifecycle);
    return this.configuration.updateMenu(adminContextFromHeaders(headers), uuid(id), { ...(name ? { name } : {}), ...(lifecycle ? { lifecycle } : {}) });
  }

  @Post('menus/:menuId/assignments')
  assignMenu(@Headers() headers: HeadersRecord, @Param('menuId') menuId: string, @Body() body: unknown) {
    return this.configuration.assignMenu(adminContextFromHeaders(headers), uuid(menuId, 'menuId'), requiredUuid(bodyObject(body), 'salesLocationId'));
  }

  @Post('menus/:menuId/items')
  createMenuItem(@Headers() headers: HeadersRecord, @Param('menuId') menuId: string, @Body() body: unknown) {
    const input = bodyObject(body);
    return this.configuration.createMenuItem(adminContextFromHeaders(headers), uuid(menuId, 'menuId'), {
      skuId: requiredUuid(input, 'skuId'),
      displayName: requiredString(input, 'displayName'),
      sortOrder: input.sortOrder === undefined ? 0 : integer(input.sortOrder, 'sortOrder'),
    });
  }

  @Patch('menu-items/:id')
  updateMenuItem(@Headers() headers: HeadersRecord, @Param('id') id: string, @Body() body: unknown) {
    const input = bodyObject(body);
    const displayName = optionalString(input, 'displayName');
    const sortOrder = input.sortOrder === undefined ? undefined : integer(input.sortOrder, 'sortOrder');
    const lifecycle = input.lifecycle === undefined ? undefined : recordLifecycle(input.lifecycle);
    return this.configuration.updateMenuItem(adminContextFromHeaders(headers), uuid(id), {
      ...(displayName ? { displayName } : {}), ...(sortOrder !== undefined ? { sortOrder } : {}), ...(lifecycle ? { lifecycle } : {}),
    });
  }

  @Put('menu-items/:menuItemId/prices')
  setMenuItemPrice(@Headers() headers: HeadersRecord, @Param('menuItemId') menuItemId: string, @Body() body: unknown) {
    const input = bodyObject(body);
    const validatedPrice = price(input);
    const locationValue = input.salesLocationId;
    let salesLocationId: string | null = null;
    if (locationValue !== undefined && locationValue !== null && locationValue !== '') {
      if (typeof locationValue !== 'string') throw new BadRequestException('salesLocationId must be a string');
      salesLocationId = uuid(locationValue, 'salesLocationId');
    }
    return this.configuration.setMenuItemPrice(adminContextFromHeaders(headers), uuid(menuItemId, 'menuItemId'), { salesLocationId, ...validatedPrice });
  }

  @Get('organisations/:organisationId/configuration')
  configurationView(@Headers() headers: HeadersRecord, @Param('organisationId') organisationId: string) {
    return this.configuration.configurationView(adminContextFromHeaders(headers), uuid(organisationId, 'organisationId'));
  }
}

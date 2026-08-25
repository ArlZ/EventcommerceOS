from pathlib import Path

service_path = Path('apps/cloud-api/src/configuration/configuration.service.ts')
test_path = Path('apps/cloud-api/test/pos-menu-publication.integration.test.ts')

service = service_path.read_text()
helper_marker = "  async updateEvent(\n"
helper = '''  private async assertPosMenuActivationReady(\n    client: PoolClient,\n    eventId: string,\n    organisationId: string,\n  ): Promise<void> {\n    const result = await client.query<{ sales_location_id: string }>(\n      `SELECT location.id::text AS sales_location_id\n       FROM sales_locations location\n       LEFT JOIN LATERAL (\n         SELECT publication.id\n         FROM pos_menu_publications publication\n         WHERE publication.event_id=$1\n           AND publication.organisation_id=$2\n           AND publication.sales_location_id=location.id\n         ORDER BY publication.version DESC\n         LIMIT 1\n       ) latest ON true\n       LEFT JOIN LATERAL (\n         SELECT receipt.id\n         FROM pos_menu_install_receipts receipt\n         WHERE receipt.publication_id=latest.id\n           AND receipt.organisation_id=$2\n         ORDER BY receipt.reported_at,receipt.id\n         LIMIT 1\n       ) installed ON true\n       WHERE location.event_id=$1\n         AND location.organisation_id=$2\n         AND location.lifecycle='ACTIVE'\n         AND (latest.id IS NULL OR installed.id IS NULL)\n       ORDER BY location.id\n       LIMIT 1`,\n      [eventId, organisationId],\n    );\n    if (result.rowCount !== 0) {\n      throw new ConflictException(\n        'Event cannot become ACTIVE until the latest POS menu for every active sales location is installed on Event Edge',\n      );\n    }\n  }\n\n'''
if helper_marker not in service:
    raise SystemExit('updateEvent marker not found')
if 'assertPosMenuActivationReady' not in service:
    service = service.replace(helper_marker, helper + helper_marker, 1)

old_lifecycle = "      const lifecycle = patch.lifecycle ?? String(row.lifecycle);\n      const result = await client.query<EventRecord & QueryResultRow>(\n"
new_lifecycle = "      const lifecycle = patch.lifecycle ?? String(row.lifecycle);\n      if (lifecycle === 'ACTIVE' && String(row.lifecycle) !== 'ACTIVE') {\n        await this.assertPosMenuActivationReady(client, eventId, organisationId);\n      }\n      const result = await client.query<EventRecord & QueryResultRow>(\n"
if old_lifecycle not in service:
    raise SystemExit('event lifecycle marker not found')
service = service.replace(old_lifecycle, new_lifecycle, 1)
service_path.write_text(service)

test = test_path.read_text()
test_marker = "    const edge = await provisionSyncEdge(database, {\n"
activation_assertion = '''    await request(app.getHttpServer())\n      .patch(`/events/${event.id}`)\n      .set(organisationHeaders(organisation.id))\n      .send({ lifecycle: 'ACTIVE' })\n      .expect(409);\n\n'''
if test_marker not in test:
    raise SystemExit('Edge provisioning marker not found')
if ".send({ lifecycle: 'ACTIVE' })\n      .expect(409);" not in test:
    test = test.replace(test_marker, activation_assertion + test_marker, 1)
test_path.write_text(test)

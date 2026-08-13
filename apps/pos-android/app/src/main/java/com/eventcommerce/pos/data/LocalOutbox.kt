package com.eventcommerce.pos.data

import java.util.UUID

class LocalOutbox(
  db: AppDatabase,
  private val deviceState: LocalDeviceState,
  private val clock: () -> Long,
  private val idFactory: () -> String = { UUID.randomUUID().toString() },
) {
  private val dao = db.pendingEvents()

  suspend fun appendOrder(
    eventType: String,
    order: OrderEntity,
    items: List<OrderItemEntity>,
    idempotencyKey: String? = null,
  ) {
    val instanceId = idFactory()
    dao.insert(
      OutboxEventEntity(
        eventInstanceId = instanceId,
        eventId = idFactory(),
        eventType = eventType,
        aggregateType = "ORDER",
        aggregateId = order.id,
        eventVersion = 1,
        deviceId = order.deviceId,
        sequence = deviceState.nextSequence(),
        occurredAtEpochMs = clock(),
        idempotencyKey = idempotencyKey ?: instanceId,
        payloadJson = OrderEventPayload.snapshot(order, items),
        sentAtEpochMs = null,
      ),
    )
  }

  suspend fun count(): Int = dao.countAll()

  suspend fun events(): List<OutboxEventEntity> = dao.events()
}

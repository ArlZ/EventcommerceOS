package com.eventcommerce.pos.data

import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

class LocalOutbox(
  db: AppDatabase,
  private val deviceState: LocalDeviceState,
  private val clock: () -> Long,
  private val idFactory: () -> String = { UUID.randomUUID().toString() },
) {
  private val dao = db.pendingEvents()
  private val orders = db.orders()

  suspend fun appendOrder(eventType: String, order: OrderEntity, idempotencyKey: String? = null) {
    val instanceId = idFactory()
    val lines = JSONArray()
    orders.orderItems(order.id).forEach { line ->
      lines.put(
        JSONObject()
          .put("menuItemId", line.menuItemId)
          .put("skuId", line.skuId)
          .put("quantity", line.quantity)
          .put("unitPriceMinor", line.unitPriceMinor),
      )
    }
    val payload = JSONObject()
      .put("orderId", order.id)
      .put("eventId", order.eventId)
      .put("salesLocationId", order.salesLocationId)
      .put("state", order.state)
      .put("totalMinor", order.totalMinor)
      .put("currency", order.currency)
      .put("lines", lines)

    dao.insert(
      OutboxEventEntity(
        eventInstanceId = instanceId,
        eventId = idFactory(),
        eventType = eventType,
        aggregateType = "ORDER",
        aggregateId = order.id,
        eventVersion = 2,
        deviceId = order.deviceId,
        sequence = deviceState.nextSequence(),
        occurredAtEpochMs = clock(),
        idempotencyKey = idempotencyKey ?: instanceId,
        payloadJson = payload.toString(),
        sentAtEpochMs = null,
      ),
    )
  }

  suspend fun count(): Int = dao.countAll()

  suspend fun events(): List<OutboxEventEntity> = dao.events()
}

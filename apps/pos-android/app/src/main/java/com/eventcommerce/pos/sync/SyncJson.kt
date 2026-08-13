package com.eventcommerce.pos.sync

import com.eventcommerce.pos.data.OutboxEventEntity
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

object SyncJson {
  fun request(deviceId: String, events: List<OutboxEventEntity>): String {
    val values = JSONArray()
    events.forEach { event ->
      values.put(
        JSONObject()
          .put("schemaVersion", 1)
          .put("eventInstanceId", event.eventInstanceId)
          .put("eventId", event.eventId)
          .put("eventType", event.eventType)
          .put("aggregateType", event.aggregateType)
          .put("aggregateId", event.aggregateId)
          .put("eventVersion", event.eventVersion)
          .put("deviceId", event.deviceId)
          .put("sequence", event.sequence)
          .put("occurredAt", Instant.ofEpochMilli(event.occurredAtEpochMs).toString())
          .put("idempotencyKey", event.idempotencyKey)
          .put("payload", JSONObject(event.payloadJson)),
      )
    }
    return JSONObject().put("deviceId", deviceId).put("events", values).toString()
  }

  fun acknowledgement(text: String): DeviceEdgeAck {
    val value = JSONObject(text)
    return DeviceEdgeAck(
      deviceId = value.getString("deviceId"),
      acceptedThroughSequence = value.getLong("acceptedThroughSequence"),
      edgeBacklogCount = value.getInt("edgeBacklogCount"),
    )
  }
}

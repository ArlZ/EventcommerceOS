package com.eventcommerce.pos.data

object OrderEventPayload {
  fun snapshot(order: OrderEntity, items: List<OrderItemEntity>): String = buildString {
    append("{\"orderId\":\"").append(escaped(order.id))
    append("\",\"state\":\"").append(escaped(order.state))
    append("\",\"menuVersion\":").append(order.menuVersion)
    append(",\"totalMinor\":").append(order.totalMinor)
    append(",\"currency\":\"").append(escaped(order.currency))
    append("\",\"items\":[")
    items.forEachIndexed { index, item ->
      if (index > 0) append(',')
      append("{\"menuItemId\":\"").append(escaped(item.menuItemId))
      append("\",\"skuId\":\"").append(escaped(item.skuId))
      append("\",\"name\":\"").append(escaped(item.name))
      append("\",\"unitPriceMinor\":").append(item.unitPriceMinor)
      append(",\"quantity\":").append(item.quantity)
      append(",\"lineTotalMinor\":").append(item.lineTotalMinor)
      append('}')
    }
    append("]}")
  }

  private fun escaped(value: String): String = buildString {
    value.forEach { character ->
      when (character) {
        '\\' -> append("\\\\")
        '"' -> append("\\\"")
        '\n' -> append("\\n")
        '\r' -> append("\\r")
        '\t' -> append("\\t")
        else -> append(character)
      }
    }
  }
}

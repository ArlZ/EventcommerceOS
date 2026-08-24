package com.eventcommerce.pos.sync

import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.domain.CachedMenu

class PosMenuSyncCoordinator(
  private val repository: LocalPosRepository,
  private val transport: PosMenuEdgeTransport,
  private val provisioningBinding: String,
) {
  suspend fun refresh(): CachedMenu =
    repository.installProvisionedMenu(transport.current(), provisioningBinding)
}

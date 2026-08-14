package com.eventcommerce.pos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.DeviceSyncProvisioningStore
import com.eventcommerce.pos.data.DeviceSyncStateStore
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.data.SyncQueueStore
import com.eventcommerce.pos.sync.DeviceSyncCoordinator
import com.eventcommerce.pos.sync.DeviceSyncEngine
import com.eventcommerce.pos.sync.HttpsDeviceEdgeTransport
import com.eventcommerce.pos.sync.HttpsPaymentEdgeTransport
import com.eventcommerce.pos.sync.PosPaymentCoordinator
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
  private val database by lazy { AppDatabase.get(applicationContext) }
  private val repository by lazy { LocalPosRepository(database) }
  private val syncState by lazy { DeviceSyncStateStore(database) }
  private val syncProvisioning by lazy { DeviceSyncProvisioningStore(database) }
  private val syncQueue by lazy { SyncQueueStore(database) }
  private var paymentCoordinator by mutableStateOf<PosPaymentCoordinator?>(null)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    lifecycleScope.launch {
      val endpoint = syncProvisioning.endpoint()
      if (endpoint != null) {
        DeviceSyncCoordinator(
          DeviceSyncEngine(database, HttpsDeviceEdgeTransport(endpoint), syncState),
        ).run()
        val paymentToken = syncProvisioning.paymentBearerToken()
        if (paymentToken != null) {
          val coordinator = PosPaymentCoordinator(
            repository,
            HttpsPaymentEdgeTransport(endpoint, paymentToken),
          )
          paymentCoordinator = coordinator
          runCatching { coordinator.refreshUnresolved() }
        }
      }
    }
    setContent {
      Column(modifier = Modifier.fillMaxSize()) {
        SyncStatusLine(syncQueue, syncState, syncProvisioning)
        PosScreen(repository, paymentCoordinator)
      }
    }
  }
}

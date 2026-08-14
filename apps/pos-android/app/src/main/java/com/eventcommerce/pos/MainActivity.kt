package com.eventcommerce.pos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.DeviceSyncProvisioningStore
import com.eventcommerce.pos.data.DeviceSyncStateStore
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.data.SyncQueueStore
import com.eventcommerce.pos.payments.PaymentCoordinator
import com.eventcommerce.pos.payments.ProvisionedEdgePaymentTransport
import com.eventcommerce.pos.sync.DeviceSyncCoordinator
import com.eventcommerce.pos.sync.DeviceSyncEngine
import com.eventcommerce.pos.sync.HttpsDeviceEdgeTransport
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
  private val database by lazy { AppDatabase.get(applicationContext) }
  private val repository by lazy { LocalPosRepository(database) }
  private val syncState by lazy { DeviceSyncStateStore(database) }
  private val syncProvisioning by lazy { DeviceSyncProvisioningStore(database) }
  private val syncQueue by lazy { SyncQueueStore(database) }
  private val payments by lazy {
    PaymentCoordinator(repository, ProvisionedEdgePaymentTransport(syncProvisioning))
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    lifecycleScope.launch {
      val endpoint = syncProvisioning.endpoint()
      if (endpoint != null) {
        DeviceSyncCoordinator(
          DeviceSyncEngine(database, HttpsDeviceEdgeTransport(endpoint), syncState),
        ).run()
      }
    }
    setContent {
      Column(modifier = Modifier.fillMaxSize()) {
        SyncStatusLine(syncQueue, syncState, syncProvisioning)
        PosScreen(repository, payments)
      }
    }
  }
}

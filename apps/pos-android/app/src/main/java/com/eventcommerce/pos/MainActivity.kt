package com.eventcommerce.pos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.DeviceEdgeProvisioning
import com.eventcommerce.pos.data.DeviceSyncProvisioningStore
import com.eventcommerce.pos.data.DeviceSyncStateStore
import com.eventcommerce.pos.data.LocalDeviceState
import com.eventcommerce.pos.data.LocalPosRepository
import com.eventcommerce.pos.data.SyncQueueStore
import com.eventcommerce.pos.payments.PaymentCoordinator
import com.eventcommerce.pos.payments.ProvisionedEdgePaymentTransport
import com.eventcommerce.pos.security.KeystorePosDeviceCredentialStore
import com.eventcommerce.pos.sync.DeviceSyncCoordinator
import com.eventcommerce.pos.sync.DeviceSyncEngine
import com.eventcommerce.pos.sync.HttpsDeviceEdgeTransport
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
  private val database by lazy { AppDatabase.get(applicationContext) }
  private val repository by lazy { LocalPosRepository(database) }
  private val deviceState by lazy { LocalDeviceState(database) }
  private val syncState by lazy { DeviceSyncStateStore(database) }
  private val deviceCredentials by lazy { KeystorePosDeviceCredentialStore(applicationContext) }
  private val syncProvisioning by lazy {
    DeviceSyncProvisioningStore(database, deviceCredentials)
  }
  private val syncQueue by lazy { SyncQueueStore(database) }
  private val payments by lazy {
    PaymentCoordinator(repository, ProvisionedEdgePaymentTransport(syncProvisioning))
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      EventCommercePosTheme {
        var localDeviceId by remember { mutableStateOf<String?>(null) }
        var provisioned by remember { mutableStateOf<DeviceEdgeProvisioning?>(null) }
        var knownEndpoint by remember { mutableStateOf("") }
        var editingProvisioning by remember { mutableStateOf(false) }
        var loading by remember { mutableStateOf(true) }

        LaunchedEffect(Unit) {
          val deviceId = deviceState.id()
          localDeviceId = deviceId
          knownEndpoint = syncProvisioning.endpoint().orEmpty()
          provisioned = syncProvisioning.current()?.takeIf { it.deviceId == deviceId }
          loading = false
        }

        when {
          loading -> Text("Starting register…", modifier = Modifier.padding(24.dp))
          localDeviceId == null -> Text(
            "This register could not load its device identity.",
            modifier = Modifier.padding(24.dp),
          )
          provisioned == null || editingProvisioning -> DeviceProvisioningScreen(
            deviceId = localDeviceId!!,
            initialEndpoint = provisioned?.endpoint ?: knownEndpoint,
          ) { endpoint, token ->
            val deviceId = localDeviceId!!
            lifecycleScope.launch {
              syncProvisioning.provision(endpoint, deviceId, token)
              knownEndpoint = endpoint
              provisioned = syncProvisioning.current()
              editingProvisioning = false
            }
          }
          else -> {
            val activeProvisioning = provisioned!!
            LaunchedEffect(
              activeProvisioning.endpoint,
              activeProvisioning.deviceId,
              activeProvisioning.token,
            ) {
              DeviceSyncCoordinator(
                DeviceSyncEngine(
                  database,
                  HttpsDeviceEdgeTransport(
                    activeProvisioning.endpoint,
                    activeProvisioning.deviceId,
                    activeProvisioning.token,
                  ),
                  syncState,
                ),
              ).run()
            }
            Column(modifier = Modifier.fillMaxSize()) {
              SyncStatusLine(syncQueue, syncState, syncProvisioning)
              TextButton(
                onClick = { editingProvisioning = true },
                modifier = Modifier.padding(horizontal = 8.dp),
              ) {
                Text("Device settings")
              }
              PosScreen(
                repository = repository,
                payments = payments,
                modifier = Modifier.weight(1f),
              )
            }
          }
        }
      }
    }
  }
}

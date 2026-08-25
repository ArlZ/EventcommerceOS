package com.eventcommerce.pos

import android.content.Intent
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
import androidx.compose.runtime.key
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
import com.eventcommerce.pos.menu.HttpsEdgeMenuTransport
import com.eventcommerce.pos.menu.MenuRefreshCoordinator
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
        var menuVersion by remember { mutableStateOf<Long?>(null) }
        var legacyDevelopmentOrderBlocked by remember { mutableStateOf(false) }

        LaunchedEffect(Unit) {
          val deviceId = deviceState.id()
          localDeviceId = deviceId
          knownEndpoint = syncProvisioning.endpoint().orEmpty()
          provisioned = syncProvisioning.current()?.takeIf { it.deviceId == deviceId }
          repository.retireUnusedDevelopmentMenu()
          legacyDevelopmentOrderBlocked = repository.hasOpenDevelopmentOrder()
          menuVersion = if (legacyDevelopmentOrderBlocked) {
            null
          } else {
            repository.activeProductionMenu()?.version
          }
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
              legacyDevelopmentOrderBlocked = repository.hasOpenDevelopmentOrder()
              menuVersion = null
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
              if (menuVersion != null && !legacyDevelopmentOrderBlocked) {
                menuVersion = repository.activeProductionMenu()?.version
              }
              MenuRefreshCoordinator(
                repository,
                HttpsEdgeMenuTransport(
                  activeProvisioning.endpoint,
                  activeProvisioning.deviceId,
                  activeProvisioning.token,
                ),
              ).run { installedVersion ->
                if (!legacyDevelopmentOrderBlocked) menuVersion = installedVersion
              }
            }
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
              TextButton(
                onClick = {
                  lifecycleScope.launch {
                    sharePilotDiagnostics()
                  }
                },
                modifier = Modifier.padding(horizontal = 8.dp),
              ) {
                Text("Share pilot diagnostics")
              }
              when {
                legacyDevelopmentOrderBlocked -> Text(
                  "Production sales are blocked because this register contains an unfinished legacy development order. Preserve the register data and complete an explicit recovery/reset before using it live.",
                  modifier = Modifier.padding(24.dp),
                )
                menuVersion == null -> Text(
                  "Waiting for this register's event menu. Keep Event Edge connected; no sales can start until a validated menu is available.",
                  modifier = Modifier.padding(24.dp),
                )
                else -> key(menuVersion) {
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
  }

  private suspend fun sharePilotDiagnostics() {
    val snapshot = PilotDiagnosticsCollector(database, repository).snapshot()
    val shareIntent = Intent(Intent.ACTION_SEND).apply {
      type = "application/json"
      putExtra(Intent.EXTRA_SUBJECT, "Event Commerce POS pilot diagnostics")
      putExtra(Intent.EXTRA_TEXT, snapshot.toJson())
    }
    startActivity(Intent.createChooser(shareIntent, "Share pilot diagnostics"))
  }
}

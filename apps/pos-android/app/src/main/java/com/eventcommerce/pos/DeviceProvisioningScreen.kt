package com.eventcommerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun DeviceProvisioningScreen(
  deviceId: String,
  initialEndpoint: String = "",
  onProvision: (endpoint: String, token: String) -> Unit,
) {
  var endpoint by remember(initialEndpoint) { mutableStateOf(initialEndpoint) }
  var token by remember { mutableStateOf("") }
  var error by remember { mutableStateOf<String?>(null) }

  Column(
    modifier = Modifier.fillMaxSize().padding(24.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    Text("Set up this register", style = MaterialTheme.typography.headlineMedium)
    Text(
      "Admin step only. Once connected, bartenders should not need this screen during normal trading.",
      style = MaterialTheme.typography.bodyLarge,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    Card(modifier = Modifier.fillMaxWidth()) {
      Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        Text("Register identity", style = MaterialTheme.typography.labelLarge)
        Text(deviceId, fontWeight = FontWeight.SemiBold)
        Text(
          "Give this ID to the event operator so they can provision this exact register at Event Edge.",
          style = MaterialTheme.typography.bodySmall,
        )
      }
    }

    OutlinedTextField(
      value = endpoint,
      onValueChange = {
        endpoint = it
        error = null
      },
      label = { Text("Event Edge address") },
      supportingText = { Text("Must be an HTTPS sync endpoint supplied by the event operator.") },
      placeholder = { Text("https://edge.example/sync/device-events") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    OutlinedTextField(
      value = token,
      onValueChange = {
        token = it
        error = null
      },
      label = { Text("One-time register credential") },
      supportingText = { Text("Paste the credential created for this register only.") },
      visualTransformation = PasswordVisualTransformation(),
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    error?.let {
      Text(
        it,
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodyMedium,
      )
    }
    Spacer(modifier = Modifier.height(4.dp))
    Button(
      onClick = {
        val cleanEndpoint = endpoint.trim()
        val cleanToken = token.trim()
        when {
          !cleanEndpoint.startsWith("https://") -> error = "Event Edge address must use HTTPS."
          cleanToken.length < 32 -> error = "Register credential is invalid."
          else -> {
            onProvision(cleanEndpoint, cleanToken)
            token = ""
          }
        }
      },
      modifier = Modifier.fillMaxWidth().height(56.dp),
    ) {
      Text("Connect register to Event Edge")
    }
  }
}

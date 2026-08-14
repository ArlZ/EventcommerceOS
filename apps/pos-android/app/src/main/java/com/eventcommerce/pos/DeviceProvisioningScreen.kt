package com.eventcommerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun DeviceProvisioningScreen(
  deviceId: String,
  onProvision: (endpoint: String, token: String) -> Unit,
) {
  var endpoint by remember { mutableStateOf("") }
  var token by remember { mutableStateOf("") }
  var error by remember { mutableStateOf<String?>(null) }

  Column(
    modifier = Modifier.fillMaxSize().padding(24.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    Text("Provision this POS", style = MaterialTheme.typography.headlineSmall)
    Text(
      "Give this device ID to the event operator. They must provision this exact device at Event Edge before entering the one-time credential below.",
    )
    Text("Device ID: $deviceId", style = MaterialTheme.typography.bodyLarge)
    OutlinedTextField(
      value = endpoint,
      onValueChange = { endpoint = it; error = null },
      label = { Text("Event Edge sync endpoint") },
      placeholder = { Text("https://edge.example/sync/device-events") },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    OutlinedTextField(
      value = token,
      onValueChange = { token = it; error = null },
      label = { Text("One-time device credential") },
      visualTransformation = PasswordVisualTransformation(),
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
    )
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    Button(
      onClick = {
        val cleanEndpoint = endpoint.trim()
        val cleanToken = token.trim()
        when {
          !cleanEndpoint.startsWith("https://") -> error = "Event Edge endpoint must use HTTPS"
          cleanToken.length < 32 -> error = "Device credential is invalid"
          else -> {
            onProvision(cleanEndpoint, cleanToken)
            token = ""
          }
        }
      },
    ) {
      Text("Provision POS")
    }
  }
}

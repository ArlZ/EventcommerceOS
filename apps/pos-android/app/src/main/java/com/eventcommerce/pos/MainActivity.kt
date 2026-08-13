package com.eventcommerce.pos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent { PosStatusScreen() }
  }
}

@Composable
fun PosStatusScreen() {
  MaterialTheme {
    Surface {
      Column(modifier = Modifier.padding(24.dp)) {
        Text("Event Commerce POS")
        Text("Local-first foundation ready")
        Text("Local store: ${LocalStoreStatus.label()}")
      }
    }
  }
}

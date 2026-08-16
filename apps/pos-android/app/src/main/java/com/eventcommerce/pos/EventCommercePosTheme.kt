package com.eventcommerce.pos

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val EventCommerceLightColors = lightColorScheme(
  primary = Color(0xFF155EEF),
  onPrimary = Color.White,
  primaryContainer = Color(0xFFEFF4FF),
  onPrimaryContainer = Color(0xFF102A56),
  secondary = Color(0xFF344054),
  onSecondary = Color.White,
  secondaryContainer = Color(0xFFF2F4F7),
  onSecondaryContainer = Color(0xFF1D2939),
  background = Color(0xFFF5F7FA),
  onBackground = Color(0xFF101828),
  surface = Color.White,
  onSurface = Color(0xFF101828),
  surfaceVariant = Color(0xFFF2F4F7),
  onSurfaceVariant = Color(0xFF475467),
  outline = Color(0xFFD0D5DD),
  error = Color(0xFFB42318),
  errorContainer = Color(0xFFFEF3F2),
  onErrorContainer = Color(0xFF7A271A),
)

@Composable
fun EventCommercePosTheme(content: @Composable () -> Unit) {
  MaterialTheme(
    colorScheme = EventCommerceLightColors,
    content = content,
  )
}

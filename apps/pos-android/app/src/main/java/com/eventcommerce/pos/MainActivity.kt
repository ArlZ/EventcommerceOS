package com.eventcommerce.pos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.eventcommerce.pos.data.AppDatabase
import com.eventcommerce.pos.data.LocalPosRepository

class MainActivity : ComponentActivity() {
  private val repository by lazy { LocalPosRepository(AppDatabase.get(applicationContext)) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent { PosScreen(repository) }
  }
}

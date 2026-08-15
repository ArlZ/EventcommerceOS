package com.eventcommerce.pos.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface PosDeviceCredentialStore {
  fun write(token: String)
  fun read(): String?
  fun clear()
}

class KeystorePosDeviceCredentialStore(context: Context) : PosDeviceCredentialStore {
  private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  override fun write(token: String) {
    require(token.length >= 32) { "POS device credential must be at least 32 characters" }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val ciphertext = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
    preferences.edit()
      .putString(CIPHERTEXT_KEY, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
      .putString(IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .apply()
  }

  override fun read(): String? {
    val encodedCiphertext = preferences.getString(CIPHERTEXT_KEY, null) ?: return null
    val encodedIv = preferences.getString(IV_KEY, null) ?: return null
    return try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(
        Cipher.DECRYPT_MODE,
        secretKey(),
        GCMParameterSpec(128, Base64.decode(encodedIv, Base64.NO_WRAP)),
      )
      cipher.doFinal(Base64.decode(encodedCiphertext, Base64.NO_WRAP)).toString(Charsets.UTF_8)
    } catch (_: Exception) {
      // A restored/copied app database or invalidated Keystore key must require explicit reprovisioning.
      clear()
      null
    }
  }

  override fun clear() {
    preferences.edit().remove(CIPHERTEXT_KEY).remove(IV_KEY).apply()
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
    if (existing != null) return existing

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  companion object {
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "event-commerce-pos-device-edge"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val PREFERENCES_NAME = "device_edge_credentials"
    private const val CIPHERTEXT_KEY = "token_ciphertext"
    private const val IV_KEY = "token_iv"
  }
}

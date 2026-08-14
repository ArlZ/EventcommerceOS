package com.eventcommerce.pos.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class DeviceCredentialStore(context: Context) {
  private val appContext = context.applicationContext
  private val preferences = appContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun token(): String? {
    val encodedIv = preferences.getString(KEY_IV, null) ?: return null
    val encodedCiphertext = preferences.getString(KEY_CIPHERTEXT, null) ?: return null
    return try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(
        Cipher.DECRYPT_MODE,
        key(),
        GCMParameterSpec(TAG_BITS, Base64.decode(encodedIv, Base64.NO_WRAP)),
      )
      val plaintext = cipher.doFinal(Base64.decode(encodedCiphertext, Base64.NO_WRAP))
      plaintext.toString(Charsets.UTF_8).also(::requireValidToken)
    } catch (error: Exception) {
      throw IllegalStateException("Stored device credential cannot be decrypted", error)
    }
  }

  fun provisionToken(value: String) {
    requireValidToken(value)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    preferences.edit()
      .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString(KEY_CIPHERTEXT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
      .apply()
  }

  fun clear() {
    preferences.edit().remove(KEY_IV).remove(KEY_CIPHERTEXT).apply()
  }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  companion object {
    private const val PREFERENCES = "event_commerce_device_security"
    private const val KEY_ALIAS = "event-commerce-pos-device-credential-v1"
    private const val KEY_IV = "device_credential_iv"
    private const val KEY_CIPHERTEXT = "device_credential_ciphertext"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128
    private val TOKEN_PATTERN = Regex(
      "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\\.[A-Za-z0-9_-]{32,}$",
    )

    fun requireValidToken(value: String) {
      require(TOKEN_PATTERN.matches(value)) { "Device credential token format is invalid" }
    }
  }
}

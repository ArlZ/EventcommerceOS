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

interface DeviceSecretStore {
  fun get(key: String): String?
  fun put(key: String, value: String)
  fun remove(key: String)
}

class AndroidKeystoreDeviceSecretStore(context: Context) : DeviceSecretStore {
  private val preferences =
    context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  override fun get(key: String): String? {
    val encoded = preferences.getString(key, null) ?: return null
    val parts = encoded.split(':')
    require(parts.size == 3 && parts[0] == FORMAT_VERSION) { "device secret format is invalid" }
    val iv = Base64.decode(parts[1], Base64.NO_WRAP)
    val ciphertext = Base64.decode(parts[2], Base64.NO_WRAP)
    val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
    return cipher.doFinal(ciphertext).toString(Charsets.UTF_8)
  }

  override fun put(key: String, value: String) {
    require(value.isNotBlank()) { "device secret cannot be blank" }
    val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    val encoded = buildString {
      append(FORMAT_VERSION)
      append(':')
      append(Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      append(':')
      append(Base64.encodeToString(ciphertext, Base64.NO_WRAP))
    }
    check(preferences.edit().putString(key, encoded).commit()) { "failed to persist encrypted device secret" }
  }

  override fun remove(key: String) {
    check(preferences.edit().remove(key).commit()) { "failed to remove encrypted device secret" }
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
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
    private const val PREFERENCES_NAME = "event-commerce-secure-device-secrets"
    private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
    private const val KEY_ALIAS = "event-commerce-pos-device-secrets-v1"
    private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val FORMAT_VERSION = "v1"
  }
}

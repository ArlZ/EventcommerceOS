plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
  id("com.google.devtools.ksp")
}

val releaseCommit = providers.environmentVariable("RELEASE_COMMIT").orElse("development").get()
if (releaseCommit != "development" && !Regex("^[0-9a-f]{40}$").matches(releaseCommit)) {
  error("RELEASE_COMMIT must be a lowercase 40-character Git SHA or omitted for development builds")
}

val releaseKeystorePath = providers.environmentVariable("POS_RELEASE_KEYSTORE_PATH").orNull
val releaseKeystorePassword = providers.environmentVariable("POS_RELEASE_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("POS_RELEASE_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("POS_RELEASE_KEY_PASSWORD").orNull
val releaseSigningValues =
  listOf(releaseKeystorePath, releaseKeystorePassword, releaseKeyAlias, releaseKeyPassword)
val releaseSigningConfigured = releaseSigningValues.all { !it.isNullOrBlank() }
if (!releaseSigningConfigured && releaseSigningValues.any { !it.isNullOrBlank() }) {
  error("Controlled-pilot release signing configuration must be supplied completely")
}

android {
  namespace = "com.eventcommerce.pos"
  compileSdk = 35
  defaultConfig {
    applicationId = "com.eventcommerce.pos"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0"
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    buildConfigField("String", "RELEASE_COMMIT", "\"$releaseCommit\"")
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  buildFeatures {
    compose = true
    buildConfig = true
  }
  signingConfigs {
    if (releaseSigningConfigured) {
      create("controlledPilotRelease") {
        storeFile = file(requireNotNull(releaseKeystorePath))
        storePassword = releaseKeystorePassword
        keyAlias = releaseKeyAlias
        keyPassword = releaseKeyPassword
      }
    }
  }
  buildTypes {
    getByName("release") {
      isDebuggable = false
      signingConfigs.findByName("controlledPilotRelease")?.let { signingConfig = it }
    }
  }
  testOptions { unitTests.isIncludeAndroidResources = true }
}

kotlin {
  compilerOptions {
    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
  }
}

dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
  implementation("androidx.activity:activity-compose:1.10.0")
  implementation(platform("androidx.compose:compose-bom:2024.12.01"))
  implementation("androidx.compose.material3:material3")
  implementation("androidx.room:room-runtime:2.8.4")
  implementation("androidx.room:room-ktx:2.8.4")
  ksp("androidx.room:room-compiler:2.8.4")
  testImplementation("junit:junit:4.13.2")
  testImplementation("androidx.room:room-testing:2.8.4")
  testImplementation("androidx.test:core:1.6.1")
  testImplementation("org.robolectric:robolectric:4.14.1")
  testImplementation("org.bouncycastle:bcprov-jdk18on:1.85")
}

tasks.register("scaResolvedDependencies") {
  group = "verification"
  description = "Prints resolved Maven dependencies for release SCA evidence"

  doLast {
    val lines = mutableSetOf<String>()
    configurations
      .filter {
        it.isCanBeResolved &&
          (it.name.endsWith("RuntimeClasspath") || it.name.startsWith("ksp"))
      }
      .forEach { configuration ->
        configuration.incoming.resolutionResult.allComponents.forEach componentLoop@{ component ->
          val module = component.moduleVersion ?: return@componentLoop
          if (module.group.isBlank() || module.name.isBlank() || module.version.isBlank()) {
            return@componentLoop
          }
          lines.add(
            listOf(
                "SCA_DEP",
                module.group,
                module.name,
                module.version,
                configuration.name,
              )
              .joinToString("\t"),
          )
        }
      }

    lines.sorted().forEach(::println)
  }
}

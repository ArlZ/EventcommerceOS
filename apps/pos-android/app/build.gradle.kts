plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
  id("com.google.devtools.ksp")
}

android {
  namespace = "com.eventcommerce.pos"
  compileSdk = 35
  defaultConfig { applicationId = "com.eventcommerce.pos"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.1.0"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
  compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
  kotlinOptions { jvmTarget = "17" }
  buildFeatures { compose = true }
  testOptions { unitTests.isIncludeAndroidResources = true }
}

dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
  implementation("androidx.activity:activity-compose:1.10.0")
  implementation(platform("androidx.compose:compose-bom:2024.12.01"))
  implementation("androidx.compose.material3:material3")
  implementation("androidx.room:room-runtime:2.6.1")
  implementation("androidx.room:room-ktx:2.6.1")
  ksp("androidx.room:room-compiler:2.6.1")
  testImplementation("junit:junit:4.13.2")
  testImplementation("androidx.room:room-testing:2.6.1")
  testImplementation("androidx.test:core:1.6.1")
  testImplementation("org.robolectric:robolectric:4.14.1")
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

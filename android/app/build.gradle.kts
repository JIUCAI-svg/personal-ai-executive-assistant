import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.forward.assistant"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.forward.assistant"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "0.4.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    // Gradle does not expose local.properties entries through findProperty;
    // load the ignored device-specific bridge settings explicitly.
    val localProperties = Properties().apply {
        val localPropertiesFile = rootProject.file("local.properties")
        if (localPropertiesFile.exists()) {
            localPropertiesFile.inputStream().use { load(it) }
        }
    }
    val aiGatewayUrl = (providers.gradleProperty("aiGatewayUrl").orNull
        ?: localProperties.getProperty("aiGatewayUrl")
        ?: "http://YOUR-SERVER-IP/forward-assistant/api/assistant/respond").replace("\\", "\\\\").replace("\"", "\\\"")
    val aiGatewayToken = (providers.gradleProperty("aiGatewayToken").orNull
        ?: localProperties.getProperty("aiGatewayToken")
        ?: "").replace("\\", "\\\\").replace("\"", "\\\"")
    defaultConfig {
        buildConfigField("String", "AI_GATEWAY_URL", "\"$aiGatewayUrl\"")
        buildConfigField("String", "AI_GATEWAY_TOKEN", "\"$aiGatewayToken\"")
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.08.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")
}

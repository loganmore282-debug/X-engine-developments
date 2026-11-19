plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Phone notifications need the owner's google-services.json from the Firebase console. Until that
// file is in this folder the app still builds and runs; it just cannot receive notifications.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.shulenotes.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.shulenotes.app"
        minSdk = 24
        targetSdk = 34
        // CI passes -PversionCode=<build number>, so every build is newer than the last and the
        // app can tell when a newer one exists. A build by hand is version 1.
        val build = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
        versionCode = build
        versionName = "1.0.$build"

        // The server the app talks to. Pass -PapiBaseUrl=https://api.example.com to
        // point any build at a real server; with nothing passed, debug builds use
        // the emulator's alias for the developer's machine and release builds use
        // the placeholder below (edit it before publishing).
        val liveApi = (project.findProperty("apiBaseUrl") as String?)?.trim().orEmpty()
        buildConfigField("String", "API_BASE_URL", "\"${liveApi.ifEmpty { "http://10.0.2.2:4000" }}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val liveApi = (project.findProperty("apiBaseUrl") as String?)?.trim().orEmpty()
            buildConfigField("String", "API_BASE_URL", "\"${liveApi.ifEmpty { "https://api.yourdomain.com" }}\"")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.activity:activity-compose:1.9.3")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-messaging")

    implementation("androidx.navigation:navigation-compose:2.8.3")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    testImplementation("junit:junit:4.13.2")
}

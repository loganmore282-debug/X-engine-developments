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

    // One fixed key signs every build this project makes for testing, so a new build installs OVER the
    // old one (a key made fresh on each CI run forced an uninstall, and the loss of the phone's data,
    // every time). It protects nothing by itself: the key for the real Play Store release is made by the
    // owner, kept private, and replaces this one at publishing time (see CLAUDE.md, "Security").
    signingConfigs {
        create("shuletest") {
            storeFile = file("shule-test-signing.keystore")
            storePassword = "shulenotes"
            keyAlias = "shuletest"
            keyPassword = "shulenotes"
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("shuletest")
            // Block screenshots and screen recording inside the reader and the AI chat (-PsecureScreens=false turns it off).
            buildConfigField("boolean", "SECURE_SCREENS", ((project.findProperty("secureScreens") as String?) != "false").toString())
            // SHA-256 of the key this build must be signed with. A copy re-signed by anyone else refuses to run.
            // Empty = not checked (the emulator test build).
            buildConfigField("String", "EXPECTED_CERT_SHA256", "\"${(project.findProperty("expectedCert") as String?).orEmpty()}\"")
            isMinifyEnabled = false
            val liveApi = (project.findProperty("apiBaseUrl") as String?)?.trim().orEmpty()
            buildConfigField("String", "API_BASE_URL", "\"${liveApi.ifEmpty { "https://api.yourdomain.com" }}\"")
        }
        debug {
            signingConfig = signingConfigs.getByName("shuletest")
            buildConfigField("boolean", "SECURE_SCREENS", "false")
            buildConfigField("String", "EXPECTED_CERT_SHA256", "\"\"")
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        // Release builds are checked by the compile and the emulator walk; lint warnings must not block them.
        checkReleaseBuilds = false
        abortOnError = false
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
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.activity:activity-compose:1.9.3")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-messaging")

    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("androidx.exifinterface:exifinterface:1.3.7")

    implementation("androidx.navigation:navigation-compose:2.8.3")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    testImplementation("junit:junit:4.13.2")
}

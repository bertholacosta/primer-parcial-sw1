plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.example.mobile_flutter"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.example.mobile_flutter"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        ndk {
            // ADR-0005: arm64-v8a is the primary target; x86_64 covers the
            // development/CI emulator.
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    // whisper.cpp + llama.cpp JNI bridges (ADR-0005). WHISPER_CPP_DIR and
    // LLAMA_CPP_DIR are forwarded to CMake; without them stub libraries are
    // built and the engines report SPEECH_RECOGNIZER_UNAVAILABLE /
    // SLM_UNAVAILABLE.
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            arguments(
                "-DWHISPER_CPP_DIR=${System.getenv("WHISPER_CPP_DIR") ?: ""}",
                "-DLLAMA_CPP_DIR=${System.getenv("LLAMA_CPP_DIR") ?: ""}",
            )
        }
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

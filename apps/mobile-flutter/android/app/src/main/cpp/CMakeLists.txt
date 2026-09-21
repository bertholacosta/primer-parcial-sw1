cmake_minimum_required(VERSION 3.22.1)
project(case_mobile_whisper_jni LANGUAGES C CXX)

# ADR-0005 (Opción A): whisper.cpp sources are not vendored in the
# repository. The model/source delivery step (tool/voice_android_gate.ps1)
# fetches a pinned checkout and the Gradle build forwards it as
# -DWHISPER_CPP_DIR=<path>. When absent, a stub library is produced so the
# app builds everywhere and the Kotlin bridge reports
# SPEECH_RECOGNIZER_UNAVAILABLE instead of crashing.
set(WHISPER_CPP_DIR "" CACHE PATH "Path to a whisper.cpp source checkout")

if(WHISPER_CPP_DIR AND EXISTS "${WHISPER_CPP_DIR}/CMakeLists.txt")
    set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
    add_subdirectory(${WHISPER_CPP_DIR} whisper_build EXCLUDE_FROM_ALL)

    add_library(whisper_jni SHARED whisper_jni.cpp)
    target_link_libraries(whisper_jni PRIVATE whisper)
    target_compile_definitions(whisper_jni PRIVATE CASE_WHISPER_BACKEND=1)
else()
    message(STATUS "WHISPER_CPP_DIR not provided: building whisper_jni stub")
    add_library(whisper_jni SHARED whisper_jni.cpp)
endif()

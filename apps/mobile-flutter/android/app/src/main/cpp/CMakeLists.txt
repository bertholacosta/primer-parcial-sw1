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

# ADR-0005 (Opción A, SLM stage): llama.cpp sources are not vendored in
# the repository either. The model/source delivery step
# (tool/local_ai_proposals_gate.ps1) fetches a pinned checkout and the
# Gradle build forwards it as -DLLAMA_CPP_DIR=<path>. When absent, a stub
# library is produced and the Kotlin bridge reports SLM_UNAVAILABLE.
set(LLAMA_CPP_DIR "" CACHE PATH "Path to a llama.cpp source checkout")

if(LLAMA_CPP_DIR AND EXISTS "${LLAMA_CPP_DIR}/CMakeLists.txt")
    set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
    add_subdirectory(${LLAMA_CPP_DIR} llama_build EXCLUDE_FROM_ALL)

    add_library(llama_jni SHARED llama_jni.cpp)
    target_link_libraries(llama_jni PRIVATE llama)
    target_compile_definitions(llama_jni PRIVATE CASE_LLAMA_BACKEND=1)
else()
    message(STATUS "LLAMA_CPP_DIR not provided: building llama_jni stub")
    add_library(llama_jni SHARED llama_jni.cpp)
endif()

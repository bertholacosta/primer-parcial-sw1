// JNI bridge between WhisperEngine.kt and whisper.cpp (ADR-0005).
//
// Built in two modes by CMakeLists.txt:
//  - CASE_WHISPER_BACKEND defined: real whisper.cpp transcription
//    (WHISPER_CPP_DIR points to a fetched source checkout).
//  - otherwise: stub that reports "not ready" so the app degrades to
//    SPEECH_RECOGNIZER_UNAVAILABLE instead of crashing.
//
// Sequential lifecycle per ADR-0005 memory policy: nativeInit loads the
// context for one utterance, nativeTranscribe runs once, nativeFree
// releases it immediately so ASR memory never overlaps later stages.

#include <jni.h>

#ifdef CASE_WHISPER_BACKEND
#include "whisper.h"
#include <string>
#include <vector>

static whisper_context* g_ctx = nullptr;
static int g_threads = 4;
#endif

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_example_mobile_1flutter_WhisperEngine_nativeBackendReady(
        JNIEnv*, jobject) {
#ifdef CASE_WHISPER_BACKEND
    return JNI_TRUE;
#else
    return JNI_FALSE;
#endif
}

JNIEXPORT jboolean JNICALL
Java_com_example_mobile_1flutter_WhisperEngine_nativeInit(
        JNIEnv* env, jobject, jstring modelPath, jint threads) {
#ifdef CASE_WHISPER_BACKEND
    const char* path = env->GetStringUTFChars(modelPath, nullptr);
    whisper_context_params cparams = whisper_context_default_params();
    g_ctx = whisper_init_from_file_with_params(path, cparams);
    env->ReleaseStringUTFChars(modelPath, path);
    g_threads = threads > 0 ? threads : 4;
    return g_ctx != nullptr ? JNI_TRUE : JNI_FALSE;
#else
    (void)env;
    return JNI_FALSE;
#endif
}

JNIEXPORT jstring JNICALL
Java_com_example_mobile_1flutter_WhisperEngine_nativeTranscribe(
        JNIEnv* env, jobject, jshortArray pcm, jint /*sampleRate*/) {
#ifdef CASE_WHISPER_BACKEND
    if (g_ctx == nullptr || pcm == nullptr) {
        return env->NewStringUTF("");
    }
    const jsize n = env->GetArrayLength(pcm);
    std::vector<float> samples(static_cast<size_t>(n));
    jshort* data = env->GetShortArrayElements(pcm, nullptr);
    for (jsize i = 0; i < n; ++i) {
        samples[i] = static_cast<float>(data[i]) / 32768.0f;
    }
    env->ReleaseShortArrayElements(pcm, data, JNI_ABORT);

    whisper_full_params params =
        whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.language = "es";
    params.translate = false;
    params.n_threads = g_threads;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;

    if (whisper_full(g_ctx, params, samples.data(), n) != 0) {
        return env->NewStringUTF("");
    }
    std::string out;
    const int segments = whisper_full_n_segments(g_ctx);
    for (int i = 0; i < segments; ++i) {
        out += whisper_full_get_segment_text(g_ctx, i);
    }
    return env->NewStringUTF(out.c_str());
#else
    return env->NewStringUTF("");
#endif
}

JNIEXPORT void JNICALL
Java_com_example_mobile_1flutter_WhisperEngine_nativeFree(
        JNIEnv*, jobject) {
#ifdef CASE_WHISPER_BACKEND
    if (g_ctx != nullptr) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }
#endif
}

} // extern "C"

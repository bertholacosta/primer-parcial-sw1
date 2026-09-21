// JNI bridge between LlamaEngine.kt and llama.cpp (ADR-0005, Opción A).
//
// Built in two modes by CMakeLists.txt:
//  - CASE_LLAMA_BACKEND defined: real llama.cpp generation
//    (LLAMA_CPP_DIR points to a fetched source checkout).
//  - otherwise: stub that reports "not ready" so the app degrades to
//    SLM_UNAVAILABLE instead of crashing.
//
// Sequential lifecycle per ADR-0005 memory policy: nativeInit loads the
// model and context for one interpretation, nativeGenerate runs once,
// nativeFree releases both immediately so SLM memory never overlaps with
// other stages. The model is mapped with mmap (llama.cpp default) so
// inactive pages are reclaimed by the kernel under memory pressure.

#include <jni.h>

#ifdef CASE_LLAMA_BACKEND
#include "llama.h"
#include <string>
#include <vector>

static llama_model* g_model = nullptr;
static llama_context* g_ctx = nullptr;
static llama_sampler* g_smpl = nullptr;
#endif

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_example_mobile_1flutter_LlamaEngine_nativeBackendReady(
        JNIEnv*, jobject) {
#ifdef CASE_LLAMA_BACKEND
    return JNI_TRUE;
#else
    return JNI_FALSE;
#endif
}

JNIEXPORT jboolean JNICALL
Java_com_example_mobile_1flutter_LlamaEngine_nativeInit(
        JNIEnv* env, jobject, jstring modelPath, jint threads, jint ctxSize) {
#ifdef CASE_LLAMA_BACKEND
    const char* path = env->GetStringUTFChars(modelPath, nullptr);

    llama_backend_init();
    llama_model_params mparams = llama_model_default_params();
    g_model = llama_model_load_from_file(path, mparams);
    env->ReleaseStringUTFChars(modelPath, path);
    if (g_model == nullptr) {
        return JNI_FALSE;
    }

    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx = ctxSize > 0 ? (uint32_t) ctxSize : 2048;
    cparams.n_threads = threads > 0 ? threads : 4;
    cparams.n_threads_batch = cparams.n_threads;
    g_ctx = llama_init_from_model(g_model, cparams);
    if (g_ctx == nullptr) {
        llama_model_free(g_model);
        g_model = nullptr;
        return JNI_FALSE;
    }
    g_smpl = llama_sampler_init_greedy();
    return JNI_TRUE;
#else
    (void)env;
    return JNI_FALSE;
#endif
}

JNIEXPORT jstring JNICALL
Java_com_example_mobile_1flutter_LlamaEngine_nativeGenerate(
        JNIEnv* env, jobject, jstring prompt, jint maxTokens) {
#ifdef CASE_LLAMA_BACKEND
    if (g_ctx == nullptr || g_model == nullptr || prompt == nullptr) {
        return env->NewStringUTF("");
    }
    const llama_vocab* vocab = llama_model_get_vocab(g_model);

    const char* text = env->GetStringUTFChars(prompt, nullptr);
    const std::string promptStr(text);
    env->ReleaseStringUTFChars(prompt, text);

    const int nPromptMax = (int) promptStr.size() + 64;
    std::vector<llama_token> tokens((size_t) nPromptMax);
    const int nTokens = llama_tokenize(
            vocab, promptStr.c_str(), (int) promptStr.size(),
            tokens.data(), nPromptMax, /*add_special*/ true,
            /*parse_special*/ true);
    if (nTokens <= 0) {
        return env->NewStringUTF("");
    }
    tokens.resize((size_t) nTokens);

    llama_batch batch = llama_batch_get_one(tokens.data(), nTokens);
    if (llama_decode(g_ctx, batch) != 0) {
        return env->NewStringUTF("");
    }

    std::string out;
    out.reserve((size_t) (maxTokens > 0 ? maxTokens : 256) * 4);
    const int limit = maxTokens > 0 ? maxTokens : 256;
    for (int i = 0; i < limit; ++i) {
        const llama_token id = llama_sampler_sample(g_smpl, g_ctx, -1);
        if (llama_vocab_is_eog(vocab, id)) {
            break;
        }
        char piece[256];
        const int n = llama_token_to_piece(
                vocab, id, piece, sizeof(piece), 0, true);
        if (n > 0) {
            out.append(piece, (size_t) n);
        }
        llama_sampler_accept(g_smpl, id);
        llama_batch next = llama_batch_get_one((llama_token*) &id, 1);
        if (llama_decode(g_ctx, next) != 0) {
            break;
        }
    }
    return env->NewStringUTF(out.c_str());
#else
    return env->NewStringUTF("");
#endif
}

JNIEXPORT void JNICALL
Java_com_example_mobile_1flutter_LlamaEngine_nativeFree(
        JNIEnv*, jobject) {
#ifdef CASE_LLAMA_BACKEND
    if (g_smpl != nullptr) {
        llama_sampler_free(g_smpl);
        g_smpl = nullptr;
    }
    if (g_ctx != nullptr) {
        llama_free(g_ctx);
        g_ctx = nullptr;
    }
    if (g_model != nullptr) {
        llama_model_free(g_model);
        g_model = nullptr;
    }
    llama_backend_free();
#endif
}

} // extern "C"

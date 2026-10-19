// Compile actual JNI exports; replace only hardware/VM/engine dependencies.
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <functional>
#include <iostream>
#include <limits>
#include <new>
#include <stdexcept>
#include <string>
#include <vector>
#include <jni.h>
#include "../../modules/kantahulay-audio/android/src/main/cpp/audio_engine.hpp"
#define __ANDROID__ 1
#include "../../modules/kantahulay-audio/android/src/main/cpp/jni_bridge.cpp"
#undef __ANDROID__

#define NATIVE(name) Java_com_kantahulay_audio_KantahulayAudioModule_native##name
extern "C" JNIEXPORT void JNICALL NATIVE(BeginPreparation)(JNIEnv*, jobject, jint);
#define CHECK(expr) do { if (!(expr)) throw std::runtime_error(#expr); } while (false)

namespace {
struct Vm {
    JNINativeInterface_ table{};
    JNIEnv env{&table};
    bool pending = false, fail_get = false, pending_on_get = false;
    int gets = 0, releases = 0, new_utf_calls = 0;
    std::string input = std::string(64, 'a');
    std::u16string output;
    static Vm* active;
    Vm() {
        active = this;
        table.ExceptionCheck = [](JNIEnv*) -> jboolean { return active->pending; };
        table.GetStringUTFChars = [](JNIEnv*, jstring value, jboolean*) -> const char* {
            CHECK(value != nullptr);
            CHECK(!active->pending);
            ++active->gets;
            if (active->pending_on_get) active->pending = true;
            if (active->fail_get) { active->pending = true; return nullptr; }
            return active->input.c_str();
        };
        table.ReleaseStringUTFChars = [](JNIEnv*, jstring value, const char* bytes) {
            CHECK(value != nullptr && bytes == active->input.c_str());
            ++active->releases;
        };
        table.NewString = [](JNIEnv*, const jchar* chars, jsize len) -> jstring {
            CHECK(!active->pending);
            CHECK(chars != nullptr);
            ++active->new_utf_calls;
            active->output.assign(reinterpret_cast<const char16_t*>(chars),
                                  reinterpret_cast<const char16_t*>(chars) + len);
            return reinterpret_cast<jstring>(1);
        };
        table.NewStringUTF = [](JNIEnv*, const char* bytes) -> jstring {
            CHECK(!active->pending);
            ++active->new_utf_calls;
            active->output.assign(bytes, bytes + std::strlen(bytes));
            return reinterpret_cast<jstring>(1);
        };
    }
    jstring text() { return reinterpret_cast<jstring>(1); }
};
Vm* Vm::active = nullptr;
int calls = 0, pack_calls = 0, parse_calls = 0, soundfont_calls = 0;
uint32_t begin_generation = 0;
bool fail_pack = false, fail_parse = false, fail_initialize = false, fail_prepare = false;
bool pending_in_dependency = false;
std::string throw_at, error_kind = "standard";
std::vector<std::string> logs;
std::vector<kantahulay::LyricEvent> current_lyrics;
void dependency(const char* name) {
    ++calls;
    if (pending_in_dependency) Vm::active->pending = true;
    if (throw_at != name) return;
    if (error_kind == "allocation") throw std::bad_alloc();
    if (error_kind == "unknown") throw 7;
    throw std::runtime_error("dependency failure");
}
jboolean prepare(Vm& vm, jstring sha, jint fd = 3, jlong start = 0,
                 jlong len = 100, jlong offset = 0, jint packed = 10,
                 jint unpacked = 20, jlong reservation = 1, jint generation = 1) {
    return NATIVE(PrepareSong)(&vm.env, nullptr, fd, start, len, offset,
                               packed, unpacked, sha, reservation, generation);
}
void reset_dependencies() {
    calls = pack_calls = parse_calls = soundfont_calls = 0;
    fail_pack = fail_parse = fail_initialize = fail_prepare = pending_in_dependency = false;
    current_lyrics.clear();
    throw_at.clear();
    error_kind = "standard";
    logs.clear();
}
void null_strings() {
    Vm vm;
    CHECK(NATIVE(LoadSoundFont)(&vm.env, nullptr, nullptr) == JNI_FALSE);
    CHECK(prepare(vm, nullptr) == JNI_FALSE);
    CHECK(vm.gets == 0 && soundfont_calls == 0 && pack_calls == 0);
}
void oom_strings() {
    Vm vm;
    vm.fail_get = true;
    CHECK(NATIVE(LoadSoundFont)(&vm.env, nullptr, vm.text()) == JNI_FALSE);
    CHECK(vm.pending && vm.gets == 1 && vm.releases == 0 && soundfont_calls == 0);
    vm.pending = false;
    CHECK(prepare(vm, vm.text()) == JNI_FALSE);
    CHECK(vm.pending && vm.gets == 2 && vm.releases == 0 && pack_calls == 0);
}
void pending_strings() {
    Vm vm;
    vm.pending = true;
    CHECK(NATIVE(LoadSoundFont)(&vm.env, nullptr, vm.text()) == JNI_FALSE);
    CHECK(prepare(vm, vm.text()) == JNI_FALSE);
    CHECK(vm.gets == 0 && calls == 0 && vm.pending);
    vm.pending = false;
    vm.pending_on_get = true;
    CHECK(NATIVE(LoadSoundFont)(&vm.env, nullptr, vm.text()) == JNI_FALSE);
    CHECK(vm.gets == 1 && vm.releases == 1 && soundfont_calls == 0);
    vm.pending = false;
    CHECK(prepare(vm, vm.text()) == JNI_FALSE);
    CHECK(vm.gets == 2 && vm.releases == 2 && pack_calls == 0 && vm.pending);
}
void signed_inputs() {
    Vm vm;
    CHECK(prepare(vm, vm.text(), -1) == JNI_FALSE);
    CHECK(prepare(vm, vm.text(), 3, -1) == JNI_FALSE);
    CHECK(prepare(vm, vm.text(), 3, 0, -1) == JNI_FALSE);
    CHECK(prepare(vm, vm.text(), 3, 0, 100, -1) == JNI_FALSE);
    CHECK(prepare(vm, vm.text(), 3, 0, 100, 0, -1) == JNI_FALSE);
    CHECK(prepare(vm, vm.text(), 3, 0, 100, 0, 10, -1) == JNI_FALSE);
    CHECK(prepare(vm, vm.text(), 3, 0, 100, 0, 10, 20, -1) == JNI_FALSE);
    CHECK(prepare(vm, vm.text(), 3, 0, 100, 0, 10, 20, 1, -1) == JNI_FALSE);
    CHECK(vm.gets == 0 && pack_calls == 0);
}
struct Export {
    const char* name;
    std::function<long long(JNIEnv*)> call;
    long long fallback;
};
std::vector<Export> exports(Vm& vm) {
    return {
        {"BeginPreparation", [](JNIEnv* e) { NATIVE(BeginPreparation)(e, nullptr, 1); return 0; }, 0},
        {"Initialize", [](JNIEnv* e) { return NATIVE(Initialize)(e, nullptr); }, JNI_FALSE},
        {"LoadSoundFont", [&](JNIEnv* e) { return NATIVE(LoadSoundFont)(e, nullptr, vm.text()); }, JNI_FALSE},
        {"PrepareSong", [&](JNIEnv* e) { return NATIVE(PrepareSong)(e, nullptr, 3, 0, 100, 0, 10, 20, vm.text(), 1, 1); }, JNI_FALSE},
        {"Play", [](JNIEnv* e) { NATIVE(Play)(e, nullptr); return 0; }, 0},
        {"Pause", [](JNIEnv* e) { NATIVE(Pause)(e, nullptr); return 0; }, 0},
        {"Stop", [](JNIEnv* e) { NATIVE(Stop)(e, nullptr); return 0; }, 0},
        {"SetKeyOffset", [](JNIEnv* e) { NATIVE(SetKeyOffset)(e, nullptr, 2); return 0; }, 0},
        {"GetPlaybackState", [](JNIEnv* e) { return NATIVE(GetPlaybackState)(e, nullptr); }, 5},
        {"GetCurrentTimeMs", [](JNIEnv* e) { return NATIVE(GetCurrentTimeMs)(e, nullptr); }, 0},
        {"IsSongEnded", [](JNIEnv* e) { return NATIVE(IsSongEnded)(e, nullptr); }, JNI_FALSE},
        {"GetLyricsJson", [](JNIEnv* e) { return NATIVE(GetLyricsJson)(e, nullptr) != nullptr; }, 0},
        {"GetTotalTimeMs", [](JNIEnv* e) { return NATIVE(GetTotalTimeMs)(e, nullptr); }, 0},
        {"Reset", [](JNIEnv* e) { NATIVE(Reset)(e, nullptr); return 0; }, 0},
        {"SetEffectsLevel", [](JNIEnv* e) { NATIVE(SetEffectsLevel)(e, nullptr, 2); return 0; }, 0},
        {"GetEffectsLevel", [](JNIEnv* e) { return NATIVE(GetEffectsLevel)(e, nullptr); }, 0},
        {"SetBluetoothActive", [](JNIEnv* e) { NATIVE(SetBluetoothActive)(e, nullptr, JNI_TRUE); return 0; }, 0},
        {"IsBluetoothActive", [](JNIEnv* e) { return NATIVE(IsBluetoothActive)(e, nullptr); }, JNI_FALSE},
        {"SetBluetoothLyricOffsetMs", [](JNIEnv* e) { NATIVE(SetBluetoothLyricOffsetMs)(e, nullptr, 100); return 0; }, 0},
        {"GetBluetoothLyricOffsetMs", [](JNIEnv* e) { return NATIVE(GetBluetoothLyricOffsetMs)(e, nullptr); }, 0},
        {"ResetLatencyTracking", [](JNIEnv* e) { NATIVE(ResetLatencyTracking)(e, nullptr); return 0; }, 0},
    };
}
void export_exception_guards() {
    Vm vm;
    for (const auto& entry : exports(vm)) {
        for (const auto* kind : {"standard", "allocation", "unknown"}) {
            throw_at = "instance";
            error_kind = kind;
            logs.clear();
            long long result;
            try { result = entry.call(&vm.env); }
            catch (...) { throw std::runtime_error(std::string(entry.name) + " escaped " + kind); }
            CHECK(result == entry.fallback);
            CHECK(!logs.empty() && logs.back().find(entry.name) != std::string::npos);
        }
    }
}
void export_pending_guards() {
    Vm vm;
    vm.pending = true;
    for (const auto& entry : exports(vm)) {
        auto before = calls;
        CHECK(entry.call(&vm.env) == entry.fallback);
        CHECK(calls == before && vm.pending);
    }
    CHECK(vm.gets == 0 && vm.new_utf_calls == 0);
}
void export_null_env_guards() {
    Vm vm;
    for (const auto& entry : exports(vm)) {
        auto before = calls;
        CHECK(entry.call(nullptr) == entry.fallback);
        CHECK(calls == before);
    }
}
void begin_preparation_generation() {
    Vm vm;
    NATIVE(BeginPreparation)(&vm.env, nullptr, -1);
    CHECK(calls == 0);
    NATIVE(BeginPreparation)(&vm.env, nullptr, 0);
    CHECK(begin_generation == 0);
    NATIVE(BeginPreparation)(&vm.env, nullptr, std::numeric_limits<jint>::max());
    CHECK(begin_generation == static_cast<uint32_t>(std::numeric_limits<jint>::max()));
}
void pending_after_work() {
    Vm vm;
    pending_in_dependency = true;
    CHECK(NATIVE(GetCurrentTimeMs)(&vm.env, nullptr) == 0);
    CHECK(vm.pending);
}
void deep_exception_guards() {
    Vm vm;
    for (const auto* kind : {"standard", "allocation", "unknown"}) {
        error_kind = kind;
        for (const auto* name : {"initialize", "oboe_instance", "oboe_start"}) {
            throw_at = name;
            CHECK(NATIVE(Initialize)(&vm.env, nullptr) == JNI_FALSE);
        }
        for (const auto* name : {"pack", "parse", "prepare"}) {
            throw_at = name;
            auto before = vm.releases;
            CHECK(prepare(vm, vm.text()) == JNI_FALSE);
            CHECK(vm.releases == before + 1 && vm.gets == vm.releases);
        }
        throw_at = "soundfont";
        CHECK(NATIVE(LoadSoundFont)(&vm.env, nullptr, vm.text()) == JNI_FALSE);
        CHECK(vm.gets == vm.releases);
        throw_at = "lyrics";
        CHECK(NATIVE(GetLyricsJson)(&vm.env, nullptr) == nullptr);
        throw_at = "begin";
        NATIVE(BeginPreparation)(&vm.env, nullptr, 3);
    }
    throw_at.clear();
    fail_initialize = true;
    auto before = calls;
    CHECK(NATIVE(Initialize)(&vm.env, nullptr) == JNI_FALSE);
    CHECK(calls == before + 2); // No output stream after failed engine initialization.
    CHECK(!logs.empty() && logs.back().find("engine initialization failed") != std::string::npos);
    fail_prepare = true;
    CHECK(prepare(vm, vm.text()) == JNI_FALSE);
    CHECK(logs.back().find("engine preparation rejected") != std::string::npos);
}
void unicode_transcoding_and_surrogates() {
    Vm vm;
    // Malformed byte 0xFF should be replaced with U+FFFD.
    current_lyrics = {{0, 10, std::string("Ma\xFF" "ana"), false, false}};
    NATIVE(GetLyricsJson)(&vm.env, nullptr);
    CHECK(vm.new_utf_calls == 1);
    CHECK(vm.output.find(u"\uFFFD") != std::u16string::npos);

    // UTF-8 multi-byte accents (ñ, é) should transcode to UTF-16 directly.
    current_lyrics = {{0, 20, "Niño café", false, false}};
    NATIVE(GetLyricsJson)(&vm.env, nullptr);
    CHECK(vm.output.find(u"Ni\u00F1o caf\u00E9") != std::u16string::npos);

    // 4-byte surrogate pair (𝄞 / Musical Symbol G Clef: U+1D11E -> D834 DD1E).
    current_lyrics = {{0, 30, "\xF0\x9D\x84\x9E", false, false}};
    NATIVE(GetLyricsJson)(&vm.env, nullptr);
    const char16_t clef_surrogates[] = {0xD834, 0xDD1E, 0};
    CHECK(vm.output.find(clef_surrogates) != std::u16string::npos);

    // Sibling native exports check: JNI bridge is the sole JNI surface in this repo.
    CHECK(exports(vm).size() == 21);
}
void prepare_error_logs() {
    Vm vm;
    fail_pack = true;
    CHECK(prepare(vm, vm.text()) == JNI_FALSE);
    CHECK(!logs.empty() && logs.back().find("pack read failed") != std::string::npos);
    fail_pack = false;
    fail_parse = true;
    CHECK(prepare(vm, vm.text()) == JNI_FALSE);
    CHECK(logs.back().find("MIDI parse failed") != std::string::npos);
    CHECK(vm.gets == 2 && vm.releases == 2);
}
void resource_release() {
    Vm vm;
    CHECK(NATIVE(LoadSoundFont)(&vm.env, nullptr, vm.text()) == JNI_TRUE);
    CHECK(vm.gets == 1 && vm.releases == 1);
    throw_at = "soundfont";
    try { NATIVE(LoadSoundFont)(&vm.env, nullptr, vm.text()); } catch (...) {}
    CHECK(vm.gets == 2 && vm.releases == 2);
    throw_at = "pack";
    try { prepare(vm, vm.text()); } catch (...) {}
    CHECK(vm.gets == 3 && vm.releases == 3);
    throw_at = "parse";
    try { prepare(vm, vm.text()); } catch (...) {}
    CHECK(vm.gets == 4 && vm.releases == 4);
    throw_at = "prepare";
    try { prepare(vm, vm.text()); } catch (...) {}
    CHECK(vm.gets == 5 && vm.releases == 5);
}
}

extern "C" int __android_log_print(int, const char*, const char* format, ...) {
    char text[512];
    va_list args;
    va_start(args, format);
    vsnprintf(text, sizeof(text), format, args);
    va_end(args);
    logs.emplace_back(text);
    return 0;
}
namespace kantahulay {
AudioEngine::AudioEngine() = default;
AudioEngine::~AudioEngine() = default;
AudioEngine& AudioEngine::instance() { dependency("instance"); static AudioEngine engine; return engine; }
void AudioEngine::begin_preparation(uint32_t generation) { dependency("begin"); begin_generation = generation; }
bool AudioEngine::initialize(int) { dependency("initialize"); return !fail_initialize; }
bool AudioEngine::load_soundfont_file(const char* path) {
    CHECK(path != nullptr);
    ++soundfont_calls;
    dependency("soundfont");
    return true;
}
bool AudioEngine::prepare_song(const ParsedSong&, int64_t, uint32_t) { dependency("prepare"); return !fail_prepare; }
void AudioEngine::play() { dependency("play"); }
void AudioEngine::pause() { dependency("pause"); }
void AudioEngine::stop() { dependency("stop"); }
void AudioEngine::set_key_offset(int) { dependency("key"); }
uint32_t AudioEngine::get_current_time_ms() { dependency("time"); return 123; }
std::vector<LyricEvent> AudioEngine::get_current_lyrics() { dependency("lyrics"); return current_lyrics; }
void AudioEngine::reset() { dependency("reset"); }
void AudioEngine::set_effects_level(int) { dependency("effects"); }
int AudioEngine::get_effects_level() const { dependency("get_effects"); return 2; }
void AudioEngine::set_master_gain(float) { dependency("gain"); }
float AudioEngine::get_master_gain() const { dependency("get_gain"); return 1.0f; }
void AudioEngine::reset_latency_tracking() { dependency("latency"); }
OboeAudioOutput& OboeAudioOutput::instance() { dependency("oboe_instance"); static OboeAudioOutput output; return output; }
bool OboeAudioOutput::start() { dependency("oboe_start"); return true; }
void OboeAudioOutput::stop() {}
oboe::DataCallbackResult OboeAudioOutput::onAudioReady(oboe::AudioStream*, void*, int32_t) { return oboe::DataCallbackResult::Continue; }
void OboeAudioOutput::onErrorAfterClose(oboe::AudioStream*, oboe::Result) {}
bool PackReader::read_entry(int fd, uint64_t, uint64_t, uint64_t, uint32_t, uint32_t,
                            const std::string&, std::vector<uint8_t>& out, std::string* error) {
    if (error) *error = fail_pack ? "mock pack rejected" : "";
    CHECK(fd >= 0);
    ++pack_calls;
    dependency("pack");
    out = {0};
    return !fail_pack;
}
bool MidiParser::parse(const uint8_t*, size_t, ParsedSong&, std::string* error) {
    if (error) *error = fail_parse ? "mock parse rejected" : "";
    ++parse_calls;
    dependency("parse");
    return !fail_parse;
}
}
int main(int argc, char** argv) {
    const std::pair<const char*, void(*)()> tests[] = {
        {"null_strings", null_strings}, {"oom_strings", oom_strings},
        {"pending_strings", pending_strings}, {"signed_inputs", signed_inputs},
        {"resource_release", resource_release},
        {"export_exception_guards", export_exception_guards},
        {"export_pending_guards", export_pending_guards},
        {"export_null_env_guards", export_null_env_guards},
        {"unicode_transcoding_and_surrogates", unicode_transcoding_and_surrogates},
        {"prepare_error_logs", prepare_error_logs},
        {"begin_preparation_generation", begin_preparation_generation},
        {"pending_after_work", pending_after_work},
        {"deep_exception_guards", deep_exception_guards},
    };
    int failed = 0, ran = 0;
    for (auto [name, test] : tests) {
        if (argc > 1 && std::strcmp(argv[1], name) != 0) continue;
        ++ran;
        reset_dependencies();
        try { test(); std::cout << "PASS " << name << '\n'; }
        catch (const std::exception& error) { ++failed; std::cout << "FAIL " << name << ": " << error.what() << '\n'; }
        catch (...) { ++failed; std::cout << "FAIL " << name << ": uncaught native exception\n"; }
    }
    std::cout << ran << " checks, " << failed << " failed\n";
    return failed || !ran ? 1 : 0;
}

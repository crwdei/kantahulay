#pragma once
// Host-only declarations required by the production audio_out_oboe.hpp.
#include <cstdint>
namespace oboe {
class AudioStream {};
enum class DataCallbackResult { Continue };
enum class Result { OK };
class AudioStreamDataCallback {
public:
    virtual ~AudioStreamDataCallback() = default;
    virtual DataCallbackResult onAudioReady(AudioStream*, void*, int32_t) = 0;
};
class AudioStreamErrorCallback {
public:
    virtual ~AudioStreamErrorCallback() = default;
    virtual void onErrorAfterClose(AudioStream*, Result) = 0;
};
}

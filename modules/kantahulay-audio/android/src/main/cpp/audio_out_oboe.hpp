#pragma once

#if defined(__ANDROID__)
#include <oboe/Oboe.h>
#include <mutex>
#include <memory>
#include <cstdint>

namespace kantahulay {

struct PipelineLagResult {
    double lag_frames = 0.0;
    bool valid = false;
    int32_t device_id = -1;
};

class OboeAudioOutput : public oboe::AudioStreamDataCallback, public oboe::AudioStreamErrorCallback {
public:
    static OboeAudioOutput& instance();

    bool start();
    void stop();
    bool is_running() const {
        std::lock_guard<std::mutex> lock(const_cast<std::mutex&>(stream_mutex_));
        return stream_ != nullptr;
    }

    PipelineLagResult get_pipeline_lag(int sample_rate);

    oboe::DataCallbackResult onAudioReady(oboe::AudioStream* stream, void* audioData, int32_t numFrames) override;
    void onErrorAfterClose(oboe::AudioStream* stream, oboe::Result result) override;

private:
    OboeAudioOutput() = default;
    ~OboeAudioOutput() override { stop(); }

    std::mutex stream_mutex_;
    std::shared_ptr<oboe::AudioStream> stream_;
};

} // namespace kantahulay
#endif

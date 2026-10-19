#if defined(__ANDROID__)
#include "audio_out_oboe.hpp"
#include "audio_engine.hpp"
#include <ctime>
#include <cmath>

namespace kantahulay {

OboeAudioOutput& OboeAudioOutput::instance() {
    static OboeAudioOutput out;
    return out;
}

PipelineLagResult OboeAudioOutput::get_pipeline_lag(int sample_rate) {
    PipelineLagResult result;
    std::shared_ptr<oboe::AudioStream> st;
    {
        std::lock_guard<std::mutex> lock(stream_mutex_);
        st = stream_;
    }
    if (!st) return result;

    result.device_id = st->getDeviceId();

    // 1. Try getTimestamp(CLOCK_MONOTONIC)
    int64_t presentedFrame = 0;
    int64_t presentedTimeNs = 0;
    oboe::Result res = st->getTimestamp(CLOCK_MONOTONIC, &presentedFrame, &presentedTimeNs);
    if (res == oboe::Result::OK && presentedTimeNs > 0) {
        struct timespec now;
        clock_gettime(CLOCK_MONOTONIC, &now);
        int64_t nowNs = static_cast<int64_t>(now.tv_sec) * 1000000000LL + now.tv_nsec;

        // Extrapolate to now: presentedNow = presentedFrame + (nowNs - presentedTimeNs) * sampleRate / 1e9
        double timeDeltaSec = static_cast<double>(nowNs - presentedTimeNs) * 1e-9;
        double presentedNow = static_cast<double>(presentedFrame) + (timeDeltaSec * static_cast<double>(sample_rate));
        int64_t framesWritten = st->getFramesWritten();
        double lagFrames = static_cast<double>(framesWritten) - presentedNow;

        if (lagFrames >= 0.0) {
            result.lag_frames = lagFrames;
            result.valid = true;
            return result;
        }
    }

    // 2. Fallback to calculateLatencyMillis()
    auto latRes = st->calculateLatencyMillis();
    if (latRes == oboe::Result::OK && latRes.value() >= 0.0) {
        result.lag_frames = latRes.value() * static_cast<double>(sample_rate) / 1000.0;
        result.valid = true;
        return result;
    }

    // 3. Fallback: valid = false (caller uses rendered time)
    return result;
}

bool OboeAudioOutput::start() {
    std::lock_guard<std::mutex> lock(stream_mutex_);
    if (stream_) return true;

    oboe::AudioStreamBuilder builder;
    builder.setDirection(oboe::Direction::Output)
           ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
           ->setSharingMode(oboe::SharingMode::Exclusive)
           ->setFormat(oboe::AudioFormat::Float)
           ->setChannelCount(oboe::ChannelCount::Stereo)
           ->setSampleRate(oboe::Unspecified)
           ->setDataCallback(this)
           ->setErrorCallback(this);

    oboe::Result res = builder.openStream(stream_);
    if (res != oboe::Result::OK) {
        // Fall back to Shared mode if Exclusive mode is unavailable
        builder.setSharingMode(oboe::SharingMode::Shared);
        res = builder.openStream(stream_);
        if (res != oboe::Result::OK) {
            stream_.reset();
            return false;
        }
    }

    AudioEngine::instance().initialize(stream_->getSampleRate());

    res = stream_->requestStart();
    if (res != oboe::Result::OK) {
        stream_->close();
        stream_.reset();
        return false;
    }
    return true;
}

void OboeAudioOutput::stop() {
    std::lock_guard<std::mutex> lock(stream_mutex_);
    if (stream_) {
        stream_->stop();
        stream_->close();
        stream_.reset();
    }
    AudioEngine::instance().reset_latency_tracking();
}

oboe::DataCallbackResult OboeAudioOutput::onAudioReady(oboe::AudioStream* /*stream*/, void* audioData, int32_t numFrames) {
    AudioEngine::instance().render_samples(static_cast<float*>(audioData), numFrames);
    return oboe::DataCallbackResult::Continue;
}

void OboeAudioOutput::onErrorAfterClose(oboe::AudioStream* /*stream*/, oboe::Result /*result*/) {
    // Stream was closed due to route change / disconnection. Restart stream safely.
    {
        std::lock_guard<std::mutex> lock(stream_mutex_);
        if (stream_) {
            stream_.reset();
        }
    }
    AudioEngine::instance().reset_latency_tracking();
    start();
}

} // namespace kantahulay
#endif

#include <cassert>
#include <iostream>
#include <cmath>
#include <cstdint>
#include <algorithm>

namespace test {

struct SimulatedTimestamp {
    bool valid = true;
    int64_t presentedFrame = 0;
    int64_t presentedTimeNs = 0;
};

struct SimulatedStream {
    int sampleRate = 48000;
    int64_t framesWritten = 0;
    SimulatedTimestamp ts;
    bool calcLatencySupported = true;
    double calcLatencyMs = 200.0;

    int64_t getFramesWritten() const { return framesWritten; }
    int getSampleRate() const { return sampleRate; }

    bool getTimestamp(int64_t* frame, int64_t* timeNs) const {
        if (!ts.valid) return false;
        *frame = ts.presentedFrame;
        *timeNs = ts.presentedTimeNs;
        return true;
    }

    bool calculateLatencyMillis(double* lat) const {
        if (!calcLatencySupported) return false;
        *lat = calcLatencyMs;
        return true;
    }
};

class LatencyClockSimulator {
public:
    double smoothed_lag_frames = -1.0;
    uint32_t last_reported_ms = 0;
    uint32_t paused_time_ms = 0;
    bool is_bluetooth = false;
    int32_t bluetooth_offset_ms = 0;

    void reset() {
        smoothed_lag_frames = -1.0;
        last_reported_ms = 0;
        paused_time_ms = 0;
    }

    double compute_lag_frames(const SimulatedStream& st, int64_t nowNs) {
        int64_t presFrame = 0;
        int64_t presNs = 0;
        if (st.getTimestamp(&presFrame, &presNs) && presNs > 0) {
            double dtSec = static_cast<double>(nowNs - presNs) * 1e-9;
            double presentedNow = static_cast<double>(presFrame) + (dtSec * st.sampleRate);
            double lag = static_cast<double>(st.getFramesWritten()) - presentedNow;
            if (lag >= 0.0) return lag;
        }

        double calcLat = 0.0;
        if (st.calculateLatencyMillis(&calcLat) && calcLat >= 0.0) {
            return (calcLat * st.sampleRate) / 1000.0;
        }

        return 0.0;
    }

    uint32_t update_time(const SimulatedStream& st, uint64_t rendered_frames, int64_t nowNs, bool is_playing) {
        if (!is_playing) return paused_time_ms;

        double raw_lag = compute_lag_frames(st, nowNs);
        if (smoothed_lag_frames < 0.0) {
            smoothed_lag_frames = raw_lag;
        } else {
            smoothed_lag_frames = 0.85 * smoothed_lag_frames + 0.15 * raw_lag;
        }

        int64_t lag_int = static_cast<int64_t>(std::round(smoothed_lag_frames));
        int64_t heard_frames = static_cast<int64_t>(rendered_frames) - lag_int;
        if (heard_frames < 0) heard_frames = 0;

        uint32_t heard_ms = static_cast<uint32_t>((static_cast<uint64_t>(heard_frames) * 1000ULL) / st.sampleRate);

        if (is_bluetooth) {
            int64_t adj = static_cast<int64_t>(heard_ms) + bluetooth_offset_ms;
            heard_ms = static_cast<uint32_t>(std::max<int64_t>(0, adj));
        }

        if (heard_ms < last_reported_ms) {
            heard_ms = last_reported_ms;
        } else {
            last_reported_ms = heard_ms;
        }

        return heard_ms;
    }

    void on_pause() {
        paused_time_ms = last_reported_ms;
    }

    void on_resume() {
        last_reported_ms = paused_time_ms;
    }
};

} // namespace test

int main() {
    using namespace test;
    std::cout << "[TEST] Running Latency Clock & Bluetooth Sync Unit Tests..." << std::endl;

    SimulatedStream stream;
    stream.sampleRate = 48000;
    LatencyClockSimulator clock;

    // Test 1: Song start clamping (heard time must not go negative)
    // 200ms lag @ 48kHz = 9600 frames
    stream.framesWritten = 10000;
    stream.ts.valid = true;
    stream.ts.presentedFrame = 400;
    stream.ts.presentedTimeNs = 1000000000LL; // 1.0s
    int64_t nowNs = 1000000000LL;            // dt = 0

    // rendered_frames = 4800 (100ms into song)
    // lag = 10000 - 400 = 9600 frames (200ms)
    // rendered_frames (4800) < lag (9600) -> heard_frames clamped to 0 -> 0 ms
    uint32_t t0 = clock.update_time(stream, 4800, nowNs, true);
    assert(t0 == 0);
    std::cout << "  ✓ Test 1: Song start clamping to 0 ms passed" << std::endl;

    // Test 2: Sound reaches ear
    // rendered_frames = 14400 (300ms)
    // heard_frames = 14400 - 9600 = 4800 frames -> 100 ms heard!
    uint32_t t1 = clock.update_time(stream, 14400, nowNs, true);
    assert(t1 == 100);
    std::cout << "  ✓ Test 2: Accurate heard-time calculation passed (100 ms)" << std::endl;

    // Test 3: Extrapolation with time delta
    // Suppose nowNs advances by 50ms (2400 frames @ 48kHz)
    nowNs += 50000000LL; // +50ms
    stream.framesWritten += 2400; // wrote 50ms more
    // rendered_frames advances by 2400 (now 16800 = 350ms)
    // presentedNow = 400 + (0.05 * 48000) = 2800 frames
    // lag = 12400 - 2800 = 9600 frames
    // heard_frames = 16800 - 9600 = 7200 frames -> 150 ms heard!
    uint32_t t2 = clock.update_time(stream, 16800, nowNs, true);
    assert(t2 == 150);
    std::cout << "  ✓ Test 3: Extrapolated timestamp passed (150 ms)" << std::endl;

    // Test 4: Monotonic clamp (clock never ticks backwards)
    // Even if stream reports an anomalous lag spike of 500ms
    stream.ts.presentedFrame = 0; // sudden bogus lag
    uint32_t t3 = clock.update_time(stream, 17000, nowNs, true);
    assert(t3 >= 150);
    std::cout << "  ✓ Test 4: Monotonic non-decreasing clamp passed" << std::endl;

    // Test 5: Fallback path when getTimestamp is unsupported
    stream.ts.valid = false;
    stream.calcLatencySupported = true;
    stream.calcLatencyMs = 150.0; // 150ms fallback latency
    clock.reset();
    // rendered_frames = 9600 (200ms)
    // fallback lag = 150ms -> heard = 50ms
    uint32_t tFallback = clock.update_time(stream, 9600, nowNs, true);
    assert(tFallback == 50);
    std::cout << "  ✓ Test 5: calculateLatencyMillis fallback passed (50 ms)" << std::endl;

    // Test 6: Fallback when calculateLatencyMillis also fails
    stream.calcLatencySupported = false;
    clock.reset();
    uint32_t tFullFallback = clock.update_time(stream, 9600, nowNs, true);
    assert(tFullFallback == 200); // 0 lag -> rendered time (200 ms)
    std::cout << "  ✓ Test 6: Ultimate fallback to rendered time passed (200 ms)" << std::endl;

    // Test 7: Pause and resume stability
    clock.reset();
    stream.ts.valid = true;
    stream.framesWritten = 10000;
    stream.ts.presentedFrame = 5200; // 100ms lag
    stream.ts.presentedTimeNs = nowNs;
    uint32_t tPlay = clock.update_time(stream, 9600, nowNs, true); // 100 ms heard
    assert(tPlay == 100);
    clock.on_pause();
    uint32_t tPaused1 = clock.update_time(stream, 9600, nowNs, false);
    assert(tPaused1 == 100);
    // While paused, time does not drift
    nowNs += 200000000LL; // 200ms passes in real time
    uint32_t tPaused2 = clock.update_time(stream, 9600, nowNs, false);
    assert(tPaused2 == 100);
    clock.on_resume();
    uint32_t tResume = clock.update_time(stream, 9600, nowNs, true);
    assert(tResume == 100);
    std::cout << "  ✓ Test 7: Pause/resume clock freeze & seamless resume passed" << std::endl;

    // Test 8: Bluetooth manual offset
    clock.is_bluetooth = true;
    clock.bluetooth_offset_ms = 50; // +50ms shift
    clock.reset();
    // rendered 9600 (200ms) - lag 4800 (100ms) = 100ms + 50ms offset = 150ms!
    uint32_t tBt = clock.update_time(stream, 9600, nowNs, true);
    assert(tBt == 150);
    clock.bluetooth_offset_ms = -30; // -30ms shift
    clock.reset();
    uint32_t tBtNeg = clock.update_time(stream, 9600, nowNs, true);
    assert(tBtNeg == 70); // 100ms - 30ms = 70ms
    std::cout << "  ✓ Test 8: Bluetooth manual offset (+50ms, -30ms) passed" << std::endl;

    std::cout << "ALL 8 LATENCY CLOCK & BLUETOOTH TESTS PASSED!" << std::endl;
    return 0;
}

// Host: uvx --from ziglang python-zig c++ -std=c++17 -O2 -UNDEBUG -Wno-nullability-completeness tests/cpp/test_audio_output.cpp -o WORKSPACE/audio-output-check.exe
// Run: WORKSPACE/audio-output-check.exe android/app/src/main/assets/soundfont.sf2
#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#define private public
#include "../../modules/kantahulay-audio/android/src/main/cpp/audio_engine.hpp"
#include "../../modules/kantahulay-audio/android/src/main/cpp/tsf_engine.hpp"
#undef private
#include "../../modules/kantahulay-audio/android/src/main/cpp/tsf_engine.cpp"
#include "../../modules/kantahulay-audio/android/src/main/cpp/audio_engine.cpp"
#include <cmath>
#include <iostream>
#include <iterator>
#include <limits>

using namespace kantahulay;

static bool check(bool passed, const char* message) {
    std::cout << (passed ? "PASS " : "FAIL ") << message << '\n';
    return passed;
}

static void render_ms(AudioEngine& engine, int milliseconds) {
    float output[384];
    for (int i = 0; i < milliseconds; i += 4) engine.render_samples(output, 192);
}

static void reset_synth_channels(tsf* synth) {
    if (!synth) return;
    for (int ch = 0; ch < 16; ++ch) tsf_channel_sounds_off_all(synth, ch);
    for (int i = 0; i < synth->voiceNum; ++i) synth->voices[i].playingPreset = -1;
    for (int ch = 0; ch < 16; ++ch) {
        tsf_channel_midi_control(synth, ch, 121, 0);
        tsf_channel_set_bank(synth, ch, (ch == 9 ? 128 : 0));
        tsf_channel_set_presetnumber(synth, ch, 0, (ch == 9));
        tsf_channel_set_sustain(synth, ch, 0);
        tsf_channel_set_pitchwheel(synth, ch, 8192);
        tsf_channel_set_pan(synth, ch, 0.5f);
        tsf_channel_midi_control(synth, ch, 1, 0);
        tsf_channel_midi_control(synth, ch, 7, 100);
        tsf_channel_midi_control(synth, ch, 39, 127);
        tsf_channel_midi_control(synth, ch, 10, 64);
        tsf_channel_midi_control(synth, ch, 42, 0);
        tsf_channel_midi_control(synth, ch, 11, 127);
        tsf_channel_midi_control(synth, ch, 64, 0);
        tsf_channel_set_tuning(synth, ch, 0.0f);
    }
}

static bool controller_check(AudioEngine& engine) {
    auto* tsf_eng = dynamic_cast<TsfEngine*>(engine.synth_.get());
    if (!tsf_eng) return false;
    auto* tsf_synth = tsf_eng->get_tsf();
    if (!tsf_synth) return false;

    ParsedSong song;
    song.total_time_ms = 1000;
    song.events = {
        {0, 0, 0xC0, 0, 33, 0},
        {0, 0, 0xB0, 0, 7, 80}, {0, 0, 0xB0, 0, 39, 17},
        {0, 0, 0xB0, 0, 11, 110},
        {0, 0, 0xB0, 0, 10, 20}, {0, 0, 0xB0, 0, 42, 31},
        {0, 0, 0xB0, 0, 64, 127}, {0, 0, 0xE0, 0, 0, 96},
        {10, 20, 0xB0, 0, 121, 0},
        {10, 20, 0xB0, 9, 121, 0},
        {20, 40, 0xB0, 0, 11, 110},
    };
    engine.begin_preparation(1);
    if (!engine.prepare_song(song, 1, 1)) return false;
    engine.set_key_offset(3);
    engine.play();
    render_ms(engine, 8);
    auto& before = tsf_synth->channels->channels[0];
    const float initial_gain = tsf_channel_get_volume(tsf_synth, 0);
    const auto initial_bank = before.bank, initial_preset = before.presetIndex;
    render_ms(engine, 20);
    auto& reset = tsf_synth->channels->channels[0];
    bool ok = check(reset.midiVolume == 10257 && reset.midiPan == 2591,
                    "CC121 preserves 14-bit channel volume and pan");
    ok &= check(reset.midiExpression == 16383 && reset.sustain == 0 && reset.pitchWheel == 8192,
                "CC121 resets expression, sustain and pitch wheel");
    ok &= check(reset.bank == initial_bank && reset.presetIndex == initial_preset && reset.tuning == 3,
                "CC121 preserves instrument and app key offset");
    ok &= check(tsf_synth->presets[tsf_synth->channels->channels[9].presetIndex].bank == 128,
                "CC121 preserves percussion preset");
    render_ms(engine, 20);
    ok &= check(std::abs(tsf_channel_get_volume(tsf_synth, 0) - initial_gain) < 0.00001f,
                "later expression event cannot overwrite channel mix with full volume");
    engine.stop();
    ok &= check(tsf_synth->channels->channels[0].midiVolume == ((100 << 7) | 127) &&
                tsf_synth->channels->channels[0].midiPan == (64 << 7),
                "full song reset clears low-bit volume and pan from previous song");
    return ok;
}

static ParsedSong sustained_note(int volume, bool loud = false) {
    ParsedSong song;
    song.total_time_ms = 4000;
    song.events = {{0, 0, 0xC0, 0, 19, 0}, {0, 0, 0xB0, 0, 7, static_cast<uint8_t>(volume)}};
    for (int key = 48; key <= (loud ? 84 : 48); key += 4) {
        song.events.push_back({0, 0, 0x90, 0, static_cast<uint8_t>(key), 100});
    }
    return song;
}

static bool dynamics_check(AudioEngine& engine) {
    auto song = sustained_note(60);
    engine.begin_preparation(2);
    if (!engine.prepare_song(song, 1, 2)) return false;
    auto* tsf_eng = dynamic_cast<TsfEngine*>(engine.synth_.get());
    if (!tsf_eng) return false;
    tsf* reference = tsf_copy(tsf_eng->get_tsf());
    if (!reference || !tsf_set_max_voices(reference, 64)) return false;
    reset_synth_channels(reference);
    tsf_channel_set_presetnumber(reference, 0, 19, 0);
    tsf_channel_midi_control(reference, 0, 7, 60);
    tsf_channel_note_on(reference, 0, 48, 100 / 127.0f);
    engine.play();
    float output[384], raw[384];
    double input_power = 0, output_power = 0;
    for (int block = 0; block < 500; ++block) {
        engine.render_samples(output, 192);
        tsf_render_float(reference, raw, 192, 0);
        if (block >= 250) for (int i = 0; i < 384; ++i) {
            input_power += raw[i] * raw[i];
            output_power += output[i] * output[i];
        }
    }
    tsf_close(reference);
    const double gain_db = 10 * std::log10(output_power / input_power);
    std::cout << "Quiet sustained-note boost: " << gain_db << " dB\n";
    bool ok = check(gain_db >= 5.0 && gain_db <= 10.0,
                    "quiet passage receives bounded audible gain instead of attenuation");
    song = sustained_note(127, true);
    engine.begin_preparation(3);
    if (!engine.prepare_song(song, 2, 3)) return false;
    engine.play();
    float peak = 0;
    bool finite = true;
    for (int block = 0; block < 500; ++block) {
        engine.render_samples(output, 192);
        for (float value : output) {
            finite &= std::isfinite(value);
            peak = std::max(peak, std::abs(value));
        }
    }
    std::cout << "Loud chord sample peak: " << peak << '\n';
    ok &= check(finite && peak <= 0.750f && peak > 0.1f,
                "dense chord stays finite below headroom ceiling without muting");
    engine.pause();
    engine.render_samples(output, 192);
    ok &= check(std::all_of(std::begin(output), std::end(output), [](float x) { return x == 0; }),
                "pause remains completely silent");
    engine.stop();
    return ok;
}

static bool output_edge_check(AudioEngine& engine) {
    bool ok = check(!engine.initialize(0) && !engine.initialize(-1), "invalid sample rate rejected");
    for (int rate : {44100, 48000, 96000}) {
        if (!engine.initialize(rate)) return false;
        auto song = sustained_note(127, true);
        engine.begin_preparation(1);
        if (!engine.prepare_song(song, 1, 1)) return false;
        std::vector<float> full(4096), split;
        for (size_t i = 0; i < full.size(); i += 2) {
            full[i] = 2.0f * std::sin(float(i) * 0.07f);
            full[i + 1] = full[i] * 0.25f;
        }
        split = full;
        engine.process_output(full.data(), 2048);
        ok &= check(std::all_of(full.begin(), full.end(), [](float x) { return std::isfinite(x) && std::abs(x) <= 0.750f; }),
                    "overshoots remain below ceiling at supported sample rates");
        bool linked = true;
        for (size_t i = 0; i < full.size(); i += 2) linked &= std::abs(full[i + 1] - full[i] * 0.25f) < 0.000001f;
        ok &= check(linked, "stereo channels share gain without moving stereo image");
        engine.stop();
        for (int frame = 0; frame < 2048; frame += 128) engine.process_output(split.data() + frame * 2, 128);
        ok &= check(full == split, "processing independent of callback block size and reset starts fresh");
        float invalid[] = {std::numeric_limits<float>::quiet_NaN(), 1.0f,
                           1.0f, std::numeric_limits<float>::infinity(), 0.0f, 0.0f, 0.1f, 0.05f};
        engine.process_output(invalid, 4);
        ok &= check(invalid[0] == 0 && invalid[1] == 0 && invalid[2] == 0 && invalid[3] == 0 &&
                    invalid[4] == 0 && invalid[5] == 0 && std::isfinite(invalid[6]) && invalid[6] > 0,
                    "nonfinite input muted; silence preserved; following samples recover");

        // U08 check: master gain scales final output linearly after limiter/compressor
        std::vector<float> gain_test_100(256, 0.4f);
        std::vector<float> gain_test_50(256, 0.4f);
        std::vector<float> gain_test_0(256, 0.4f);

        engine.stop();
        engine.set_master_gain(1.0f);
        engine.process_output(gain_test_100.data(), 128);

        engine.stop();
        engine.set_master_gain(0.5f);
        engine.process_output(gain_test_50.data(), 128);

        engine.stop();
        engine.set_master_gain(0.0f);
        engine.process_output(gain_test_0.data(), 128);

        bool zero_silent = std::all_of(gain_test_0.begin(), gain_test_0.end(), [](float x) { return x == 0.0f; });
        ok &= check(zero_silent, "U08: 0.0 master gain completely silences output after limiter");

        // Check proportionality at tail of buffer
        float val100 = std::abs(gain_test_100[250]);
        float val50 = std::abs(gain_test_50[250]);
        ok &= check(std::abs(val50 - val100 * 0.5f) < 0.0001f, "U08: master gain scales output level linearly without compression countering");
        engine.set_master_gain(1.0f);
        engine.stop();
    }
    return ok;
}

static double tone_gain(AudioEngine& engine, int rate, int frequency) {
    engine.initialize(rate);
    engine.stop();
    std::vector<float> tone(rate * 2);
    for (int frame = 0; frame < rate; ++frame) {
        tone[frame * 2] = 0.001f * std::sin(2.0 * std::acos(-1.0) * frequency * frame / rate);
    }
    engine.process_output(tone.data(), rate);
    double power = 0;
    for (int frame = rate / 2; frame < rate; ++frame) {
        power += double(tone[frame * 2]) * tone[frame * 2];
    }
    bool isolated = true;
    for (int frame = 0; frame < rate; ++frame) isolated &= tone[frame * 2 + 1] == 0;
    if (!isolated) return std::numeric_limits<double>::quiet_NaN();
    return 10 * std::log10(power / (rate - rate / 2) / 0.0000005);
}

static bool bass_check(AudioEngine& engine) {
    bool ok = check(!engine.initialize(240), "bass shelf rejects sample rate at or below its Nyquist limit");
    for (int rate : {44100, 48000, 96000}) {
        double low = tone_gain(engine, rate, 50);
        double pivot = tone_gain(engine, rate, 120);
        double high = tone_gain(engine, rate, 4000);
        std::cout << "Tone gains at " << rate << " Hz: " << low << ", " << pivot << ", " << high << " dB\n";
        ok &= check(low - high > 1.5 && low - high < 2.1, "gentle bass lift without channel crosstalk");
        ok &= check(pivot - high > 0.8 && pivot - high < 1.2, "bass shelf transition stays near 120 Hz");
        ok &= check(std::abs(high - 9.0) < 0.05, "mid/high gain unchanged by bass shelf");
        engine.pause();
        engine.play();
        float silence[384] = {};
        engine.process_output(silence, 192);
        ok &= check(std::all_of(std::begin(silence), std::end(silence), [](float x) { return x == 0; }),
                    "pause clears bass-filter tail before resume");
    }
    return ok;
}

static bool key_shift_preservation_check(AudioEngine& engine) {
    auto* tsf_eng = dynamic_cast<TsfEngine*>(engine.synth_.get());
    if (!tsf_eng) return false;
    tsf* s = tsf_eng->get_tsf();
    if (!s) return false;

    auto song = sustained_note(60);
    engine.begin_preparation(1);
    if (!engine.prepare_song(song, 1, 1)) return false;
    engine.set_key_offset(3);
    engine.play();
    render_ms(engine, 10);
    bool ok = check(s->channels->channels[0].tuning == 3.0f, "key shift applied during playback");
    ok &= check(s->channels->channels[9].tuning == 0.0f, "drum channel 9 remains untransposed");

    engine.stop();
    ok &= check(s->channels->channels[0].tuning == 3.0f, "key shift preserved after stop()");

    engine.play();
    render_ms(engine, 10);
    ok &= check(s->channels->channels[0].tuning == 3.0f, "key shift preserved after resume play()");

    engine.synth_->reset();
    ok &= check(s->channels->channels[0].tuning == 3.0f, "key shift re-applied after synth reset");

    auto next_song = sustained_note(62);
    engine.begin_preparation(2);
    engine.prepare_song(next_song, 2, 2);
    render_ms(engine, 10);
    ok &= check(s->channels->channels[0].tuning == 0.0f, "fresh song resets key shift to 0 semitones");
    return ok;
}

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    auto& engine = AudioEngine::instance();
    engine.set_synth_engine(std::make_unique<TsfEngine>());
    if (!engine.initialize(48000) || !engine.load_soundfont_file(argv[1])) return 3;
    bool ok = controller_check(engine);
    ok &= dynamics_check(engine);
    ok &= key_shift_preservation_check(engine);
    ok &= output_edge_check(engine);
    ok &= bass_check(engine);
    return ok ? 0 : 1;
}

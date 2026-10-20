#include <cassert>
#include <iostream>
#include "fluidsynth_engine.hpp"
#include <fluidsynth.h>

using namespace kantahulay;

int main() {
    std::cout << "Testing FluidSynthEngine channel group isolation (TDD)..." << std::endl;
    FluidSynthEngine engine;
    assert(engine.init(48000));

    auto* synth = engine.get_synth();
    assert(synth != nullptr);

    // Initial check: all 16 channels must be configured as independent basic channels
    engine.reset_channels();
    for (int ch = 0; ch < 16; ++ch) {
        int basic = -1, mode = -1, val = -1;
        assert(fluid_synth_get_basic_channel(synth, ch, &basic, &mode, &val) == FLUID_OK);
        assert(basic == ch && "Each channel must be its own basic channel");
        assert(mode == FLUID_CHANNEL_MODE_OMNIOFF_POLY);
        assert(val == 1 && "Each channel group must have size 1");
    }
    std::cout << "  Passed: All 16 channels initialized as independent OMNIOFF_POLY groups." << std::endl;

    // Simulate Bakit: channel 0 receives CC 124 (Omni Off) and CC 127 (Poly On)
    engine.cc(0, 124, 0);
    engine.cc(0, 127, 0);

    // In stock FluidSynth, CC 124 on ch 0 shrinks the group to 1 channel, disabling channels 1..15!
    // With our fix, channels 1..15 MUST remain enabled and sound notes.
    for (int ch = 0; ch < 16; ++ch) {
        int basic = -1, mode = -1, val = -1;
        assert(fluid_synth_get_basic_channel(synth, ch, &basic, &mode, &val) == FLUID_OK);
        assert(basic >= 0 && "Channel must not be disabled by CC 124 on channel 0");
    }
    std::cout << "  Passed: Sibling channels not disabled after CC 124 on channel 0." << std::endl;

    // Cross-song leakage test: reset_channels() must fully restore all channel groups
    engine.reset_channels();
    for (int ch = 0; ch < 16; ++ch) {
        int basic = -1, mode = -1, val = -1;
        assert(fluid_synth_get_basic_channel(synth, ch, &basic, &mode, &val) == FLUID_OK);
        assert(basic == ch);
        assert(val == 1);
    }
    std::cout << "  Passed: reset_channels() completely clears any previous mode/group modifications." << std::endl;

    std::cout << "ALL FLUIDSYNTH CHANNEL GROUP REGRESSION TESTS PASSED!" << std::endl;
    return 0;
}

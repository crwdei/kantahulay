cmake_minimum_required(VERSION 3.22.1)
project(kantahulay_audio)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_compile_options(-Wall -Wextra)

find_package(oboe REQUIRED CONFIG)

option(KANTAHULAY_USE_FLUIDSYNTH "Use FluidSynth synthesizer instead of TinySoundFont" ON)

set(AUDIO_SOURCES
    midi_parser.cpp
    pack_reader.cpp
    audio_engine.cpp
    audio_out_oboe.cpp
    jni_bridge.cpp
    tsf_engine.cpp
)

set(AUDIO_LIBS
    oboe::oboe
    z
    log
)

if(KANTAHULAY_USE_FLUIDSYNTH)
    add_compile_definitions(KANTAHULAY_USE_FLUIDSYNTH=1)
    list(APPEND AUDIO_SOURCES fluidsynth_engine.cpp)
    
    add_library(fluidsynth SHARED IMPORTED)
    set_target_properties(fluidsynth PROPERTIES
        IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libfluidsynth.so"
        INTERFACE_INCLUDE_DIRECTORIES "${CMAKE_CURRENT_SOURCE_DIR}/fluidsynth/include"
    )
    list(APPEND AUDIO_LIBS fluidsynth)
endif()

add_library(kantahulay_audio SHARED ${AUDIO_SOURCES})

target_include_directories(kantahulay_audio PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/fluidsynth/include
)

target_link_libraries(kantahulay_audio PRIVATE ${AUDIO_LIBS})

# Android 16KB page-size alignment
target_link_options(kantahulay_audio PRIVATE "-Wl,-z,max-page-size=16384")

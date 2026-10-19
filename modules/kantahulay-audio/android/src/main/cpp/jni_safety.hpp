#pragma once

#include <android/log.h>
#include <jni.h>
#include <exception>
#include <limits>
#include <new>
#include <string>
#include <string_view>
#include <vector>

namespace kantahulay::jni {

inline void log_failure(const char* operation, const char* reason) noexcept {
    __android_log_print(ANDROID_LOG_ERROR, "KantahulayJNI", "%s: %s", operation, reason);
}

inline bool ready(JNIEnv* env, const char* operation) noexcept {
    if (!env) {
        log_failure(operation, "null JNIEnv");
        return false;
    }
    if (env->ExceptionCheck()) {
        log_failure(operation, "pending Java exception");
        return false;
    }
    return true;
}

template <typename T, typename Work>
T guard(JNIEnv* env, const char* operation, T fallback, Work&& work) noexcept {
    try {
        if (!ready(env, operation)) return fallback;
        T result = work();
        return env->ExceptionCheck() ? fallback : result;
    } catch (const std::bad_alloc&) {
        log_failure(operation, "C++ allocation failed");
    } catch (const std::exception& error) {
        __android_log_print(ANDROID_LOG_ERROR, "KantahulayJNI", "%s: C++ exception: %s",
                            operation, error.what());
    } catch (...) {
        log_failure(operation, "unknown C++ exception");
    }
    // Preserve pending Java exceptions; never allocate/throw from an error handler.
    return fallback;
}

template <typename Work>
void guard(JNIEnv* env, const char* operation, Work&& work) noexcept {
    guard<bool>(env, operation, false, [&] { work(); return true; });
}

// Bounded UTF-8 to UTF-16 transcoder replacing malformed sequences with U+FFFD.
inline std::u16string utf8_to_utf16_lossy(std::string_view utf8) {
    std::u16string out;
    out.reserve(utf8.size());
    size_t i = 0;
    while (i < utf8.size()) {
        unsigned char c0 = static_cast<unsigned char>(utf8[i]);
        if (c0 < 0x80) {
            out.push_back(static_cast<char16_t>(c0));
            ++i;
            continue;
        }
        if ((c0 & 0xE0) == 0xC0) {
            if (i + 1 < utf8.size()) {
                unsigned char c1 = static_cast<unsigned char>(utf8[i + 1]);
                if ((c1 & 0xC0) == 0x80) {
                    uint32_t cp = ((c0 & 0x1F) << 6) | (c1 & 0x3F);
                    if (cp >= 0x80) {
                        out.push_back(static_cast<char16_t>(cp));
                        i += 2;
                        continue;
                    }
                }
            }
        } else if ((c0 & 0xF0) == 0xE0) {
            if (i + 2 < utf8.size()) {
                unsigned char c1 = static_cast<unsigned char>(utf8[i + 1]);
                unsigned char c2 = static_cast<unsigned char>(utf8[i + 2]);
                if ((c1 & 0xC0) == 0x80 && (c2 & 0xC0) == 0x80) {
                    uint32_t cp = ((c0 & 0x0F) << 12) | ((c1 & 0x3F) << 6) | (c2 & 0x3F);
                    if (cp >= 0x800 && (cp < 0xD800 || cp > 0xDFFF)) {
                        out.push_back(static_cast<char16_t>(cp));
                        i += 3;
                        continue;
                    }
                }
            }
        } else if ((c0 & 0xF8) == 0xF0) {
            if (i + 3 < utf8.size()) {
                unsigned char c1 = static_cast<unsigned char>(utf8[i + 1]);
                unsigned char c2 = static_cast<unsigned char>(utf8[i + 2]);
                unsigned char c3 = static_cast<unsigned char>(utf8[i + 3]);
                if ((c1 & 0xC0) == 0x80 && (c2 & 0xC0) == 0x80 && (c3 & 0xC0) == 0x80) {
                    uint32_t cp = ((c0 & 0x07) << 18) | ((c1 & 0x3F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
                    if (cp >= 0x10000 && cp <= 0x10FFFF) {
                        cp -= 0x10000;
                        out.push_back(static_cast<char16_t>(0xD800 + (cp >> 10)));
                        out.push_back(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
                        i += 4;
                        continue;
                    }
                }
            }
        }
        out.push_back(u'\uFFFD');
        ++i;
    }
    return out;
}

inline jstring make_jstring_utf16(JNIEnv* env, std::string_view utf8, const char* operation) {
    if (!ready(env, operation)) return nullptr;
    std::u16string utf16 = utf8_to_utf16_lossy(utf8);
    if (utf16.size() > static_cast<size_t>(std::numeric_limits<jsize>::max())) {
        log_failure(operation, "string length exceeds JNI jsize limit");
        return nullptr;
    }
    jstring res = env->NewString(reinterpret_cast<const jchar*>(utf16.data()),
                                 static_cast<jsize>(utf16.size()));
    if (!res || env->ExceptionCheck()) {
        log_failure(operation, "NewString allocation failed");
        return nullptr;
    }
    return res;
}

class UtfChars {
public:
    UtfChars(JNIEnv* env, jstring value, const char* operation) : env_(env), value_(value) {
        if (!ready(env, operation)) return;
        if (!value) {
            log_failure(operation, "null string");
            return;
        }
        chars_ = env->GetStringUTFChars(value, nullptr);
        if (!chars_ || env->ExceptionCheck()) {
            log_failure(operation, "string acquisition failed");
            return;
        }
        valid_ = true;
    }
    ~UtfChars() {
        // ReleaseStringUTFChars is permitted with a pending Java exception.
        if (chars_) env_->ReleaseStringUTFChars(value_, chars_);
    }
    UtfChars(const UtfChars&) = delete;
    UtfChars& operator=(const UtfChars&) = delete;
    explicit operator bool() const { return valid_; }
    const char* get() const { return chars_; }

private:
    JNIEnv* env_;
    jstring value_;
    const char* chars_ = nullptr;
    bool valid_ = false;
};

} // namespace kantahulay::jni

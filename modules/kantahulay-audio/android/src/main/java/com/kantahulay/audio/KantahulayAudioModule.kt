package com.kantahulay.audio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KantahulayAudioModule : Module() {
  companion object {
    init {
      try {
        System.loadLibrary("fluidsynth")
      } catch (e: UnsatisfiedLinkError) {
        // Handled when running in TSF-only or mock/host environment
      }
      try {
        System.loadLibrary("kantahulay_audio")
      } catch (e: UnsatisfiedLinkError) {
        // Handled when running in mock/host environment
      }
    }
  }

  private var audioManager: AudioManager? = null
  private var focusRequest: AudioFocusRequest? = null
  private var focusLostTransientCanDuck = false
  private var focusLostCallOrPermanent = false

  private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    when (focusChange) {
      AudioManager.AUDIOFOCUS_LOSS -> {
        focusLostCallOrPermanent = true
        focusLostTransientCanDuck = false
        nativePause()
        this@KantahulayAudioModule.sendEvent("onAudioFocusChanged", mapOf("event" to "LOSS", "action" to "PAUSE"))
      }
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
        focusLostCallOrPermanent = true
        focusLostTransientCanDuck = false
        nativePause()
        this@KantahulayAudioModule.sendEvent("onAudioFocusChanged", mapOf("event" to "LOSS_TRANSIENT", "action" to "PAUSE"))
      }
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        focusLostTransientCanDuck = true
        nativePause()
        this@KantahulayAudioModule.sendEvent("onAudioFocusChanged", mapOf("event" to "LOSS_TRANSIENT_CAN_DUCK", "action" to "DUCK"))
      }
      AudioManager.AUDIOFOCUS_GAIN -> {
        if (focusLostTransientCanDuck) {
          focusLostTransientCanDuck = false
          nativePlay()
          this@KantahulayAudioModule.sendEvent("onAudioFocusChanged", mapOf("event" to "GAIN", "action" to "RESUME"))
        } else {
          // Do NOT auto-resume after a phone call or permanent focus loss. User must press play.
          focusLostCallOrPermanent = false
          this@KantahulayAudioModule.sendEvent("onAudioFocusChanged", mapOf("event" to "GAIN", "action" to "STAY_PAUSED"))
        }
      }
    }
  }

  private var noisyReceiverRegistered = false
  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      when (intent?.action) {
        AudioManager.ACTION_AUDIO_BECOMING_NOISY -> {
          nativePause()
          this@KantahulayAudioModule.sendEvent("onAudioBecomingNoisy", mapOf("action" to "PAUSE"))
        }
        Intent.ACTION_SCREEN_OFF -> {
          nativePause()
          this@KantahulayAudioModule.sendEvent("onAudioFocusChanged", mapOf("event" to "SCREEN_OFF", "action" to "PAUSE"))
        }
      }
    }
  }

  private fun registerNoisyReceiver() {
    val context = appContext.reactContext ?: return
    if (!noisyReceiverRegistered) {
      val filter = IntentFilter().apply {
        addAction(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
        addAction(Intent.ACTION_SCREEN_OFF)
      }
      context.registerReceiver(noisyReceiver, filter)
      noisyReceiverRegistered = true
    }
  }

  private fun unregisterNoisyReceiver() {
    val context = appContext.reactContext ?: return
    if (noisyReceiverRegistered) {
      try {
        context.unregisterReceiver(noisyReceiver)
      } catch (e: Exception) {
        // Ignored if already unregistered
      }
      noisyReceiverRegistered = false
    }
  }

  private fun requestAudioFocus(): Boolean {
    val context = appContext.reactContext ?: return true
    val am = audioManager ?: (context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager).also {
      audioManager = it
    } ?: return true

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val req = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        )
        .setOnAudioFocusChangeListener(focusChangeListener)
        .build().also { focusRequest = it }
      am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(
        focusChangeListener,
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN
      ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
  }

  private fun abandonAudioFocus() {
    val am = audioManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { am.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      am.abandonAudioFocus(focusChangeListener)
    }
  }

  private var isBluetoothActive = false
  private var bluetoothLyricOffsetMs = 0

  private val audioDeviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
      checkAudioRoute()
    }
    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
      checkAudioRoute()
    }
  }

  private fun checkAudioRoute() {
    val context = appContext.reactContext ?: return
    val am = audioManager ?: (context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager).also {
      audioManager = it
    } ?: return

    val devices = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    var btFound = false
    for (dev in devices) {
      val type = dev.type
      if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
          type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
          (Build.VERSION.SDK_INT >= 31 && type == AudioDeviceInfo.TYPE_BLE_HEADSET) ||
          (Build.VERSION.SDK_INT >= 31 && type == AudioDeviceInfo.TYPE_BLE_SPEAKER) ||
          (Build.VERSION.SDK_INT >= 33 && type == AudioDeviceInfo.TYPE_BLE_BROADCAST)) {
        btFound = true
        break
      }
    }
    isBluetoothActive = btFound
    nativeSetBluetoothActive(btFound)
    nativeResetLatencyTracking()
  }

  private external fun nativeInitialize(): Boolean
  private external fun nativeLoadSoundFont(path: String): Boolean
  private external fun nativeBeginPreparation(generation: Int)
  private external fun nativePrepareSong(
    fd: Int,
    assetStartOffset: Long,
    assetLen: Long,
    packOffset: Long,
    packedSize: Int,
    unpackedSize: Int,
    expectedSha256: String,
    reservationId: Long,
    generation: Int
  ): Boolean
  private external fun nativePlay()
  private external fun nativePause()
  private external fun nativeStop()
  private external fun nativeSetKeyOffset(semitones: Int)
  private external fun nativeGetPlaybackState(): Int
  private external fun nativeGetCurrentTimeMs(): Int
  private external fun nativeGetTotalTimeMs(): Int
  private external fun nativeGetLyricsJson(): String
  private external fun nativeIsSongEnded(): Boolean
  private external fun nativeReset()
  private external fun nativeSetEffectsLevel(level: Int)
  private external fun nativeGetEffectsLevel(): Int
  private external fun nativeSetMasterGain(gain: Float)
  private external fun nativeGetMasterGain(): Float
  private external fun nativeSetBluetoothActive(active: Boolean)
  private external fun nativeIsBluetoothActive(): Boolean
  private external fun nativeSetBluetoothLyricOffsetMs(offsetMs: Int)
  private external fun nativeGetBluetoothLyricOffsetMs(): Int
  private external fun nativeResetLatencyTracking()

  override fun definition() = ModuleDefinition {
    Name("KantahulayAudio")
    Events("onAudioFocusChanged", "onAudioBecomingNoisy")

    OnCreate {
      val context = appContext.reactContext
      val am = context?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      audioManager = am
      am?.registerAudioDeviceCallback(audioDeviceCallback, Handler(Looper.getMainLooper()))
      checkAudioRoute()
    }

    OnActivityEntersBackground {
      nativePause()
      this@KantahulayAudioModule.sendEvent("onAudioFocusChanged", mapOf("event" to "BACKGROUND", "action" to "PAUSE"))
    }

    OnDestroy {
      unregisterNoisyReceiver()
      audioManager?.unregisterAudioDeviceCallback(audioDeviceCallback)
    }

    Function("initialize") {
      nativeInitialize()
    }

    Function("loadSoundFont") { path: String ->
      nativeLoadSoundFont(path)
    }

    AsyncFunction("ensureSoundFontLoaded") { promise: expo.modules.kotlin.Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
        val startTime = System.currentTimeMillis()
        val versionedName = "soundfont-gugs-v2.sf2"
        val sfFile = java.io.File(context.filesDir, versionedName)
        val tmpFile = java.io.File(context.filesDir, "$versionedName.tmp")
        val oldFile = java.io.File(context.filesDir, "soundfont.sf2")
        try {
          if (oldFile.exists()) {
            oldFile.delete()
          }

          val assetName = try {
            context.assets.open(versionedName).close()
            versionedName
          } catch (e: Exception) {
            "soundfont.sf2"
          }

          val expectedSize = try {
            var afd: android.content.res.AssetFileDescriptor? = null
            try {
              afd = context.assets.openFd(assetName)
              afd.length
            } finally {
              afd?.close()
            }
          } catch (e: Exception) {
            -1L
          }

          val needsCopy = if (!sfFile.exists()) {
            true
          } else if (expectedSize > 0L) {
            sfFile.length() != expectedSize
          } else {
            sfFile.length() < 1_000_000L
          }

          if (needsCopy) {
            if (tmpFile.exists()) {
              tmpFile.delete()
            }
            var bytesWritten = 0L
            val buffer = ByteArray(65536)
            context.assets.open(assetName).use { input ->
              java.io.FileOutputStream(tmpFile).use { output ->
                var read: Int
                while (input.read(buffer).also { read = it } != -1) {
                  output.write(buffer, 0, read)
                  bytesWritten += read
                }
                output.flush()
              }
            }

            if (expectedSize > 0L && bytesWritten != expectedSize) {
              tmpFile.delete()
              promise.resolve(false)
              return@launch
            }
            if (bytesWritten < 1_000_000L) {
              tmpFile.delete()
              promise.resolve(false)
              return@launch
            }

            if (sfFile.exists()) {
              sfFile.delete()
            }
            val renamed = tmpFile.renameTo(sfFile)
            if (!renamed) {
              tmpFile.inputStream().use { inStream ->
                sfFile.outputStream().use { outStream ->
                  inStream.copyTo(outStream)
                }
              }
              tmpFile.delete()
            }
            val elapsed = System.currentTimeMillis() - startTime
            android.util.Log.i("KantahulayAudio", "SoundFont copy completed in ${elapsed}ms")
          }

          nativeLoadSoundFont(sfFile.absolutePath)
          promise.resolve(true)
        } catch (e: Exception) {
          android.util.Log.e("KantahulayAudio", "Failed to load soundfont", e)
          if (tmpFile.exists()) {
            tmpFile.delete()
          }
          promise.resolve(false)
        }
      }
    }

    Function("beginPreparation") { generation: Int ->
      nativeBeginPreparation(generation)
    }

    AsyncFunction("prepareSong") { params: Map<String, Any?> ->
      val fd = (params["fd"] as Number).toInt()
      val assetStartOffset = (params["assetStartOffset"] as Number).toLong()
      val assetLen = (params["assetLen"] as Number).toLong()
      val packOffset = (params["packOffset"] as Number).toLong()
      val packedSize = (params["packedSize"] as Number).toInt()
      val unpackedSize = (params["unpackedSize"] as Number).toInt()
      val expectedSha256 = params["expectedSha256"] as String
      val reservationId = (params["reservationId"] as Number).toLong()
      val generation = (params["generation"] as Number).toInt()

      nativePrepareSong(
        fd,
        assetStartOffset,
        assetLen,
        packOffset,
        packedSize,
        unpackedSize,
        expectedSha256,
        reservationId,
        generation
      )
    }

    Function("play") {
      requestAudioFocus()
      registerNoisyReceiver()
      nativePlay()
    }

    Function("pause") {
      unregisterNoisyReceiver()
      nativePause()
    }

    Function("stop") {
      abandonAudioFocus()
      unregisterNoisyReceiver()
      nativeStop()
    }

    Function("setKeyOffset") { semitones: Int ->
      nativeSetKeyOffset(semitones)
    }

    Function("getPlaybackState") {
      nativeGetPlaybackState()
    }

    Function("getCurrentTimeMs") {
      nativeGetCurrentTimeMs()
    }

    Function("getTotalTimeMs") {
      nativeGetTotalTimeMs()
    }

    Function("getLyricsJson") {
      nativeGetLyricsJson()
    }

    Function("isSongEnded") {
      nativeIsSongEnded()
    }

    Function("reset") {
      abandonAudioFocus()
      unregisterNoisyReceiver()
      nativeReset()
    }

    Function("setKeepScreenOn") { keepOn: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        if (keepOn) {
          activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
      }
    }

    Function("setEffectsLevel") { level: Int ->
      nativeSetEffectsLevel(level)
    }

    Function("getEffectsLevel") {
      nativeGetEffectsLevel()
    }

    Function("setMasterGain") { gain: Double ->
      nativeSetMasterGain(gain.toFloat())
    }

    Function("getMasterGain") {
      nativeGetMasterGain().toDouble()
    }

    Function("setBluetoothLyricOffset") { offsetMs: Int ->
      bluetoothLyricOffsetMs = offsetMs
      nativeSetBluetoothLyricOffsetMs(offsetMs)
    }

    Function("getBluetoothLyricOffset") {
      nativeGetBluetoothLyricOffsetMs()
    }

    Function("isBluetoothActive") {
      checkAudioRoute()
      nativeIsBluetoothActive()
    }
  }
}

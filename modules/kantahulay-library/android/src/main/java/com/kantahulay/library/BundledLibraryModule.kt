package com.kantahulay.library

import android.content.pm.ActivityInfo
import android.content.res.AssetFileDescriptor
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

class BundledLibraryModule : Module() {
  private var currentAfd: AssetFileDescriptor? = null

  override fun definition() = ModuleDefinition {
    Name("KantahulayLibrary")

    Function("openPackFd") {
      val context = appContext.reactContext ?: return@Function null
      try {
        currentAfd?.close()
        val afd = context.assets.openFd("songs.kpak")
        currentAfd = afd
        mapOf(
          "fd" to afd.parcelFileDescriptor.fd,
          "startOffset" to afd.startOffset.toDouble(),
          "length" to afd.length.toDouble()
        )
      } catch (e: Exception) {
        null
      }
    }

    Function("closePackFd") {
      try {
        currentAfd?.close()
        currentAfd = null
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("readManifest") {
      val context = appContext.reactContext ?: return@Function null
      try {
        context.assets.open("bundle_manifest.json").bufferedReader().use { it.readText() }
      } catch (e: Exception) {
        null
      }
    }

    AsyncFunction("copyCatalogToTemp") { destPath: String ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      try {
        val destFile = File(destPath)
        destFile.parentFile?.mkdirs()
        if (destFile.exists()) {
          destFile.delete()
        }
        context.assets.open("catalog.sqlite").use { input ->
          FileOutputStream(destFile).use { output ->
            input.copyTo(output)
          }
        }
        true
      } catch (e: Exception) {
        false
      }
    }

    AsyncFunction("extractCatalogToCache") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      try {
        val destFile = File(context.cacheDir, "bundled_catalog.sqlite")
        destFile.parentFile?.mkdirs()
        context.assets.open("catalog.sqlite").use { input ->
          FileOutputStream(destFile).use { output ->
            input.copyTo(output)
          }
        }
        destFile.absolutePath
      } catch (e: Exception) {
        null
      }
    }

    Function("setScreenOrientation") { orientation: String ->
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread {
        when (orientation) {
          "landscape" -> activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
          "portrait" -> activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
          else -> activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
      }
      true
    }
    OnDestroy {
      try {
        currentAfd?.close()
        currentAfd = null
      } catch (_e: Exception) {}
    }
  }
}

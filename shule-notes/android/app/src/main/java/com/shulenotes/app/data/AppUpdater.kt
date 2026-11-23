package com.shulenotes.app.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import com.shulenotes.app.BuildConfig
import com.shulenotes.app.ShuleApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

// Where an in-app update has got to.
sealed class UpdateState {
    object Idle : UpdateState()
    data class Downloading(val percent: Int) : UpdateState()
    object ReadyToInstall : UpdateState()
    object NeedsPermission : UpdateState()
    data class Failed(val message: String) : UpdateState()
}

// Updates the app from inside the app: downloads the newest APK from the owner's server (with a progress bar),
// checks that it really is a newer Shule Notes, and hands it to Android's own installer. Android still asks the
// student to tap "Install", and only accepts it if it is signed with the same key as the installed app, so a
// wrong or tampered file cannot replace the app.
object AppUpdater {
    var state by mutableStateOf<UpdateState>(UpdateState.Idle)
        private set

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    val apkUrl: String get() = BuildConfig.API_BASE_URL.trimEnd('/') + "/download/shule-notes.apk"

    private fun apkFile(app: Context): File = File(File(app.cacheDir, "updates").apply { mkdirs() }, "shule-notes.apk")

    // From Android 8, an app may install only if the student allowed "install unknown apps" for it (once).
    fun canInstall(app: Context): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || app.packageManager.canRequestPackageInstalls()

    // The student pressed Update (or Install, or Try again).
    fun start(context: Context) {
        val app = context.applicationContext
        if (state is UpdateState.Downloading) return
        if (state is UpdateState.ReadyToInstall && apkFile(app).length() > 0L) {
            install(app)
            return
        }
        if (!canInstall(app)) {
            state = UpdateState.NeedsPermission
            try {
                app.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (e: Exception) {
                // the system settings page could not be opened: the message on screen still says what to do
            }
            return
        }
        ShuleApp.appScope.launch { download(app) }
    }

    // A copy left over from an earlier session is no longer needed once the app has restarted.
    fun cleanup(app: Context) {
        runCatching { apkFile(app).delete() }
    }

    private suspend fun download(app: Context) {
        state = UpdateState.Downloading(0)
        val target = apkFile(app)
        val part = File(target.parentFile, "shule-notes.part")
        try {
            withContext(Dispatchers.IO) {
                part.delete()
                target.delete()
                http.newCall(Request.Builder().url(apkUrl).build()).execute().use { response ->
                    if (!response.isSuccessful) throw IOException("the server answered " + response.code)
                    val body = response.body ?: throw IOException("the server sent nothing")
                    val total = body.contentLength()
                    var done = 0L
                    var lastPercent = -1
                    body.byteStream().use { input ->
                        part.outputStream().use { output ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val read = input.read(buffer)
                                if (read < 0) break
                                output.write(buffer, 0, read)
                                done += read
                                if (total > 0) {
                                    val percent = (done * 100 / total).toInt()
                                    if (percent != lastPercent) {
                                        lastPercent = percent
                                        state = UpdateState.Downloading(percent)
                                    }
                                }
                            }
                        }
                    }
                }
                if (!part.renameTo(target)) throw IOException("could not save the file")
            }
            val problem = problemWith(app, target)
            if (problem != null) {
                target.delete()
                state = UpdateState.Failed(problem)
                return
            }
            state = UpdateState.ReadyToInstall
            install(app)
        } catch (e: IOException) {
            part.delete()
            state = UpdateState.Failed("The download stopped. Check your internet and try again.")
        } catch (e: Exception) {
            part.delete()
            state = UpdateState.Failed("Could not download the update. Please try again.")
        }
    }

    // Is this file really a newer Shule Notes? (null = yes)
    private fun problemWith(app: Context, file: File): String? {
        if (file.length() < 1_000_000L) return "The downloaded file is not complete. Please try again."
        val info = app.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
            ?: return "The downloaded file is not an app. Please try again."
        if (info.packageName != app.packageName) return "That file is not Shule Notes."
        val newCode: Long = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        if (newCode <= BuildConfig.VERSION_CODE.toLong()) return "You already have the newest version."
        return null
    }

    fun install(app: Context) {
        val file = apkFile(app)
        if (!file.exists()) {
            state = UpdateState.Idle
            return
        }
        try {
            val uri = FileProvider.getUriForFile(app, app.packageName + ".updates", file)
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            app.startActivity(intent)
        } catch (e: Exception) {
            state = UpdateState.Failed("Could not open the installer. Please try again.")
        }
    }
}

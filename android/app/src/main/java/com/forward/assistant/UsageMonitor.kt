package com.forward.assistant

import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.os.Process
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private const val USAGE_CHECK_INTERVAL_MS = 5 * 60 * 1000L
private const val USAGE_UPLOAD_INTERVAL_MS = 15 * 60 * 1000L

data class InstalledUsageApp(
    val appName: String,
    val packageName: String
)

data class UsagePackageSummary(
    val appName: String,
    val packageName: String,
    val minutes: Int
)

data class UsageAppSnapshot(
    val appName: String,
    val packageName: String,
    val dailyMinutes: Int,
    val currentSessionMinutes: Int,
    val dailyLimitMinutes: Int,
    val sessionLimitMinutes: Int,
    val isInForeground: Boolean,
    val sessionStartedAt: Long = 0L
)

data class DeviceActivitySnapshot(
    val date: String,
    val firstActiveAt: String,
    val lastActiveAt: String,
    val firstForegroundApp: String,
    val lastForegroundApp: String
)

data class UsageMonitorSnapshot(
    val enabled: Boolean,
    val targetApps: List<UsageAppSnapshot>,
    val autoTopTen: Boolean,
    val topApps: List<UsagePackageSummary>,
    val lastEvent: String,
    val updatedAt: String,
    val deviceActivity: DeviceActivitySnapshot? = null
) {
    private val primary get() = targetApps.firstOrNull()
    val packageName get() = primary?.packageName.orEmpty()
    val appName get() = primary?.appName ?: "未选择关注应用"
    val dailyMinutes get() = primary?.dailyMinutes ?: 0
    val currentSessionMinutes get() = primary?.currentSessionMinutes ?: 0
    val dailyLimitMinutes get() = primary?.dailyLimitMinutes ?: 0
    val sessionLimitMinutes get() = primary?.sessionLimitMinutes ?: 0
    val isInForeground get() = primary?.isInForeground ?: false
}

object UsageMonitorStore {
    private const val PREFS = "usage_monitor"
    private const val KEY_TARGET_PACKAGES = "target_packages"
    private const val KEY_TARGET_NAMES = "target_names"
    private const val KEY_TARGET_USAGE = "target_usage"
    private const val KEY_TOP_APPS = "top_apps"
    private const val KEY_DEVICE_ACTIVITY = "device_activity"
    private const val KEY_AUTO_TOP_TEN = "auto_top_ten"
    // Existing installs keep this target until the user changes the selection.
    private const val DEFAULT_PACKAGE = "com.ss.android.ugc.aweme.lite"
    private const val DEFAULT_APP_NAME = "抖音极速版"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(context: Context): Boolean = prefs(context).getBoolean("enabled", false)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean("enabled", enabled).apply()
    }

    fun targetApps(context: Context): List<InstalledUsageApp> {
        val preferences = prefs(context)
        if (!preferences.contains(KEY_TARGET_PACKAGES)) {
            return listOf(InstalledUsageApp(appName(context), packageName(context)))
        }
        val names = runCatching { JSONObject(preferences.getString(KEY_TARGET_NAMES, "{}") ?: "{}") }.getOrDefault(JSONObject())
        return preferences.getStringSet(KEY_TARGET_PACKAGES, emptySet()).orEmpty()
            .map(String::trim)
            .filter(String::isNotBlank)
            .map { packageName ->
                InstalledUsageApp(
                    names.optString(packageName).trim().ifBlank { packageName },
                    packageName
                )
            }
            .sortedBy { it.appName.lowercase() }
    }

    fun packageName(context: Context): String = prefs(context).getString("package_name", DEFAULT_PACKAGE).orEmpty()

    fun appName(context: Context): String = prefs(context).getString("app_name", DEFAULT_APP_NAME).orEmpty()

    fun saveTarget(context: Context, appName: String, packageName: String) {
        saveTargets(context, listOf(InstalledUsageApp(
            appName.trim().ifBlank { DEFAULT_APP_NAME },
            packageName.trim().ifBlank { DEFAULT_PACKAGE }
        )))
    }

    fun saveTargets(context: Context, apps: Collection<InstalledUsageApp>) {
        val cleaned = apps
            .map { InstalledUsageApp(it.appName.trim().ifBlank { it.packageName }, it.packageName.trim()) }
            .filter { it.packageName.isNotBlank() }
            .distinctBy { it.packageName }
        val names = JSONObject().apply { cleaned.forEach { put(it.packageName, it.appName) } }
        val first = cleaned.firstOrNull()
        prefs(context).edit()
            .putStringSet(KEY_TARGET_PACKAGES, cleaned.map { it.packageName }.toSet())
            .putString(KEY_TARGET_NAMES, names.toString())
            .putString("app_name", first?.appName ?: DEFAULT_APP_NAME)
            .putString("package_name", first?.packageName ?: DEFAULT_PACKAGE)
            .apply()
    }

    fun autoTopTen(context: Context): Boolean = prefs(context).getBoolean(KEY_AUTO_TOP_TEN, true)

    fun saveAutoTopTen(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_AUTO_TOP_TEN, enabled).apply()
    }

    fun dailyLimit(context: Context): Int = prefs(context).getInt("daily_limit", 30)

    fun sessionLimit(context: Context): Int = prefs(context).getInt("session_limit", 20)

    fun saveLimits(context: Context, daily: Int, session: Int) {
        prefs(context).edit()
            .putInt("daily_limit", daily.coerceIn(1, 24 * 60))
            .putInt("session_limit", session.coerceIn(1, 24 * 60))
            .apply()
    }

    fun snapshot(context: Context): UsageMonitorSnapshot {
        val preferences = prefs(context)
        val dailyLimit = dailyLimit(context)
        val sessionLimit = sessionLimit(context)
        val usageByPackage = readTargetUsage(preferences)
        val targets = targetApps(context).map { target ->
            val saved = usageByPackage[target.packageName]
            UsageAppSnapshot(
                appName = target.appName,
                packageName = target.packageName,
                dailyMinutes = saved?.dailyMinutes ?: 0,
                currentSessionMinutes = saved?.currentSessionMinutes ?: 0,
                dailyLimitMinutes = dailyLimit,
                sessionLimitMinutes = sessionLimit,
                isInForeground = saved?.isInForeground ?: false
            )
        }
        return UsageMonitorSnapshot(
            enabled = enabled(context),
            targetApps = targets,
            autoTopTen = autoTopTen(context),
            topApps = readTopApps(preferences),
            lastEvent = preferences.getString("last_event", "").orEmpty(),
            updatedAt = preferences.getString("updated_at", "").orEmpty(),
            deviceActivity = readDeviceActivity(preferences)
        )
    }

    fun saveUsage(context: Context, targetApps: List<UsageAppSnapshot>, topApps: List<UsagePackageSummary>, deviceActivity: DeviceActivitySnapshot?) {
        val targetUsage = JSONArray().apply {
            targetApps.forEach { snapshot ->
                put(JSONObject().apply {
                    put("app", snapshot.appName)
                    put("package_name", snapshot.packageName)
                    put("today_minutes", snapshot.dailyMinutes)
                    put("current_session_minutes", snapshot.currentSessionMinutes)
                    put("in_foreground", snapshot.isInForeground)
                    put("session_started_at", snapshot.sessionStartedAt)
                })
            }
        }
        val topUsage = JSONArray().apply {
            topApps.forEach { app ->
                put(JSONObject().apply {
                    put("app", app.appName)
                    put("package_name", app.packageName)
                    put("today_minutes", app.minutes)
                })
            }
        }
        prefs(context).edit()
            .putString(KEY_TARGET_USAGE, targetUsage.toString())
            .putString(KEY_TOP_APPS, topUsage.toString())
            .putString(KEY_DEVICE_ACTIVITY, deviceActivity?.let { activity -> JSONObject().apply {
                put("date", activity.date); put("first_active_at", activity.firstActiveAt); put("last_active_at", activity.lastActiveAt)
                put("first_foreground_app", activity.firstForegroundApp); put("last_foreground_app", activity.lastForegroundApp)
            }.toString() }.orEmpty())
            .putString("updated_at", LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME))
            .apply()
    }

    fun saveEvent(context: Context, event: String) {
        prefs(context).edit().putString("last_event", event).apply()
    }

    fun shouldSendDailyReminder(context: Context, date: LocalDate, packageName: String): Boolean {
        val key = "daily_reminder_$packageName"
        return prefs(context).getString(key, null) != date.toString()
    }

    fun markDailyReminderSent(context: Context, date: LocalDate, packageName: String) {
        prefs(context).edit().putString("daily_reminder_$packageName", date.toString()).apply()
    }

    fun shouldSendSessionReminder(context: Context, sessionStart: Long, packageName: String): Boolean =
        prefs(context).getLong("session_reminder_$packageName", 0L) != sessionStart

    fun markSessionReminderSent(context: Context, sessionStart: Long, packageName: String) {
        prefs(context).edit().putLong("session_reminder_$packageName", sessionStart).apply()
    }

    fun shouldUpload(context: Context): Boolean {
        val lastAttempt = prefs(context).getLong("usage_upload_attempt", 0L)
        return System.currentTimeMillis() - lastAttempt >= USAGE_UPLOAD_INTERVAL_MS
    }

    fun markUploadAttempt(context: Context) {
        prefs(context).edit().putLong("usage_upload_attempt", System.currentTimeMillis()).apply()
    }

    private fun readTargetUsage(preferences: android.content.SharedPreferences): Map<String, UsageAppSnapshot> {
        val result = mutableMapOf<String, UsageAppSnapshot>()
        val array = runCatching { JSONArray(preferences.getString(KEY_TARGET_USAGE, "[]")) }.getOrDefault(JSONArray())
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val packageName = item.optString("package_name").trim()
            if (packageName.isBlank()) continue
            result[packageName] = UsageAppSnapshot(
                appName = item.optString("app").ifBlank { packageName },
                packageName = packageName,
                dailyMinutes = item.optInt("today_minutes").coerceAtLeast(0),
                currentSessionMinutes = item.optInt("current_session_minutes").coerceAtLeast(0),
                dailyLimitMinutes = 0,
                sessionLimitMinutes = 0,
                isInForeground = item.optBoolean("in_foreground"),
                sessionStartedAt = item.optLong("session_started_at")
            )
        }
        return result
    }

    private fun readTopApps(preferences: android.content.SharedPreferences): List<UsagePackageSummary> {
        val array = runCatching { JSONArray(preferences.getString(KEY_TOP_APPS, "[]")) }.getOrDefault(JSONArray())
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val packageName = item.optString("package_name").trim()
            if (packageName.isBlank()) return@mapNotNull null
            UsagePackageSummary(
                appName = item.optString("app").trim().ifBlank { packageName },
                packageName = packageName,
                minutes = item.optInt("today_minutes").coerceAtLeast(0)
            )
        }
    }

    private fun readDeviceActivity(preferences: android.content.SharedPreferences): DeviceActivitySnapshot? {
        val value = preferences.getString(KEY_DEVICE_ACTIVITY, "").orEmpty()
        if (value.isBlank()) return null
        val item = runCatching { JSONObject(value) }.getOrNull() ?: return null
        val first = item.optString("first_active_at")
        val last = item.optString("last_active_at")
        if (first.isBlank() && last.isBlank()) return null
        return DeviceActivitySnapshot(item.optString("date", LocalDate.now().toString()), first, last, item.optString("first_foreground_app"), item.optString("last_foreground_app"))
    }
}

object UsageMonitorPermissions {
    fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(AppOpsManager::class.java)
        val mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.packageName
        )
        return mode == AppOpsManager.MODE_ALLOWED
    }
}

fun installedUsageApps(context: Context): List<InstalledUsageApp> {
    val packageManager = context.packageManager
    return packageManager.getInstalledApplications(PackageManager.GET_META_DATA)
        .asSequence()
        .filter { application ->
            application.packageName != context.packageName &&
                application.flags and ApplicationInfo.FLAG_SYSTEM == 0 &&
                packageManager.getLaunchIntentForPackage(application.packageName) != null
        }
        .map { application ->
            InstalledUsageApp(
                application.loadLabel(packageManager).toString().trim().ifBlank { application.packageName },
                application.packageName
            )
        }
        .distinctBy { it.packageName }
        .sortedBy { it.appName.lowercase() }
        .toList()
}

class UsageMonitorBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!UsageMonitorStore.enabled(context) || !UsageMonitorPermissions.hasUsageAccess(context)) return
        ContextCompat.startForegroundService(context, Intent(context, UsageMonitorService::class.java))
    }
}

private data class UsageCalculation(
    val packageName: String,
    val appName: String,
    var sessionStart: Long = 0L,
    var totalMillis: Long = 0L,
    var inForeground: Boolean = false
)

class UsageMonitorService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var monitorJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        createUsageChannel()
        startForeground(UsageMonitorNotification.ONGOING_ID, buildOngoingNotification())
        monitorJob = serviceScope.launch { monitorLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!UsageMonitorStore.enabled(this)) stopSelf()
        else startForeground(UsageMonitorNotification.ONGOING_ID, buildOngoingNotification())
        return START_STICKY
    }

    override fun onDestroy() {
        monitorJob?.cancel()
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun monitorLoop() {
        while (serviceScope.isActive) {
            runCatching { updateUsage() }
            delay(USAGE_CHECK_INTERVAL_MS)
        }
    }

    private suspend fun updateUsage() {
        val now = System.currentTimeMillis()
        val startOfDay = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val usageManager = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val targetApps = UsageMonitorStore.targetApps(this)
        val targetSnapshots = calculateTargetUsage(usageManager, targetApps, startOfDay, now)
        val installed = installedUsageApps(this).associateBy { it.packageName }
        val topApps = if (UsageMonitorStore.autoTopTen(this)) calculateTopApps(usageManager, startOfDay, now, installed) else emptyList()
        val deviceActivity = calculateDeviceActivity(usageManager, startOfDay, now, installed)
        UsageMonitorStore.saveUsage(this, targetSnapshots, topApps, deviceActivity)
        val snapshot = UsageMonitorStore.snapshot(this)
        if (UsageMonitorStore.shouldUpload(this)) uploadUsage(snapshot)
        sendTargetReminders(targetSnapshots)
    }

    private fun calculateTargetUsage(
        usageManager: UsageStatsManager,
        targetApps: List<InstalledUsageApp>,
        startOfDay: Long,
        now: Long
    ): List<UsageAppSnapshot> {
        if (targetApps.isEmpty()) return emptyList()
        val calculations = targetApps.associate { it.packageName to UsageCalculation(it.packageName, it.appName) }.toMutableMap()
        // Read one extra day so an app left open across midnight still has a valid session start.
        val events = usageManager.queryEvents(startOfDay - 24 * 60 * 60 * 1000L, now)
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val calculation = calculations[event.packageName] ?: continue
            when (event.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> if (!calculation.inForeground) {
                    calculation.sessionStart = event.timeStamp
                    calculation.inForeground = true
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND -> if (calculation.inForeground) {
                    calculation.totalMillis += (event.timeStamp - maxOf(calculation.sessionStart, startOfDay)).coerceAtLeast(0L)
                    calculation.inForeground = false
                }
            }
        }
        val dailyLimit = UsageMonitorStore.dailyLimit(this)
        val sessionLimit = UsageMonitorStore.sessionLimit(this)
        return targetApps.map { target ->
            val calculation = calculations.getValue(target.packageName)
            val currentSessionMillis = if (calculation.inForeground) (now - calculation.sessionStart).coerceAtLeast(0L) else 0L
            UsageAppSnapshot(
                appName = target.appName,
                packageName = target.packageName,
                dailyMinutes = ((calculation.totalMillis + if (calculation.inForeground) (now - maxOf(calculation.sessionStart, startOfDay)).coerceAtLeast(0L) else 0L) / 60_000L).toInt(),
                currentSessionMinutes = (currentSessionMillis / 60_000L).toInt(),
                dailyLimitMinutes = dailyLimit,
                sessionLimitMinutes = sessionLimit,
                isInForeground = calculation.inForeground,
                sessionStartedAt = if (calculation.inForeground) calculation.sessionStart else 0L
            )
        }
    }

    private fun calculateTopApps(usageManager: UsageStatsManager, startOfDay: Long, now: Long, installed: Map<String, InstalledUsageApp>): List<UsagePackageSummary> {
        return usageManager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startOfDay, now)
            .asSequence()
            .mapNotNull { stat ->
                val app = installed[stat.packageName] ?: return@mapNotNull null
                val minutes = (stat.totalTimeInForeground / 60_000L).toInt()
                if (minutes <= 0) null else UsagePackageSummary(app.appName, app.packageName, minutes)
            }
            .sortedByDescending { it.minutes }
            .take(10)
            .toList()
    }

    private fun calculateDeviceActivity(usageManager: UsageStatsManager, startOfDay: Long, now: Long, installed: Map<String, InstalledUsageApp>): DeviceActivitySnapshot? {
        var firstAt = 0L
        var lastAt = 0L
        var firstApp = ""
        var lastApp = ""
        val events = usageManager.queryEvents(startOfDay, now)
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.eventType != UsageEvents.Event.MOVE_TO_FOREGROUND) continue
            val app = installed[event.packageName] ?: continue
            if (firstAt == 0L || event.timeStamp < firstAt) { firstAt = event.timeStamp; firstApp = app.appName }
            if (event.timeStamp >= lastAt) { lastAt = event.timeStamp; lastApp = app.appName }
        }
        if (firstAt == 0L || lastAt == 0L) return null
        val formatter = DateTimeFormatter.ISO_LOCAL_DATE_TIME
        return DeviceActivitySnapshot(
            LocalDate.now().toString(),
            LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(firstAt), ZoneId.systemDefault()).format(formatter),
            LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(lastAt), ZoneId.systemDefault()).format(formatter),
            firstApp, lastApp
        )
    }

    private fun sendTargetReminders(targetSnapshots: List<UsageAppSnapshot>) {
        targetSnapshots.forEach { target ->
            if (target.dailyLimitMinutes > 0 && target.dailyMinutes >= target.dailyLimitMinutes && UsageMonitorStore.shouldSendDailyReminder(this, LocalDate.now(), target.packageName)) {
                UsageMonitorStore.markDailyReminderSent(this, LocalDate.now(), target.packageName)
                UsageMonitorStore.saveEvent(this, "${target.appName} 今日累计 ${target.dailyMinutes} 分钟，超过每日上限 ${target.dailyLimitMinutes} 分钟")
                UsageMonitorNotification.send(
                    this,
                    "${target.appName} 使用已超时",
                    "今天已使用约 ${target.dailyMinutes} 分钟，超过设定的 ${target.dailyLimitMinutes} 分钟。打开向前重新安排剩余计划。"
                )
            }
            if (target.isInForeground && target.sessionLimitMinutes > 0 && target.currentSessionMinutes >= target.sessionLimitMinutes) {
                if (UsageMonitorStore.shouldSendSessionReminder(this, target.sessionStartedAt, target.packageName)) {
                    UsageMonitorStore.markSessionReminderSent(this, target.sessionStartedAt, target.packageName)
                    UsageMonitorStore.saveEvent(this, "${target.appName} 当前连续使用 ${target.currentSessionMinutes} 分钟，超过连续上限 ${target.sessionLimitMinutes} 分钟")
                    UsageMonitorNotification.send(
                        this,
                        "连续使用时间较长",
                        "你已连续使用 ${target.appName} 约 ${target.currentSessionMinutes} 分钟，建议停下来休息一下。"
                    )
                }
            }
        }
    }

    private suspend fun uploadUsage(snapshot: UsageMonitorSnapshot) = withContext(Dispatchers.IO) {
        UsageMonitorStore.markUploadAttempt(this@UsageMonitorService)
        val configuredUrl = BuildConfig.AI_GATEWAY_URL.trim()
        if (configuredUrl.isBlank()) return@withContext
        val endpoint = if (configuredUrl.endsWith("/api/assistant/respond")) {
            configuredUrl.removeSuffix("/api/assistant/respond") + "/api/assistant/usage"
        } else {
            configuredUrl.trimEnd('/') + "/api/assistant/usage"
        }
        val payload = JSONObject().apply {
            put("app_usage", JSONArray().apply {
                snapshot.targetApps.forEach { target ->
                    put(JSONObject().apply {
                        put("enabled", snapshot.enabled)
                        put("app", target.appName)
                        put("package_name", target.packageName)
                        put("today_minutes", target.dailyMinutes)
                        put("current_session_minutes", target.currentSessionMinutes)
                        put("daily_limit_minutes", target.dailyLimitMinutes)
                        put("session_limit_minutes", target.sessionLimitMinutes)
                        put("in_foreground", target.isInForeground)
                        put("last_event", snapshot.lastEvent)
                        put("updated_at", snapshot.updatedAt)
                        put("date", LocalDate.now().toString())
                        put("source", "android-usage-monitor")
                    })
                }
                if (snapshot.autoTopTen) {
                    snapshot.topApps.forEach { app ->
                        put(JSONObject().apply {
                            put("enabled", snapshot.enabled)
                            put("app", app.appName)
                            put("package_name", app.packageName)
                            put("today_minutes", app.minutes)
                            put("current_session_minutes", 0)
                            put("daily_limit_minutes", 0)
                            put("session_limit_minutes", 0)
                            put("in_foreground", false)
                            put("updated_at", snapshot.updatedAt)
                            put("date", LocalDate.now().toString())
                            put("source", "android-auto-top-ten")
                        })
                    }
                }
            })
            snapshot.deviceActivity?.let { activity -> put("device_activity", JSONObject().apply {
                put("date", activity.date); put("first_active_at", activity.firstActiveAt); put("last_active_at", activity.lastActiveAt)
                put("first_foreground_app", activity.firstForegroundApp); put("last_foreground_app", activity.lastForegroundApp)
                put("updated_at", snapshot.updatedAt); put("source", "android-usage-monitor")
            }) }
        }.toString().toByteArray(Charsets.UTF_8)
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 5_000
            readTimeout = 8_000
            doOutput = true
            useCaches = false
            setFixedLengthStreamingMode(payload.size)
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Connection", "close")
            if (BuildConfig.AI_GATEWAY_TOKEN.isNotBlank()) setRequestProperty("x-forward-token", BuildConfig.AI_GATEWAY_TOKEN)
            AssistantSessionStore.token(this@UsageMonitorService).takeIf { it.isNotBlank() }?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        try {
            connection.outputStream.use { output -> output.write(payload) }
            connection.responseCode
        } finally {
            connection.disconnect()
        }
    }

    private fun createUsageChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(
                UsageMonitorNotification.CHANNEL_ID,
                "应用使用提醒",
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = "记录关注应用和当天使用时长前十的应用" })
            manager.createNotificationChannel(NotificationChannel(
                "forward-usage-reminders",
                "应用使用超时提醒",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "关注应用使用达到设定时长后的提醒" })
        }
    }

    private fun buildOngoingNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(this, 1002, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val targets = UsageMonitorStore.targetApps(this)
        val description = when {
            targets.isEmpty() && UsageMonitorStore.autoTopTen(this) -> "正在记录当天使用时长前 10 的应用"
            targets.size == 1 && UsageMonitorStore.autoTopTen(this) -> "正在关注 ${targets.first().appName}，并记录当天前 10"
            targets.size == 1 -> "正在记录 ${targets.first().appName} 的使用时长"
            else -> "正在关注 ${targets.size} 个应用，并记录当天前 10"
        }
        return NotificationCompat.Builder(this, UsageMonitorNotification.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_forward)
            .setContentTitle("向前 · 使用监控已开启")
            .setContentText(description)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}

object UsageMonitorNotification {
    const val CHANNEL_ID = "forward-usage-monitor"
    private const val REMINDER_CHANNEL_ID = "forward-usage-reminders"
    const val ONGOING_ID = 2001
    private const val REMINDER_ID = 2002

    fun send(context: Context, title: String, text: String) {
        val intent = Intent(context, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(context, REMINDER_ID, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, REMINDER_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_forward)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        context.getSystemService(NotificationManager::class.java).notify("$title:$text".hashCode(), notification)
    }
}

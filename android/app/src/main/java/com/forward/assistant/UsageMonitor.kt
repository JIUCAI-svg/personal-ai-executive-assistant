package com.forward.assistant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.AppOpsManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
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
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class UsageMonitorSnapshot(
    val enabled: Boolean,
    val packageName: String,
    val appName: String,
    val dailyMinutes: Int,
    val currentSessionMinutes: Int,
    val dailyLimitMinutes: Int,
    val sessionLimitMinutes: Int,
    val isInForeground: Boolean,
    val lastEvent: String,
    val updatedAt: String
)

object UsageMonitorStore {
    private const val PREFS = "usage_monitor"
    // This device has Douyin Lite installed. Users can override the target package in Settings.
    private const val DEFAULT_PACKAGE = "com.ss.android.ugc.aweme.lite"
    private const val DEFAULT_APP_NAME = "抖音"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(context: Context): Boolean = prefs(context).getBoolean("enabled", false)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean("enabled", enabled).apply()
    }

    fun packageName(context: Context): String = prefs(context).getString("package_name", DEFAULT_PACKAGE).orEmpty()

    fun appName(context: Context): String = prefs(context).getString("app_name", DEFAULT_APP_NAME).orEmpty()

    fun saveTarget(context: Context, appName: String, packageName: String) {
        prefs(context).edit()
            .putString("app_name", appName.trim().ifBlank { DEFAULT_APP_NAME })
            .putString("package_name", packageName.trim().ifBlank { DEFAULT_PACKAGE })
            .apply()
    }

    fun dailyLimit(context: Context): Int = prefs(context).getInt("daily_limit", 30)

    fun sessionLimit(context: Context): Int = prefs(context).getInt("session_limit", 20)

    fun saveLimits(context: Context, daily: Int, session: Int) {
        prefs(context).edit()
            .putInt("daily_limit", daily.coerceIn(1, 24 * 60))
            .putInt("session_limit", session.coerceIn(1, 24 * 60))
            .apply()
    }

    fun snapshot(context: Context): UsageMonitorSnapshot = UsageMonitorSnapshot(
        enabled = enabled(context),
        packageName = packageName(context),
        appName = appName(context),
        dailyMinutes = prefs(context).getInt("daily_minutes", 0),
        currentSessionMinutes = prefs(context).getInt("session_minutes", 0),
        dailyLimitMinutes = dailyLimit(context),
        sessionLimitMinutes = sessionLimit(context),
        isInForeground = prefs(context).getBoolean("in_foreground", false),
        lastEvent = prefs(context).getString("last_event", "").orEmpty(),
        updatedAt = prefs(context).getString("updated_at", "").orEmpty()
    )

    fun saveUsage(context: Context, dailyMinutes: Int, sessionMinutes: Int, inForeground: Boolean) {
        prefs(context).edit()
            .putInt("daily_minutes", dailyMinutes)
            .putInt("session_minutes", sessionMinutes)
            .putBoolean("in_foreground", inForeground)
            .putString("updated_at", LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME))
            .apply()
    }

    fun saveEvent(context: Context, event: String) {
        prefs(context).edit().putString("last_event", event).apply()
    }

    fun shouldSendDailyReminder(context: Context, date: LocalDate): Boolean {
        val key = date.toString()
        return prefs(context).getString("daily_reminder_date", null) != key
    }

    fun markDailyReminderSent(context: Context, date: LocalDate) {
        prefs(context).edit().putString("daily_reminder_date", date.toString()).apply()
    }

    fun shouldSendSessionReminder(context: Context, sessionStart: Long): Boolean =
        prefs(context).getLong("session_reminder_start", 0L) != sessionStart

    fun markSessionReminderSent(context: Context, sessionStart: Long) {
        prefs(context).edit().putLong("session_reminder_start", sessionStart).apply()
    }

    fun shouldUpload(context: Context): Boolean {
        val lastAttempt = prefs(context).getLong("usage_upload_attempt", 0L)
        return System.currentTimeMillis() - lastAttempt >= 5 * 60 * 1000L
    }

    fun markUploadAttempt(context: Context) {
        prefs(context).edit().putLong("usage_upload_attempt", System.currentTimeMillis()).apply()
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

class UsageMonitorBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!UsageMonitorStore.enabled(context) || !UsageMonitorPermissions.hasUsageAccess(context)) return
        ContextCompat.startForegroundService(context, Intent(context, UsageMonitorService::class.java))
    }
}

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
            delay(30_000)
        }
    }

    private suspend fun updateUsage() {
        val targetPackage = UsageMonitorStore.packageName(this)
        val now = System.currentTimeMillis()
        val startOfDay = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val usageManager = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val events = usageManager.queryEvents(startOfDay, now)
        val event = UsageEvents.Event()
        var sessionStart = 0L
        var totalMillis = 0L
        var lastSessionStart = 0L
        var inForeground = false
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            if (event.packageName != targetPackage) continue
            when (event.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    if (!inForeground) {
                        sessionStart = event.timeStamp
                        lastSessionStart = sessionStart
                        inForeground = true
                    }
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    if (inForeground) {
                        totalMillis += (event.timeStamp - sessionStart).coerceAtLeast(0L)
                        inForeground = false
                    }
                }
            }
        }
        val currentSessionMillis = if (inForeground) (now - sessionStart).coerceAtLeast(0L) else 0L
        val dailyMinutes = ((totalMillis + currentSessionMillis) / 60_000L).toInt()
        val sessionMinutes = (currentSessionMillis / 60_000L).toInt()
        UsageMonitorStore.saveUsage(this, dailyMinutes, sessionMinutes, inForeground)
        if (UsageMonitorStore.shouldUpload(this)) uploadUsage(UsageMonitorStore.snapshot(this))

        val dailyLimit = UsageMonitorStore.dailyLimit(this)
        if (dailyMinutes >= dailyLimit && UsageMonitorStore.shouldSendDailyReminder(this, LocalDate.now())) {
            UsageMonitorStore.markDailyReminderSent(this, LocalDate.now())
            UsageMonitorStore.saveEvent(this, "${UsageMonitorStore.appName(this)} 今日累计 ${dailyMinutes} 分钟，超过每日上限 ${dailyLimit} 分钟")
            UsageMonitorNotification.send(
                this,
                "${UsageMonitorStore.appName(this)} 使用已超时",
                "今天已使用约 ${dailyMinutes} 分钟，超过设定的 ${dailyLimit} 分钟。打开向前重新安排剩余计划。"
            )
        }
        val sessionLimit = UsageMonitorStore.sessionLimit(this)
        if (inForeground && sessionMinutes >= sessionLimit && UsageMonitorStore.shouldSendSessionReminder(this, lastSessionStart)) {
            UsageMonitorStore.markSessionReminderSent(this, lastSessionStart)
            UsageMonitorStore.saveEvent(this, "${UsageMonitorStore.appName(this)} 当前连续使用 ${sessionMinutes} 分钟，超过连续上限 ${sessionLimit} 分钟")
            UsageMonitorNotification.send(
                this,
                "连续使用时间较长",
                "你已连续使用${UsageMonitorStore.appName(this)}约 ${sessionMinutes} 分钟，建议停下来休息一下。"
            )
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
            put("app_usage", JSONObject().apply {
                put("enabled", snapshot.enabled)
                put("app", snapshot.appName)
                put("package_name", snapshot.packageName)
                put("today_minutes", snapshot.dailyMinutes)
                put("current_session_minutes", snapshot.currentSessionMinutes)
                put("daily_limit_minutes", snapshot.dailyLimitMinutes)
                put("session_limit_minutes", snapshot.sessionLimitMinutes)
                put("in_foreground", snapshot.isInForeground)
                put("last_event", snapshot.lastEvent)
                put("updated_at", snapshot.updatedAt)
                put("date", LocalDate.now().toString())
                put("source", "android-usage-monitor")
            })
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
        }
        try {
            connection.outputStream.use { output -> output.write(payload) }
            val responseCode = connection.responseCode
            if (responseCode !in 200..299) return@withContext
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
            ).apply { description = "监控指定应用的使用时长" })
            manager.createNotificationChannel(NotificationChannel(
                "forward-usage-reminders",
                "应用使用超时提醒",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "应用使用达到设定时长后的提醒" })
        }
    }

    private fun buildOngoingNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(this, 1002, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, UsageMonitorNotification.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_forward)
            .setContentTitle("向前 · 使用监控已开启")
            .setContentText("正在记录 ${UsageMonitorStore.appName(this)} 的使用时长")
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
        context.getSystemService(NotificationManager::class.java).notify(REMINDER_ID, notification)
    }
}

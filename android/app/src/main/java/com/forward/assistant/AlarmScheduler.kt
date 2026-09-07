package com.forward.assistant

import android.app.AlarmManager
import android.app.AlarmManager.AlarmClockInfo
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.AlarmClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.json.JSONArray
import org.json.JSONObject

data class AlarmOperationResult(
    val ok: Boolean,
    val message: String,
    val needsExactPermission: Boolean = false,
    val needsNotificationPermission: Boolean = false,
    val triggerAtMillis: Long? = null
)

/** Local device execution for alarm actions returned by the assistant gateway. */
object AlarmScheduler {
    private const val PREFS = "forward_alarms"
    private const val KEY_ALARMS = "items"
    private const val ACTION_FIRE = "com.forward.assistant.action.FIRE_ALARM"
    internal const val EXTRA_ID = "alarm_id"
    internal const val EXTRA_LABEL = "alarm_label"
    internal const val EXTRA_TIME = "alarm_time"
    internal const val EXTRA_DATE = "alarm_date"
    internal const val EXTRA_REPEAT = "alarm_repeat"
    internal const val EXTRA_KIND = "alarm_kind"
    internal const val EXTRA_INSTRUCTION = "alarm_instruction"
    internal const val EXTRA_NOTIFY_USER = "alarm_notify_user"
    internal const val EXTRA_MESSAGE = "alarm_message"
    private const val CHANNEL_ID = "forward-device-alarms-v2"

    private fun canPostNotifications(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            (ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED &&
                context.getSystemService(NotificationManager::class.java).areNotificationsEnabled())

    fun needsNotificationPermission(context: Context, action: AssistantAction): Boolean =
        action.type == "schedule_followup" && !canPostNotifications(context)

    fun apply(context: Context, action: AssistantAction): AlarmOperationResult {
        val outcome = when (action.type) {
            "set_alarm" -> schedule(context, action)
            "cancel_alarm" -> cancel(context, action)
            "schedule_followup" -> scheduleFollowup(context, action)
            else -> AlarmOperationResult(false, "不是手机闹钟动作")
        }
        val status = when {
            !outcome.ok -> "failed"
            action.type == "cancel_alarm" -> "cancelled"
            else -> "scheduled"
        }
        DeviceActionReporter.report(context, action, status, outcome.message, outcome.triggerAtMillis)
        return outcome
    }

    fun restore(context: Context) {
        DeviceActionReporter.drain(context)
        val alarms = read(context)
        val retained = JSONArray()
        for (index in 0 until alarms.length()) {
            val item = alarms.optJSONObject(index) ?: continue
            if (item.optBoolean("cancelled", false)) continue
            // Alarms created through ACTION_SET_ALARM are owned by the
            // device's Clock app. Do not recreate them with our receiver.
            if (item.optBoolean("system_clock", false) || item.optString("kind") == "system_clock") {
                retained.put(item)
                continue
            }
            if (item.optString("kind") == "followup") {
                val trigger = item.optLong("trigger_at", 0L)
                if (trigger > System.currentTimeMillis()) runCatching { schedulePending(context, item, trigger) }
                retained.put(item)
                continue
            }
            // Entries from pre-system-clock builds used our own notification
            // receiver. Cancel any pending broadcast and drop them during
            // migration so no app-level alarm can fire after the upgrade.
            runCatching { cancelPending(context, item) }
        }
        write(context, retained)
    }

    fun onTriggered(context: Context, intent: Intent?) {
        if (intent?.getStringExtra(EXTRA_KIND) == "followup") {
            val followupId = intent.getStringExtra(EXTRA_ID).orEmpty()
            val directNotification = intent.getBooleanExtra(EXTRA_NOTIFY_USER, false)
            val message = intent.getStringExtra(EXTRA_MESSAGE).orEmpty().ifBlank { intent.getStringExtra(EXTRA_INSTRUCTION).orEmpty() }
            val action = AssistantAction(type = "schedule_followup", followupId = followupId, notifyUser = directNotification, message = message)
            val alarms = read(context)
            val item = (0 until alarms.length()).mapNotNull { alarms.optJSONObject(it) }.firstOrNull { it.optString("id") == followupId }
            var succeeded = false
            if (directNotification) {
                val delivered = showNotification(context, followupId, message.ifBlank { "到达了你设置的提醒时间。" })
                succeeded = delivered
                DeviceActionReporter.report(
                    context,
                    action,
                    if (delivered) "delivered" else "failed",
                    if (delivered) "主动提醒已显示在手机上" else "主动提醒触发，但系统未能显示通知"
                )
            } else {
                val dispatched = runCatching { FollowupDispatcher.dispatch(context, followupId, intent.getStringExtra(EXTRA_INSTRUCTION).orEmpty()) }.isSuccess
                succeeded = dispatched
                DeviceActionReporter.report(
                    context,
                    action,
                    if (dispatched) "triggered" else "failed",
                    if (dispatched) "延后唤醒已触发" else "延后唤醒服务启动失败"
                )
            }
            if (succeeded) {
                for (index in alarms.length() - 1 downTo 0) {
                    if (alarms.optJSONObject(index)?.optString("id") == followupId) alarms.remove(index)
                }
            } else if (item != null) {
                // Keep a failed local wake-up alive so a transient notification
                // or service-start failure can be retried on the next cycle.
                val retryAt = System.currentTimeMillis() + 60_000L
                item.put("trigger_at", retryAt)
                runCatching { schedulePending(context, item, retryAt) }
            }
            write(context, alarms)
            return
        }
        val id = intent?.getStringExtra(EXTRA_ID).orEmpty()
        val label = intent?.getStringExtra(EXTRA_LABEL).orEmpty().ifBlank { "向前提醒" }
        val time = intent?.getStringExtra(EXTRA_TIME).orEmpty()
        val date = intent?.getStringExtra(EXTRA_DATE).orEmpty()
        val repeat = intent?.getStringExtra(EXTRA_REPEAT).orEmpty().ifBlank { "none" }
        // Legacy app-owned alarms are intentionally disabled. New alarms are
        // created by the device Clock app via ACTION_SET_ALARM and never
        // reach this receiver.
        val alarms = read(context)
        val item = (0 until alarms.length()).mapNotNull { alarms.optJSONObject(it) }.firstOrNull { it.optString("id") == id }
        for (index in alarms.length() - 1 downTo 0) {
            if (alarms.optJSONObject(index)?.optString("id") == id) alarms.remove(index)
        }
        write(context, alarms)
        if (id.isNotBlank()) {
            DeviceActionReporter.report(
                context,
                AssistantAction(type = "set_alarm", time = time, date = date, label = label, repeat = repeat, alarmId = id),
                "failed",
                "旧版应用闹钟已停用，请从手机系统时钟中重新创建",
                item?.optLong("trigger_at")?.takeIf { it > 0L }
            )
        }
    }

    private fun schedule(context: Context, action: AssistantAction): AlarmOperationResult {
        val time = runCatching { LocalTime.parse(action.time.orEmpty()) }.getOrNull()
            ?: return AlarmOperationResult(false, "闹钟时间格式应为 HH:mm")
        val repeat = if (action.repeat == "daily") "daily" else "none"
        val requestedDate = action.date?.trim()?.takeIf { it.isNotBlank() }?.let {
            runCatching { LocalDate.parse(it) }.getOrNull()
                ?: return AlarmOperationResult(false, "闹钟日期格式应为 yyyy-MM-dd")
        }
        val nativeNextTrigger = resolveTrigger(null, time.toString().take(5), repeat)
            ?: return AlarmOperationResult(false, "闹钟时间已经过去，请换一个未来时间")
        // ACTION_SET_ALARM can express the next occurrence and daily repeats,
        // but it has no public one-shot calendar-date field. Accept a supplied
        // date only when it matches the Clock app's actual next occurrence.
        // This allows a natural "明天 8 点" request without silently moving a
        // future dated alarm to the wrong day.
        if (requestedDate != null && requestedDate != nativeNextTrigger.toLocalDate()) {
            return AlarmOperationResult(false, "手机系统时钟只能创建下一次响铃，无法创建 ${requestedDate} 的单次闹钟")
        }
        val trigger = nativeNextTrigger
        val id = action.alarmId?.ifBlank { null } ?: "local-${System.currentTimeMillis()}-${time.hour}${time.minute}"
        val item = JSONObject().apply {
            put("id", id)
            put("time", time.toString().take(5))
            put("date", requestedDate?.toString().orEmpty())
            put("label", action.label.orEmpty().ifBlank { "向前提醒" })
            put("repeat", repeat)
            put("trigger_at", trigger.toInstant().toEpochMilli())
            put("created_at", System.currentTimeMillis())
        }
        val clockIntent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(AlarmClock.EXTRA_HOUR, time.hour)
            putExtra(AlarmClock.EXTRA_MINUTES, time.minute)
            putExtra(AlarmClock.EXTRA_MESSAGE, item.optString("label"))
            // Request silent creation. Clock apps that do not support this
            // flag may show their own confirmation UI, which is still a
            // system-clock flow and never falls back to an app notification.
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            if (repeat == "daily") {
                putIntegerArrayListExtra(
                    AlarmClock.EXTRA_DAYS,
                    arrayListOf(
                        java.util.Calendar.SUNDAY,
                        java.util.Calendar.MONDAY,
                        java.util.Calendar.TUESDAY,
                        java.util.Calendar.WEDNESDAY,
                        java.util.Calendar.THURSDAY,
                        java.util.Calendar.FRIDAY,
                        java.util.Calendar.SATURDAY
                    )
                )
            }
        }
        val resolver = context.packageManager
        if (clockIntent.resolveActivity(resolver) == null) {
            return AlarmOperationResult(false, "手机没有可用的系统时钟应用，闹钟创建失败")
        }
        val launchError = runCatching { context.startActivity(clockIntent) }.exceptionOrNull()
        if (launchError != null) {
            return AlarmOperationResult(false, "系统时钟未能创建闹钟：${launchError.message.orEmpty()}")
        }
        val alarms = read(context)
        for (index in alarms.length() - 1 downTo 0) {
            if (alarms.optJSONObject(index)?.optString("id") == id) alarms.remove(index)
        }
        item.put("kind", "system_clock")
        item.put("system_clock", true)
        val triggerAt = trigger.toInstant().toEpochMilli()
        alarms.put(item)
        write(context, alarms)
        return AlarmOperationResult(
            true,
            "已请求手机系统时钟创建：${item.optString("label")}，${item.optString("date").ifBlank { "下一次" }} ${item.optString("time")}",
            triggerAtMillis = triggerAt
        )
    }

    private fun scheduleFollowup(context: Context, action: AssistantAction): AlarmOperationResult {
        if (!canPostNotifications(context)) {
            return AlarmOperationResult(false, "需要先允许通知权限，才能在到点时主动提醒。", needsNotificationPermission = true)
        }
        val id = action.followupId?.takeIf { it.isNotBlank() }
            ?: return AlarmOperationResult(false, "延后唤醒缺少记录 ID")
        val after = action.afterMinutes?.coerceIn(1, 10080)
            ?: return AlarmOperationResult(false, "延后唤醒缺少分钟数")
        val trigger = System.currentTimeMillis() + after * 60_000L
        val item = JSONObject().apply {
            put("id", id); put("kind", "followup"); put("trigger_at", trigger)
            put("instruction", action.instruction.orEmpty()); put("notify_user", action.notifyUser)
            put("message", action.message.orEmpty()); put("created_at", System.currentTimeMillis())
        }
        val alarms = read(context)
        for (index in alarms.length() - 1 downTo 0) if (alarms.optJSONObject(index)?.optString("id") == id) alarms.remove(index)
        val scheduleError = runCatching { schedulePending(context, item, trigger) }.exceptionOrNull()
        if (scheduleError != null) {
            return AlarmOperationResult(false, "系统未允许创建延后唤醒：${scheduleError.message.orEmpty()}", needsExactPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        }
        alarms.put(item); write(context, alarms)
        return AlarmOperationResult(
            true,
            if (action.notifyUser) "已安排 ${after} 分钟后的直接提醒" else "已安排 ${after} 分钟后重新判断",
            triggerAtMillis = trigger
        )
    }

    private fun cancel(context: Context, action: AssistantAction): AlarmOperationResult {
        val alarms = read(context)
        val requestedId = action.alarmId.orEmpty()
        val requestedLabel = action.label.orEmpty()
        val requestedTime = action.time.orEmpty()
        var found: JSONObject? = null
        for (index in alarms.length() - 1 downTo 0) {
            val item = alarms.optJSONObject(index) ?: continue
            val matches = if (requestedId.isNotBlank()) item.optString("id") == requestedId else
                (requestedLabel.isBlank() || item.optString("label") == requestedLabel) &&
                    (requestedTime.isBlank() || item.optString("time") == requestedTime)
            if (matches) { found = item; break }
        }
        if (found == null) return AlarmOperationResult(false, "手机上没有找到匹配的闹钟")
        if (found.optBoolean("system_clock", false) || found.optString("kind") == "system_clock") {
            if (found.optString("repeat", "none") == "daily") {
                return AlarmOperationResult(false, "系统时钟公开接口只能跳过下一次重复闹钟，无法确认关闭整个重复计划，请在系统时钟中关闭")
            }
            val dismissIntent = Intent(AlarmClock.ACTION_DISMISS_ALARM).apply {
                putExtra(AlarmClock.EXTRA_ALARM_SEARCH_MODE, AlarmClock.ALARM_SEARCH_MODE_LABEL)
                putExtra(AlarmClock.EXTRA_MESSAGE, found.optString("label"))
                putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            }
            if (dismissIntent.resolveActivity(context.packageManager) == null) {
                return AlarmOperationResult(false, "此手机的系统时钟未开放应用内取消入口")
            }
            val dismissError = runCatching { context.startActivity(dismissIntent) }.exceptionOrNull()
            if (dismissError != null) return AlarmOperationResult(false, "系统时钟未能取消闹钟：${dismissError.message.orEmpty()}")
        } else {
            cancelPending(context, found)
        }
        for (index in alarms.length() - 1 downTo 0) {
            if (alarms.optJSONObject(index)?.optString("id") == found.optString("id")) {
                alarms.remove(index)
                break
            }
        }
        write(context, alarms)
        return AlarmOperationResult(true, "已取消手机闹钟：${found.optString("label")} ${found.optString("time")}")
    }

    private fun resolveTrigger(dateText: String?, timeText: String, repeat: String): ZonedDateTime? {
        val time = runCatching { LocalTime.parse(timeText) }.getOrNull() ?: return null
        val zone = ZoneId.systemDefault()
        val now = ZonedDateTime.now(zone)
        val requestedDate = dateText?.takeIf { it.isNotBlank() }?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        var target = ZonedDateTime.of(requestedDate ?: now.toLocalDate(), time, zone)
        if (requestedDate == null && !target.isAfter(now)) target = target.plusDays(1)
        if (requestedDate != null && !target.isAfter(now) && repeat != "daily") return null
        if (requestedDate != null && !target.isAfter(now)) target = target.plusDays(1)
        return target
    }

    private fun requestCode(id: String) = id.hashCode() and 0x7fffffff

    private fun pendingIntent(context: Context, item: JSONObject): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = ACTION_FIRE
            putExtra(EXTRA_ID, item.optString("id"))
            putExtra(EXTRA_LABEL, item.optString("label"))
            putExtra(EXTRA_TIME, item.optString("time"))
            putExtra(EXTRA_DATE, item.optString("date"))
            putExtra(EXTRA_REPEAT, item.optString("repeat", "none"))
            putExtra(EXTRA_KIND, item.optString("kind", "alarm"))
            putExtra(EXTRA_INSTRUCTION, item.optString("instruction"))
            putExtra(EXTRA_NOTIFY_USER, item.optBoolean("notify_user", false))
            putExtra(EXTRA_MESSAGE, item.optString("message"))
        }
        return PendingIntent.getBroadcast(context, requestCode(item.optString("id")), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun schedulePending(context: Context, item: JSONObject, triggerAt: Long) {
        val manager = context.getSystemService(AlarmManager::class.java)
        val pending = pendingIntent(context, item)
        val showIntent = PendingIntent.getActivity(
            context,
            requestCode(item.optString("id")) + 1,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // Use the exact alarm-clock path when available. If Android has not
        // granted exact-alarm access, retain a real idle-aware alarm rather
        // than claiming success or dropping the reminder entirely.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.canScheduleExactAlarms()) {
            manager.setAlarmClock(AlarmClockInfo(triggerAt, showIntent), pending)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
        } else {
            manager.set(AlarmManager.RTC_WAKEUP, triggerAt, pending)
        }
    }

    private fun cancelPending(context: Context, item: JSONObject) {
        val manager = context.getSystemService(AlarmManager::class.java)
        manager.cancel(pendingIntent(context, item))
    }

    private fun read(context: Context): JSONArray = runCatching {
        JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ALARMS, "[]"))
    }.getOrElse { JSONArray() }

    private fun write(context: Context, alarms: JSONArray) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_ALARMS, alarms.toString()).apply()
    }

    private fun showNotification(context: Context, id: String, label: String): Boolean {
        if (!canPostNotifications(context)) return false
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "向前闹钟", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "AI 对话创建的闹钟提醒"
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
                )
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 300, 500)
            })
        }
        if (!manager.areNotificationsEnabled() || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID)?.importance == NotificationManager.IMPORTANCE_NONE)) return false
        val alertIntent = Intent(context, MainActivity::class.java).apply {
            putExtra(EXTRA_ID, id)
            putExtra(EXTRA_LABEL, label)
        }
        val contentIntent = PendingIntent.getActivity(context, requestCode(id) + 2, alertIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_forward)
            .setContentTitle("向前 · 闹钟")
            .setContentText(label)
            .setStyle(NotificationCompat.BigTextStyle().bigText(label))
            .setContentIntent(contentIntent)
            .setFullScreenIntent(contentIntent, true)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
            .setVibrate(longArrayOf(0, 500, 300, 500))
            .build()
        return runCatching {
            manager.notify(("alarm:" + id).hashCode(), notification)
            true
        }.getOrDefault(false)
    }
}

/** Reports the device-side result without blocking alarm delivery. */
object DeviceActionReporter {
    private const val REPORT_PREFS = "forward_device_action_reports"
    private const val REPORT_QUEUE = "queue"
    private val lock = Any()
    private fun deviceId(context: Context): String = android.provider.Settings.Secure.getString(
        context.contentResolver, android.provider.Settings.Secure.ANDROID_ID
    )?.takeIf { it.isNotBlank() } ?: "android-${context.packageName}"

    fun report(context: Context, action: AssistantAction, status: String, message: String, triggerAt: Long? = null) {
        val base = BuildConfig.AI_GATEWAY_URL.trim().removeSuffix("/api/assistant/respond").trimEnd('/')
        if (base.isBlank() || (action.alarmId.isNullOrBlank() && action.followupId.isNullOrBlank())) return
        val itemId = action.alarmId?.takeIf { it.isNotBlank() } ?: action.followupId.orEmpty()
        val event = JSONObject().apply {
            put("action", action.type)
            if (action.type == "schedule_followup") put("followup_id", action.followupId ?: JSONObject.NULL)
            else put("alarm_id", action.alarmId ?: JSONObject.NULL)
            put("status", status)
            put("event_id", "${action.type}:${itemId}:${status}:${System.currentTimeMillis()}:${java.util.UUID.randomUUID()}")
            if (status == "failed") put("error", message)
            put("device_id", deviceId(context)); put("message", message); put("event_at", java.time.Instant.now().toString())
            triggerAt?.let { put("trigger_at", java.time.Instant.ofEpochMilli(it).toString()) }
        }.toString()
        synchronized(lock) {
            val prefs = context.getSharedPreferences(REPORT_PREFS, Context.MODE_PRIVATE)
            val queue = runCatching { JSONArray(prefs.getString(REPORT_QUEUE, "[]")) }.getOrElse { JSONArray() }
            queue.put(event)
            while (queue.length() > 100) queue.remove(0)
            prefs.edit().putString(REPORT_QUEUE, queue.toString()).apply()
        }
        drain(context, base)
    }

    fun drain(context: Context) {
        val base = BuildConfig.AI_GATEWAY_URL.trim().removeSuffix("/api/assistant/respond").trimEnd('/')
        if (base.isNotBlank()) drain(context, base)
    }

    private fun drain(context: Context, base: String) {
        Thread {
            repeat(3) { attempt ->
                val sent = synchronized(lock) {
                    val prefs = context.getSharedPreferences(REPORT_PREFS, Context.MODE_PRIVATE)
                    val queue = runCatching { JSONArray(prefs.getString(REPORT_QUEUE, "[]")) }.getOrElse { JSONArray() }
                    if (queue.length() == 0) return@synchronized true
                    val event = queue.optString(0).toByteArray(Charsets.UTF_8)
                    val ok = runCatching {
                        val connection = (java.net.URL("$base/api/assistant/device-actions/status").openConnection() as java.net.HttpURLConnection).apply {
                            requestMethod = "POST"; connectTimeout = 5_000; readTimeout = 8_000; doOutput = true; useCaches = false
                            setFixedLengthStreamingMode(event.size); setRequestProperty("Content-Type", "application/json; charset=utf-8")
                            if (BuildConfig.AI_GATEWAY_TOKEN.isNotBlank()) setRequestProperty("x-forward-token", BuildConfig.AI_GATEWAY_TOKEN)
                            AssistantSessionStore.token(context).takeIf { it.isNotBlank() }?.let { setRequestProperty("Authorization", "Bearer $it") }
                        }
                        try { connection.outputStream.use { it.write(event) }; connection.responseCode in 200..299 } finally { connection.disconnect() }
                    }.getOrDefault(false)
                    if (ok) { queue.remove(0); prefs.edit().putString(REPORT_QUEUE, queue.toString()).apply() }
                    ok
                }
                if (!sent && attempt < 2) {
                    try { Thread.sleep((attempt + 1) * 1_000L) } catch (_: InterruptedException) { return@Thread }
                }
            }
        }.start()
    }
}

object FollowupDispatcher {
    fun dispatch(context: Context, followupId: String, instruction: String) {
        androidx.core.content.ContextCompat.startForegroundService(
            context,
            Intent(context, UsageMonitorService::class.java).apply {
                action = "com.forward.assistant.action.PROCESS_FOLLOWUP"
                putExtra(AlarmScheduler.EXTRA_ID, followupId)
                putExtra(AlarmScheduler.EXTRA_INSTRUCTION, instruction)
            }
        )
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == "com.forward.assistant.action.FIRE_ALARM") AlarmScheduler.onTriggered(context, intent)
    }
}

class AlarmBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) AlarmScheduler.restore(context)
    }
}

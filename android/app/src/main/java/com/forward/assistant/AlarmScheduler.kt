package com.forward.assistant

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.json.JSONArray
import org.json.JSONObject

data class AlarmOperationResult(val ok: Boolean, val message: String, val needsExactPermission: Boolean = false)

/** Local device execution for alarm actions returned by the assistant gateway. */
object AlarmScheduler {
    private const val PREFS = "forward_alarms"
    private const val KEY_ALARMS = "items"
    private const val ACTION_FIRE = "com.forward.assistant.action.FIRE_ALARM"
    private const val EXTRA_ID = "alarm_id"
    private const val EXTRA_LABEL = "alarm_label"
    private const val EXTRA_TIME = "alarm_time"
    private const val EXTRA_DATE = "alarm_date"
    private const val EXTRA_REPEAT = "alarm_repeat"
    private const val CHANNEL_ID = "forward-device-alarms"

    fun apply(context: Context, action: AssistantAction): AlarmOperationResult = when (action.type) {
        "set_alarm" -> schedule(context, action)
        "cancel_alarm" -> cancel(context, action)
        else -> AlarmOperationResult(false, "不是手机闹钟动作")
    }

    fun restore(context: Context) {
        val alarms = read(context)
        for (index in 0 until alarms.length()) {
            val item = alarms.optJSONObject(index) ?: continue
            if (item.optBoolean("cancelled", false)) continue
            val time = item.optString("time")
            val date = item.optString("date").ifBlank { null }
            val repeat = item.optString("repeat", "none")
            val trigger = resolveTrigger(date, time, repeat) ?: continue
            item.put("trigger_at", trigger.toInstant().toEpochMilli())
            schedulePending(context, item, trigger.toInstant().toEpochMilli())
        }
        write(context, alarms)
    }

    fun onTriggered(context: Context, intent: Intent?) {
        val id = intent?.getStringExtra(EXTRA_ID).orEmpty()
        val label = intent?.getStringExtra(EXTRA_LABEL).orEmpty().ifBlank { "向前提醒" }
        val time = intent?.getStringExtra(EXTRA_TIME).orEmpty()
        val date = intent?.getStringExtra(EXTRA_DATE).orEmpty()
        val repeat = intent?.getStringExtra(EXTRA_REPEAT).orEmpty().ifBlank { "none" }
        showNotification(context, label)
        val alarms = read(context)
        val item = (0 until alarms.length()).mapNotNull { alarms.optJSONObject(it) }.firstOrNull { it.optString("id") == id }
        if (repeat == "daily" && item != null) {
            val next = resolveTrigger(null, time, repeat)
            if (next != null) {
                item.put("date", next.toLocalDate().toString())
                item.put("trigger_at", next.toInstant().toEpochMilli())
                schedulePending(context, item, next.toInstant().toEpochMilli())
            }
        } else {
            for (index in alarms.length() - 1 downTo 0) {
                if (alarms.optJSONObject(index)?.optString("id") == id) alarms.remove(index)
            }
        }
        write(context, alarms)
    }

    private fun schedule(context: Context, action: AssistantAction): AlarmOperationResult {
        val time = runCatching { LocalTime.parse(action.time.orEmpty()) }.getOrNull()
            ?: return AlarmOperationResult(false, "闹钟时间格式应为 HH:mm")
        val repeat = if (action.repeat == "daily") "daily" else "none"
        val trigger = resolveTrigger(action.date, time.toString().take(5), repeat)
            ?: return AlarmOperationResult(false, "闹钟时间已经过去，请换一个未来时间")
        val id = action.alarmId?.ifBlank { null } ?: "local-${System.currentTimeMillis()}-${time.hour}${time.minute}"
        val item = JSONObject().apply {
            put("id", id)
            put("time", time.toString().take(5))
            put("date", action.date.orEmpty())
            put("label", action.label.orEmpty().ifBlank { "向前提醒" })
            put("repeat", repeat)
            put("trigger_at", trigger.toInstant().toEpochMilli())
            put("created_at", System.currentTimeMillis())
        }
        val alarms = read(context)
        for (index in alarms.length() - 1 downTo 0) {
            if (alarms.optJSONObject(index)?.optString("id") == id) alarms.remove(index)
        }
        alarms.put(item)
        write(context, alarms)
        schedulePending(context, item, trigger.toInstant().toEpochMilli())
        val accuracy = if (canScheduleExact(context)) "准时" else "近似"
        return AlarmOperationResult(true, "已设置${accuracy}闹钟：${item.optString("label")}，${item.optString("date").ifBlank { "下一次" }} ${item.optString("time")}", !canScheduleExact(context))
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
            if (matches) { found = item; alarms.remove(index); break }
        }
        if (found == null) return AlarmOperationResult(false, "手机上没有找到匹配的闹钟")
        cancelPending(context, found)
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

    private fun canScheduleExact(context: Context): Boolean {
        val manager = context.getSystemService(AlarmManager::class.java)
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
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
        }
        return PendingIntent.getBroadcast(context, requestCode(item.optString("id")), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun schedulePending(context: Context, item: JSONObject, triggerAt: Long) {
        val manager = context.getSystemService(AlarmManager::class.java)
        val pending = pendingIntent(context, item)
        if (canScheduleExact(context)) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
        else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
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

    private fun showNotification(context: Context, label: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "向前闹钟", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "AI 对话创建的闹钟提醒"
            })
        }
        val contentIntent = PendingIntent.getActivity(context, 901, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_forward)
            .setContentTitle("向前 · 闹钟")
            .setContentText(label)
            .setStyle(NotificationCompat.BigTextStyle().bigText(label))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .build()
        manager.notify(("alarm:" + label + System.currentTimeMillis()).hashCode(), notification)
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

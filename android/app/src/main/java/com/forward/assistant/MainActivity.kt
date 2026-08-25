package com.forward.assistant

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.TimePickerDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.NotificationsNone
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Spa
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.temporal.ChronoUnit
import java.time.format.DateTimeFormatter

private val Ink = Color(0xFF20312F)
private val Green = Color(0xFF173D39)
private val GreenSoft = Color(0xFFE5EEE8)
private val Canvas = Color(0xFFF5F6F2)
private val Rail = Color(0xFFF0F2ED)
private val Cream = Color(0xFFF1E4C9)
private val Coral = Color(0xFFE99C68)
private val Muted = Color(0xFF7A8984)

data class PlanItem(
    val title: String,
    val note: String,
    val minutes: Int,
    val tone: Color,
    val flexible: Boolean = false,
    val done: Boolean = false,
    val deferred: Boolean = false,
    val cancelled: Boolean = false,
    val isBreak: Boolean = false
)

data class ScheduledPlanItem(
    val item: PlanItem,
    val start: LocalDateTime? = null,
    val end: LocalDateTime? = null,
    val deferredByCapacity: Boolean = false
)

data class ChatMessage(val fromAssistant: Boolean, val text: String)

data class AssistantAction(val type: String, val time: String? = null, val task: String? = null, val title: String? = null, val start: String? = null, val end: String? = null)
data class AssistantResult(val reply: String, val actions: List<AssistantAction>)

private val aiGatewayUrl get() = BuildConfig.AI_GATEWAY_URL
private val aiGatewayToken get() = BuildConfig.AI_GATEWAY_TOKEN

private const val DEFAULT_SLEEP_MINUTES = 23 * 60 + 30
private const val DEFAULT_WAKE_MINUTES = 8 * 60

private fun LocalTime.toMinutesOfDay() = hour * 60 + minute

private fun localTimeFromMinutes(minutes: Int) = LocalTime.of((minutes / 60) % 24, minutes % 60)

private fun formatClock(time: LocalTime) = time.format(DateTimeFormatter.ofPattern("HH:mm"))

private fun formatDuration(totalMinutes: Long): String {
    val minutes = totalMinutes.coerceAtLeast(0)
    val hours = minutes / 60
    val remainder = minutes % 60
    return when {
        hours == 0L -> "$remainder 分钟"
        remainder == 0L -> "$hours 小时"
        else -> "$hours 小时 $remainder 分"
    }
}

private fun dateLabel(date: LocalDate): String {
    val weekday = when (date.dayOfWeek.value) {
        1 -> "一"
        2 -> "二"
        3 -> "三"
        4 -> "四"
        5 -> "五"
        6 -> "六"
        else -> "日"
    }
    return "周$weekday，${date.monthValue} 月 ${date.dayOfMonth} 日"
}

private fun sleepDateTime(now: LocalDateTime, sleepTime: LocalTime): LocalDateTime {
    val todaySleep = now.toLocalDate().atTime(sleepTime)
    return if (todaySleep.isAfter(now)) todaySleep else todaySleep.plusDays(1)
}

private fun minutesUntilSleep(now: LocalDateTime, sleepTime: LocalTime): Long =
    Duration.between(now, sleepDateTime(now, sleepTime)).toMinutes().coerceAtLeast(0)

private fun isDeferred(title: String, deferredTasks: Set<String>): Boolean =
    deferredTasks.any { marker ->
        marker.isNotBlank() && (title.contains(marker, ignoreCase = true) || marker.contains(title, ignoreCase = true))
    }

private fun isCancelled(title: String, cancelledTasks: Set<String>): Boolean =
    cancelledTasks.any { marker ->
        marker.isNotBlank() && (title.contains(marker, ignoreCase = true) || marker.contains(title, ignoreCase = true))
    }

private fun buildPlan(
    currentDone: Boolean,
    deferredTasks: Set<String>,
    cancelledTasks: Set<String>,
    cancelAllTasks: Boolean = false
): List<PlanItem> {
    if (cancelAllTasks) return emptyList()
    return listOf(
        PlanItem("高等数学 · 错题回顾", "第 2 章极限与连续", 50, Coral, done = currentDone, cancelled = isCancelled("高等数学", cancelledTasks) || isCancelled("高数", cancelledTasks)),
        PlanItem("短暂休息", "离开屏幕，喝水走动", 15, Color(0xFFB9C8BF), isBreak = true),
        PlanItem("英语 · 阅读一篇", "计时完成 + 订正", 45, Coral, deferred = isDeferred("英语", deferredTasks), cancelled = isCancelled("英语", cancelledTasks)),
        PlanItem("多手机收益实验 · 记录", "汇总今天的关键数据", 40, Color(0xFF55A496), deferred = isDeferred("收益", deferredTasks), cancelled = isCancelled("收益", cancelledTasks)),
        PlanItem("漫剧 · 拆解一个热门开场", "可顺延", 45, Color(0xFF968BD0), flexible = true, deferred = isDeferred("漫剧", deferredTasks), cancelled = isCancelled("漫剧", cancelledTasks)),
        PlanItem("直播 · 设计一段特色玩法", "可顺延", 45, Color(0xFF968BD0), flexible = true, deferred = isDeferred("直播", deferredTasks), cancelled = isCancelled("直播", cancelledTasks))
    )
}

private fun schedulePlan(
    plan: List<PlanItem>,
    now: LocalDateTime,
    sleepTime: LocalTime
): List<ScheduledPlanItem> {
    val endOfDay = sleepDateTime(now, sleepTime)
    var cursor = now.withSecond(0).withNano(0).plusMinutes(5)
    return plan.filterNot { it.cancelled }.map { item ->
        when {
            item.done -> ScheduledPlanItem(item)
            item.deferred -> ScheduledPlanItem(item, deferredByCapacity = true)
            else -> {
                val end = cursor.plusMinutes(item.minutes.toLong())
                if (end.isAfter(endOfDay)) {
                    ScheduledPlanItem(item, deferredByCapacity = true)
                } else {
                    ScheduledPlanItem(item, cursor, end).also { cursor = end }
                }
            }
        }
    }
}

private fun parseClock(text: String): LocalTime? {
    val match = Regex("""(?<!\\d)([01]?\\d|2[0-3])\\s*(?:点|:|：)\\s*([0-5]?\\d)?(?:分)?""").find(text) ?: return null
    var hour = match.groupValues[1].toInt()
    val minute = when {
        text.drop(match.range.last + 1).startsWith("半") -> 30
        match.groupValues[2].isNotBlank() -> match.groupValues[2].toInt()
        else -> 0
    }
    if ((text.contains("晚上") || text.contains("下午")) && hour < 12) hour += 12
    return LocalTime.of(hour, minute)
}

private suspend fun requestAssistant(
    message: String,
    now: LocalDateTime,
    sleepTime: LocalTime,
    wakeTime: LocalTime,
    plan: List<PlanItem>,
    conversation: List<ChatMessage>,
    usageSnapshot: UsageMonitorSnapshot
): AssistantResult = withContext(Dispatchers.IO) {
    check(aiGatewayUrl.isNotBlank()) { "AI 网关地址尚未配置" }
    val payload = JSONObject().apply {
        put("message", message)
        put("conversation", JSONArray().apply {
            conversation.takeLast(12).forEach { entry ->
                put(JSONObject().apply {
                    put("role", if (entry.fromAssistant) "assistant" else "user")
                    put("content", entry.text)
                })
            }
        })
        put("context", JSONObject().apply {
            put("now", now.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")))
            put("sleep_time", formatClock(sleepTime))
            put("wake_time", formatClock(wakeTime))
            put("today_plan", JSONArray().apply {
                plan.filterNot { it.done || it.deferred || it.cancelled }.forEach { item ->
                    put(JSONObject().apply {
                        put("title", item.title)
                        put("minutes", item.minutes)
                        put("project", when {
                            item.title.contains("高等数学") || item.title.contains("英语") -> "9 月 5 日补考"
                            item.title.contains("收益") -> "多手机收益实验"
                            item.title.contains("漫剧") -> "AI 恐怖灵异漫剧"
                            item.title.contains("直播") -> "和平精英特色直播"
                            else -> ""
                        })
                    })
                }
            })
            put("app_usage", JSONArray().apply {
                usageSnapshot.targetApps.forEach { target ->
                    put(JSONObject().apply {
                        put("enabled", usageSnapshot.enabled)
                        put("app", target.appName)
                        put("package_name", target.packageName)
                        put("today_minutes", target.dailyMinutes)
                        put("current_session_minutes", target.currentSessionMinutes)
                        put("daily_limit_minutes", target.dailyLimitMinutes)
                        put("session_limit_minutes", target.sessionLimitMinutes)
                        put("in_foreground", target.isInForeground)
                        put("last_event", usageSnapshot.lastEvent)
                        put("updated_at", usageSnapshot.updatedAt)
                        put("source", "android-usage-monitor")
                    })
                }
                if (usageSnapshot.autoTopTen) {
                    usageSnapshot.topApps.forEach { app ->
                        put(JSONObject().apply {
                            put("enabled", usageSnapshot.enabled)
                            put("app", app.appName)
                            put("package_name", app.packageName)
                            put("today_minutes", app.minutes)
                            put("current_session_minutes", 0)
                            put("daily_limit_minutes", 0)
                            put("session_limit_minutes", 0)
                            put("in_foreground", false)
                            put("updated_at", usageSnapshot.updatedAt)
                            put("source", "android-auto-top-ten")
                        })
                    }
                }
            })
        })
    }
    val payloadBytes = payload.toString().toByteArray(Charsets.UTF_8)
    val connection = (URL(aiGatewayUrl).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 8_000
        readTimeout = 60_000
        doOutput = true
        useCaches = false
        setFixedLengthStreamingMode(payloadBytes.size)
        setRequestProperty("Content-Type", "application/json; charset=utf-8")
        setRequestProperty("Connection", "close")
        if (aiGatewayToken.isNotBlank()) setRequestProperty("x-forward-token", aiGatewayToken)
    }
    try {
        connection.outputStream.use { output -> output.write(payloadBytes) }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        check(connection.responseCode in 200..299) { JSONObject(body).optString("error", "AI 网关请求失败") }
        val json = JSONObject(body)
        AssistantResult(
            reply = json.optString("reply", "我已经处理好了。"),
            actions = json.optJSONArray("actions")?.let { array ->
                (0 until array.length()).mapNotNull { index ->
                    val action = array.optJSONObject(index) ?: return@mapNotNull null
                    AssistantAction(
                        type = action.optString("type"),
                        time = action.optString("time").ifBlank { null },
                        task = action.optString("task").ifBlank { null },
                        title = action.optString("title").ifBlank { null },
                        start = action.optString("start").ifBlank { null },
                        end = action.optString("end").ifBlank { null }
                    )
                }
            }.orEmpty()
        )
    } catch (error: Exception) {
        Log.e("ForwardAssistant", "AI gateway request failed: $aiGatewayUrl", error)
        throw error
    } finally {
        connection.disconnect()
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createNotificationChannel()
        setContent { ForwardApp(this) }
        if (UsageMonitorStore.enabled(this) && UsageMonitorPermissions.hasUsageAccess(this)) {
            ContextCompat.startForegroundService(this, Intent(this, UsageMonitorService::class.java))
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "forward-reminders",
                "向前任务提醒",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "当前任务和晚间复盘提醒" }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    fun showReminder() {
        val manager = getSystemService(NotificationManager::class.java)
        val notification = NotificationCompat.Builder(this, "forward-reminders")
            .setSmallIcon(com.forward.assistant.R.drawable.ic_forward)
            .setContentTitle("向前 · 计划提醒")
            .setContentText("开始高数错题回顾，预计 50 分钟。")
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        manager.notify(1001, notification)
    }

    fun plannerTime(key: String, defaultMinutes: Int): LocalTime {
        val minutes = getSharedPreferences("planner", Context.MODE_PRIVATE).getInt(key, defaultMinutes)
        return localTimeFromMinutes(minutes)
    }

    fun savePlannerTime(key: String, time: LocalTime) {
        getSharedPreferences("planner", Context.MODE_PRIVATE)
            .edit()
            .putInt(key, time.toMinutesOfDay())
            .apply()
    }

    fun plannerSet(key: String): Set<String> = getSharedPreferences("planner", Context.MODE_PRIVATE)
        .getString(key, "")
        .orEmpty()
        .split('|')
        .map(String::trim)
        .filter(String::isNotBlank)
        .toSet()

    fun savePlannerSet(key: String, values: Set<String>) {
        getSharedPreferences("planner", Context.MODE_PRIVATE)
            .edit()
            .putString(key, values.joinToString("|"))
            .apply()
    }

    fun plannerFlag(key: String): Boolean = getSharedPreferences("planner", Context.MODE_PRIVATE).getBoolean(key, false)

    fun savePlannerFlag(key: String, value: Boolean) {
        getSharedPreferences("planner", Context.MODE_PRIVATE).edit().putBoolean(key, value).apply()
    }

    fun hasUsageAccess(): Boolean {
        return UsageMonitorPermissions.hasUsageAccess(this)
    }

    fun openUsageAccessSettings() {
        startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
    }

    fun usageMonitorEnabled(): Boolean = UsageMonitorStore.enabled(this)

    fun usageSnapshot(): UsageMonitorSnapshot = UsageMonitorStore.snapshot(this)

    fun installedUsageApps(): List<InstalledUsageApp> = com.forward.assistant.installedUsageApps(this)

    fun usageTargetApps(): List<InstalledUsageApp> = UsageMonitorStore.targetApps(this)

    fun saveUsageMonitorTarget(appName: String, packageName: String) {
        UsageMonitorStore.saveTarget(this, appName, packageName)
    }

    fun saveUsageMonitorTargets(apps: Collection<InstalledUsageApp>) {
        UsageMonitorStore.saveTargets(this, apps)
    }

    fun usageAutoTopTen(): Boolean = UsageMonitorStore.autoTopTen(this)

    fun saveUsageAutoTopTen(enabled: Boolean) {
        UsageMonitorStore.saveAutoTopTen(this, enabled)
    }

    fun saveUsageMonitorLimits(daily: Int, session: Int) {
        UsageMonitorStore.saveLimits(this, daily, session)
    }

    fun setUsageMonitorEnabled(enabled: Boolean) {
        UsageMonitorStore.setEnabled(this, enabled)
        if (enabled) {
            ContextCompat.startForegroundService(this, Intent(this, UsageMonitorService::class.java))
        } else {
            stopService(Intent(this, UsageMonitorService::class.java))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ForwardApp(activity: MainActivity) {
    MaterialTheme(colorScheme = androidx.compose.material3.lightColorScheme(primary = Green, background = Canvas)) {
        var tab by remember { mutableStateOf(0) }
        var currentDone by remember { mutableStateOf(false) }
        var unavailablePeriod by remember { mutableStateOf(false) }
        var deferredTasks by remember { mutableStateOf(activity.plannerSet("deferred_tasks")) }
        var cancelledTasks by remember { mutableStateOf(activity.plannerSet("cancelled_tasks")) }
        var cancelAllTasks by remember { mutableStateOf(activity.plannerFlag("cancel_all_tasks")) }
        var aiBusy by remember { mutableStateOf(false) }
        var input by remember { mutableStateOf(TextFieldValue()) }
        var sleepTime by remember { mutableStateOf(activity.plannerTime("sleep_time", DEFAULT_SLEEP_MINUTES)) }
        var wakeTime by remember { mutableStateOf(activity.plannerTime("wake_time", DEFAULT_WAKE_MINUTES)) }
        var usageSnapshot by remember { mutableStateOf(activity.usageSnapshot()) }
        var now by remember { mutableStateOf(LocalDateTime.now()) }
        LaunchedEffect(Unit) {
            while (true) {
                now = LocalDateTime.now()
                usageSnapshot = activity.usageSnapshot()
                delay(60_000)
            }
        }
        var messages by remember { mutableStateOf(listOf(
            ChatMessage(true, "你好，我在。今晚大概几点睡？我按这个把今天剩下的时间和任务排清楚。")
        )) }
        val snackbar = remember { SnackbarHostState() }
        val scope = rememberCoroutineScope()
        val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted || Build.VERSION.SDK_INT < 33) {
                activity.showReminder()
                scope.launch { snackbar.showSnackbar("提醒已开启，已发送一条测试通知") }
            } else scope.launch { snackbar.showSnackbar("通知权限未开启，应用内计划仍可使用") }
        }

        fun completeTask() {
            currentDone = true
            messages = messages + ChatMessage(true, "好，高数错题记为完成。接下来留 15 分钟休息，再按今天还剩的时间继续排英语和收益实验。")
            scope.launch { snackbar.showSnackbar("已完成，计划向前推进") }
        }

        fun applyActions(actions: List<AssistantAction>) {
            actions.forEach { action ->
                when (action.type) {
                    "set_sleep_time" -> parseClock(action.time.orEmpty())?.let {
                        sleepTime = it
                        activity.savePlannerTime("sleep_time", it)
                    }
                    "set_wake_time" -> parseClock(action.time.orEmpty())?.let {
                        wakeTime = it
                        activity.savePlannerTime("wake_time", it)
                    }
                    "complete_current_task" -> currentDone = true
                    "defer_task" -> action.task?.takeIf { it.isNotBlank() }?.let {
                        val updated = deferredTasks + it
                        deferredTasks = updated
                        activity.savePlannerSet("deferred_tasks", updated)
                    }
                    "cancel_task" -> action.task?.takeIf { it.isNotBlank() }?.let {
                        val updatedCancelled = cancelledTasks + it
                        val updatedDeferred = deferredTasks - it
                        cancelledTasks = updatedCancelled
                        deferredTasks = updatedDeferred
                        activity.savePlannerSet("cancelled_tasks", updatedCancelled)
                        activity.savePlannerSet("deferred_tasks", updatedDeferred)
                    }
                    "cancel_all_tasks" -> {
                        cancelAllTasks = true
                        deferredTasks = emptySet()
                        cancelledTasks = emptySet()
                        activity.savePlannerFlag("cancel_all_tasks", true)
                        activity.savePlannerSet("deferred_tasks", emptySet())
                        activity.savePlannerSet("cancelled_tasks", emptySet())
                    }
                    "replan_today" -> {
                        cancelAllTasks = false
                        activity.savePlannerFlag("cancel_all_tasks", false)
                    }
                    "set_unavailable_period" -> unavailablePeriod = true
                }
            }
        }

        fun localReply(text: String): String {
            val timeInMessage = parseClock(text)
            return when {
                (text.contains("睡") || text.contains("睡觉")) && timeInMessage != null -> {
                    sleepTime = timeInMessage
                    activity.savePlannerTime("sleep_time", timeInMessage)
                    "今晚按 ${formatClock(timeInMessage)} 睡来安排。今天的可用时间、缓冲和后续任务已经重算。"
                }
                (text.contains("起床") || text.contains("起")) && timeInMessage != null -> {
                    wakeTime = timeInMessage
                    activity.savePlannerTime("wake_time", timeInMessage)
                    "记下了，明天按 ${formatClock(timeInMessage)} 起床。明早的首个复习块会以这个时间为起点。"
                }
                (text.contains("取消") || text.contains("删除") || text.contains("删掉") || text.contains("移除")) &&
                    (text.contains("所有") || text.contains("全部") || text.contains("清空") || text.contains("计划")) -> {
                    cancelAllTasks = true
                    deferredTasks = emptySet()
                    cancelledTasks = emptySet()
                    activity.savePlannerFlag("cancel_all_tasks", true)
                    activity.savePlannerSet("deferred_tasks", emptySet())
                    activity.savePlannerSet("cancelled_tasks", emptySet())
                    "已取消今天和已顺延的全部任务，当前计划已清空。"
                }
                text.contains("取消") || text.contains("删除") || text.contains("删掉") || text.contains("移除") -> {
                    val target = listOf("高等数学", "高数", "英语", "收益", "漫剧", "直播").firstOrNull { text.contains(it) }
                    if (target != null) {
                        val updatedCancelled = cancelledTasks + target
                        val updatedDeferred = deferredTasks - target
                        cancelledTasks = updatedCancelled
                        deferredTasks = updatedDeferred
                        activity.savePlannerSet("cancelled_tasks", updatedCancelled)
                        activity.savePlannerSet("deferred_tasks", updatedDeferred)
                        "已将${target}从今天的计划中移除，不会再占用今天的时间。"
                    } else "请告诉我具体要取消哪一项任务，我会从今天的计划中移除它。"
                }
                text.contains("完成") || text.contains("做完") -> {
                    currentDone = true
                    "好，高数错题记为完成。接下来留 15 分钟休息，再按今天还剩的时间继续排英语和收益实验。"
                }
                text.contains("外出") || text.contains("出门") || text.contains("累") || text.contains("疲惫") -> {
                    unavailablePeriod = true
                    "我已经降低今天后半段的负荷，把可顺延的创作任务放到明天，优先保留补考主线。"
                }
                else -> "我目前没有连上 AI 网关。你可以检查电脑端桥接服务是否运行，或继续用本地计划指令。"
            }
        }

        fun sendMessage() {
            val text = input.text.trim()
            if (text.isEmpty() || aiBusy) return
            val priorConversation = messages
            messages = messages + ChatMessage(false, text)
            input = TextFieldValue()
            aiBusy = true
            scope.launch {
                val result = runCatching {
                    requestAssistant(text, now, sleepTime, wakeTime, buildPlan(currentDone, deferredTasks, cancelledTasks, cancelAllTasks), priorConversation, usageSnapshot)
                }.getOrElse { error -> AssistantResult(localReply(text), emptyList()).also { scope.launch { snackbar.showSnackbar(error.message ?: "AI 网关未连接，已使用本地规则") } } }
                applyActions(result.actions)
                messages = messages + ChatMessage(true, result.reply)
                aiBusy = false
            }
        }

        Scaffold(
            containerColor = Canvas,
            snackbarHost = { SnackbarHost(snackbar) },
            topBar = {
                TopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(Cream), contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.ArrowForward, null, tint = Green, modifier = Modifier.size(20.dp))
                            }
                            Spacer(Modifier.width(9.dp))
                            Column { Text("向前", color = Green, fontWeight = FontWeight.Bold, fontSize = 16.sp); Text("你的执行助手", color = Muted, fontSize = 10.sp) }
                        }
                    },
                    actions = {
                        IconButton(onClick = {
                            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                            else { activity.showReminder(); scope.launch { snackbar.showSnackbar("已发送一条测试提醒") } }
                        }) { Icon(Icons.Default.NotificationsNone, "开启提醒", tint = if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) Coral else Green) }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Canvas)
                )
            },
            bottomBar = {
                NavigationBar(containerColor = Color.White, modifier = Modifier.navigationBarsPadding()) {
                    NavigationBarItem(selected = tab == 0, onClick = { tab = 0 }, icon = { Icon(Icons.Default.CalendarToday, null) }, label = { Text("今天") })
                    NavigationBarItem(selected = tab == 1, onClick = { tab = 1 }, icon = { Icon(Icons.Default.SmartToy, null) }, label = { Text("对话") })
                    NavigationBarItem(selected = tab == 2, onClick = { tab = 2 }, icon = { Icon(Icons.Default.Lightbulb, null) }, label = { Text("记忆") })
                    NavigationBarItem(selected = tab == 3, onClick = { tab = 3 }, icon = { Icon(Icons.Default.Settings, null) }, label = { Text("设置") })
                }
            }
        ) { padding ->
            when (tab) {
                0 -> TodayScreen(padding, now, sleepTime, currentDone, unavailablePeriod, buildPlan(currentDone, deferredTasks, cancelledTasks, cancelAllTasks), ::completeTask, ::sendMessage, input, { input = it }, aiBusy)
                1 -> ChatScreen(padding, messages, ::sendMessage, input, { input = it }, aiBusy)
                2 -> MemoryScreen(padding)
                else -> SettingsScreen(
                    padding,
                    activity,
                    snackbar,
                    sleepTime,
                    wakeTime,
                    usageSnapshot,
                    onSleepTime = { time -> sleepTime = time; activity.savePlannerTime("sleep_time", time) },
                    onWakeTime = { time -> wakeTime = time; activity.savePlannerTime("wake_time", time) },
                    onUsageSnapshotChanged = { usageSnapshot = activity.usageSnapshot() }
                )
            }
        }
    }
}

@Composable
private fun TodayScreen(
    padding: PaddingValues,
    now: LocalDateTime,
    sleepTime: LocalTime,
    currentDone: Boolean,
    unavailablePeriod: Boolean,
    plan: List<PlanItem>,
    completeTask: () -> Unit,
    sendMessage: () -> Unit,
    input: TextFieldValue,
    onInput: (TextFieldValue) -> Unit,
    aiBusy: Boolean
) {
    val clock = formatClock(now.toLocalTime())
    val scheduledPlan = schedulePlan(plan, now, sleepTime)
    val availableMinutes = minutesUntilSleep(now, sleepTime)
    val scheduledMinutes = scheduledPlan.filter { it.start != null && !it.item.done }.sumOf { it.item.minutes }.toLong()
    val bufferMinutes = (availableMinutes - scheduledMinutes).coerceAtLeast(0)
    val currentItem = scheduledPlan.firstOrNull { it.start != null && !it.item.isBreak && !it.item.done }
    LazyColumn(modifier = Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 10.dp)) {
        item { Column(Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(7.dp).clip(CircleShape).background(Coral)); Spacer(Modifier.width(7.dp)); Text(dateLabel(now.toLocalDate()), color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
            Spacer(Modifier.height(10.dp)); Text("今天，先把最重要的事做下去。", color = Green, fontSize = 26.sp, fontWeight = FontWeight.Bold, lineHeight = 34.sp)
            Spacer(Modifier.height(6.dp)); Text("现在 $clock · 今天排到 ${formatClock(sleepTime)} · 还可用 ${formatDuration(availableMinutes)}", color = Muted, fontSize = 11.sp)
        } }
        item { CurrentTaskCard(currentItem, currentDone, completeTask) }
        item { SectionTitle("今日动态计划", "现在 $clock") }
        item { BudgetRow(scheduledMinutes, bufferMinutes, availableMinutes) }
        items(scheduledPlan) { item -> PlanRow(item) }
        if (unavailablePeriod) item { AdjustmentCard("有一段不可用时间已加入计划", "我会避开这段时间，并把受影响事项顺延；调整原因会在对话中说明。") }
        else if (scheduledPlan.any { it.deferredByCapacity && !it.item.done }) item { AdjustmentCard("今晚时间不够用", "超过 ${formatClock(sleepTime)} 的事项已转为可顺延，不会为了塞完任务压缩你的睡眠。") }
        item { SectionTitle("快速记录", "直接告诉我发生了什么") }
        item { Composer(input, onInput, sendMessage, aiBusy) }
    }
}

@Composable
private fun CurrentTaskCard(currentItem: ScheduledPlanItem?, done: Boolean, onDone: () -> Unit) {
    val title = when {
        done -> "已完成 · 高等数学错题回顾"
        currentItem == null -> "今天不再安排核心任务"
        else -> currentItem.item.title
    }
    val detail = when {
        done -> "接下来休息 15 分钟"
        currentItem == null -> "剩余事项已留作明天或等待你调整"
        else -> "${currentItem.item.note} · 至 ${formatClock(currentItem.end!!.toLocalTime())}"
    }
    Card(Modifier.padding(horizontal = 16.dp, vertical = 2.dp).fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = GreenSoft), shape = RoundedCornerShape(10.dp)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(if (done) Color(0xFF5AAE9D) else Coral)); Spacer(Modifier.width(10.dp)); Column(Modifier.weight(1f)) { Text("当前任务", color = Muted, fontSize = 10.sp); Text(title, color = Green, fontSize = 14.sp, fontWeight = FontWeight.Bold); Text(detail, color = Color(0xFF4C7168), fontSize = 10.sp) }
            IconButton(onClick = onDone, enabled = !done && currentItem != null, modifier = Modifier.size(36.dp).clip(CircleShape).background(if (done) Color(0xFFD5E8DE) else Color(0xFFD7EDE3))) { Icon(Icons.Default.Check, "完成当前任务", tint = Color(0xFF257264)) }
        }
    }
}

@Composable
private fun SectionTitle(title: String, detail: String) { Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 15.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { Text(title, color = Ink, fontSize = 15.sp, fontWeight = FontWeight.Bold); Text(detail, color = Muted, fontSize = 10.sp) } }

@Composable
private fun BudgetRow(scheduledMinutes: Long, bufferMinutes: Long, availableMinutes: Long) { Row(Modifier.padding(horizontal = 20.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Metric("任务已排", formatDuration(scheduledMinutes)); Metric("保留缓冲", formatDuration(bufferMinutes)); Metric("剩余可用", formatDuration(availableMinutes)) } }
@Composable
private fun Metric(label: String, value: String) { Column { Text(label, color = Muted, fontSize = 10.sp); Text(value, color = Color(0xFF34544D), fontSize = 11.sp, fontWeight = FontWeight.SemiBold) } }

@Composable
private fun PlanRow(scheduled: ScheduledPlanItem) {
    val item = scheduled.item
    val time = when {
        item.done -> "完成"
        scheduled.deferredByCapacity -> "明日"
        else -> formatClock(scheduled.start!!.toLocalTime())
    }
    val note = when {
        item.done -> "已完成"
        scheduled.deferredByCapacity -> if (item.deferred) "因今天安排变化而顺延" else "超过今晚可用时间，顺延"
        else -> "${item.note} · 至 ${formatClock(scheduled.end!!.toLocalTime())} · ${item.minutes} 分钟"
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.Top) { Text(time, color = Muted, fontSize = 10.sp, modifier = Modifier.width(39.dp)); Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(18.dp)) { Box(Modifier.size(9.dp).border(2.dp, item.tone, CircleShape).clip(CircleShape).background(Rail)); Box(Modifier.width(1.dp).height(39.dp).background(Color(0xFFD2DAD1))) }; Spacer(Modifier.width(7.dp)); Column(Modifier.weight(1f)) { Text(item.title, color = if (item.done || scheduled.deferredByCapacity) Muted else Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, textDecoration = if (item.done) androidx.compose.ui.text.style.TextDecoration.LineThrough else null, maxLines = 1, overflow = TextOverflow.Ellipsis); Text(note, color = Muted, fontSize = 10.sp) }; if (item.done) Icon(Icons.Default.TaskAlt, null, tint = Color(0xFF4A897D), modifier = Modifier.size(17.dp)) }
}

@Composable
private fun AdjustmentCard(title: String, body: String) { Card(Modifier.padding(horizontal = 20.dp, vertical = 10.dp).fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFFE1EDE6)), shape = RoundedCornerShape(7.dp)) { Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) { Icon(Icons.Default.AutoAwesome, null, tint = Color(0xFF2C655B), modifier = Modifier.size(16.dp)); Column { Text(title, color = Color(0xFF2C655B), fontSize = 11.sp, fontWeight = FontWeight.Bold); Text(body, color = Color(0xFF56756D), fontSize = 10.sp, lineHeight = 15.sp) } } } }

@Composable
private fun Composer(input: TextFieldValue, onInput: (TextFieldValue) -> Unit, onSend: () -> Unit, aiBusy: Boolean = false) { Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Color.White).border(1.dp, Color(0xFFD6DED4), RoundedCornerShape(9.dp)).padding(8.dp), verticalAlignment = Alignment.Bottom) { OutlinedTextField(value = input, onValueChange = onInput, enabled = !aiBusy, placeholder = { Text(if (aiBusy) "向前正在思考…" else "说进展、临时安排，或直接聊天…", color = Color(0xFF94A19C), fontSize = 12.sp) }, modifier = Modifier.weight(1f), minLines = 1, maxLines = 3, colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(unfocusedBorderColor = Color.Transparent, focusedBorderColor = Color.Transparent), trailingIcon = { Icon(Icons.Default.Mic, "语音输入", tint = Muted) }); IconButton(onClick = onSend, enabled = input.text.isNotBlank() && !aiBusy, modifier = Modifier.size(37.dp).clip(RoundedCornerShape(6.dp)).background(if (input.text.isBlank() || aiBusy) Color(0xFFE9EDE8) else Green)) { Icon(Icons.Default.Send, "发送", tint = if (input.text.isBlank() || aiBusy) Color(0xFF93A69F) else Color.White, modifier = Modifier.size(18.dp)) } } }

@Composable
private fun ChatScreen(padding: PaddingValues, messages: List<ChatMessage>, onSend: () -> Unit, input: TextFieldValue, onInput: (TextFieldValue) -> Unit, aiBusy: Boolean) {
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) { listState.animateScrollToItem((messages.size - 1).coerceAtLeast(0)) }
    Column(Modifier.fillMaxSize().padding(padding)) {
        SectionTitle("对话", "今天")
        LazyColumn(
            modifier = Modifier.weight(1f),
            state = listState,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)
        ) {
            items(messages) { message ->
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 6.dp),
                    horizontalArrangement = if (message.fromAssistant) Arrangement.Start else Arrangement.End,
                    verticalAlignment = Alignment.Top
                ) {
                    if (message.fromAssistant) {
                        Icon(Icons.Default.SmartToy, null, tint = Color.White, modifier = Modifier.size(28.dp).clip(RoundedCornerShape(7.dp)).background(Green).padding(6.dp))
                        Spacer(Modifier.width(7.dp))
                    }
                    Text(
                        message.text,
                        color = if (message.fromAssistant) Ink else Color.White,
                        fontSize = 13.sp,
                        lineHeight = 21.sp,
                        modifier = Modifier
                            .widthIn(max = if (message.fromAssistant) 286.dp else 250.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (message.fromAssistant) Color(0xFFE9EFEA) else Green)
                            .padding(11.dp)
                    )
                }
            }
        }
        Composer(input, onInput, onSend, aiBusy)
    }
}

@Composable
private fun MemoryScreen(padding: PaddingValues) {
    val memories = listOf("9 月 5 日补考", "近期复习进度", "个人长期目标", "今日精力记录")
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(padding),
        contentPadding = PaddingValues(20.dp)
    ) {
        item {
            Text("记忆库", color = Green, fontSize = 25.sp, fontWeight = FontWeight.Bold)
            Text("电脑端 Obsidian 知识库的同步内容", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 5.dp, bottom = 18.dp))
            Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = GreenSoft)) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Visibility, null, tint = Color(0xFF277267))
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text("电脑端桥接已配置", color = Green, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text("手机端将在云端同步接入后读取完整资料", color = Muted, fontSize = 11.sp)
                    }
                }
            }
        }
        items(memories) { label ->
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Lightbulb, null, tint = Color(0xFFB77D55), modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Text(label, color = Ink, fontSize = 13.sp)
                Spacer(Modifier.weight(1f))
                Text("可读取", color = Muted, fontSize = 10.sp)
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    padding: PaddingValues,
    activity: MainActivity,
    snackbar: SnackbarHostState,
    sleepTime: LocalTime,
    wakeTime: LocalTime,
    usageSnapshot: UsageMonitorSnapshot,
    onSleepTime: (LocalTime) -> Unit,
    onWakeTime: (LocalTime) -> Unit,
    onUsageSnapshotChanged: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var usageAccess by remember { mutableStateOf(activity.hasUsageAccess()) }
    LaunchedEffect(Unit) {
        while (true) {
            usageAccess = activity.hasUsageAccess()
            delay(1_000)
        }
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(padding),
        contentPadding = PaddingValues(20.dp)
    ) {
        item {
            Text("设置", color = Green, fontSize = 25.sp, fontWeight = FontWeight.Bold)
            Text("让向前更贴合你的执行节奏", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 5.dp, bottom = 18.dp))
        }
        item { TimeSettingRow(Icons.Default.Bedtime, "今晚睡觉时间", formatClock(sleepTime), "今日可用时间按此截止", onClick = {
            TimePickerDialog(activity, { _, hour, minute -> onSleepTime(LocalTime.of(hour, minute)) }, sleepTime.hour, sleepTime.minute, true).show()
        }) }
        item { TimeSettingRow(Icons.Default.CalendarToday, "明天起床时间", formatClock(wakeTime), "明早计划从这个时间开始", onClick = {
            TimePickerDialog(activity, { _, hour, minute -> onWakeTime(LocalTime.of(hour, minute)) }, wakeTime.hour, wakeTime.minute, true).show()
        }) }
        item { SettingRow(Icons.Default.NotificationsNone, "任务提醒", "安卓通知通道已准备", true) }
        item { SettingRow(Icons.Default.Refresh, "本地知识库", "电脑端 E: 盘桥接 · 云端同步待接入", false) }
        item { SettingRow(Icons.Default.Bedtime, "免打扰时段", "${formatClock(sleepTime)} - ${formatClock(wakeTime)}", true) }
        item {
            AppUsageMonitorCard(
                activity = activity,
                snackbar = snackbar,
                snapshot = usageSnapshot,
                usageAccess = usageAccess,
                onChanged = onUsageSnapshotChanged
            )
        }
        item {
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = {
                    activity.showReminder()
                    scope.launch { snackbar.showSnackbar("已发送一条测试提醒") }
                },
                colors = ButtonDefaults.buttonColors(containerColor = Green),
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.NotificationsNone, null, modifier = Modifier.size(17.dp))
                Spacer(Modifier.width(7.dp))
                Text("发送测试提醒")
            }
        }
    }
}

@Composable
private fun AppUsageMonitorCard(
    activity: MainActivity,
    snackbar: SnackbarHostState,
    snapshot: UsageMonitorSnapshot,
    usageAccess: Boolean,
    onChanged: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var enabled by remember(snapshot.enabled) { mutableStateOf(snapshot.enabled) }
    val installedApps = remember { activity.installedUsageApps() }
    var selectedPackages by remember(snapshot.targetApps) {
        mutableStateOf(snapshot.targetApps.map { it.packageName }.toSet())
    }
    var autoTopTen by remember(snapshot.autoTopTen) { mutableStateOf(snapshot.autoTopTen) }
    var dailyLimit by remember(snapshot.dailyLimitMinutes) { mutableStateOf(snapshot.dailyLimitMinutes.toString()) }
    var sessionLimit by remember(snapshot.sessionLimitMinutes) { mutableStateOf(snapshot.sessionLimitMinutes.toString()) }

    Card(
        Modifier.fillMaxWidth().padding(top = 14.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFEAF1EC)),
        shape = RoundedCornerShape(9.dp)
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Visibility, null, tint = Color(0xFF277267), modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(9.dp))
                Column(Modifier.weight(1f)) {
                    Text("应用使用监控", color = Green, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    Text("只读取应用名称和使用时长，不读取屏幕内容或对话", color = Muted, fontSize = 10.sp)
                }
                Switch(
                    checked = enabled,
                    onCheckedChange = { checked ->
                        if (!usageAccess) {
                            activity.openUsageAccessSettings()
                            scope.launch { snackbar.showSnackbar("请先在系统设置中开启使用情况访问权限") }
                        } else {
                            enabled = checked
                            activity.setUsageMonitorEnabled(checked)
                            onChanged()
                        }
                    }
                )
            }
            if (!usageAccess) {
                Text("需要一次性开启 Android 的“使用情况访问权限”，才能识别当前应用和累计时长。", color = Color(0xFF7A5F42), fontSize = 10.sp, lineHeight = 15.sp)
                TextButton(onClick = { activity.openUsageAccessSettings() }) { Text("去开启权限", color = Green, fontSize = 12.sp) }
            }
            Text("关注应用", color = Green, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Text("勾选后才会按下方阈值提醒。可多选。", color = Muted, fontSize = 10.sp)
            if (installedApps.isEmpty()) {
                Text("暂未读取到可启动的第三方应用。", color = Color(0xFF7A5F42), fontSize = 10.sp)
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 228.dp)
                        .border(1.dp, Color(0xFFD4DED8), RoundedCornerShape(7.dp))
                        .padding(horizontal = 4.dp)
                ) {
                    items(installedApps, key = { it.packageName }) { app ->
                        val checked = app.packageName in selectedPackages
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selectedPackages = if (checked) selectedPackages - app.packageName else selectedPackages + app.packageName
                                }
                                .padding(vertical = 3.dp, horizontal = 3.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Checkbox(
                                checked = checked,
                                onCheckedChange = { isChecked ->
                                    selectedPackages = if (isChecked) selectedPackages + app.packageName else selectedPackages - app.packageName
                                }
                            )
                            Column(Modifier.weight(1f)) {
                                Text(app.appName, color = Ink, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(app.packageName, color = Muted, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = dailyLimit,
                    onValueChange = { dailyLimit = it.filter(Char::isDigit).take(4) },
                    label = { Text("每日上限（分钟）", fontSize = 11.sp) },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                OutlinedTextField(
                    value = sessionLimit,
                    onValueChange = { sessionLimit = it.filter(Char::isDigit).take(4) },
                    label = { Text("连续上限（分钟）", fontSize = 11.sp) },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("自动记录当天使用前 10", color = Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Text("供 AI 和晚间复盘查看，不会逐个发送超时提醒。", color = Muted, fontSize = 10.sp)
                }
                Switch(checked = autoTopTen, onCheckedChange = { autoTopTen = it })
            }
            Button(
                onClick = {
                    if (selectedPackages.isEmpty() && !autoTopTen) {
                        scope.launch { snackbar.showSnackbar("请至少选择关注应用，或开启自动前 10 记录") }
                    } else {
                        activity.saveUsageMonitorTargets(installedApps.filter { it.packageName in selectedPackages })
                        activity.saveUsageAutoTopTen(autoTopTen)
                        activity.saveUsageMonitorLimits(dailyLimit.toIntOrNull() ?: 30, sessionLimit.toIntOrNull() ?: 20)
                        if (enabled && usageAccess) activity.setUsageMonitorEnabled(true)
                        onChanged()
                        scope.launch { snackbar.showSnackbar("应用使用监控设置已保存") }
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = Green),
                modifier = Modifier.fillMaxWidth()
            ) { Text("保存监控设置", fontSize = 12.sp) }
            if (snapshot.targetApps.isNotEmpty()) {
                snapshot.targetApps.forEach { target ->
                    Text(
                        "关注 · ${target.appName} 今日 ${target.dailyMinutes} 分钟 · 当前连续 ${target.currentSessionMinutes} 分钟" +
                            if (snapshot.updatedAt.isBlank()) "" else " · 已更新",
                        color = Color(0xFF4C7168),
                        fontSize = 10.sp
                    )
                }
            }
            if (snapshot.autoTopTen) {
                val preview = snapshot.topApps.take(3).joinToString(" · ") { "${it.appName} ${it.minutes} 分" }
                Text(
                    if (preview.isBlank()) "当天前 10 会在首次检查后显示" else "今日使用前 10：$preview",
                    color = Color(0xFF4C7168),
                    fontSize = 10.sp,
                    lineHeight = 15.sp
                )
            }
            if (snapshot.lastEvent.isNotBlank()) {
                Text("最近事件：${snapshot.lastEvent}", color = Color(0xFF7A5F42), fontSize = 10.sp, lineHeight = 15.sp)
            }
        }
    }
}

@Composable
private fun TimeSettingRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    time: String,
    detail: String,
    onClick: () -> Unit
) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = Color(0xFF277267), modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(detail, color = Muted, fontSize = 10.sp)
        }
        Text(time, color = Green, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun SettingRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    detail: String,
    enabled: Boolean
) {
    Row(Modifier.fillMaxWidth().padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = if (enabled) Color(0xFF277267) else Muted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(detail, color = Muted, fontSize = 10.sp)
        }
        Box(Modifier.size(8.dp).clip(CircleShape).background(if (enabled) Color(0xFF58AE9D) else Color(0xFFD0A07C)))
    }
}

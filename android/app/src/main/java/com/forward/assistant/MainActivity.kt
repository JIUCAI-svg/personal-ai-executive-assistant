package com.forward.assistant

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.TimePickerDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.CameraAlt
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
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
import kotlin.math.abs

private val Ink = Color(0xFF20312F)
private val Green = Color(0xFF173D39)
private val GreenSoft = Color(0xFFE5EEE8)
private val Canvas = Color(0xFFF5F6F2)
private val Rail = Color(0xFFF0F2ED)
private val Cream = Color(0xFFF1E4C9)
private val Coral = Color(0xFFE99C68)
private val Muted = Color(0xFF7A8984)

private fun AnnotatedString.Builder.appendMarkdownInline(value: String, color: Color) {
    val pattern = Regex("(`[^`\\n]+`|\\*\\*[^*\\n]+?\\*\\*|__[^_\\n]+?__)")
    var cursor = 0
    pattern.findAll(value).forEach { match ->
        if (match.range.first > cursor) append(value.substring(cursor, match.range.first).replace("**", "").replace("__", ""))
        val token = match.value
        if (token.startsWith("`")) {
            withStyle(SpanStyle(color = Color(0xFF5A5035), background = Color(0xFFF3EAD5))) { append(token.substring(1, token.length - 1)) }
        } else {
            withStyle(SpanStyle(color = color, fontWeight = FontWeight.Bold)) { append(token.substring(2, token.length - 2)) }
        }
        cursor = match.range.last + 1
    }
    if (cursor < value.length) append(value.substring(cursor).replace("**", "").replace("__", ""))
}

@Composable
private fun MarkdownText(value: String, color: Color, fontSize: androidx.compose.ui.unit.TextUnit, lineHeight: androidx.compose.ui.unit.TextUnit) {
    Text(
        text = buildAnnotatedString {
            value.replace("\r", "").split('\n').forEachIndexed { index, line ->
                if (index > 0) append("\n")
                val trimmed = line.trim()
                if (trimmed.isEmpty()) return@forEachIndexed
                val heading = Regex("^#{1,3}\\s+(.+)$").matchEntire(trimmed)
                val bullet = Regex("^[-*+]\\s+(.+)$").matchEntire(trimmed)
                when {
                    heading != null -> withStyle(SpanStyle(color = Color(0xFF245D54), fontWeight = FontWeight.Bold)) { appendMarkdownInline(heading.groupValues[1], color) }
                    bullet != null -> { append("• "); appendMarkdownInline(bullet.groupValues[1], color) }
                    else -> appendMarkdownInline(line, color)
                }
            }
        },
        color = color,
        fontSize = fontSize,
        lineHeight = lineHeight
    )
}

data class PlanItem(
    val title: String,
    val note: String,
    val minutes: Int,
    val tone: Color,
    val flexible: Boolean = false,
    val done: Boolean = false,
    val deferred: Boolean = false,
    val cancelled: Boolean = false,
    val isBreak: Boolean = false,
    val id: String = "",
    val priority: Int = 3,
    val actualMinutes: Int = 0,
    val actualSeconds: Long = 0,
    val isSubtask: Boolean = false,
    val parentTitle: String = ""
)

data class ScheduledPlanItem(
    val item: PlanItem,
    val start: LocalDateTime? = null,
    val end: LocalDateTime? = null,
    val deferredByCapacity: Boolean = false
)

data class ChatMessage(val fromAssistant: Boolean, val text: String, val imageData: List<String> = emptyList())

private fun decodeImageData(data: String?): Bitmap? = runCatching {
    val encoded = data?.substringAfter(',', "")?.takeIf { it.isNotBlank() } ?: return null
    val bytes = Base64.decode(encoded, Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}.getOrNull()

data class BreakTimerState(
    val remainingSeconds: Long = 15 * 60L,
    val running: Boolean = true
)

data class AssistantAction(
    val type: String,
    val minutes: Int? = null,
    val time: String? = null,
    val task: String? = null,
    val title: String? = null,
    val start: String? = null,
    val end: String? = null,
    val date: String? = null,
    val label: String? = null,
    val repeat: String? = null,
    val alarmId: String? = null,
    val dueAt: String? = null,
    val projectId: String? = null
    , val visible: Boolean? = null
)
data class DeviceActionResult(val action: AssistantAction, val result: AlarmOperationResult)
data class AssistantResult(
    val reply: String,
    val actions: List<AssistantAction>,
    val deviceActions: List<AssistantAction> = emptyList(),
    val plan: RemotePlan? = null,
    val state: RemoteState? = null,
    val threadId: String? = null
)
data class AiProviderOption(val id: String, val name: String, val models: List<String>, val active: Boolean = false)

private fun defaultConversationOptions(mode: String, projectId: String? = null): ConversationOptions {
    val temporary = mode == "temporary"
    return ConversationOptions(
        mode = mode,
        projectId = projectId,
        memoryScope = !temporary,
        saveFullConversation = !temporary,
        allowMemoryDistillation = !temporary
    )
}

private fun ConversationThread.toConversationOptions() = ConversationOptions(
    mode = mode,
    projectId = projectId,
    memoryScope = memoryScope,
    saveFullConversation = saveFullConversation,
    allowMemoryDistillation = allowMemoryDistillation,
    projectName = projectName
)

private fun conversationModeLabel(mode: String): String = when (mode) {
    "temporary" -> "临时聊天"
    "project" -> "项目对话"
    "daily_planning" -> "每日规划"
    else -> "普通助手"
}

private fun conversationScopeLabel(options: ConversationOptions): String = buildList {
    add(if (options.memoryScope) "读记忆" else "不读记忆")
    add(if (options.saveFullConversation) "存原对话" else "不存原对话")
    add(if (options.allowMemoryDistillation) "可沉淀" else "不沉淀")
}.joinToString(" · ")

private fun formatThreadTime(value: String): String = value
    .replace("T", " ")
    .replace(Regex("""\.\d+Z?$"""), "")
    .take(16)

private val aiGatewayUrl get() = BuildConfig.AI_GATEWAY_URL
private val aiGatewayToken get() = BuildConfig.AI_GATEWAY_TOKEN

private const val DEFAULT_SLEEP_MINUTES = 23 * 60 + 30
private const val DEFAULT_WAKE_MINUTES = 8 * 60

private fun LocalTime.toMinutesOfDay() = hour * 60 + minute

private fun localTimeFromMinutes(minutes: Int) = LocalTime.of((minutes / 60) % 24, minutes % 60)

private fun formatClock(time: LocalTime) = time.format(DateTimeFormatter.ofPattern("HH:mm"))

private fun formatElapsed(seconds: Long): String {
    val total = seconds.coerceAtLeast(0)
    return "%02d:%02d:%02d".format(total / 3600, (total / 60) % 60, total % 60)
}

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

private fun remoteTone(priority: Int): Color = when {
    priority >= 5 -> Coral
    priority >= 3 -> Color(0xFF55A496)
    else -> Color(0xFF968BD0)
}

private fun remoteScheduledItem(item: RemotePlanItem, deferred: Boolean): ScheduledPlanItem {
    val planItem = PlanItem(item.title, listOf(item.project, item.notes).filter(String::isNotBlank).joinToString(" · "), item.minutes, remoteTone(item.priority), flexible = deferred, deferred = deferred, id = item.id, priority = item.priority, actualMinutes = item.actualMinutes, actualSeconds = item.actualSeconds, isSubtask = item.parentTaskId != null, parentTitle = item.parentTitle)
    if (deferred || item.start.isBlank() || item.end.isBlank()) return ScheduledPlanItem(planItem, deferredByCapacity = true)
    val date = runCatching { LocalDate.parse(item.date) }.getOrDefault(LocalDate.now())
    val start = parseClock(item.start) ?: return ScheduledPlanItem(planItem, deferredByCapacity = true)
    val end = parseClock(item.end) ?: return ScheduledPlanItem(planItem, deferredByCapacity = true)
    return ScheduledPlanItem(planItem, date.atTime(start), date.atTime(end))
}

private fun normalizeRemotePlanItems(remote: RemotePlan, now: LocalDateTime): List<ScheduledPlanItem> {
    val source = remote.scheduled + remote.sleeping + remote.deferred
    val hasMissingTimes = remote.scheduled.any { it.start.isBlank() || it.end.isBlank() } ||
        (remote.scheduled.isEmpty() && remote.deferred.isNotEmpty())
    // If the gateway gives task totals but no actual slots, the slots are stale
    // regardless of the cached capacity number. Rebuild them for the live view.
    if (!hasMissingTimes) {
        return remote.scheduled.map { remoteScheduledItem(it, false) } + remote.sleeping.map { remoteScheduledItem(it, true) } + remote.deferred.map { remoteScheduledItem(it, true) }
    }
    // A stale snapshot can contain the right totals but blank schedule fields.
    // Keep the server order and rebuild only the visual time slots locally.
    var cursor = now.withSecond(0).withNano(0).plusMinutes(5)
    return source.filter { it.status != "done" }.map { item ->
        val start = cursor
        val end = cursor.plusMinutes(item.minutes.toLong())
        cursor = end
        val planItem = PlanItem(item.title, listOf(item.project, item.notes).filter(String::isNotBlank).joinToString(" · "), item.minutes, remoteTone(item.priority), id = item.id, priority = item.priority, actualMinutes = item.actualMinutes, actualSeconds = item.actualSeconds, isSubtask = item.parentTaskId != null, parentTitle = item.parentTitle)
        ScheduledPlanItem(planItem, start, end)
    }
}

private fun parseClock(text: String): LocalTime? {
    val match = Regex("""(?<!\d)([01]?\d|2[0-3])\s*(?:点|:|：)\s*([0-5]?\d)?(?:分)?""").find(text) ?: return null
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
    context: Context,
    message: String,
    now: LocalDateTime,
    sleepTime: LocalTime,
    wakeTime: LocalTime,
    plan: List<PlanItem>,
    conversation: List<ChatMessage>,
    usageSnapshot: UsageMonitorSnapshot,
    providerId: String,
    model: String,
    agentEngine: String,
    threadId: String?,
    conversationOptions: ConversationOptions,
    attachments: List<String> = emptyList()
): AssistantResult = withContext(Dispatchers.IO) {
    check(aiGatewayUrl.isNotBlank()) { "AI 网关地址尚未配置" }
    val payload = JSONObject().apply {
        put("message", message)
        if (attachments.isNotEmpty()) put("attachments", JSONArray(attachments))
        if (!threadId.isNullOrBlank()) put("thread_id", threadId)
        put("conversation_mode", conversationOptions.mode)
        conversationOptions.projectId?.takeIf { it.isNotBlank() }?.let { put("project_id", it) }
        conversationOptions.projectName?.takeIf { it.isNotBlank() }?.let { put("project", it) }
        put("conversation_options", JSONObject().apply {
            put("memory_scope", conversationOptions.memoryScope)
            put("save_full_conversation", conversationOptions.saveFullConversation)
            put("allow_memory_distillation", conversationOptions.allowMemoryDistillation)
            conversationOptions.projectId?.takeIf { it.isNotBlank() }?.let { put("project_id", it) }
            conversationOptions.projectName?.takeIf { it.isNotBlank() }?.let { put("project", it) }
        })
        if (providerId.isNotBlank()) put("provider_id", providerId)
        if (model.isNotBlank()) put("model", model)
        if (agentEngine.isNotBlank()) put("agent_engine", agentEngine)
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
            usageSnapshot.deviceActivity?.let { activity -> put("device_activity", JSONObject().apply {
                put("date", activity.date); put("first_active_at", activity.firstActiveAt); put("last_active_at", activity.lastActiveAt)
                put("first_foreground_app", activity.firstForegroundApp); put("last_foreground_app", activity.lastForegroundApp)
                put("updated_at", usageSnapshot.updatedAt); put("source", "android-usage-monitor")
            }) }
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
        AssistantSessionStore.token(context).takeIf { it.isNotBlank() }?.let { setRequestProperty("Authorization", "Bearer $it") }
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
                        minutes = if (action.has("minutes")) action.optInt("minutes") else null,
                        time = action.optString("time").ifBlank { null },
                        task = action.optString("task").ifBlank { null },
                        title = action.optString("title").ifBlank { null },
                        start = action.optString("start").ifBlank { null },
                        end = action.optString("end").ifBlank { null },
                        date = action.optString("date").ifBlank { null },
                        label = action.optString("label").ifBlank { null },
                        repeat = action.optString("repeat").ifBlank { null },
                        alarmId = action.optString("alarm_id").ifBlank { null }
                        , visible = if (action.has("visible")) action.optBoolean("visible") else null
                    )
                }
            }.orEmpty(),
            deviceActions = json.optJSONArray("deviceActions")?.let { array ->
                (0 until array.length()).mapNotNull { index ->
                    val action = array.optJSONObject(index) ?: return@mapNotNull null
                    AssistantAction(
                        type = action.optString("type"),
                        minutes = if (action.has("minutes")) action.optInt("minutes") else null,
                        time = action.optString("time").ifBlank { null },
                        date = action.optString("date").ifBlank { null },
                        label = action.optString("label").ifBlank { null },
                        repeat = action.optString("repeat").ifBlank { null },
                        alarmId = action.optString("id").ifBlank { action.optString("alarm_id").ifBlank { null } }
                    )
                }
            }.orEmpty(),
            plan = parseRemotePlan(json.optJSONObject("plan") ?: json.optJSONObject("state")?.optJSONObject("plan")),
            state = parseRemoteState(json.optJSONObject("state")),
            threadId = json.optJSONObject("thread")?.optString("id")?.ifBlank { null }
        )
    } catch (error: Exception) {
        Log.e("ForwardAssistant", "AI gateway request failed: $aiGatewayUrl", error)
        throw error
    } finally {
        connection.disconnect()
    }
}

private suspend fun requestAiProviders(context: Context): List<AiProviderOption> = withContext(Dispatchers.IO) {
    val providersUrl = aiGatewayUrl.removeSuffix("/api/assistant/respond") + "/api/assistant/providers"
    val connection = (URL(providersUrl).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 8_000
        readTimeout = 15_000
        if (aiGatewayToken.isNotBlank()) setRequestProperty("x-forward-token", aiGatewayToken)
        AssistantSessionStore.token(context).takeIf { it.isNotBlank() }?.let { setRequestProperty("Authorization", "Bearer $it") }
    }
    try {
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        check(connection.responseCode in 200..299) { JSONObject(body).optString("error", "读取 AI 提供商失败") }
        val array = JSONObject(body).optJSONArray("providers") ?: return@withContext emptyList()
        (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val models = item.optJSONArray("models")?.let { values -> (0 until values.length()).map { values.optString(it) }.filter(String::isNotBlank) }.orEmpty()
            AiProviderOption(item.optString("id"), item.optString("name"), models, item.optBoolean("active"))
        }
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

    fun aiProviderId(): String = getSharedPreferences("ai", Context.MODE_PRIVATE).getString("provider_id", "").orEmpty()
    fun aiModel(): String = getSharedPreferences("ai", Context.MODE_PRIVATE).getString("model", "").orEmpty()
    fun aiAgentEngine(): String = getSharedPreferences("ai", Context.MODE_PRIVATE).getString("agent_engine", "legacy").orEmpty()
    fun saveAiSelection(providerId: String, model: String, agentEngine: String = aiAgentEngine()) {
        getSharedPreferences("ai", Context.MODE_PRIVATE).edit()
            .putString("provider_id", providerId).putString("model", model).putString("agent_engine", agentEngine).apply()
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

    fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
        }
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
        var breakTimer by remember { mutableStateOf<BreakTimerState?>(null) }
        var deferredTasks by remember { mutableStateOf(activity.plannerSet("deferred_tasks")) }
        var cancelledTasks by remember { mutableStateOf(activity.plannerSet("cancelled_tasks")) }
        var cancelAllTasks by remember { mutableStateOf(activity.plannerFlag("cancel_all_tasks")) }
        var aiBusy by remember { mutableStateOf(false) }
        var input by remember { mutableStateOf(TextFieldValue()) }
        var sleepTime by remember { mutableStateOf(activity.plannerTime("sleep_time", DEFAULT_SLEEP_MINUTES)) }
        var wakeTime by remember { mutableStateOf(activity.plannerTime("wake_time", DEFAULT_WAKE_MINUTES)) }
        var usageSnapshot by remember { mutableStateOf(activity.usageSnapshot()) }
        var aiProviders by remember { mutableStateOf(emptyList<AiProviderOption>()) }
        var selectedProviderId by remember { mutableStateOf(activity.aiProviderId()) }
        var selectedModel by remember { mutableStateOf(activity.aiModel()) }
        var agentEngine by remember { mutableStateOf(activity.aiAgentEngine()) }
        var remotePlan by remember { mutableStateOf<RemotePlan?>(null) }
        var remoteMemories by remember { mutableStateOf(emptyList<RemoteMemory>()) }
        var memoryStatus by remember { mutableStateOf<MemoryRunStatus?>(null) }
        var remoteProjects by remember { mutableStateOf(emptyList<RemoteProject>()) }
        var remoteTasks by remember { mutableStateOf(emptyList<RemoteTask>()) }
        var remoteLongTasks by remember { mutableStateOf(emptyList<RemoteLongTask>()) }
        var remoteThreadId by remember { mutableStateOf<String?>(null) }
        var showSleepPlan by remember { mutableStateOf(false) }
        var initialStateLoading by remember { mutableStateOf(true) }
        var conversationOptions by remember { mutableStateOf(defaultConversationOptions("assistant")) }
        var threads by remember { mutableStateOf(emptyList<ConversationThread>()) }
        var threadLoading by remember { mutableStateOf(false) }
        var now by remember { mutableStateOf(LocalDateTime.now()) }
        var messages by remember { mutableStateOf(emptyList<ChatMessage>()) }
        var pendingImageData by remember { mutableStateOf<List<String>>(emptyList()) }
        var showProjects by remember { mutableStateOf(false) }
        var showCreateProject by remember { mutableStateOf(false) }
        var drawerOpen by remember { mutableStateOf(false) }
        var projectPageId by remember { mutableStateOf<String?>(null) }
        val drawerState = androidx.compose.material3.rememberDrawerState(androidx.compose.material3.DrawerValue.Closed)
        LaunchedEffect(drawerOpen) {
            if (drawerOpen) drawerState.open() else drawerState.close()
        }
        LaunchedEffect(drawerState.currentValue) {
            if (drawerState.currentValue == androidx.compose.material3.DrawerValue.Closed) drawerOpen = false
        }
        LaunchedEffect(breakTimer?.running) {
            while (breakTimer?.running == true) {
                delay(1000)
                val current = breakTimer ?: break
                if (current.remainingSeconds <= 1L) {
                    breakTimer = null
                    currentDone = false
                    break
                }
                breakTimer = current.copy(remainingSeconds = current.remainingSeconds - 1L)
            }
        }
        LaunchedEffect(remotePlan) {
            UsageMonitorStore.savePlanSummary(activity, remotePlan)
        }
        LaunchedEffect(Unit) {
            runCatching { gatewayFetchState(activity) }.onSuccess { state ->
                    remotePlan = state.plan
                    remoteMemories = state.memories
                    remoteProjects = state.projects
                    remoteTasks = state.tasks
                    remoteLongTasks = state.longTasks
                    showSleepPlan = state.plan?.showSleepPlan ?: showSleepPlan
                    runCatching { gatewayMemoryStatus(activity) }.onSuccess { memoryStatus = it }
                    parseClock(state.plan?.sleepTime.orEmpty())?.let { sleepTime = it }
                    parseClock(state.plan?.wakeTime.orEmpty())?.let { wakeTime = it }
                }.also { initialStateLoading = false }
            runCatching { gatewayListThreads(activity) }.onSuccess { loadedThreads ->
                threads = loadedThreads
                val savedThreadId = AssistantSessionStore.currentThread(activity)
                val resume = loadedThreads.firstOrNull { it.id == savedThreadId }
                    ?: loadedThreads.firstOrNull { it.mode != "temporary" }
                    ?: loadedThreads.firstOrNull()
                if (resume != null) {
                    threadLoading = true
                    runCatching { gatewayLoadThread(activity, resume.id) }.onSuccess { detail ->
                        remoteThreadId = detail.thread.id
                        AssistantSessionStore.saveCurrentThread(activity, detail.thread.id)
                        conversationOptions = detail.thread.toConversationOptions()
                        messages = detail.messages
                    }
                    threadLoading = false
                }
            }
            runCatching { requestAiProviders(activity) }.onSuccess { providers ->
                aiProviders = providers
                val provider = providers.firstOrNull { it.id == selectedProviderId } ?: providers.firstOrNull { it.active } ?: providers.firstOrNull()
                if (provider != null) {
                    if (selectedProviderId.isBlank() || providers.none { it.id == selectedProviderId }) selectedProviderId = provider.id
                    val selectedProvider = providers.firstOrNull { it.id == selectedProviderId } ?: provider
                    if (selectedModel.isBlank() || selectedModel !in selectedProvider.models) selectedModel = selectedProvider.models.firstOrNull().orEmpty()
                    activity.saveAiSelection(selectedProviderId, selectedModel)
                }
            }
            while (true) {
                now = LocalDateTime.now()
                usageSnapshot = activity.usageSnapshot()
                // The plan contains a server-side planning window. Refresh it as the
                // clock advances so midnight and sleep-time boundaries do not leave
                // yesterday's "tomorrow/deferred" labels on screen.
                if (!aiBusy && !threadLoading) {
                    runCatching { gatewayFetchState(activity) }.onSuccess { state ->
                        remotePlan = state.plan
                        remoteMemories = state.memories
                        remoteProjects = state.projects
                        remoteTasks = state.tasks
                        remoteLongTasks = state.longTasks
                        showSleepPlan = state.plan?.showSleepPlan ?: showSleepPlan
                        parseClock(state.plan?.sleepTime.orEmpty())?.let { sleepTime = it }
                        parseClock(state.plan?.wakeTime.orEmpty())?.let { wakeTime = it }
                    }
                }
                delay(60_000)
            }
        }
        val snackbar = remember { SnackbarHostState() }
        val scope = rememberCoroutineScope()

        fun applyLoadedThread(detail: RemoteThreadDetail) {
            remoteThreadId = detail.thread.id
            AssistantSessionStore.saveCurrentThread(activity, detail.thread.id)
            conversationOptions = detail.thread.toConversationOptions()
            messages = detail.messages
            input = TextFieldValue()
        }

        fun loadThread(thread: ConversationThread) {
            if (aiBusy || threadLoading) return
            scope.launch {
                threadLoading = true
                runCatching { gatewayLoadThread(activity, thread.id) }
                    .onSuccess { detail -> applyLoadedThread(detail); tab = 1 }
                    .onFailure { snackbar.showSnackbar(it.message ?: "读取历史对话失败") }
                threadLoading = false
            }
        }

        fun startConversation(options: ConversationOptions, destinationTab: Int = 1) {
            if (aiBusy || threadLoading) return
            scope.launch {
                threadLoading = true
                runCatching { gatewayCreateThread(activity, options) }
                    .onSuccess { thread ->
                        remoteThreadId = thread.id
                        AssistantSessionStore.saveCurrentThread(activity, thread.id)
                        conversationOptions = thread.toConversationOptions()
                        messages = emptyList()
                        input = TextFieldValue()
                        if (thread.saveFullConversation) {
                            threads = listOf(thread) + threads.filterNot { it.id == thread.id }
                        }
                        tab = destinationTab
                    }
                    .onFailure { snackbar.showSnackbar(it.message ?: "新建对话失败") }
                threadLoading = false
            }
        }

        fun updateConversationOptions(updated: ConversationOptions) {
            conversationOptions = updated
            val threadId = remoteThreadId
            val existsRemotely = threadId != null && threads.any { it.id == threadId }
            if (!existsRemotely) {
                scope.launch { snackbar.showSnackbar("会话设置已更新，将从下一条消息起生效") }
                return
            }
            scope.launch {
                runCatching { gatewayUpdateThreadOptions(activity, threadId!!, updated) }
                    .onSuccess { saved ->
                        conversationOptions = saved.toConversationOptions()
                        threads = threads.map { if (it.id == saved.id) saved else it }
                        snackbar.showSnackbar("会话设置已保存")
                    }
                    .onFailure { snackbar.showSnackbar(it.message ?: "会话设置没有保存成功") }
            }
        }

        val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted || Build.VERSION.SDK_INT < 33) {
                activity.showReminder()
                scope.launch { snackbar.showSnackbar("提醒已开启，已发送一条测试通知") }
            } else scope.launch { snackbar.showSnackbar("通知权限未开启，应用内计划仍可使用") }
        }

        fun beginBreak() {
            breakTimer = BreakTimerState()
        }
        val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris: List<Uri> ->
            val additions = uris.take((4 - pendingImageData.size).coerceAtLeast(0)).mapNotNull { uri ->
                runCatching { activity.contentResolver.openInputStream(uri)?.use { Base64.encodeToString(it.readBytes(), Base64.NO_WRAP) } }
                    .getOrNull()?.let { "data:image/*;base64,$it" }
            }
            pendingImageData = (pendingImageData + additions).take(4)
        }
        val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap: Bitmap? ->
            val image = bitmap?.let { output -> java.io.ByteArrayOutputStream().use { stream -> output.compress(Bitmap.CompressFormat.JPEG, 88, stream); "data:image/jpeg;base64,${Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)}" } }
            if (image != null && pendingImageData.size < 4) pendingImageData = pendingImageData + image
        }

        fun refreshThreads() { scope.launch { runCatching { gatewayListThreads(activity) }.onSuccess { threads = it }.onFailure { snackbar.showSnackbar(it.message ?: "刷新历史失败") } } }
        fun deleteThread(thread: ConversationThread) { scope.launch { runCatching { gatewayDeleteThread(activity, thread.id) }.onSuccess { refreshThreads(); if (remoteThreadId == thread.id) { remoteThreadId = null; AssistantSessionStore.saveCurrentThread(activity, null); messages = emptyList() } }.onFailure { snackbar.showSnackbar(it.message ?: "删除对话失败") } } }
        fun setThreadLocked(thread: ConversationThread, locked: Boolean) { scope.launch { runCatching { gatewaySetThreadLocked(activity, thread.id, locked) }.onSuccess { saved -> threads = threads.map { if (it.id == saved.id) saved else it } }.onFailure { snackbar.showSnackbar(it.message ?: "更新锁定状态失败") } } }
        fun deleteThreads(selected: List<ConversationThread>) { scope.launch { runCatching { gatewayDeleteThreads(activity, selected.map { it.id }) }.onSuccess { (_, locked) -> refreshThreads(); snackbar.showSnackbar(if (locked.isEmpty()) "已删除 ${selected.size} 段对话" else "有 ${locked.size} 段对话已锁定，未删除") }.onFailure { snackbar.showSnackbar(it.message ?: "批量删除失败") } } }

        fun createProject(name: String, kind: String, description: String, priority: Int, dueAt: String?) {
            scope.launch {
                runCatching { gatewayCreateProject(activity, name, kind, description, priority, dueAt) }
                    .onSuccess { state -> remotePlan = state.plan; remoteMemories = state.memories; remoteProjects = state.projects; remoteTasks = state.tasks; showCreateProject = false; snackbar.showSnackbar("目标或项目已创建") }
                    .onFailure { snackbar.showSnackbar(it.message ?: "新建项目失败") }
            }
        }

        fun completeTask() {
            scope.launch {
                runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "complete_current_task").put("reason", "用户在移动端点击完成当前任务")) }
                    .onSuccess { state -> remotePlan = state.plan?.copy(activeTimer = null); remoteMemories = state.memories; remoteProjects = state.projects; remoteTasks = state.tasks; currentDone = false; beginBreak() }
                    .onFailure { snackbar.showSnackbar(it.message ?: "计划更新失败，本次未写入") }
            }
        }

        fun startCurrentTimer() {
            val task = remotePlan?.currentTaskId ?: return
            scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "start_task_timer").put("task_id", task).put("mode", "stopwatch")) }
                .onSuccess { state -> remotePlan = state.plan; remoteTasks = state.tasks }
                .onFailure { snackbar.showSnackbar(it.message ?: "开始计时失败") } }
        }

        fun pauseCurrentTimer() {
            val task = remotePlan?.activeTimer?.taskId ?: return
            scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "pause_task_timer").put("task_id", task)) }
                .onSuccess { state -> remotePlan = state.plan; remoteTasks = state.tasks }
                .onFailure { snackbar.showSnackbar(it.message ?: "暂停计时失败") } }
        }

        fun reopenTask(taskId: String) {
            scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "reopen_task").put("task_id", taskId)) }
                .onSuccess { state -> remotePlan = state.plan; remoteTasks = state.tasks; snackbar.showSnackbar("任务已重新打开") }
                .onFailure { snackbar.showSnackbar(it.message ?: "重新打开失败") } }
        }

        fun completeSpecificTask(item: RemotePlanItem) {
            if (item.id.isBlank()) return
            scope.launch {
                runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "complete_task").put("task_id", item.id).put("reason", "用户双击今日计划任务完成")) }
                    .onSuccess { state -> remotePlan = state.plan?.copy(activeTimer = null); remoteProjects = state.projects; remoteTasks = state.tasks }
                    .onFailure { snackbar.showSnackbar(it.message ?: "完成任务失败") }
            }
        }

        fun editTask(item: RemotePlanItem) {
            scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "update_task").put("task_id", item.id).put("title", item.title).put("estimated_minutes", item.minutes).put("priority", item.priority)) }
                .onSuccess { state -> remotePlan = state.plan; remoteTasks = state.tasks; snackbar.showSnackbar("任务已保存") }
                .onFailure { snackbar.showSnackbar(it.message ?: "保存任务失败") } }
        }

        fun removeTask(item: RemotePlanItem) {
            scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "cancel_task").put("task_id", item.id).put("reason", "用户在移动端手动移除任务")) }
                .onSuccess { state -> remotePlan = state.plan; remoteTasks = state.tasks }
                .onFailure { snackbar.showSnackbar(it.message ?: "移除任务失败") } }
        }

        fun createTask(title: String, minutes: Int, priority: Int, projectId: String? = null, parentTaskId: String? = null, taskType: String = "one_off", dueAt: String? = null) {
            scope.launch { runCatching {
                gatewayExecuteAction(activity, remoteThreadId, JSONObject()
                    .put("type", when {
                        parentTaskId?.isNotBlank() == true -> "create_subtask"
                        taskType == "long" -> "create_long_task"
                        else -> "create_task"
                    })
                    .put("title", title)
                    .put("estimated_minutes", minutes)
                    .put("daily_minutes", minutes)
                    .put("priority", priority)
                    .apply { if (parentTaskId.isNullOrBlank()) dueAt?.takeIf(String::isNotBlank)?.let { put("due_at", it) } }
                    .apply { if (parentTaskId.isNullOrBlank()) remoteProjects.firstOrNull { it.id == projectId }?.name?.let { put("project", it) } }
                    .apply { parentTaskId?.takeIf(String::isNotBlank)?.let { put("parent_task_id", it) } }
                    .put("reason", if (parentTaskId.isNullOrBlank()) "用户在移动端手动新建任务" else "用户在移动端手动新建子任务"))
            }.onSuccess { state -> remotePlan = state.plan; remoteProjects = state.projects; remoteTasks = state.tasks }
                .onFailure { snackbar.showSnackbar(it.message ?: "新建任务失败") } }
        }

        fun reorderTasks(taskIds: List<String>) {
            val ids = taskIds.filter(String::isNotBlank)
            if (ids.size < 2) return
            scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "reorder_tasks").put("task_ids", JSONArray(ids)))}
                .onSuccess { state -> remotePlan = state.plan; remoteTasks = state.tasks }
                .onFailure { snackbar.showSnackbar(it.message ?: "排序失败") } }
        }

        fun addTaskToToday(task: RemoteTask) {
            if (task.status == "open" || task.status == "in_progress") return
            scope.launch {
                runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "reopen_task").put("task_id", task.id)) }
                    .onSuccess { state -> remotePlan = state.plan; remoteProjects = state.projects; remoteTasks = state.tasks }
                    .onFailure { snackbar.showSnackbar(it.message ?: "加入今日计划失败") }
            }
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
                    "set_buffer_minutes" -> action.minutes?.coerceIn(0, 1440)?.let { minutes ->
                        scope.launch {
                            runCatching {
                                gatewayExecuteAction(activity, remoteThreadId, JSONObject()
                                    .put("type", "set_buffer_minutes")
                                    .put("minutes", minutes)
                                    .put("reason", "用户在移动端设置缓冲时间"))
                            }.onSuccess { state -> remotePlan = state.plan }
                        }
                    }
                    "complete_current_task" -> { currentDone = false; beginBreak() }
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

        fun applyDeviceActions(actions: List<AssistantAction>): List<AlarmOperationResult> {
            return actions.filter { it.type == "set_alarm" || it.type == "cancel_alarm" }.map { action ->
                if (action.type == "set_alarm" && Build.VERSION.SDK_INT >= 33 &&
                    ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
                val outcome = AlarmScheduler.apply(activity, action)
                scope.launch { snackbar.showSnackbar(outcome.message) }
                if (outcome.needsExactPermission) activity.openExactAlarmSettings()
                outcome
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
                    beginBreak()
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
            if ((text.isEmpty() && pendingImageData.isEmpty()) || aiBusy) return
            val priorConversation = messages
            val images = pendingImageData
            pendingImageData = emptyList()
            messages = messages + ChatMessage(false, text, images)
            input = TextFieldValue()
            aiBusy = true
            scope.launch {
                val result = runCatching {
                    requestAssistant(activity, text, now, sleepTime, wakeTime, buildPlan(currentDone, deferredTasks, cancelledTasks, cancelAllTasks), priorConversation, usageSnapshot, selectedProviderId, selectedModel, agentEngine, remoteThreadId, conversationOptions, images)
                }.getOrElse { error -> AssistantResult("这次没有连上服务，内容没有写入任务、计划或记忆。请稍后重试。", emptyList()).also { scope.launch { snackbar.showSnackbar(error.message ?: "AI 服务连接失败") } } }
                if (result.plan == null) applyActions(result.actions)
                val deviceResults = applyDeviceActions(result.deviceActions.ifEmpty { result.actions })
                result.plan?.let { remotePlan = it }
                result.state?.let { remoteMemories = it.memories; remoteProjects = it.projects; remoteTasks = it.tasks; if (it.plan != null) remotePlan = it.plan }
                result.threadId?.let { id ->
                    remoteThreadId = id
                    AssistantSessionStore.saveCurrentThread(activity, id)
                    if (conversationOptions.saveFullConversation) {
                        runCatching { gatewayListThreads(activity) }.onSuccess { threads = it }
                    }
                }
                val deviceFailure = deviceResults.firstOrNull { !it.ok }
                val displayReply = if (deviceFailure != null) {
                    "手机端闹钟操作需要进一步处理：${deviceFailure.message}"
                } else if (deviceResults.isNotEmpty()) {
                    result.reply + "\n\n" + deviceResults.joinToString("\n") { it.message }
                } else result.reply
                messages = messages + ChatMessage(true, displayReply)
                aiBusy = false
            }
        }

        ModalNavigationDrawer(
            drawerState = drawerState,
            gesturesEnabled = true,
            drawerContent = {
                ModalDrawerSheet(drawerContainerColor = Color(0xFFF5F6F2)) {
                    Column(Modifier.fillMaxSize().padding(20.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(34.dp).clip(RoundedCornerShape(9.dp)).background(Cream), contentAlignment = Alignment.Center) { Icon(Icons.Default.ArrowForward, null, tint = Green, modifier = Modifier.size(21.dp)) }
                            Spacer(Modifier.width(10.dp)); Column { Text("向前", color = Green, fontWeight = FontWeight.Bold, fontSize = 17.sp); Text("你的执行助手", color = Muted, fontSize = 10.sp) }
                        }
                        Spacer(Modifier.height(24.dp))
                        TextButton(onClick = { drawerOpen = false; projectPageId = null; tab = 0 }, modifier = Modifier.fillMaxWidth()) { Text("今日计划", color = Green, fontSize = 14.sp) }
                        Text("人生主线与支线", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 18.dp, bottom = 8.dp))
                        remoteProjects.forEach { project ->
                            TextButton(onClick = { drawerOpen = false; projectPageId = project.id; startConversation(defaultConversationOptions("project", project.id), 4) }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Default.FolderOpen, null, tint = Green, modifier = Modifier.size(17.dp)); Spacer(Modifier.width(8.dp)); Text(project.name, color = Ink, fontSize = 13.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        Spacer(Modifier.height(12.dp)); TextButton(onClick = { drawerOpen = false; tab = 1 }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.SmartToy, null, tint = Green, modifier = Modifier.size(17.dp)); Spacer(Modifier.width(8.dp)); Text("所有对话", color = Ink, fontSize = 13.sp) }
                        TextButton(onClick = { drawerOpen = false; tab = 2 }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.Lightbulb, null, tint = Green, modifier = Modifier.size(17.dp)); Spacer(Modifier.width(8.dp)); Text("记忆库", color = Ink, fontSize = 13.sp) }
                        TextButton(onClick = { drawerOpen = false; tab = 3 }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.Settings, null, tint = Green, modifier = Modifier.size(17.dp)); Spacer(Modifier.width(8.dp)); Text("设置", color = Ink, fontSize = 13.sp) }
                    }
                }
            }
        ) {
        Scaffold(
            containerColor = Canvas,
            snackbarHost = { SnackbarHost(snackbar) },
            topBar = {
                TopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = { drawerOpen = true }) {
                            Box(Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).background(Cream), contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.ArrowForward, null, tint = Green, modifier = Modifier.size(20.dp))
                            } }
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
                0 -> TodayScreen(padding, now, sleepTime, currentDone, unavailablePeriod, breakTimer, buildPlan(currentDone, deferredTasks, cancelledTasks, cancelAllTasks), remotePlan, remoteProjects, { showProjects = true }, ::completeTask, ::startCurrentTimer, ::pauseCurrentTimer, { breakTimer = breakTimer?.copy(running = !breakTimer!!.running) }, { breakTimer = null; currentDone = false }, ::reopenTask, ::editTask, ::removeTask, ::createTask, { parent, title, minutes, priority ->
                    val projectId = remoteProjects.firstOrNull { it.name == parent.project }?.id
                    createTask(title, minutes, priority, projectId, parent.id)
                }, ::completeSpecificTask, ::reorderTasks, ::sendMessage, input, { value -> input = value }, aiBusy, initialStateLoading)
                1 -> ChatScreen(
                    padding = padding,
                    messages = messages,
                    input = input,
                    onInput = { input = it },
                    onSend = ::sendMessage,
                    aiBusy = aiBusy,
                    threadLoading = threadLoading,
                    conversationOptions = conversationOptions,
                    projects = remoteProjects,
                    threads = threads,
                    onLoadThread = ::loadThread,
                    onStartConversation = ::startConversation,
                    onUpdateConversationOptions = ::updateConversationOptions
                    ,onDeleteThread = ::deleteThread,
                    onSetThreadLocked = ::setThreadLocked,
                    onDeleteThreads = ::deleteThreads
                    ,onGallery = { galleryLauncher.launch("image/*") },
                    onCamera = { cameraLauncher.launch(null) }, imageData = pendingImageData, onRemoveImage = { index -> pendingImageData = pendingImageData.filterIndexed { position, _ -> position != index } }, onClearImage = { pendingImageData = emptyList() }
                )
                2 -> MemoryScreen(
                    padding = padding,
                    activity = activity,
                    memories = remoteMemories,
                    status = memoryStatus,
                    onStateChanged = { state ->
                        remoteMemories = state.memories
                        remotePlan = state.plan ?: remotePlan
                        remoteProjects = state.projects
                        remoteTasks = state.tasks
                        scope.launch { runCatching { gatewayMemoryStatus(activity) }.onSuccess { memoryStatus = it } }
                    },
                    onStatusChanged = { memoryStatus = it }
                )
                4 -> ProjectScreen(
                    padding = padding,
                    project = remoteProjects.firstOrNull { it.id == projectPageId },
                    plan = remotePlan,
                    tasks = remoteTasks,
                    messages = messages,
                    input = input,
                    aiBusy = aiBusy,
                    threadLoading = threadLoading,
                    conversationOptions = conversationOptions,
                    projects = remoteProjects,
                    threads = threads,
                    onInput = { input = it },
                    onSend = ::sendMessage,
                    onLoadThread = ::loadThread,
                    onStartConversation = { startConversation(it, 4) },
                    onUpdateConversationOptions = ::updateConversationOptions,
                    onCreateTask = { title, minutes, priority, projectId, parentTaskId -> createTask(title, minutes, priority, projectId, parentTaskId) },
                    onAddTaskToToday = ::addTaskToToday,
                    onStartTaskTimer = { task -> scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "start_task_timer").put("task_id", task.id).put("mode", "stopwatch")) }.onSuccess { remotePlan = it.plan; remoteTasks = it.tasks }.onFailure { snackbar.showSnackbar(it.message ?: "开始计时失败") } } },
                    onPauseTaskTimer = { task -> scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "pause_task_timer").put("task_id", task.id)) }.onSuccess { remotePlan = it.plan; remoteTasks = it.tasks }.onFailure { snackbar.showSnackbar(it.message ?: "暂停计时失败") } } },
                    onBack = { projectPageId = null; tab = 0 }
                )
                else -> SettingsScreen(
                    padding,
                    activity,
                    snackbar,
                    sleepTime,
                    wakeTime,
                    bufferMinutes = remotePlan?.configuredBufferMinutes ?: 60,
                    usageSnapshot = usageSnapshot,
                    onSleepTime = { time -> sleepTime = time; activity.savePlannerTime("sleep_time", time); scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "set_sleep_time").put("time", formatClock(time)).put("reason", "用户在移动端设置睡觉时间")) }.onSuccess { remotePlan = it.plan; remoteMemories = it.memories } } },
                    onWakeTime = { time -> wakeTime = time; activity.savePlannerTime("wake_time", time); scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "set_wake_time").put("time", formatClock(time)).put("reason", "用户在移动端设置起床时间")) }.onSuccess { remotePlan = it.plan; remoteMemories = it.memories } } },
                    onBufferMinutes = { minutes -> scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "set_buffer_minutes").put("minutes", minutes).put("reason", "用户在移动端设置缓冲时间")) }.onSuccess { state -> remotePlan = state.plan; remoteMemories = state.memories }.onFailure { snackbar.showSnackbar(it.message ?: "缓冲时间保存失败") } } },
                    showSleepPlan = showSleepPlan,
                    onSleepPlanVisibility = { visible -> showSleepPlan = visible; scope.launch { runCatching { gatewayExecuteAction(activity, remoteThreadId, JSONObject().put("type", "set_sleep_plan_visibility").put("visible", visible).put("reason", "用户调整睡眠时段计划显示")) }.onSuccess { state -> remotePlan = state.plan; remoteMemories = state.memories }.onFailure { snackbar.showSnackbar(it.message ?: "睡眠时段显示设置保存失败") } } },
                    aiProviders = aiProviders,
                    selectedProviderId = selectedProviderId,
                    selectedModel = selectedModel,
                    agentEngine = agentEngine,
                    onAgentEngine = { value -> agentEngine = value; activity.saveAiSelection(selectedProviderId, selectedModel, value) },
                    onAiSelection = { providerId, model -> selectedProviderId = providerId; selectedModel = model; activity.saveAiSelection(providerId, model, agentEngine) },
                    onUsageSnapshotChanged = { usageSnapshot = activity.usageSnapshot() },
                    onRemoteState = { state -> remotePlan = state.plan; remoteMemories = state.memories; remoteProjects = state.projects; remoteTasks = state.tasks },
                    onThreadsRefresh = {
                        scope.launch {
                            runCatching { gatewayListThreads(activity) }
                                .onSuccess { loaded ->
                                    threads = loaded
                                    val stillAvailable = remoteThreadId?.let { id -> loaded.any { it.id == id } } == true
                                    if (!stillAvailable) {
                                        val resume = loaded.firstOrNull { it.mode != "temporary" } ?: loaded.firstOrNull()
                                        if (resume != null) loadThread(resume) else {
                                            remoteThreadId = null
                                            AssistantSessionStore.saveCurrentThread(activity, null)
                                            messages = emptyList()
                                            conversationOptions = defaultConversationOptions("assistant")
                                        }
                                    }
                                }
                        }
                    }
                )
            }
        }
        }
        if (showProjects) {
            ProjectOverviewDialog(
                projects = remoteProjects,
                onDismiss = { showProjects = false },
                onCreateProject = { showCreateProject = true }
            )
        }
        if (showCreateProject) {
            CreateProjectDialog(
                onDismiss = { showCreateProject = false },
                onCreate = ::createProject
            )
        }
    }
}

@Composable
private fun ProjectOverviewDialog(
    projects: List<RemoteProject>,
    onDismiss: () -> Unit,
    onCreateProject: () -> Unit
) {
    var selectedProjectId by remember { mutableStateOf<String?>(null) }
    val selectedProject = projects.firstOrNull { it.id == selectedProjectId }
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(22.dp),
        containerColor = Color(0xFFFFFEFA),
        tonalElevation = 0.dp,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("目标与项目", color = Green, fontSize = 21.sp, fontWeight = FontWeight.SemiBold)
                    Text(if (selectedProject == null) "长期目标和项目截止日期" else "项目详情", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                }
                if (selectedProject == null) TextButton(onClick = onCreateProject) { Icon(Icons.Default.Add, null, tint = Green, modifier = Modifier.size(16.dp)); Text("新建", color = Green, fontSize = 12.sp) }
            }
        },
        text = {
            if (selectedProject != null) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    TextButton(onClick = { selectedProjectId = null }, contentPadding = PaddingValues(0.dp)) { Text("‹ 返回全部目标与项目", color = Green, fontSize = 12.sp) }
                    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFFEAF1EC)), shape = RoundedCornerShape(11.dp)) {
                        Column(Modifier.padding(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.FolderOpen, null, tint = Green, modifier = Modifier.size(20.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(selectedProject.name, color = Ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            }
                            Text(if (selectedProject.kind == "goal") "长期目标" else "项目", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 8.dp))
                            Text(selectedProject.description.ifBlank { "还没有项目说明。" }, color = Color(0xFF4C7168), fontSize = 12.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 8.dp))
                            Text("优先级 ${when { selectedProject.priority >= 4 -> "高"; selectedProject.priority <= 1 -> "低"; else -> "中" }} · ${selectedProject.dueAt?.takeUnless { it == "null" }?.let { "截止 $it" } ?: "持续推进"}", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 10.dp))
                        }
                    }
                    Text("这个项目的任务可以从今日计划或对话中继续添加，AI 会根据项目上下文帮你推进。", color = Muted, fontSize = 11.sp, lineHeight = 17.sp)
                }
            } else if (projects.isEmpty()) {
                Text("当前还没有目标或项目。", color = Muted, fontSize = 12.sp)
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(projects, key = { it.id }) { project ->
                        val kindLabel = if (project.kind == "goal") "长期目标" else "项目"
                        val priorityLabel = when {
                            project.priority >= 4 -> "高优先级"
                            project.priority <= 1 -> "低优先级"
                            else -> "中优先级"
                        }
                        val dueLabel = project.dueAt?.takeIf { it.isNotBlank() }?.let { due ->
                            "截止 $due"
                        } ?: "持续推进"
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(containerColor = Color(0xFFEAF1EC)),
                                shape = RoundedCornerShape(11.dp)
                            ) {
                            Column(Modifier.padding(12.dp).clickable { selectedProjectId = project.id }) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Default.FolderOpen, null, tint = Green, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text(project.name, color = Ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Text("$kindLabel · $priorityLabel · $dueLabel", color = Muted, fontSize = 10.sp, modifier = Modifier.padding(top = 5.dp))
                                project.description.takeIf { it.isNotBlank() }?.let {
                                    Text(it, color = Color(0xFF4C7168), fontSize = 11.sp, lineHeight = 16.sp, modifier = Modifier.padding(top = 5.dp), maxLines = 3, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("关闭", color = Green) }
        }
    )
}

@Composable
private fun CreateProjectDialog(
    onDismiss: () -> Unit,
    onCreate: (String, String, String, Int, String?) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("project") }
    var description by remember { mutableStateOf("") }
    var priority by remember { mutableStateOf(3) }
    var dueAt by remember { mutableStateOf("") }
    val priorityChoices = listOf(Triple(5, "高", Color(0xFFE17E5D)), Triple(3, "中", Color(0xFF55A496)), Triple(1, "低", Color(0xFF968BD0)))
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(22.dp),
        containerColor = Color(0xFFFFFEFA),
        title = { Text("新建目标或项目", color = Green, fontSize = 20.sp, fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    listOf("goal" to "长期目标", "project" to "项目").forEach { (value, label) ->
                        TextButton(onClick = { kind = value }, modifier = Modifier.weight(1f)) { Text(if (kind == value) "✓ $label" else label, color = if (kind == value) Green else Muted) }
                    }
                }
                OutlinedTextField(description, { description = it }, label = { Text("说明（可选）") }, minLines = 2, maxLines = 4, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(dueAt, { dueAt = it }, label = { Text("截止时间（可选）") }, placeholder = { Text("例如 2026-09-05T23:59:00+08:00") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("优先级", color = Muted, fontSize = 11.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp), modifier = Modifier.fillMaxWidth()) {
                    priorityChoices.forEach { (value, label, color) ->
                        TextButton(onClick = { priority = value }, modifier = Modifier.weight(1f)) { Text(if (priority == value) "● $label" else label, color = if (priority == value) color else Muted, fontSize = 12.sp) }
                    }
                }
            }
        },
        confirmButton = { Button(onClick = { onCreate(name.trim(), kind, description.trim(), priority, dueAt.trim().takeIf { it.isNotBlank() }) }, enabled = name.trim().isNotBlank(), colors = ButtonDefaults.buttonColors(containerColor = Green)) { Text("创建") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消", color = Muted) } }
    )
}

@Composable
private fun TodayScreen(
    padding: PaddingValues,
    now: LocalDateTime,
    sleepTime: LocalTime,
    currentDone: Boolean,
    unavailablePeriod: Boolean,
    breakTimer: BreakTimerState?,
    plan: List<PlanItem>,
    remotePlan: RemotePlan?,
    remoteProjects: List<RemoteProject>,
    onShowProjects: () -> Unit,
    completeTask: () -> Unit,
    startTimer: () -> Unit,
    pauseTimer: () -> Unit,
    toggleBreak: () -> Unit,
    skipBreak: () -> Unit,
    reopenTask: (String) -> Unit,
    editTask: (RemotePlanItem) -> Unit,
    removeTask: (RemotePlanItem) -> Unit,
    createTask: (String, Int, Int, String?, String?, String, String?) -> Unit,
    createSubtask: (RemotePlanItem, String, Int, Int) -> Unit,
    completeSpecificTask: (RemotePlanItem) -> Unit,
    reorderTasks: (List<String>) -> Unit,
    sendMessage: () -> Unit,
    input: TextFieldValue,
    onInput: (TextFieldValue) -> Unit,
    aiBusy: Boolean,
    initialStateLoading: Boolean = false
) {
    var editingTask by remember { mutableStateOf<RemotePlanItem?>(null) }
    var creatingTask by remember { mutableStateOf(false) }
    var creatingSubtask by remember { mutableStateOf<RemotePlanItem?>(null) }
    var createTitle by remember { mutableStateOf("") }
    var createMinutes by remember { mutableStateOf("45") }
    var createPriority by remember { mutableStateOf("3") }
    var createType by remember { mutableStateOf("one_off") }
    var createDueDate by remember { mutableStateOf("") }
    var editTitle by remember { mutableStateOf("") }
    var editMinutes by remember { mutableStateOf("") }
    var editPriority by remember { mutableStateOf("") }
    // Keep the local ticker alive while the same task is running. The plan is
    // refreshed periodically, but its server elapsed value must not reset the
    // visible seconds on every refresh.
    var timerSeconds by remember(remotePlan?.activeTimer?.taskId) { mutableStateOf(remotePlan?.activeTimer?.elapsedSeconds ?: 0L) }
    LaunchedEffect(remotePlan?.activeTimer?.elapsedSeconds) {
        val serverElapsed = remotePlan?.activeTimer?.elapsedSeconds ?: return@LaunchedEffect
        if (serverElapsed > timerSeconds) timerSeconds = serverElapsed
    }
    LaunchedEffect(remotePlan?.activeTimer?.taskId) {
        while (remotePlan?.activeTimer != null) { delay(1000); timerSeconds += 1 }
    }
    val clock = formatClock(now.toLocalTime())
    val serverPlan = if (initialStateLoading && remotePlan == null) emptyList() else remotePlan?.let { remote ->
        normalizeRemotePlanItems(remote, now)
    } ?: schedulePlan(plan, now, sleepTime)
    var draggingTaskId by remember { mutableStateOf<String?>(null) }
    var dragOffset by remember { mutableStateOf(0f) }
    var lastDragMoveAt by remember { mutableStateOf(0L) }
    var displayPlan by remember { mutableStateOf(serverPlan) }
    val listState = rememberLazyListState()
    LaunchedEffect(serverPlan.map { "${it.item.id}:${it.start}:${it.end}:${it.deferredByCapacity}" }.joinToString("|")) {
        if (draggingTaskId == null) displayPlan = serverPlan
    }
    fun moveDraggedTask(targetId: String) {
        val sourceId = draggingTaskId ?: return
        val sourceIndex = displayPlan.indexOfFirst { it.item.id == sourceId }
        val targetIndex = displayPlan.indexOfFirst { it.item.id == targetId }
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex == targetIndex) return
        displayPlan = displayPlan.toMutableList().apply { add(targetIndex, removeAt(sourceIndex)) }
        // Require another deliberate movement before the next swap. This prevents
        // one fast swipe from carrying a task across the entire list.
        dragOffset = 0f
        lastDragMoveAt = System.currentTimeMillis()
    }
    fun finishDragging() {
        val dragged = draggingTaskId
        draggingTaskId = null
        dragOffset = 0f
        if (dragged != null) reorderTasks(displayPlan.map { it.item.id })
    }
    val scheduledPlan = displayPlan
    val availableMinutes = remotePlan?.availableMinutes?.toLong() ?: minutesUntilSleep(now, sleepTime)
    val scheduledMinutes = remotePlan?.scheduledMinutes?.toLong() ?: scheduledPlan.filter { it.start != null && !it.item.done }.sumOf { it.item.minutes }.toLong()
    val bufferMinutes = remotePlan?.bufferMinutes?.toLong() ?: (availableMinutes - scheduledMinutes).coerceAtLeast(0)
    val freeMinutes = remotePlan?.freeMinutes?.toLong() ?: 0L
    val currentItem = remotePlan?.currentTaskId?.let { currentId ->
        scheduledPlan.getOrNull(remotePlan.scheduled.indexOfFirst { it.id == currentId }.takeIf { it >= 0 } ?: -1)
    } ?: scheduledPlan.firstOrNull { it.start != null && !it.item.isBreak && !it.item.done }
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 10.dp)) {
        item { Column(Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(7.dp).clip(CircleShape).background(Coral)); Spacer(Modifier.width(7.dp)); Text(dateLabel(now.toLocalDate()), color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
            Spacer(Modifier.height(10.dp)); Text("今天，先把最重要的事做下去。", color = Green, fontSize = 26.sp, fontWeight = FontWeight.Bold, lineHeight = 34.sp)
            Spacer(Modifier.height(6.dp)); Text(if (initialStateLoading && remotePlan == null) "正在同步你的今日计划…" else if (remotePlan?.isSleeping == true) "现在 $clock · 正在睡眠时段 · ${remotePlan?.wakeTime.orEmpty()} 后恢复安排" else "现在 $clock · 今天排到 ${remotePlan?.sleepTime ?: formatClock(sleepTime)} · 还可用 ${formatDuration(availableMinutes)}", color = Muted, fontSize = 11.sp)
            if (remoteProjects.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                val lead = remoteProjects.maxByOrNull { it.priority }
                Card(onClick = onShowProjects, colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F0E9)), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.FolderOpen, null, tint = Green, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(9.dp))
                        Column(Modifier.weight(1f)) { Text("当前主线", color = Muted, fontSize = 10.sp); Text(lead?.name ?: "目标与项目", color = Green, fontSize = 14.sp, fontWeight = FontWeight.SemiBold); Text("点击查看全部目标、项目与截止日期", color = Muted, fontSize = 10.sp) }
                        Icon(Icons.Default.ArrowForward, null, tint = Green, modifier = Modifier.size(18.dp))
                    }
                }
            }
        } }
        if (initialStateLoading && remotePlan == null) {
            item {
                Card(Modifier.padding(horizontal = 20.dp, vertical = 12.dp).fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F0E9)), shape = RoundedCornerShape(12.dp)) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.CircularProgressIndicator(Modifier.size(20.dp), color = Green, strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp)); Text("正在读取你的计划和作息…", color = Green, fontSize = 12.sp)
                    }
                }
            }
        } else item { CurrentTaskCard(currentItem, currentDone, breakTimer, remotePlan?.completed?.firstOrNull()?.title, remotePlan?.activeTimer, timerSeconds, completeTask, startTimer, pauseTimer, toggleBreak, skipBreak) }
        item { Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 15.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { Text("今日动态计划", color = Ink, fontSize = 15.sp, fontWeight = FontWeight.Bold); Row(verticalAlignment = Alignment.CenterVertically) { Text("现在 $clock", color = Muted, fontSize = 10.sp); TextButton(onClick = { creatingTask = true; createTitle = ""; createMinutes = "45"; createPriority = "3" }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp)) { Icon(Icons.Default.Add, null, tint = Green, modifier = Modifier.size(16.dp)); Text("新建", color = Green, fontSize = 11.sp) } } } }
        item { BudgetRow(scheduledMinutes, bufferMinutes, freeMinutes) }
        // Some legacy/local tasks may not have an id yet; keep LazyColumn keys unique
        // so the app can still open and the task can be edited normally.
        items(scheduledPlan, key = { it.item.id.ifBlank { "task-${it.item.title}-${it.start ?: "unscheduled"}" } }) { item ->
            PlanRow(
                scheduled = item,
                editTask = { task -> editingTask = task; editTitle = task.title; editMinutes = task.minutes.toString(); editPriority = task.priority.toString() },
                removeTask = removeTask,
                completeTask = completeSpecificTask,
                createSubtask = { item ->
                    val source = remotePlan?.scheduled.orEmpty().firstOrNull { it.id == item.item.id }
                        ?: remotePlan?.deferred.orEmpty().firstOrNull { it.id == item.item.id }
                    creatingSubtask = source ?: RemotePlanItem(item.item.id, item.item.title, "", item.item.note, item.item.priority, item.item.minutes, "", "", "", "open")
                },
                isDragging = draggingTaskId == item.item.id,
                dragOffset = if (draggingTaskId == item.item.id) dragOffset else 0f,
                onDragStart = { if (item.item.id.isNotBlank() && !item.item.done) { draggingTaskId = item.item.id; dragOffset = 0f; lastDragMoveAt = 0L } },
                onDrag = { delta ->
                    if (draggingTaskId == item.item.id) {
                        dragOffset += delta
                        val draggedInfo = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.key == item.item.id }
                        if (draggedInfo != null) {
                            val center = draggedInfo.offset + dragOffset + draggedInfo.size / 2
                            val sourceIndex = displayPlan.indexOfFirst { it.item.id == item.item.id }
                            val direction = if (dragOffset > 0f) 1 else -1
                            val targetItem = displayPlan.getOrNull(sourceIndex + direction)
                            val target = targetItem?.let { targetValue ->
                                listState.layoutInfo.visibleItemsInfo.firstOrNull { it.key == targetValue.item.id }
                            }
                            val crossed = target != null && if (direction > 0) {
                                center > target.offset + target.size * 0.72f
                            } else {
                                center < target.offset + target.size * 0.28f
                            }
                            if (crossed && System.currentTimeMillis() - lastDragMoveAt > 180L) {
                                target?.key?.toString()?.takeIf { it.isNotBlank() }?.let(::moveDraggedTask)
                            }
                        }
                    }
                },
                onDragEnd = ::finishDragging
            )
        }
        if (remotePlan?.completed?.isNotEmpty() == true) {
            item { SectionTitle("已完成", "保留历史，可重新打开") }
            items(remotePlan.completed) { item -> CompletedTaskRow(item, onReopen = { reopenTask(item.id) }) }
        }
        if (unavailablePeriod) item { AdjustmentCard("有一段不可用时间已加入计划", "我会避开这段时间，并把受影响事项顺延；调整原因会在对话中说明。") }
        else if (remotePlan?.adjustmentReason?.isNotBlank() == true) item { AdjustmentCard("本次计划调整", remotePlan.adjustmentReason) }
        else if (scheduledPlan.any { it.deferredByCapacity && !it.item.done }) item { AdjustmentCard("今晚时间不够用", "超过 ${formatClock(sleepTime)} 的事项已转为可顺延，不会为了塞完任务压缩你的睡眠。") }
        item { SectionTitle("快速记录", "直接告诉我发生了什么") }
        item { Composer(input, onInput, sendMessage, aiBusy) }
    }
    creatingSubtask?.let { parent ->
        CreateSubtaskDialog(
            parentTitle = parent.title,
            parentPriority = parent.priority,
            onDismiss = { creatingSubtask = null },
            onCreate = { title, minutes, priority ->
                creatingSubtask = null
                createSubtask(parent, title, minutes, priority)
            }
        )
    }
    editingTask?.let { task ->
        val selectedPriority = (editPriority.toIntOrNull() ?: task.priority).let { value ->
            when {
                value >= 4 -> 5
                value >= 3 -> 3
                else -> 1
            }
        }
        val priorityChoices = listOf(
            Triple(5, "高", Color(0xFFE17E5D)),
            Triple(3, "中", Color(0xFF55A496)),
            Triple(1, "低", Color(0xFF968BD0))
        )
        AlertDialog(
            onDismissRequest = { editingTask = null },
            shape = RoundedCornerShape(22.dp),
            containerColor = Color(0xFFFFFEFA),
            tonalElevation = 0.dp,
            title = { Text("编辑任务", color = Green, fontSize = 21.sp, fontWeight = FontWeight.SemiBold) },
            text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(editTitle, { editTitle = it }, label = { Text("任务名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(editMinutes, { editMinutes = it.filter(Char::isDigit) }, label = { Text("预计分钟") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("优先级", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp), modifier = Modifier.fillMaxWidth()) {
                        priorityChoices.forEach { (value, label, color) ->
                            val selected = selectedPriority == value
                            Column(
                                Modifier.weight(1f).clip(RoundedCornerShape(9.dp))
                                    .background(if (selected) color.copy(alpha = .13f) else Color(0xFFF5F6F2))
                                    .border(1.dp, if (selected) color else Color(0xFFDCE4DC), RoundedCornerShape(9.dp))
                                    .clickable { editPriority = value.toString() }
                                    .padding(vertical = 9.dp),
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                Box(Modifier.size(9.dp).clip(CircleShape).background(color))
                                Spacer(Modifier.height(4.dp))
                                Text(label, color = if (selected) Green else Muted, fontSize = 12.sp, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
                            }
                        }
                    }
                }
            } },
            confirmButton = { Button(onClick = { editTask(task.copy(title = editTitle.trim().ifBlank { task.title }, minutes = editMinutes.toIntOrNull() ?: task.minutes, priority = selectedPriority)); editingTask = null }, colors = ButtonDefaults.buttonColors(containerColor = Green), shape = RoundedCornerShape(8.dp)) { Text("保存") } },
            dismissButton = { Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) { TextButton(onClick = { removeTask(task); editingTask = null }) { Text("从计划移除", color = Color(0xFFB04F42)) }; TextButton(onClick = { editingTask = null }) { Text("取消", color = Muted) } } }
        )
    }
    if (creatingTask) {
        val selectedPriority = (createPriority.toIntOrNull() ?: 3).let { value -> when { value >= 4 -> 5; value >= 3 -> 3; else -> 1 } }
        val priorityChoices = listOf(
            Triple(5, "高", Color(0xFFE17E5D)),
            Triple(3, "中", Color(0xFF55A496)),
            Triple(1, "低", Color(0xFF968BD0))
        )
        AlertDialog(
            onDismissRequest = { creatingTask = false },
            shape = RoundedCornerShape(22.dp),
            containerColor = Color(0xFFFFFEFA),
            tonalElevation = 0.dp,
            title = { Text("新建任务", color = Green, fontSize = 21.sp, fontWeight = FontWeight.SemiBold) },
            text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(createTitle, { createTitle = it }, label = { Text("任务名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("任务类型", color = Muted, fontSize = 12.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    listOf("one_off" to "普通", "deadline" to "截止", "long" to "长期").forEach { (value, label) ->
                        TextButton(onClick = { createType = value }) { Text(if (createType == value) "✓ $label" else label, color = if (createType == value) Green else Muted, fontSize = 11.sp) }
                    }
                }
                OutlinedTextField(createMinutes, { createMinutes = it.filter(Char::isDigit) }, label = { Text("预计分钟") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (createType != "one_off") OutlinedTextField(createDueDate, { createDueDate = it }, label = { Text("截止日期（YYYY-MM-DD，可选）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("优先级", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp), modifier = Modifier.fillMaxWidth()) {
                        priorityChoices.forEach { (value, label, color) ->
                            val selected = selectedPriority == value
                            Column(Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (selected) color.copy(alpha = .13f) else Color(0xFFF5F6F2)).border(1.dp, if (selected) color else Color(0xFFDCE4DC), RoundedCornerShape(9.dp)).clickable { createPriority = value.toString() }.padding(vertical = 9.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Box(Modifier.size(9.dp).clip(CircleShape).background(color)); Spacer(Modifier.height(4.dp)); Text(label, color = if (selected) Green else Muted, fontSize = 12.sp, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
                            }
                        }
                    }
                }
            } },
            confirmButton = { Button(onClick = { createTask(createTitle.trim(), (createMinutes.toIntOrNull() ?: 45).coerceIn(5, 720), selectedPriority, null, null, createType, createDueDate.trim().takeIf { it.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) }?.let { "${it}T23:59:00+08:00" }); creatingTask = false }, enabled = createTitle.trim().isNotBlank(), colors = ButtonDefaults.buttonColors(containerColor = Green), shape = RoundedCornerShape(8.dp)) { Text("创建任务") } },
            dismissButton = { TextButton(onClick = { creatingTask = false }) { Text("取消", color = Muted) } }
        )
    }
}

@Composable
private fun CreateLongTaskDialog(
    projects: List<RemoteProject>,
    onDismiss: () -> Unit,
    onCreate: (String, Int, Int, String?) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf("45") }
    var priority by remember { mutableStateOf(3) }
    var projectId by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新建长期任务", color = Green, fontWeight = FontWeight.Bold) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("每天生成一条可计时、可复盘的执行项；完成今天不会结束主任务。", color = Muted, fontSize = 11.sp, lineHeight = 16.sp)
            OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("长期任务名称") }, singleLine = true)
            OutlinedTextField(value = minutes, onValueChange = { minutes = it.filter(Char::isDigit) }, label = { Text("每天预计分钟") }, singleLine = true)
            if (projects.isNotEmpty()) {
                Text("所属项目", color = Muted, fontSize = 11.sp)
                projects.take(4).forEach { project -> TextButton(onClick = { projectId = project.id }) { Text(if (projectId == project.id) "✓ ${project.name}" else project.name, color = if (projectId == project.id) Green else Muted, fontSize = 10.sp) } }
            }
            Row { listOf(1 to "低", 3 to "中", 5 to "高").forEach { (value, label) -> TextButton(onClick = { priority = value }) { Text(if (priority == value) "✓ $label" else label, color = if (priority == value) Green else Muted) } } }
        } },
        confirmButton = { TextButton(onClick = { if (title.isNotBlank()) onCreate(title.trim(), minutes.toIntOrNull()?.coerceIn(5, 720) ?: 45, priority, projectId.ifBlank { null }) }) { Text("创建", color = Green) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消", color = Muted) } }
    )
}

@Composable
private fun CompletedTaskRow(item: RemotePlanItem, onReopen: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Default.TaskAlt, null, tint = Color(0xFF4A897D), modifier = Modifier.size(17.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title, color = Muted, fontSize = 12.sp, textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough)
            Text("实际 ${item.actualMinutes} 分钟 · 已完成", color = Muted, fontSize = 10.sp)
        }
        TextButton(onClick = onReopen) { Text("重新打开", color = Green, fontSize = 11.sp) }
    }
}

@Composable
private fun CurrentTaskCard(currentItem: ScheduledPlanItem?, done: Boolean, breakTimer: BreakTimerState?, completedTitle: String?, activeTimer: RemoteActiveTimer?, timerSeconds: Long, onDone: () -> Unit, onStart: () -> Unit, onPause: () -> Unit, onToggleBreak: () -> Unit, onSkipBreak: () -> Unit) {
    val breakActive = breakTimer != null
    val visibleTimer = activeTimer?.takeIf { !done && !breakActive && currentItem != null && it.taskId == currentItem.item.id }
    val estimatedSeconds = (currentItem?.item?.minutes ?: 0).coerceAtLeast(1) * 60L
    val storedSeconds = currentItem?.item?.actualSeconds ?: 0L
    // actualSeconds includes all saved sessions, while timerSeconds tracks the
    // currently running session locally. Add the saved sessions before the
    // current one so the visible value keeps increasing instead of being reset
    // to the last server snapshot on every recomposition.
    val previousSeconds = if (visibleTimer != null) (storedSeconds - visibleTimer.elapsedSeconds).coerceAtLeast(0) else 0L
    val elapsedSeconds = if (visibleTimer != null) previousSeconds + timerSeconds else storedSeconds
    val progress = if (done) 1f else (elapsedSeconds.toFloat() / estimatedSeconds.toFloat()).coerceIn(0f, 1f)
    val title = when {
        breakActive -> "休息中"
        done -> "已完成 · ${completedTitle?.takeIf { it.isNotBlank() } ?: currentItem?.item?.title ?: "当前任务"}"
        currentItem == null -> "今天不再安排核心任务"
        else -> currentItem.item.title
    }
    val detail = when {
        breakActive -> if (breakTimer!!.running) "自动休息 · 还剩 ${formatElapsed(breakTimer.remainingSeconds)}" else "休息已暂停 · 还剩 ${formatElapsed(breakTimer.remainingSeconds)}"
        done -> "接下来休息 15 分钟"
        currentItem == null -> "剩余事项已留作明天或等待你调整"
        else -> {
            val endLabel = currentItem.end?.let { formatClock(it.toLocalTime()) }
            when {
                endLabel != null && currentItem.item.note.isNotBlank() -> "${currentItem.item.note} · 至 $endLabel"
                endLabel != null -> "至 $endLabel"
                currentItem.item.note.isNotBlank() -> "${currentItem.item.note} · 等待重新安排时间"
                else -> "等待重新安排时间"
            }
        }
    }
    Card(Modifier.padding(horizontal = 16.dp, vertical = 2.dp).fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = GreenSoft), shape = RoundedCornerShape(10.dp)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(if (breakActive || done) Color(0xFF5AAE9D) else Coral)); Spacer(Modifier.width(10.dp)); Column(Modifier.weight(1f)) { Text(if (breakActive) "当前状态" else "当前任务", color = Muted, fontSize = 10.sp); Text(title, color = Green, fontSize = 14.sp, fontWeight = FontWeight.Bold); Text(detail, color = Color(0xFF4C7168), fontSize = 10.sp) }
            Column(horizontalAlignment = Alignment.End) {
                if (breakActive) {
                    val breakProgress = (1f - breakTimer!!.remainingSeconds / (15 * 60f)).coerceIn(0f, 1f)
                    Text("休息 ${formatElapsed(breakTimer.remainingSeconds)}", color = Green, fontSize = 10.sp)
                    LinearProgressIndicator(progress = { breakProgress }, modifier = Modifier.width(92.dp), color = Color(0xFF5AAE9D), trackColor = Color(0xFFD7E4DC))
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = onToggleBreak, contentPadding = PaddingValues(horizontal = 5.dp, vertical = 0.dp)) {
                            Text(if (breakTimer.running) "暂停" else "继续", fontSize = 11.sp, color = Green)
                        }
                        TextButton(onClick = onSkipBreak, contentPadding = PaddingValues(horizontal = 5.dp, vertical = 0.dp)) {
                            Text("跳过", fontSize = 11.sp, color = Green)
                        }
                    }
                } else if (currentItem != null && !currentItem.item.isBreak) {
                    Text(if (visibleTimer?.mode == "countdown") "已用 ${formatElapsed(elapsedSeconds)} · 剩余 ${formatElapsed((estimatedSeconds - elapsedSeconds).coerceAtLeast(0))}" else "已用 ${formatElapsed(elapsedSeconds)} / ${formatElapsed(estimatedSeconds)}", color = Green, fontSize = 10.sp)
                    LinearProgressIndicator(progress = { progress }, modifier = Modifier.width(92.dp), color = if (progress >= 1f) Color(0xFF5AAE9D) else Coral, trackColor = Color(0xFFD7E4DC))
                }
                if (!breakActive && !done && currentItem != null) {
                    val timerBelongsToCurrent = visibleTimer != null
                    TextButton(onClick = if (timerBelongsToCurrent) onPause else onStart) { Text(if (timerBelongsToCurrent) "暂停" else "开始", fontSize = 11.sp, color = Green) }
                    TextButton(onClick = onDone) { Text("完成", fontSize = 11.sp, color = Green) }
                } else if (done) Text("已完成", color = Color(0xFF4A897D), fontSize = 11.sp)
            }
        }
    }
}

@Composable
private fun SectionTitle(title: String, detail: String) { Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 15.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { Text(title, color = Ink, fontSize = 15.sp, fontWeight = FontWeight.Bold); Text(detail, color = Muted, fontSize = 10.sp) } }

@Composable
private fun BudgetRow(scheduledMinutes: Long, bufferMinutes: Long, freeMinutes: Long) { Row(Modifier.padding(horizontal = 20.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Metric("任务已排", formatDuration(scheduledMinutes)); Metric("保留缓冲", formatDuration(bufferMinutes)); Metric("剩余可用", formatDuration(freeMinutes)) } }
@Composable
private fun Metric(label: String, value: String) { Column { Text(label, color = Muted, fontSize = 10.sp); Text(value, color = Color(0xFF34544D), fontSize = 11.sp, fontWeight = FontWeight.SemiBold) } }

@Composable
private fun PlanRow(
    scheduled: ScheduledPlanItem,
    editTask: (RemotePlanItem) -> Unit,
    removeTask: (RemotePlanItem) -> Unit = {},
    completeTask: (RemotePlanItem) -> Unit = {},
    createSubtask: (ScheduledPlanItem) -> Unit = {},
    isDragging: Boolean = false,
    dragOffset: Float = 0f,
    onDragStart: () -> Unit = {},
    onDrag: (Float) -> Unit = {},
    onDragEnd: () -> Unit = {}
) {
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
    val dragModifier = if (item.id.isNotBlank() && !item.done) Modifier.pointerInput(item.id) {
        detectDragGesturesAfterLongPress(
            onDragStart = { onDragStart() },
            onDragCancel = { onDragEnd() },
            onDragEnd = { onDragEnd() },
            onDrag = { _, amount -> onDrag(amount.y) }
        )
    } else Modifier
    Row(dragModifier.graphicsLayer { translationY = if (isDragging) dragOffset else 0f; alpha = if (isDragging) 0.86f else 1f }.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.Top) { Text(time, color = Muted, fontSize = 10.sp, modifier = Modifier.width(39.dp)); Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(18.dp)) { Box(Modifier.size(9.dp).border(2.dp, item.tone, CircleShape).clip(CircleShape).background(Rail)); Box(Modifier.width(1.dp).height(39.dp).background(Color(0xFFD2DAD1))) }; Spacer(Modifier.width(7.dp)); Column(Modifier.weight(1f).padding(start = if (item.isSubtask) 20.dp else 0.dp).combinedClickable(onClick = { if (item.id.isNotBlank()) editTask(RemotePlanItem(item.id, item.title, "", item.note, item.priority, item.minutes, "", "", "", "open", actualMinutes = item.actualMinutes, parentTaskId = null)) }, onDoubleClick = { if (!item.done && item.id.isNotBlank()) completeTask(RemotePlanItem(item.id, item.title, "", item.note, item.priority, item.minutes, "", "", "", "open", actualMinutes = item.actualMinutes, parentTaskId = null)) })) { if (item.isSubtask && item.parentTitle.isNotBlank()) { Text(item.parentTitle, color = if (scheduled.deferredByCapacity) Muted else Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis); Text("↳ ${item.title}", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis) } else Text(item.title, color = if (item.done || scheduled.deferredByCapacity) Muted else Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, textDecoration = if (item.done) androidx.compose.ui.text.style.TextDecoration.LineThrough else null, maxLines = 1, overflow = TextOverflow.Ellipsis); Text(note, color = Muted, fontSize = 10.sp) }; if (!item.done && !item.isSubtask && item.id.isNotBlank()) TextButton(onClick = { createSubtask(scheduled) }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp)) { Text("子任务", color = Muted, fontSize = 10.sp) }; if (item.done) Icon(Icons.Default.TaskAlt, null, tint = Color(0xFF4A897D), modifier = Modifier.size(17.dp)) }
}

@Composable
private fun AdjustmentCard(title: String, body: String) { Card(Modifier.padding(horizontal = 20.dp, vertical = 10.dp).fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFFE1EDE6)), shape = RoundedCornerShape(7.dp)) { Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) { Icon(Icons.Default.AutoAwesome, null, tint = Color(0xFF2C655B), modifier = Modifier.size(16.dp)); Column { Text(title, color = Color(0xFF2C655B), fontSize = 11.sp, fontWeight = FontWeight.Bold); Text(body, color = Color(0xFF56756D), fontSize = 10.sp, lineHeight = 15.sp) } } } }

@Composable
private fun Composer(input: TextFieldValue, onInput: (TextFieldValue) -> Unit, onSend: () -> Unit, aiBusy: Boolean = false, onGallery: () -> Unit = {}, onCamera: () -> Unit = {}, imageSelected: Boolean = false) {
    val canSend = (input.text.isNotBlank() || imageSelected) && !aiBusy
    Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Color.White).border(1.dp, Color(0xFFD6DED4), RoundedCornerShape(9.dp)).padding(8.dp), verticalAlignment = Alignment.Bottom) {
        OutlinedTextField(value = input, onValueChange = onInput, enabled = !aiBusy, placeholder = { Text(if (aiBusy) "向前正在思考…" else "说进展、临时安排，或直接聊天…", color = Color(0xFF94A19C), fontSize = 12.sp) }, modifier = Modifier.weight(1f), minLines = 1, maxLines = 3, colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(unfocusedBorderColor = Color.Transparent, focusedBorderColor = Color.Transparent))
        IconButton(onClick = onGallery, modifier = Modifier.size(34.dp)) { Icon(Icons.Default.Image, "图库", tint = Muted) }
        IconButton(onClick = onCamera, modifier = Modifier.size(34.dp)) { Icon(Icons.Default.CameraAlt, "拍照", tint = Muted) }
        IconButton(onClick = onSend, enabled = canSend, modifier = Modifier.size(37.dp).clip(RoundedCornerShape(6.dp)).background(if (canSend) Green else Color(0xFFE9EDE8))) { Icon(Icons.Default.Send, "发送", tint = if (canSend) Color.White else Color(0xFF93A69F), modifier = Modifier.size(18.dp)) }
    }
}

@Composable
private fun ChatScreen(
    padding: PaddingValues,
    messages: List<ChatMessage>,
    input: TextFieldValue,
    onInput: (TextFieldValue) -> Unit,
    onSend: () -> Unit,
    aiBusy: Boolean,
    threadLoading: Boolean,
    conversationOptions: ConversationOptions,
    projects: List<RemoteProject>,
    threads: List<ConversationThread>,
    onLoadThread: (ConversationThread) -> Unit,
    onStartConversation: (ConversationOptions) -> Unit,
    onUpdateConversationOptions: (ConversationOptions) -> Unit,
    onDeleteThread: (ConversationThread) -> Unit = {},
    onSetThreadLocked: (ConversationThread, Boolean) -> Unit = { _, _ -> },
    onDeleteThreads: (List<ConversationThread>) -> Unit = {},
    onGallery: () -> Unit = {},
    onCamera: () -> Unit = {},
    imageData: List<String> = emptyList(),
    onRemoveImage: (Int) -> Unit = {},
    onClearImage: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()
    var showHistory by remember { mutableStateOf(false) }
    var showNewConversation by remember { mutableStateOf(false) }
    var showConversationOptions by remember { mutableStateOf(false) }
    val modeTitle = conversationModeLabel(conversationOptions.mode)
    val projectName = projects.firstOrNull { it.id == conversationOptions.projectId }?.name
        ?: threads.firstOrNull { it.projectId == conversationOptions.projectId }?.projectName.orEmpty()
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex) }

    Column(modifier.fillMaxSize().padding(padding)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(modeTitle, color = Ink, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(
                    listOfNotNull(projectName.takeIf { it.isNotBlank() }, conversationScopeLabel(conversationOptions)).joinToString(" · "),
                    color = Muted,
                    fontSize = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            TextButton(onClick = { showHistory = true }, enabled = !threadLoading && !aiBusy) { Text("历史", color = Green, fontSize = 12.sp) }
            TextButton(onClick = { showNewConversation = true }, enabled = !threadLoading && !aiBusy) { Text("新建", color = Green, fontSize = 12.sp) }
            TextButton(onClick = { showConversationOptions = true }, enabled = !threadLoading && !aiBusy) { Text("设置", color = Green, fontSize = 12.sp) }
        }
        LazyColumn(
            modifier = Modifier.weight(1f),
            state = listState,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)
        ) {
            if (messages.isEmpty()) {
                item {
                    Card(
                        Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 8.dp),
                        colors = CardDefaults.cardColors(containerColor = GreenSoft),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Column(Modifier.padding(16.dp)) {
                            Text("开始一段$modeTitle", color = Green, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(6.dp))
                            Text(
                                when (conversationOptions.mode) {
                                    "temporary" -> "这段对话默认不读取记忆、不保存原始对话，也不会沉淀长期记忆。"
                                    "project" -> "围绕指定项目对话；读取范围和保存策略可在右上角单独调整。"
                                    "daily_planning" -> "告诉我今天的进展、临时安排或作息，我会据此更新计划。"
                                    else -> "我会结合你允许读取的长期目标和近期记录，帮你推进事情。"
                                },
                                color = Color(0xFF4C7168), fontSize = 12.sp, lineHeight = 18.sp
                            )
                        }
                    }
                }
            }
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
                    Column(
                        modifier = Modifier
                            .widthIn(max = if (message.fromAssistant) 286.dp else 250.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (message.fromAssistant) Color(0xFFE9EFEA) else Green)
                            .padding(11.dp)
                    ) {
                        message.imageData.forEach { imageData ->
                            decodeImageData(imageData)?.let { bitmap ->
                                Image(
                                    bitmap = bitmap.asImageBitmap(),
                                    contentDescription = "已发送图片",
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.size(150.dp, 110.dp).clip(RoundedCornerShape(6.dp))
                                )
                                Spacer(Modifier.height(5.dp))
                            }
                        }
                        if (message.text.isNotBlank()) {
                            if (message.fromAssistant) MarkdownText(message.text, Ink, 13.sp, 21.sp)
                            else Text(message.text, color = Color.White, fontSize = 13.sp, lineHeight = 21.sp)
                        }
                    }
                }
            }
        }
        if (imageData.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            imageData.forEachIndexed { index, image ->
                Box(Modifier.size(56.dp).padding(end = 4.dp)) {
                    decodeImageData(image)?.let { bitmap -> Image(bitmap = bitmap.asImageBitmap(), contentDescription = "待发送图片", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(6.dp))) }
                    IconButton(onClick = { onRemoveImage(index) }, modifier = Modifier.size(20.dp).align(Alignment.TopEnd).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f))) { Icon(Icons.Default.Close, "移除图片", tint = Color.White, modifier = Modifier.size(13.dp)) }
                }
            }
            Spacer(Modifier.width(4.dp)); Text("已选择 ${imageData.size} 张", color = Green, fontSize = 10.sp); Spacer(Modifier.weight(1f)); TextButton(onClick = onClearImage) { Text("清空", color = Coral, fontSize = 10.sp) }
        }

        Composer(input, onInput, onSend, aiBusy || threadLoading, onGallery, onCamera, imageData.isNotEmpty())
    }

    if (showHistory) {
        ConversationHistoryDialog(
            threads = threads,
            busy = threadLoading || aiBusy,
            onDismiss = { showHistory = false },
            onSelect = { thread -> showHistory = false; onLoadThread(thread) },
            onDeleteThread = onDeleteThread,
            onSetThreadLocked = onSetThreadLocked,
            onDeleteThreads = onDeleteThreads
        )
    }
    if (showNewConversation) {
        NewConversationDialog(
            projects = projects,
            busy = threadLoading || aiBusy,
            onDismiss = { showNewConversation = false },
            onCreate = { options -> showNewConversation = false; onStartConversation(options) }
        )
    }
    if (showConversationOptions) {
        ConversationOptionsDialog(
            current = conversationOptions,
            busy = threadLoading || aiBusy,
            onDismiss = { showConversationOptions = false },
            onSave = { options -> showConversationOptions = false; onUpdateConversationOptions(options) }
        )
    }
}

@Composable
private fun ProjectScreen(
    padding: PaddingValues,
    project: RemoteProject?,
    plan: RemotePlan?,
    tasks: List<RemoteTask>,
    messages: List<ChatMessage>,
    input: TextFieldValue,
    aiBusy: Boolean,
    threadLoading: Boolean,
    conversationOptions: ConversationOptions,
    projects: List<RemoteProject>,
    threads: List<ConversationThread>,
    onInput: (TextFieldValue) -> Unit,
    onSend: () -> Unit,
    onLoadThread: (ConversationThread) -> Unit,
    onStartConversation: (ConversationOptions) -> Unit,
    onUpdateConversationOptions: (ConversationOptions) -> Unit,
    onCreateTask: (String, Int, Int, String?, String?) -> Unit,
    onAddTaskToToday: (RemoteTask) -> Unit,
    onStartTaskTimer: (RemoteTask) -> Unit,
    onPauseTaskTimer: (RemoteTask) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val projectName = project?.name.orEmpty()
    val projectTasks = tasks.filter { it.projectId == project?.id }
    val completedCount = projectTasks.count { it.status == "done" }
    var showProjectTaskDialog by remember { mutableStateOf(false) }
    var subtaskParent by remember { mutableStateOf<RemoteTask?>(null) }
    Column(modifier.fillMaxSize().padding(padding)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack, contentPadding = PaddingValues(0.dp)) { Text("‹ 今日", color = Green, fontSize = 12.sp) }
            Spacer(Modifier.width(12.dp)); Text(projectName.ifBlank { "项目" }, color = Green, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        project?.let {
            Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFFEAF1EC)), shape = RoundedCornerShape(10.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(it.description.ifBlank { "还没有项目说明。" }, color = Color(0xFF4C7168), fontSize = 11.sp, lineHeight = 16.sp)
                    Text("${if (it.kind == "goal") "长期目标" else "项目"} · ${completedCount}/${projectTasks.size} 项完成 · ${it.dueAt?.takeUnless { value -> value == "null" } ?: "持续推进"}", color = Muted, fontSize = 10.sp, modifier = Modifier.padding(top = 6.dp))
                    if (projectTasks.isNotEmpty()) {
                        LinearProgressIndicator(progress = { completedCount.toFloat() / projectTasks.size.toFloat() }, modifier = Modifier.fillMaxWidth().padding(top = 9.dp), color = Green, trackColor = Color(0xFFD3E1D8))
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("项目任务", color = Green, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            TextButton(onClick = { showProjectTaskDialog = true }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) { Icon(Icons.Default.Add, null, tint = Green, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("新建任务", color = Green, fontSize = 11.sp) }
        }
        if (projectTasks.isEmpty()) {
            Text("还没有这个项目的任务，可以先新建一项。", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
        } else {
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 190.dp).padding(horizontal = 16.dp)) {
                items(projectTasks, key = { it.id }) { task ->
                    val progress = (task.actualMinutes.toFloat() / task.minutes.coerceAtLeast(1)).coerceIn(0f, 1f)
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text((if (task.parentTaskId != null) "↳ " else "") + task.title, color = if (task.status == "done") Muted else Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, textDecoration = if (task.status == "done") androidx.compose.ui.text.style.TextDecoration.LineThrough else null, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${task.minutes} 分钟 · ${when (task.status) { "done" -> "已完成"; "deferred" -> "已顺延"; "cancelled" -> "已取消"; else -> "待完成" }}", color = Muted, fontSize = 10.sp)
                            LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp), color = if (task.status == "done") Color(0xFF74A99A) else Coral, trackColor = Color(0xFFE5ECE7))
                        }
                        if (task.status == "deferred" || task.status == "cancelled") {
                            TextButton(onClick = { onAddTaskToToday(task) }, contentPadding = PaddingValues(horizontal = 5.dp)) { Text("加入今日", color = Green, fontSize = 10.sp) }
                        }
                        if (task.status == "open" || task.status == "in_progress") {
                            val running = plan?.activeTimer?.taskId == task.id
                            TextButton(onClick = { if (running) onPauseTaskTimer(task) else onStartTaskTimer(task) }, contentPadding = PaddingValues(horizontal = 5.dp)) { Text(if (running) "暂停" else "计时", color = Green, fontSize = 10.sp) }
                            if (task.parentTaskId == null) TextButton(onClick = { subtaskParent = task }, contentPadding = PaddingValues(horizontal = 5.dp)) { Text("子任务", color = Muted, fontSize = 10.sp) }
                        }
                    }
                }
            }
        }
        ChatScreen(
            padding = PaddingValues(0.dp), messages = messages, input = input, onInput = onInput, onSend = onSend,
            aiBusy = aiBusy, threadLoading = threadLoading, conversationOptions = conversationOptions, projects = projects,
            threads = threads, onLoadThread = onLoadThread, onStartConversation = onStartConversation, onUpdateConversationOptions = onUpdateConversationOptions,
            modifier = Modifier.weight(1f)
        )
    }
    if (showProjectTaskDialog) {
        CreateProjectTaskDialog(
            projectId = project?.id,
            onDismiss = { showProjectTaskDialog = false },
            onCreate = { title, minutes, priority -> showProjectTaskDialog = false; onCreateTask(title, minutes, priority, project?.id, null) }
        )
    }
    subtaskParent?.let { parent ->
        CreateSubtaskDialog(
            parentTitle = parent.title,
            parentPriority = parent.priority,
            onDismiss = { subtaskParent = null },
            onCreate = { title, minutes, priority ->
                onCreateTask(title, minutes, priority, null, parent.id)
                subtaskParent = null
            }
        )
    }
}

@Composable
private fun CreateProjectTaskDialog(
    projectId: String?,
    onDismiss: () -> Unit,
    onCreate: (String, Int, Int) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf("45") }
    var priority by remember { mutableStateOf(3) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新建项目任务", color = Green, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("任务内容") }, singleLine = true)
                OutlinedTextField(value = minutes, onValueChange = { minutes = it.filter(Char::isDigit) }, label = { Text("预计分钟") }, singleLine = true)
                Text("优先级", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
                Row { listOf(1 to "低", 3 to "中", 5 to "高").forEach { (value, label) -> TextButton(onClick = { priority = value }) { Text(if (priority == value) "✓ $label" else label, color = if (priority == value) Green else Muted) } } }
            }
        },
        confirmButton = { TextButton(onClick = { if (title.isNotBlank()) onCreate(title.trim(), minutes.toIntOrNull()?.coerceIn(5, 720) ?: 45, priority) }) { Text("创建", color = Green) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消", color = Muted) } }
    )
}

@Composable
private fun CreateSubtaskDialog(
    parentTitle: String,
    parentPriority: Int,
    onDismiss: () -> Unit,
    onCreate: (String, Int, Int) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf("30") }
    var priority by remember { mutableStateOf(when { parentPriority >= 4 -> 5; parentPriority <= 1 -> 1; else -> 3 }) }
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(18.dp),
        containerColor = Color(0xFFFFFEFA),
        title = { Text("新建子任务", color = Green, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("归入父任务", color = Muted, fontSize = 10.sp)
                Text(parentTitle, color = Ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("子任务会继承所属项目，可独立计时和完成。", color = Muted, fontSize = 10.sp, lineHeight = 15.sp)
                OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("子任务内容") }, singleLine = true)
                OutlinedTextField(value = minutes, onValueChange = { minutes = it.filter(Char::isDigit) }, label = { Text("预计分钟") }, singleLine = true)
                Text("优先级", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 2.dp))
                Row { listOf(1 to "低", 3 to "中", 5 to "高").forEach { (value, label) -> TextButton(onClick = { priority = value }) { Text(if (priority == value) "✓ $label" else label, color = if (priority == value) Green else Muted) } } }
            }
        },
        confirmButton = { TextButton(onClick = { if (title.isNotBlank()) onCreate(title.trim(), minutes.toIntOrNull()?.coerceIn(5, 720) ?: 30, priority) }) { Text("创建子任务", color = Green) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消", color = Muted) } }
    )
}

@Composable
private fun ConversationHistoryDialog(
    threads: List<ConversationThread>,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSelect: (ConversationThread) -> Unit,
    onDeleteThread: (ConversationThread) -> Unit = {},
    onSetThreadLocked: (ConversationThread, Boolean) -> Unit = { _, _ -> },
    onDeleteThreads: (List<ConversationThread>) -> Unit = {}
) {
    var selected by remember { mutableStateOf(setOf<String>()) }
    var confirmDelete by remember { mutableStateOf<List<ConversationThread>?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("历史对话", color = Green, fontWeight = FontWeight.Bold) },
        text = {
            if (threads.isEmpty()) {
                Text("还没有保存的对话。新建普通助手、项目对话或每日规划后，对话会自动出现在这里。", color = Muted, fontSize = 12.sp, lineHeight = 18.sp)
            } else {
                LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    items(threads) { thread ->
                        Card(
                            Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            colors = CardDefaults.cardColors(containerColor = if (thread.mode == "temporary") Color(0xFFFFF7E9) else Color(0xFFF2F5F1)),
                            shape = RoundedCornerShape(9.dp)
                        ) {
                            Column(Modifier.padding(12.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Checkbox(checked = thread.id in selected, onCheckedChange = { checked -> selected = if (checked) selected + thread.id else selected - thread.id }, enabled = !busy, modifier = Modifier.size(28.dp))
                                    Text(conversationModeLabel(thread.mode), color = Ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                    Text(formatThreadTime(thread.updatedAt), color = Muted, fontSize = 10.sp)
                                }
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    TextButton(onClick = { if (!busy) onSelect(thread) }, contentPadding = PaddingValues(0.dp)) { Text("打开", color = Green, fontSize = 10.sp) }
                                    Spacer(Modifier.weight(1f))
                                    TextButton(onClick = { onSetThreadLocked(thread, !thread.locked) }, contentPadding = PaddingValues(horizontal = 5.dp)) { Text(if (thread.locked) "解锁" else "锁定", color = Muted, fontSize = 10.sp) }
                                    TextButton(onClick = { if (!thread.locked) onDeleteThread(thread) }, enabled = !thread.locked, contentPadding = PaddingValues(horizontal = 5.dp)) { Text("删除", color = if (thread.locked) Muted else Coral, fontSize = 10.sp) }
                                }
                                thread.projectName.takeIf { it.isNotBlank() }?.let { Text(it, color = Color(0xFF476F66), fontSize = 11.sp, modifier = Modifier.padding(top = 3.dp)) }
                                Text(thread.preview.ifBlank { "尚未发送消息" }, color = Muted, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                                Text("${thread.messageCount} 条消息 · ${conversationScopeLabel(thread.toConversationOptions())}", color = Color(0xFF8A9791), fontSize = 9.sp, modifier = Modifier.padding(top = 5.dp))
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { Row { if (selected.isNotEmpty()) TextButton(onClick = { confirmDelete = threads.filter { it.id in selected } }) { Text("删除所选", color = Coral) }; TextButton(onClick = onDismiss) { Text("关闭", color = Green) } } }
    )
    confirmDelete?.let { targets -> AlertDialog(onDismissRequest = { confirmDelete = null }, title = { Text("确认删除", color = Green) }, text = { Text("将删除 ${targets.size} 段对话；已锁定的对话会保留。", color = Muted) }, confirmButton = { TextButton(onClick = { onDeleteThreads(targets); selected = emptySet(); confirmDelete = null }) { Text("确定", color = Coral) } }, dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("取消", color = Muted) } }) }
}

@Composable
private fun NewConversationDialog(
    projects: List<RemoteProject>,
    busy: Boolean,
    onDismiss: () -> Unit,
    onCreate: (ConversationOptions) -> Unit
) {
    var mode by remember { mutableStateOf("assistant") }
    var projectId by remember { mutableStateOf<String?>(null) }
    var memoryScope by remember { mutableStateOf(true) }
    var saveFullConversation by remember { mutableStateOf(true) }
    var allowMemoryDistillation by remember { mutableStateOf(true) }
    fun chooseMode(nextMode: String) {
        mode = nextMode
        if (nextMode != "project") projectId = null
        val defaults = defaultConversationOptions(nextMode, projectId)
        memoryScope = defaults.memoryScope
        saveFullConversation = defaults.saveFullConversation
        allowMemoryDistillation = defaults.allowMemoryDistillation
    }
    val canCreate = mode != "project" || !projectId.isNullOrBlank()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新建对话", color = Green, fontWeight = FontWeight.Bold) },
        text = {
            LazyColumn(Modifier.heightIn(max = 470.dp)) {
                item { Text("选择这段对话的工作方式", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 7.dp)) }
                items(listOf("temporary", "assistant", "project", "daily_planning")) { item ->
                    val selected = mode == item
                    Card(
                        Modifier.fillMaxWidth().padding(vertical = 3.dp).clickable(enabled = !busy) { chooseMode(item) },
                        colors = CardDefaults.cardColors(containerColor = if (selected) GreenSoft else Color(0xFFF6F7F4)),
                        shape = RoundedCornerShape(9.dp)
                    ) {
                        Column(Modifier.padding(10.dp)) {
                            Text(conversationModeLabel(item), color = if (selected) Green else Ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            Text(
                                when (item) {
                                    "temporary" -> "默认不读记忆、不保存原始对话"
                                    "assistant" -> "读取长期目标和近期记录"
                                    "project" -> "仅围绕一个指定项目"
                                    else -> "读取任务、作息、进度和复盘"
                                },
                                color = Muted, fontSize = 10.sp, modifier = Modifier.padding(top = 2.dp)
                            )
                        }
                    }
                }
                if (mode == "project") {
                    item { Text("选择项目", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp)) }
                    if (projects.isEmpty()) item { Text("当前还没有可选择的项目；请先在电脑端建立项目后再创建项目对话。", color = Color(0xFF9C6441), fontSize = 11.sp) }
                    items(projects) { project ->
                        val selected = projectId == project.id
                        Card(
                            Modifier.fillMaxWidth().padding(vertical = 3.dp).clickable(enabled = !busy) { projectId = project.id },
                            colors = CardDefaults.cardColors(containerColor = if (selected) Color(0xFFE4F0E8) else Color(0xFFF7F7F5)),
                            shape = RoundedCornerShape(8.dp)
                        ) { Text(project.name, color = if (selected) Green else Ink, fontSize = 12.sp, modifier = Modifier.padding(10.dp)) }
                    }
                }
                item { Text("这段对话的数据边界", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 14.dp, bottom = 4.dp)) }
                item { ConversationSwitchRow("读取记忆", "本次回复是否带入相应范围内的记忆", memoryScope, enabled = !busy) { memoryScope = it } }
                item { ConversationSwitchRow("保存完整对话", "保留原始聊天记录，之后可重新打开", saveFullConversation, enabled = !busy) { saveFullConversation = it } }
                item { ConversationSwitchRow("允许沉淀长期记忆", "重要事实、决定和进度可进入每日整理候选", allowMemoryDistillation, enabled = !busy) { allowMemoryDistillation = it } }
            }
        },
        confirmButton = {
            Button(
                onClick = { onCreate(ConversationOptions(
                    mode = mode,
                    projectId = projectId,
                    memoryScope = memoryScope,
                    saveFullConversation = saveFullConversation,
                    allowMemoryDistillation = allowMemoryDistillation,
                    projectName = projects.firstOrNull { it.id == projectId }?.name
                )) },
                enabled = canCreate && !busy,
                colors = ButtonDefaults.buttonColors(containerColor = Green)
            ) { Text("开始对话") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("取消", color = Muted) } }
    )
}

@Composable
private fun ConversationOptionsDialog(
    current: ConversationOptions,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (ConversationOptions) -> Unit
) {
    var memoryScope by remember { mutableStateOf(current.memoryScope) }
    var saveFullConversation by remember { mutableStateOf(current.saveFullConversation) }
    var allowMemoryDistillation by remember { mutableStateOf(current.allowMemoryDistillation) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("本次对话设置", color = Green, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text("${conversationModeLabel(current.mode)}：三项控制彼此独立。", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
                ConversationSwitchRow("读取记忆", "只控制本次对话带入哪些已有记忆", memoryScope, enabled = !busy) { memoryScope = it }
                ConversationSwitchRow("保存完整对话", "只控制原始消息是否保留", saveFullConversation, enabled = !busy) { saveFullConversation = it }
                ConversationSwitchRow("允许沉淀长期记忆", "只控制每日整理是否处理本段对话", allowMemoryDistillation, enabled = !busy) { allowMemoryDistillation = it }
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(current.copy(memoryScope = memoryScope, saveFullConversation = saveFullConversation, allowMemoryDistillation = allowMemoryDistillation)) },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = Green)
            ) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("取消", color = Muted) } }
    )
}

@Composable
private fun ConversationSwitchRow(title: String, detail: String, checked: Boolean, enabled: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = Ink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Text(detail, color = Muted, fontSize = 10.sp, lineHeight = 14.sp)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
}

@Composable
private fun MemoryScreen(
    padding: PaddingValues,
    activity: MainActivity,
    memories: List<RemoteMemory>,
    status: MemoryRunStatus?,
    onStateChanged: (RemoteState) -> Unit,
    onStatusChanged: (MemoryRunStatus) -> Unit
) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var busy by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<RemoteMemory?>(null) }
    var editText by remember { mutableStateOf("") }
    val visible = memories.filter { it.status != "archived" }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, containerColor = Color.Transparent) { inner ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(inner),
            contentPadding = PaddingValues(20.dp)
        ) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("记忆库", color = Green, fontSize = 25.sp, fontWeight = FontWeight.Bold)
                        Text("原始对话保留不变，AI 每天整理出可确认的长期记忆", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 5.dp))
                    }
                    IconButton(onClick = {
                        if (busy) return@IconButton
                        scope.launch {
                            busy = true
                            runCatching { gatewayRunDailyMemory(activity) }
                                .onSuccess { state -> onStateChanged(state); runCatching { gatewayMemoryStatus(activity) }.onSuccess(onStatusChanged); snackbar.showSnackbar("今日记忆整理完成") }
                                .onFailure { snackbar.showSnackbar(it.message ?: "每日整理失败") }
                            busy = false
                        }
                    }) { Icon(Icons.Default.Refresh, "立即整理", tint = Green) }
                }
                Card(Modifier.fillMaxWidth().padding(top = 14.dp), colors = CardDefaults.cardColors(containerColor = GreenSoft), shape = RoundedCornerShape(10.dp)) {
                    Column(Modifier.padding(14.dp)) {
                        Text(if (busy) "正在整理今天的对话…" else "每日 22:00 自动整理", color = Green, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text(
                            status?.let { "今日 ${it.rawMessageCount} 条原始消息 · 待确认 ${it.pendingReviewCount} · 已确认 ${it.activeCount}" } ?: "正在读取整理状态…",
                            color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp)
                        )
                        status?.summary?.takeIf { it.isNotBlank() }?.let { Text(it, color = Color(0xFF4C7168), fontSize = 11.sp, lineHeight = 16.sp, modifier = Modifier.padding(top = 7.dp)) }
                    }
                }
                Spacer(Modifier.height(10.dp))
            }
            if (visible.isEmpty()) item {
                Text("目前还没有记忆条目。每天自动整理后，重要决定、项目进度和生活事件会先出现在这里，确认后才成为长期记忆。", color = Muted, fontSize = 12.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 12.dp))
            }
            items(visible) { memory ->
                Card(Modifier.fillMaxWidth().padding(vertical = 5.dp), colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(9.dp)) {
                    Column(Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.Top) {
                            Icon(Icons.Default.Lightbulb, null, tint = Color(0xFFB77D55), modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(9.dp))
                            Text(memory.content, color = Ink, fontSize = 13.sp, lineHeight = 19.sp, modifier = Modifier.weight(1f))
                        }
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(if (memory.status == "active") "已确认" else "待确认", color = if (memory.status == "active") Color(0xFF4A897D) else Color(0xFFB77D55), fontSize = 10.sp)
                            Spacer(Modifier.weight(1f))
                            if (memory.status == "pending_review") TextButton(enabled = !busy, onClick = {
                                scope.launch {
                                    busy = true
                                    runCatching { gatewayUpdateMemory(activity, memory.id, "active") }
                                        .onSuccess(onStateChanged)
                                        .onFailure { snackbar.showSnackbar(it.message ?: "确认记忆失败") }
                                    busy = false
                                }
                            }) { Text("确认", color = Green, fontSize = 11.sp) }
                            TextButton(enabled = !busy, onClick = { editing = memory; editText = memory.content }) { Text("编辑", color = Green, fontSize = 11.sp) }
                            TextButton(enabled = !busy, onClick = {
                                scope.launch {
                                    busy = true
                                    runCatching { gatewayUpdateMemory(activity, memory.id, "archived") }
                                        .onSuccess(onStateChanged)
                                        .onFailure { snackbar.showSnackbar(it.message ?: "归档记忆失败") }
                                    busy = false
                                }
                            }) { Text("归档", color = Color(0xFF9C4B3B), fontSize = 11.sp) }
                        }
                    }
                }
            }
        }
    }
    editing?.let { memory ->
        AlertDialog(
            onDismissRequest = { if (!busy) editing = null },
            title = { Text("编辑记忆", color = Green, fontWeight = FontWeight.Bold) },
            text = { OutlinedTextField(value = editText, onValueChange = { editText = it }, minLines = 3, maxLines = 6, modifier = Modifier.fillMaxWidth()) },
            confirmButton = {
                Button(enabled = !busy && editText.isNotBlank(), onClick = {
                    scope.launch {
                        busy = true
                        runCatching { gatewayUpdateMemory(activity, memory.id, memory.status, editText.trim()) }
                            .onSuccess { state -> editing = null; onStateChanged(state); snackbar.showSnackbar("记忆已更新") }
                            .onFailure { snackbar.showSnackbar(it.message ?: "更新记忆失败") }
                        busy = false
                    }
                }, colors = ButtonDefaults.buttonColors(containerColor = Green)) { Text("保存") }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = { editing = null }) { Text("取消", color = Muted) } }
        )
    }
}

@Composable
private fun SettingsScreen(
    padding: PaddingValues,
    activity: MainActivity,
    snackbar: SnackbarHostState,
    sleepTime: LocalTime,
    wakeTime: LocalTime,
    bufferMinutes: Int,
    showSleepPlan: Boolean,
    onSleepPlanVisibility: (Boolean) -> Unit,
    usageSnapshot: UsageMonitorSnapshot,
    onSleepTime: (LocalTime) -> Unit,
    onWakeTime: (LocalTime) -> Unit,
    onBufferMinutes: (Int) -> Unit,
    aiProviders: List<AiProviderOption>,
    selectedProviderId: String,
    selectedModel: String,
    agentEngine: String,
    onAgentEngine: (String) -> Unit,
    onAiSelection: (String, String) -> Unit,
    onUsageSnapshotChanged: () -> Unit,
    onRemoteState: (RemoteState) -> Unit,
    onThreadsRefresh: () -> Unit
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
        item { BufferSettingRow(bufferMinutes, onBufferMinutes) }
        item { SettingRow(Icons.Default.Bedtime, "睡眠时段显示计划", if (showSleepPlan) "显示任务但不安排" else "隐藏待安排任务", showSleepPlan, onToggle = onSleepPlanVisibility) }
        item { SettingRow(Icons.Default.NotificationsNone, "任务提醒", "安卓通知通道已准备", true) }
        item { CloudSyncCard(activity, snackbar, onRemoteState, onThreadsRefresh) }
        item {
            AiProviderSettingsCard(
                providers = aiProviders,
                selectedProviderId = selectedProviderId,
                selectedModel = selectedModel,
                agentEngine = agentEngine,
                onAgentEngine = onAgentEngine,
                onSelection = onAiSelection
            )
        }
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
private fun CloudSyncCard(
    activity: MainActivity,
    snackbar: SnackbarHostState,
    onRemoteState: (RemoteState) -> Unit,
    onThreadsRefresh: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf(AssistantSessionStore.email(activity)) }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf(if (AssistantSessionStore.token(activity).isBlank()) "登录后，手机和电脑会读取同一份任务、计划、对话和记忆。" else "已登录 ${AssistantSessionStore.email(activity)}") }
    Card(Modifier.fillMaxWidth().padding(top = 14.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFFEAF1EC)), shape = RoundedCornerShape(9.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Refresh, null, tint = Color(0xFF277267), modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(9.dp))
                Column { Text("云端同步", color = Green, fontSize = 14.sp, fontWeight = FontWeight.Bold); Text(status, color = Muted, fontSize = 10.sp, lineHeight = 14.sp) }
            }
            if (AssistantSessionStore.token(activity).isBlank()) {
                OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Supabase 邮箱") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("密码") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Button(onClick = {
                    if (email.isBlank() || password.isBlank() || busy) return@Button
                    busy = true
                    scope.launch {
                        runCatching { supabasePasswordLogin(activity, email, password); gatewayFetchState(activity) }
                            .onSuccess { state -> onRemoteState(state); onThreadsRefresh(); status = "已登录 ${AssistantSessionStore.email(activity)}，正在使用云端数据"; snackbar.showSnackbar("云端同步已连接") }
                            .onFailure { error -> status = error.message ?: "登录失败"; snackbar.showSnackbar(status) }
                        busy = false
                    }
                }, colors = ButtonDefaults.buttonColors(containerColor = Green), modifier = Modifier.fillMaxWidth()) { Text(if (busy) "正在连接…" else "登录并同步") }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { scope.launch { runCatching { gatewayFetchState(activity) }.onSuccess { onRemoteState(it); onThreadsRefresh(); snackbar.showSnackbar("已刷新云端数据") }.onFailure { snackbar.showSnackbar(it.message ?: "刷新失败") } } }) { Text("刷新云端", color = Green) }
                    TextButton(onClick = { scope.launch { runCatching { gatewayInitializeCloud(activity) }.onSuccess { onRemoteState(it); onThreadsRefresh(); snackbar.showSnackbar("已将服务器本机状态初始化到云端") }.onFailure { snackbar.showSnackbar(it.message ?: "云端已有数据或初始化失败") } } }) { Text("首次初始化", color = Green) }
                    TextButton(onClick = { AssistantSessionStore.clear(activity); status = "已退出登录，本机不会继续读取云端数据" }) { Text("退出", color = Color(0xFF9C4B3B)) }
                }
            }
        }
    }
}

@Composable
private fun AiProviderSettingsCard(
    providers: List<AiProviderOption>,
    selectedProviderId: String,
    selectedModel: String,
    agentEngine: String,
    onAgentEngine: (String) -> Unit,
    onSelection: (String, String) -> Unit
) {
    Card(
        Modifier.fillMaxWidth().padding(top = 14.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFEAF1EC)),
        shape = RoundedCornerShape(9.dp)
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.AutoAwesome, null, tint = Color(0xFF277267), modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(9.dp))
                Column(Modifier.weight(1f)) {
                    Text("AI 提供商与模型", color = Green, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    Text("可在多个中转站和模型之间切换", color = Muted, fontSize = 10.sp)
                }
            }
            if (providers.isEmpty()) {
                Text("正在读取云端提供商列表…", color = Muted, fontSize = 11.sp)
            } else {
                Text("Agent 引擎", color = Green, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("legacy" to "标准 AI", "claude_code" to "Claude Code", "codex" to "Codex").forEach { (id, label) ->
                        TextButton(onClick = { onAgentEngine(id) }, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) {
                            Text(if (agentEngine == id) "✓ $label" else label, fontSize = 10.sp, color = if (agentEngine == id) Green else Ink)
                        }
                    }
                }
                Text("中转站", color = Green, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().heightIn(max = 180.dp)
                        .border(1.dp, Color(0xFFD4DED8), RoundedCornerShape(7.dp))
                        .padding(horizontal = 4.dp)
                ) {
                    items(providers, key = { it.id }) { provider ->
                        val selected = provider.id == selectedProviderId
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable {
                                onSelection(provider.id, provider.models.firstOrNull().orEmpty())
                            }.background(if (selected) Color(0xFFD7E8DF) else Color.Transparent).padding(horizontal = 8.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(provider.name, color = Ink, fontSize = 12.sp, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
                                Text("${provider.models.size} 个模型", color = Muted, fontSize = 9.sp)
                            }
                            if (selected) Icon(Icons.Default.Check, null, tint = Green, modifier = Modifier.size(17.dp))
                        }
                    }
                }
                val provider = providers.firstOrNull { it.id == selectedProviderId }
                if (provider != null && provider.models.isNotEmpty()) {
                    Text("模型", color = Green, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 150.dp)) {
                        items(provider.models, key = { it }) { model ->
                            val selected = model == selectedModel
                            TextButton(onClick = { onSelection(provider.id, model) }, modifier = Modifier.fillMaxWidth()) {
                                Text(if (selected) "✓ $model" else model, color = if (selected) Green else Ink, fontSize = 11.sp)
                            }
                        }
                    }
                } else if (provider != null) {
                    Text("此中转站暂未提供模型目录，可在服务端配置模型 ID。", color = Color(0xFF7A5F42), fontSize = 10.sp)
                }
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
private fun BufferSettingRow(value: Int, onSave: (Int) -> Unit) {
    var text by remember(value) { mutableStateOf(value.coerceIn(0, 1440).toString()) }
    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text("每日缓冲时间", color = Ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text("给临时事件、任务超时和任务切换预留的时间；睡觉和外出时间单独计算。", color = Muted, fontSize = 10.sp, lineHeight = 14.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it.filter(Char::isDigit).take(4) },
                label = { Text("分钟") },
                singleLine = true,
                modifier = Modifier.weight(1f)
            )
            Button(
                onClick = { onSave((text.toIntOrNull() ?: value).coerceIn(0, 1440)) },
                colors = ButtonDefaults.buttonColors(containerColor = Green),
                shape = RoundedCornerShape(7.dp)
            ) { Text("保存") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(0, 30, 60, 90).forEach { preset ->
                TextButton(onClick = { text = preset.toString() }) { Text("${preset}分", color = Green, fontSize = 10.sp) }
            }
        }
    }
}

@Composable
private fun SettingRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    detail: String,
    enabled: Boolean,
    onToggle: ((Boolean) -> Unit)? = null
) {
    Row(Modifier.fillMaxWidth().padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = if (enabled) Color(0xFF277267) else Muted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text(detail, color = Muted, fontSize = 10.sp)
        }
        if (onToggle != null) {
            Switch(checked = enabled, onCheckedChange = onToggle)
        } else {
            Box(Modifier.size(8.dp).clip(CircleShape).background(if (enabled) Color(0xFF58AE9D) else Color(0xFFD0A07C)))
        }
    }
}

package com.forward.assistant

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class RemotePlanItem(
    val id: String,
    val title: String,
    val project: String,
    val notes: String,
    val priority: Int,
    val minutes: Int,
    val start: String,
    val end: String,
    val date: String,
    val status: String,
    val dueAt: String? = null,
    val reason: String = "",
    val actualMinutes: Int = 0,
    val actualSeconds: Long = 0,
    val longTaskId: String? = null,
    val occurrenceDate: String? = null,
    val parentTaskId: String? = null,
    val parentTitle: String = ""
)

data class RemoteActiveTimer(val taskId: String, val mode: String, val targetMinutes: Int, val elapsedSeconds: Long)

data class RemotePlan(
    val now: String,
    val sleepTime: String,
    val wakeTime: String,
    val sleepDurationMinutes: Int = 480,
    val isSleeping: Boolean = false,
    val availableMinutes: Int,
    val scheduledMinutes: Int,
    val bufferMinutes: Int,
    val configuredBufferMinutes: Int = 60,
    val freeMinutes: Int,
    val adjustmentReason: String,
    val scheduled: List<RemotePlanItem>,
    val deferred: List<RemotePlanItem>,
    val completed: List<RemotePlanItem> = emptyList(),
    val currentTaskId: String?,
    val activeTimer: RemoteActiveTimer? = null
)

data class RemoteMemory(val id: String, val content: String, val status: String)
data class RemoteProject(
    val id: String,
    val name: String,
    val status: String,
    val kind: String = "project",
    val dueAt: String? = null,
    val priority: Int = 3,
    val description: String = ""
)
data class RemoteTask(
    val id: String,
    val projectId: String? = null,
    val parentTaskId: String? = null,
    val title: String,
    val notes: String = "",
    val status: String = "open",
    val priority: Int = 3,
    val minutes: Int = 45,
    val actualMinutes: Int = 0,
    val dueAt: String? = null,
    val longTaskId: String? = null,
    val occurrenceDate: String? = null
)
data class RemoteLongTask(
    val id: String,
    val projectId: String? = null,
    val title: String,
    val notes: String = "",
    val status: String = "active",
    val priority: Int = 3,
    val dailyMinutes: Int = 45,
    val dueAt: String? = null
)
data class RemoteState(
    val plan: RemotePlan?,
    val memories: List<RemoteMemory>,
    val projects: List<RemoteProject> = emptyList(),
    val tasks: List<RemoteTask> = emptyList(),
    val longTasks: List<RemoteLongTask> = emptyList()
)

/** Conversation metadata is deliberately independent from the selected mode. */
data class ConversationOptions(
    val mode: String,
    val projectId: String? = null,
    val memoryScope: Boolean,
    val saveFullConversation: Boolean,
    val allowMemoryDistillation: Boolean,
    val projectName: String? = null
)

data class ConversationThread(
    val id: String,
    val mode: String,
    val projectId: String?,
    val projectName: String,
    val memoryScope: Boolean,
    val saveFullConversation: Boolean,
    val allowMemoryDistillation: Boolean,
    val preview: String,
    val updatedAt: String,
    val messageCount: Int,
    val locked: Boolean = false
)

data class RemoteThreadDetail(val thread: ConversationThread, val messages: List<ChatMessage>)

object AssistantSessionStore {
    private const val PREFS = "assistant_session"
    private const val ACCESS_TOKEN = "supabase_access_token"
    private const val EMAIL = "supabase_email"
    fun token(context: Context): String = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(ACCESS_TOKEN, "").orEmpty()
    fun email(context: Context): String = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(EMAIL, "").orEmpty()
    fun save(context: Context, accessToken: String, email: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(ACCESS_TOKEN, accessToken).putString(EMAIL, email).apply()
    }
    fun clear(context: Context) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply() }
}

private fun gatewayBaseUrl(): String = BuildConfig.AI_GATEWAY_URL.trim().removeSuffix("/api/assistant/respond").trimEnd('/')

private fun remotePlanItem(item: JSONObject): RemotePlanItem = RemotePlanItem(
    id = item.optString("id"), title = item.optString("title"), project = item.optString("project"), notes = item.optString("notes"),
    priority = item.optInt("priority", 3), minutes = item.optInt("estimated_minutes", 45), start = item.optString("start"), end = item.optString("end"),
    date = item.optString("date"), status = item.optString("status", "open"), dueAt = item.optString("due_at").takeUnless { it.isBlank() || it == "null" }, reason = item.optString("reason"), actualMinutes = item.optInt("actual_minutes", 0), actualSeconds = item.optLong("actual_seconds", item.optInt("actual_minutes", 0) * 60L), longTaskId = item.optString("long_task_id").ifBlank { null }, occurrenceDate = item.optString("occurrence_date").ifBlank { null }
    , parentTaskId = item.optString("parent_task_id").ifBlank { null }, parentTitle = item.optString("parent_title")
)

private fun remoteProject(item: JSONObject): RemoteProject = RemoteProject(
    id = item.optString("id"), name = item.optString("name"), status = item.optString("status", "active"),
    kind = item.optString("kind", "project"), dueAt = item.optString("due_at").takeUnless { it.isBlank() || it == "null" },
    priority = item.optInt("priority", 3), description = item.optString("description")
)

private fun remoteTask(item: JSONObject): RemoteTask = RemoteTask(
    id = item.optString("id"),
    projectId = item.optString("project_id").ifBlank { null },
    parentTaskId = item.optString("parent_task_id").ifBlank { null },
    title = item.optString("title"),
    notes = item.optString("notes"),
    status = item.optString("status", "open"),
    priority = item.optInt("priority", 3),
    minutes = item.optInt("estimated_minutes", 45),
    actualMinutes = item.optInt("actual_minutes", 0),
    dueAt = item.optString("due_at").takeUnless { it.isBlank() || it == "null" },
    longTaskId = item.optString("long_task_id").ifBlank { null }, occurrenceDate = item.optString("occurrence_date").ifBlank { null }
)

private fun remoteLongTask(item: JSONObject): RemoteLongTask = RemoteLongTask(
    id = item.optString("id"), projectId = item.optString("project_id").ifBlank { null }, title = item.optString("title"), notes = item.optString("notes"),
    status = item.optString("status", "active"), priority = item.optInt("priority", 3), dailyMinutes = item.optInt("daily_minutes", 45),
    dueAt = item.optString("due_at").takeUnless { it.isBlank() || it == "null" }
)

fun parseRemotePlan(json: JSONObject?): RemotePlan? {
    if (json == null) return null
    fun items(name: String): List<RemotePlanItem> {
        val array = json.optJSONArray(name) ?: return emptyList()
        return (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::remotePlanItem) }
    }
    val active = json.optJSONObject("active_timer")?.let { timer -> RemoteActiveTimer(timer.optString("task_id"), timer.optString("mode", "stopwatch"), timer.optInt("target_minutes"), timer.optLong("elapsed_seconds")) }
    return RemotePlan(
        now = json.optString("now"), sleepTime = json.optString("sleep_time", "01:00"), wakeTime = json.optString("wake_time", "08:00"), sleepDurationMinutes = json.optInt("sleep_duration_minutes", 480), isSleeping = json.optBoolean("is_sleeping", false),
        availableMinutes = json.optInt("available_minutes"), scheduledMinutes = json.optInt("scheduled_minutes"),
        bufferMinutes = json.optInt("buffer_minutes"), configuredBufferMinutes = json.optInt("configured_buffer_minutes", json.optInt("buffer_minutes")), freeMinutes = json.optInt("free_minutes"),
        adjustmentReason = json.optString("adjustment_reason"), scheduled = items("scheduled"), deferred = items("deferred"),
        currentTaskId = json.optJSONObject("current_task")?.optString("id")?.ifBlank { null }, completed = items("completed"), activeTimer = active
    )
}

fun parseRemoteState(json: JSONObject?): RemoteState {
    val state = json ?: return RemoteState(null, emptyList())
    val memories = state.optJSONArray("memory_items")?.let { array ->
        (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let { item ->
            RemoteMemory(item.optString("id"), item.optString("content"), item.optString("status"))
        } }
    }.orEmpty()
    val projects = state.optJSONArray("projects")?.let { array ->
        (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let(::remoteProject) }
    }.orEmpty()
    val tasks = state.optJSONArray("tasks")?.let { array ->
        (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let(::remoteTask) }
    }.orEmpty()
    val longTasks = state.optJSONArray("long_tasks")?.let { array ->
        (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let(::remoteLongTask) }
    }.orEmpty()
    return RemoteState(parseRemotePlan(state.optJSONObject("plan")), memories, projects, tasks, longTasks)
}

private fun remoteThread(item: JSONObject): ConversationThread = ConversationThread(
    id = item.optString("id"),
    mode = item.optString("mode", "assistant"),
    projectId = item.optString("project_id").ifBlank { null },
    projectName = item.optString("project_name"),
    memoryScope = item.optBoolean("memory_scope", true),
    saveFullConversation = item.optBoolean("save_full_conversation", true),
    allowMemoryDistillation = item.optBoolean("allow_memory_distillation", true),
    preview = item.optString("preview"),
    updatedAt = item.optString("updated_at"),
    messageCount = item.optInt("message_count"),
    locked = item.optBoolean("locked", false)
)

private fun optionsJson(options: ConversationOptions): JSONObject = JSONObject().apply {
    put("memory_scope", options.memoryScope)
    put("save_full_conversation", options.saveFullConversation)
    put("allow_memory_distillation", options.allowMemoryDistillation)
    options.projectId?.takeIf(String::isNotBlank)?.let { put("project_id", it) }
    options.projectName?.takeIf(String::isNotBlank)?.let { put("project", it) }
}

private fun gatewayConnection(context: Context, endpoint: String, method: String, body: ByteArray? = null): HttpURLConnection {
    val connection = (URL("${gatewayBaseUrl()}$endpoint").openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = 8_000
        readTimeout = 60_000
        useCaches = false
        setRequestProperty("Connection", "close")
        if (BuildConfig.AI_GATEWAY_TOKEN.isNotBlank()) setRequestProperty("x-forward-token", BuildConfig.AI_GATEWAY_TOKEN)
        AssistantSessionStore.token(context).takeIf(String::isNotBlank)?.let { setRequestProperty("Authorization", "Bearer $it") }
        if (body != null) {
            doOutput = true
            setFixedLengthStreamingMode(body.size)
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
        }
    }
    return connection
}

private fun HttpURLConnection.readJsonOrThrow(defaultError: String): JSONObject {
    val stream = if (responseCode in 200..299) inputStream else errorStream
    val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
    val json = runCatching { JSONObject(response) }.getOrElse { JSONObject().put("error", response) }
    check(responseCode in 200..299) { json.optString("error", defaultError) }
    return json
}

suspend fun gatewayFetchState(context: Context): RemoteState = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val connection = gatewayConnection(context, "/api/assistant/state", "GET")
    try { parseRemoteState(connection.readJsonOrThrow("读取同步数据失败").optJSONObject("state")) } finally { connection.disconnect() }
}

suspend fun gatewayListThreads(context: Context, limit: Int = 60): List<ConversationThread> = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val connection = gatewayConnection(context, "/api/assistant/threads?limit=${limit.coerceIn(1, 200)}", "GET")
    try {
        val array = connection.readJsonOrThrow("读取历史对话失败").optJSONArray("threads") ?: return@withContext emptyList()
        (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::remoteThread) }
    } finally { connection.disconnect() }
}

suspend fun gatewayLoadThread(context: Context, threadId: String, limit: Int = 200): RemoteThreadDetail = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val connection = gatewayConnection(context, "/api/assistant/threads/${threadId.trim()}?limit=${limit.coerceIn(1, 500)}", "GET")
    try {
        val json = connection.readJsonOrThrow("读取这段对话失败")
        val rawThread = json.optJSONObject("thread") ?: error("服务没有返回对话内容")
        val messages = rawThread.optJSONArray("messages")?.let { array ->
            (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let { message ->
                val content = message.optString("content").trim()
                val imageData = message.optJSONArray("attachments")?.let { attachments ->
                    (0 until attachments.length()).mapNotNull { attachmentIndex ->
                        attachments.optJSONObject(attachmentIndex)?.optString("data_url")?.trim()?.takeIf(String::isNotBlank)
                    }
                }.orEmpty()
                if (content.isNotBlank() || imageData.isNotEmpty()) {
                    ChatMessage(message.optString("role") == "assistant", content, imageData)
                } else null
            } }
        }.orEmpty()
        RemoteThreadDetail(remoteThread(rawThread), messages)
    } finally { connection.disconnect() }
}

suspend fun gatewayCreateThread(context: Context, options: ConversationOptions): ConversationThread = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val request = JSONObject().apply {
        put("conversation_mode", options.mode)
        options.projectId?.takeIf(String::isNotBlank)?.let { put("project_id", it) }
        options.projectName?.takeIf(String::isNotBlank)?.let { put("project", it) }
        put("conversation_options", optionsJson(options))
    }.toString().toByteArray(Charsets.UTF_8)
    val connection = gatewayConnection(context, "/api/assistant/threads", "POST", request)
    try {
        connection.outputStream.use { it.write(request) }
        val thread = connection.readJsonOrThrow("新建对话失败").optJSONObject("thread") ?: error("服务没有返回新对话")
        remoteThread(thread)
    } finally { connection.disconnect() }
}

suspend fun gatewayUpdateThreadOptions(context: Context, threadId: String, options: ConversationOptions): ConversationThread = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val request = JSONObject().put("conversation_options", optionsJson(options)).toString().toByteArray(Charsets.UTF_8)
    val connection = gatewayConnection(context, "/api/assistant/threads/${threadId.trim()}", "PATCH", request)
    try {
        connection.outputStream.use { it.write(request) }
        val thread = connection.readJsonOrThrow("保存会话设置失败").optJSONObject("thread") ?: error("服务没有返回会话设置")
        remoteThread(thread)
    } finally { connection.disconnect() }
}

data class MemoryRunStatus(
    val rawMessageCount: Int,
    val activeCount: Int,
    val pendingReviewCount: Int,
    val archivedCount: Int,
    val latestStatus: String,
    val latestDate: String,
    val summary: String
)

private fun parseMemoryRunStatus(json: JSONObject): MemoryRunStatus {
    val counts = json.optJSONObject("memory_counts")
    val latest = json.optJSONObject("latest_run")
    val summary = json.optJSONObject("summary")
    return MemoryRunStatus(
        rawMessageCount = json.optInt("raw_message_count"),
        activeCount = counts?.optInt("active") ?: 0,
        pendingReviewCount = counts?.optInt("pending_review") ?: 0,
        archivedCount = counts?.optInt("archived") ?: 0,
        latestStatus = latest?.optString("status").orEmpty(),
        latestDate = latest?.optString("date").orEmpty(),
        summary = summary?.optString("summary").orEmpty()
    )
}

suspend fun gatewayMemoryStatus(context: Context): MemoryRunStatus = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val connection = gatewayConnection(context, "/api/assistant/memory/status", "GET")
    try { parseMemoryRunStatus(connection.readJsonOrThrow("读取记忆状态失败")) } finally { connection.disconnect() }
}

suspend fun gatewayRunDailyMemory(context: Context): RemoteState = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val connection = gatewayConnection(context, "/api/assistant/memory/daily-run", "POST", "{}".toByteArray(Charsets.UTF_8))
    try {
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        parseRemoteState(connection.readJsonOrThrow("每日记忆整理失败").optJSONObject("state"))
    } finally { connection.disconnect() }
}

suspend fun gatewayUpdateMemory(context: Context, memoryId: String, status: String, content: String? = null): RemoteState = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val request = JSONObject().apply {
        put("status", status)
        content?.let { put("content", it) }
    }.toString().toByteArray(Charsets.UTF_8)
    val connection = gatewayConnection(context, "/api/assistant/memories/${memoryId.trim()}", "PATCH", request)
    try {
        connection.outputStream.use { it.write(request) }
        parseRemoteState(connection.readJsonOrThrow("更新记忆失败").optJSONObject("state"))
    } finally { connection.disconnect() }
}

suspend fun gatewayExecuteAction(context: Context, threadId: String?, action: JSONObject): RemoteState = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val request = JSONObject().apply {
        if (!threadId.isNullOrBlank()) put("thread_id", threadId)
        put("conversation_mode", "daily_planning")
        put("actions", JSONArray().put(action))
    }.toString().toByteArray(Charsets.UTF_8)
    val connection = gatewayConnection(context, "/api/assistant/actions", "POST", request)
    try {
        connection.outputStream.use { it.write(request) }
        parseRemoteState(connection.readJsonOrThrow("计划更新失败").optJSONObject("state"))
    } finally { connection.disconnect() }
}

data class SupabaseConfig(val url: String, val anonKey: String)

suspend fun gatewaySupabaseConfig(context: Context): SupabaseConfig = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val connection = gatewayConnection(context, "/api/auth/config", "GET")
    try {
        val json = connection.readJsonOrThrow("读取云端同步配置失败")
        check(json.optBoolean("configured")) { "云端同步尚未配置" }
        SupabaseConfig(json.optString("url"), json.optString("anonKey"))
    } finally { connection.disconnect() }
}

suspend fun supabasePasswordLogin(context: Context, email: String, password: String): String = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val config = gatewaySupabaseConfig(context)
    val bytes = JSONObject().put("email", email.trim()).put("password", password).toString().toByteArray(Charsets.UTF_8)
    val connection = (URL("${config.url}/auth/v1/token?grant_type=password").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"; connectTimeout = 8_000; readTimeout = 30_000; doOutput = true; setFixedLengthStreamingMode(bytes.size)
        setRequestProperty("apikey", config.anonKey); setRequestProperty("Content-Type", "application/json")
    }
    try {
        connection.outputStream.use { it.write(bytes) }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        val json = JSONObject(text)
        check(connection.responseCode in 200..299) { json.optString("msg", json.optString("message", "登录失败")) }
        val token = json.optString("access_token")
        check(token.isNotBlank()) { "登录没有返回访问令牌" }
        AssistantSessionStore.save(context, token, json.optJSONObject("user")?.optString("email").orEmpty().ifBlank { email.trim() })
        token
    } finally { connection.disconnect() }
}

suspend fun gatewayInitializeCloud(context: Context): RemoteState = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val connection = gatewayConnection(context, "/api/assistant/sync/initialize", "POST", "{}".toByteArray(Charsets.UTF_8))
    try {
        connection.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
        parseRemoteState(connection.readJsonOrThrow("初始化云端同步失败").optJSONObject("state"))
    } finally { connection.disconnect() }
}

suspend fun gatewayDeleteThread(context: Context, threadId: String): Boolean = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val connection = gatewayConnection(context, "/api/assistant/threads/${threadId.trim()}", "DELETE")
    try { connection.readJsonOrThrow("删除对话失败"); true } finally { connection.disconnect() }
}

suspend fun gatewaySetThreadLocked(context: Context, threadId: String, locked: Boolean): ConversationThread = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val request = JSONObject().put("locked", locked).toString().toByteArray(Charsets.UTF_8)
    val connection = gatewayConnection(context, "/api/assistant/threads/${threadId.trim()}", "PATCH", request)
    try { connection.outputStream.use { it.write(request) }; remoteThread(connection.readJsonOrThrow("更新对话锁定状态失败").optJSONObject("thread") ?: error("服务没有返回对话")) } finally { connection.disconnect() }
}

suspend fun gatewayDeleteThreads(context: Context, threadIds: List<String>): Pair<List<String>, List<String>> = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val request = JSONObject().put("thread_ids", JSONArray(threadIds)).toString().toByteArray(Charsets.UTF_8)
    val connection = gatewayConnection(context, "/api/assistant/threads/bulk-delete", "POST", request)
    try {
        connection.outputStream.use { it.write(request) }
        val json = connection.readJsonOrThrow("批量删除对话失败")
        val deleted = json.optJSONArray("deleted")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
        val locked = json.optJSONArray("locked")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
        deleted to locked
    } finally { connection.disconnect() }
}

suspend fun gatewayCreateProject(context: Context, name: String, kind: String, description: String, priority: Int = 3, dueAt: String? = null): RemoteState = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val request = JSONObject().apply {
        put("name", name)
        put("kind", if (kind == "goal") "goal" else "project")
        put("description", description)
        put("priority", priority)
        put("due_at", dueAt ?: JSONObject.NULL)
    }.toString().toByteArray(Charsets.UTF_8)
    val connection = gatewayConnection(context, "/api/assistant/projects", "POST", request)
    try {
        connection.outputStream.use { it.write(request) }
        parseRemoteState(connection.readJsonOrThrow("新建项目失败").optJSONObject("state"))
    } finally { connection.disconnect() }
}

suspend fun gatewayCreateLongTask(context: Context, title: String, dailyMinutes: Int, priority: Int, projectId: String? = null, dueAt: String? = null, notes: String = ""): RemoteState = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val request = JSONObject().apply {
        put("title", title)
        put("daily_minutes", dailyMinutes.coerceIn(5, 720))
        put("priority", priority)
        put("project_id", projectId ?: JSONObject.NULL)
        put("due_at", dueAt ?: JSONObject.NULL)
        put("notes", notes)
    }.toString().toByteArray(Charsets.UTF_8)
    val connection = gatewayConnection(context, "/api/assistant/long-tasks", "POST", request)
    try {
        connection.outputStream.use { it.write(request) }
        parseRemoteState(connection.readJsonOrThrow("新建长期任务失败").optJSONObject("state"))
    } finally { connection.disconnect() }
}

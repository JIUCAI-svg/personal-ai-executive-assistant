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
    val reason: String = ""
)

data class RemotePlan(
    val now: String,
    val sleepTime: String,
    val wakeTime: String,
    val availableMinutes: Int,
    val scheduledMinutes: Int,
    val bufferMinutes: Int,
    val freeMinutes: Int,
    val adjustmentReason: String,
    val scheduled: List<RemotePlanItem>,
    val deferred: List<RemotePlanItem>,
    val currentTaskId: String?
)

data class RemoteMemory(val id: String, val content: String, val status: String)
data class RemoteState(val plan: RemotePlan?, val memories: List<RemoteMemory>)

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
    date = item.optString("date"), status = item.optString("status", "open"), reason = item.optString("reason")
)

fun parseRemotePlan(json: JSONObject?): RemotePlan? {
    if (json == null) return null
    fun items(name: String): List<RemotePlanItem> {
        val array = json.optJSONArray(name) ?: return emptyList()
        return (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::remotePlanItem) }
    }
    return RemotePlan(
        now = json.optString("now"), sleepTime = json.optString("sleep_time", "01:00"), wakeTime = json.optString("wake_time", "08:00"),
        availableMinutes = json.optInt("available_minutes"), scheduledMinutes = json.optInt("scheduled_minutes"),
        bufferMinutes = json.optInt("buffer_minutes"), freeMinutes = json.optInt("free_minutes"),
        adjustmentReason = json.optString("adjustment_reason"), scheduled = items("scheduled"), deferred = items("deferred"),
        currentTaskId = json.optJSONObject("current_task")?.optString("id")?.ifBlank { null }
    )
}

fun parseRemoteState(json: JSONObject?): RemoteState {
    val state = json ?: return RemoteState(null, emptyList())
    val memories = state.optJSONArray("memory_items")?.let { array ->
        (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let { item ->
            RemoteMemory(item.optString("id"), item.optString("content"), item.optString("status"))
        } }
    }.orEmpty()
    return RemoteState(parseRemotePlan(state.optJSONObject("plan")), memories)
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

suspend fun gatewayFetchState(context: Context): RemoteState = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val connection = gatewayConnection(context, "/api/assistant/state", "GET")
    try {
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        check(connection.responseCode in 200..299) { JSONObject(response).optString("error", "读取同步数据失败") }
        parseRemoteState(JSONObject(response).optJSONObject("state"))
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
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        check(connection.responseCode in 200..299) { JSONObject(response).optString("error", "计划更新失败") }
        parseRemoteState(JSONObject(response).optJSONObject("state"))
    } finally { connection.disconnect() }
}

data class SupabaseConfig(val url: String, val anonKey: String)

suspend fun gatewaySupabaseConfig(context: Context): SupabaseConfig = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val connection = gatewayConnection(context, "/api/auth/config", "GET")
    try {
        val text = connection.inputStream.bufferedReader().use { it.readText() }
        val json = JSONObject(text)
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
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        val json = JSONObject(text)
        check(connection.responseCode in 200..299) { json.optString("error", "初始化云端同步失败") }
        parseRemoteState(json.optJSONObject("state"))
    } finally { connection.disconnect() }
}

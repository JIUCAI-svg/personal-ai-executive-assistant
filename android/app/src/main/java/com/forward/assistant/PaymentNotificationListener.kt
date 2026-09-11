package com.forward.assistant

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// Observation-phase notification capture: accept EVERY notification, mask
// verification codes, extract payments from any app, keep a raw observation
// ring buffer, and batch-upload to the gateway. No whitelist by design —
// parsing rules get tuned against real data first.

private const val TAG = "PaymentListener"
private const val PREFS = "payment_capture"
private const val MAX_OBSERVATIONS = 400
private const val MAX_PAYMENTS = 5_000
private const val OBSERVATION_RETENTION_DAYS = 7L
private const val UPLOAD_MIN_INTERVAL_MS = 3 * 60 * 1000L

private val PAYMENT_AMOUNT_REGEX =
    Regex("""(?:[¥￥]\s*([0-9,]+\.[0-9]{2}))|((?:支付|付款|消费|支出|收款|到账|退[款回]|转入|转出)[^\d]{0,12}([0-9,]+\.[0-9]{2})\s*元?)""")

private val INCOME_REGEX = Regex("""收款|到账|退[款回]|转入|退款成功""")
private val EXPENSE_REGEX = Regex("""已?支付|付款成功|消费|支出|转出|扣[款除]""")

private val VERIFICATION_CODE_REGEXES = listOf(
    Regex("""(验证码|校验码|动态码|动态密码)[^0-9]{0,16}(\d{4,8})"""),
    Regex("""(\d{4,8})[^\d]{0,8}(?:是您的|为您的|，请勿|,请勿)""")
)

/** Masks verification-code digits while keeping the rest of the text intact. */
internal fun maskVerificationCodes(text: String): String {
    var masked = text
    for (regex in VERIFICATION_CODE_REGEXES) {
        masked = regex.replace(masked) { match ->
            val digits = match.groupValues.last()
            match.value.replace(digits, "•".repeat(digits.length))
        }
    }
    return masked
}

internal data class ParsedPayment(
    val amount: Double,
    val direction: String,
    val merchant: String
)

/** Extracts amount + direction from arbitrary notification text, any app. */
internal fun parsePayment(title: String, text: String): ParsedPayment? {
    val haystack = "$title $text"
    val match = PAYMENT_AMOUNT_REGEX.find(haystack) ?: return null
    val amountText = (match.groupValues[1].ifBlank { match.groupValues[3] }).replace(",", "")
    val amount = amountText.toDoubleOrNull() ?: return null
    if (amount <= 0.0) return null
    val direction = when {
        INCOME_REGEX.containsMatchIn(haystack) -> "income"
        EXPENSE_REGEX.containsMatchIn(haystack) -> "expense"
        else -> "expense"
    }
    val merchant = Regex("""(?:向|给|在)\s*([^\s，。,]{2,20})""").find(haystack)?.groupValues?.get(1).orEmpty()
    return ParsedPayment(amount, direction, merchant)
}

internal fun observationKey(packageName: String, postedAt: Long, title: String, text: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
        .digest("$packageName|$postedAt|$title|$text".toByteArray())
    return digest.take(10).joinToString("") { "%02x".format(it) }
}

class PaymentCaptureStore {
    companion object {
        fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        fun pendingQueue(context: Context): Pair<List<JSONObject>, List<JSONObject>> {
            val preferences = prefs(context)
            val payments = preferences.getString("pending_payments", "[]").orEmpty()
            val observations = preferences.getString("pending_observations", "[]").orEmpty()
            return JSONArray(payments).let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) } } to
                JSONArray(observations).let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) } }
        }

        fun clearUploaded(context: Context, paymentKeys: List<String>, observationKeys: List<String>) {
            val paymentSet = paymentKeys.toSet()
            val observationSet = observationKeys.toSet()
            val (payments, observations) = pendingQueue(context)
            val preferences = prefs(context).edit()
            preferences.putString("pending_payments", JSONArray(payments.filterNot { it.optString("key") in paymentSet }).toString())
            preferences.putString("pending_observations", JSONArray(observations.filterNot { it.optString("key") in observationSet }).toString())
            preferences.apply()
        }
    }
}

class PaymentNotificationListener : NotificationListenerService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var lastUploadAt = 0L

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn?.notification ?: return
        val extras = notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        if (title.isBlank() && text.isBlank()) return
        val packageName = sbn.packageName.orEmpty()
        val postedAt = sbn.postTime

        val maskedTitle = maskVerificationCodes(title)
        val maskedText = maskVerificationCodes(text)
        val key = observationKey(packageName, postedAt, maskedTitle, maskedText)
        val payment = parsePayment(maskedTitle, maskedText)

        val preferences = PaymentCaptureStore.prefs(this).edit()
        var (pendingPayments, pendingObservations) = PaymentCaptureStore.pendingQueue(this)

        if (payment != null) {
            val appLabel = runCatching {
                val info = packageManager.getApplicationInfo(packageName, 0)
                packageManager.getApplicationLabel(info).toString()
            }.getOrDefault(packageName)
            val newPayments = pendingPayments.plus(
                JSONObject()
                    .put("key", key)
                    .put("amount", payment.amount)
                    .put("direction", payment.direction)
                    .put("source", appLabel)
                    .put("package_name", packageName)
                    .put("merchant", payment.merchant)
                    .put("note", maskedText.take(200))
                    .put("occurred_at", formatInstant(postedAt))
            )
            preferences.putString("pending_payments", JSONArray(newPayments).toString())
            pendingPayments = newPayments
        }

        val observation = JSONObject()
            .put("key", key)
            .put("package_name", packageName)
            .put("app", pendingPayments.lastOrNull()?.optString("source") ?: packageName)
            .put("title", maskedTitle.take(120))
            .put("text", maskedText.take(600))
            .put("is_payment", payment != null)
            .put("posted_at", formatInstant(postedAt))
        preferences.putString(
            "pending_observations",
            JSONArray((pendingObservations + observation).takeLast(MAX_OBSERVATIONS)).toString()
        )
        preferences.apply()
        pruneOld()

        val now = System.currentTimeMillis()
        if (now - lastUploadAt >= UPLOAD_MIN_INTERVAL_MS) {
            lastUploadAt = now
            scope.launch { flushUpload() }
        }
    }

    private fun formatInstant(postedAt: Long): String =
        LocalDateTime.ofInstant(Instant.ofEpochMilli(postedAt), ZoneId.systemDefault())
            .format(DateTimeFormatter.ISO_LOCAL_DATE_TIME)

    private fun pruneOld() {
        val cutoff = LocalDate.now().minusDays(OBSERVATION_RETENTION_DAYS).toString()
        val (payments, observations) = PaymentCaptureStore.pendingQueue(this)
        val kept = observations.filter { (it.optString("posted_at") ?: "").take(10) >= cutoff }
        if (kept.size != observations.size) {
            PaymentCaptureStore.prefs(this).edit()
                .putString("pending_observations", JSONArray(kept).toString()).apply()
        }
        if (payments.size > MAX_PAYMENTS) {
            PaymentCaptureStore.prefs(this).edit()
                .putString("pending_payments", JSONArray(payments.takeLast(MAX_PAYMENTS)).toString()).apply()
        }
    }

    private suspend fun flushUpload() {
        val (payments, observations) = PaymentCaptureStore.pendingQueue(this)
        if (payments.isEmpty() && observations.isEmpty()) return
        val configuredUrl = BuildConfig.AI_GATEWAY_URL.trim()
        if (configuredUrl.isBlank()) return
        val base = if (configuredUrl.endsWith("/api/assistant/respond")) {
            configuredUrl.removeSuffix("/api/assistant/respond")
        } else configuredUrl.trimEnd('/')
        val payload = JSONObject()
            .put("payments", JSONArray(payments))
            .put("observations", JSONArray(observations.takeLast(MAX_OBSERVATIONS)))
            .toString().toByteArray(Charsets.UTF_8)
        val connection = (URL("$base/api/assistant/expenses").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 8_000; readTimeout = 30_000; doOutput = true
            setFixedLengthStreamingMode(payload.size)
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Connection", "close")
            if (BuildConfig.AI_GATEWAY_TOKEN.isNotBlank()) setRequestProperty("x-forward-token", BuildConfig.AI_GATEWAY_TOKEN)
        }
        try {
            connection.outputStream.use { output -> output.write(payload) }
            if (connection.responseCode in 200..299) {
                PaymentCaptureStore.clearUploaded(
                    this,
                    payments.map { it.optString("key") },
                    observations.map { it.optString("key") }
                )
            } else {
                Log.w(TAG, "expense upload failed: HTTP ${connection.responseCode}")
            }
        } catch (error: Exception) {
            Log.w(TAG, "expense upload error: ${error.message}")
        } finally { connection.disconnect() }
    }
}

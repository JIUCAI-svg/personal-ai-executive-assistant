package com.forward.assistant

/**
 * Decides whether a completed assistant reply needs a system notification.
 *
 * A reply is considered consumed only when the app is resumed, the chat page
 * is visible, and that exact reply thread is the thread currently on screen.
 * Keeping this decision pure makes the foreground/background contract easy to
 * verify without a device or Android framework.
 */
data class ReplyNotificationContext(
    val appInForeground: Boolean,
    val chatPageVisible: Boolean,
    val visibleThreadId: String?,
    val replyThreadId: String?
)

object ReplyNotificationPolicy {
    fun shouldNotify(context: ReplyNotificationContext): Boolean {
        val sameThread = !context.replyThreadId.isNullOrBlank() &&
            context.replyThreadId == context.visibleThreadId
        return !(context.appInForeground && context.chatPageVisible && sameThread)
    }
}

/**
 * Process-local view state shared by the foreground activity and background
 * proactive delivery. The policy remains pure; this object only mirrors the
 * current UI visibility so a service can apply the same decision.
 */
object ReplyNotificationState {
    @Volatile var appInForeground: Boolean = false
        private set
    @Volatile var chatPageVisible: Boolean = false
        private set
    @Volatile var visibleThreadId: String? = null
        private set

    fun setAppInForeground(value: Boolean) {
        appInForeground = value
    }

    fun setChatPageVisible(visible: Boolean, threadId: String?) {
        chatPageVisible = visible
        visibleThreadId = threadId
    }

    fun context(replyThreadId: String?): ReplyNotificationContext = ReplyNotificationContext(
        appInForeground = appInForeground,
        chatPageVisible = chatPageVisible,
        visibleThreadId = visibleThreadId,
        replyThreadId = replyThreadId
    )
}

private const val REPLY_THREAD_SCHEME = "forward"
private const val REPLY_THREAD_HOST = "thread"

fun replyThreadDeepLink(threadId: String): android.net.Uri =
    android.net.Uri.Builder()
        .scheme(REPLY_THREAD_SCHEME)
        .authority(REPLY_THREAD_HOST)
        .appendPath(threadId)
        .build()

fun threadIdFromReplyDeepLink(intent: android.content.Intent?): String? {
    val data = intent?.data ?: return null
    if (!data.scheme.equals(REPLY_THREAD_SCHEME, ignoreCase = true) ||
        !data.host.equals(REPLY_THREAD_HOST, ignoreCase = true)) return null
    return data.pathSegments.lastOrNull()?.takeIf { it.isNotBlank() }
}

fun proactiveNotificationShouldNotify(replyThreadId: String?): Boolean =
    ReplyNotificationPolicy.shouldNotify(ReplyNotificationState.context(replyThreadId))

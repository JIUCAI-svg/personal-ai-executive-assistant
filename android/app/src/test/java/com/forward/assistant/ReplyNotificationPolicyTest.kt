package com.forward.assistant

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyNotificationPolicyTest {
    @Test
    fun suppressesReplyWhileSameChatIsVisible() {
        assertFalse(
            ReplyNotificationPolicy.shouldNotify(
                ReplyNotificationContext(true, true, "THREAD", "THREAD")
            )
        )
    }

    @Test
    fun notifiesWhenAnotherThreadIsVisible() {
        assertTrue(
            ReplyNotificationPolicy.shouldNotify(
                ReplyNotificationContext(true, true, "OTHER", "THREAD")
            )
        )
    }

    @Test
    fun notifiesWhenAnotherPageOrBackgroundIsActive() {
        assertTrue(ReplyNotificationPolicy.shouldNotify(ReplyNotificationContext(true, false, "THREAD", "THREAD")))
        assertTrue(ReplyNotificationPolicy.shouldNotify(ReplyNotificationContext(false, true, "THREAD", "THREAD")))
    }

    @Test
    fun suppressesReplyOnAnyVisibleChatSurface() {
        // Project conversations use a separate navigation tab but render the
        // same chat surface; the policy only receives the visibility result.
        assertFalse(
            ReplyNotificationPolicy.shouldNotify(
                ReplyNotificationContext(true, true, "PROJECT_THREAD", "PROJECT_THREAD")
            )
        )
    }

    @Test
    fun missingThreadIdentityDoesNotCountAsConsumed() {
        assertTrue(ReplyNotificationPolicy.shouldNotify(ReplyNotificationContext(true, true, null, "THREAD")))
        assertTrue(ReplyNotificationPolicy.shouldNotify(ReplyNotificationContext(true, true, "THREAD", null)))
    }
}

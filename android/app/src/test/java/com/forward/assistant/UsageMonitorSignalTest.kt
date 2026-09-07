package com.forward.assistant

import java.time.LocalTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UsageMonitorSignalTest {
    @Test
    fun anyForegroundAppQualifiesWithoutManualTargetSelection() {
        val snapshot = UsageAppSnapshot(
            appName = "短视频",
            packageName = "com.example.video",
            dailyMinutes = 12,
            currentSessionMinutes = 10,
            dailyLimitMinutes = 30,
            sessionLimitMinutes = 20,
            isInForeground = true,
            sessionStartedAt = 1234L
        )
        assertTrue(qualifiesForPhoneUsageProactive(snapshot))
    }

    @Test
    fun backgroundOrIncompleteSessionDoesNotQualify() {
        val base = UsageAppSnapshot(
            appName = "短视频",
            packageName = "com.example.video",
            dailyMinutes = 12,
            currentSessionMinutes = 12,
            dailyLimitMinutes = 30,
            sessionLimitMinutes = 20,
            isInForeground = true,
            sessionStartedAt = 1234L
        )
        assertFalse(qualifiesForPhoneUsageProactive(base.copy(isInForeground = false)))
        assertFalse(qualifiesForPhoneUsageProactive(base.copy(currentSessionMinutes = 9)))
        assertFalse(qualifiesForPhoneUsageProactive(base.copy(sessionStartedAt = 0L)))
    }

    @Test
    fun phoneUsageKeyIsStableAcrossPollingMinutes() {
        val first = phoneUsageIdempotencyKey("com.example.study", 1234L, 10)
        val later = phoneUsageIdempotencyKey("com.example.study", 1234L, 25)
        assertEquals(first, later)
        assertTrue(first.contains("com.example.study"))
        assertTrue(first.contains("1234"))
    }

    @Test
    fun selfCheckKeyUsesFollowupIdentity() {
        assertEquals("schedule_self_check:followup-1", selfCheckIdempotencyKey("followup-1"))
    }

    @Test
    fun sleepWindowHandlesOvernightBoundary() {
        val sleep = LocalTime.of(23, 30)
        val wake = LocalTime.of(8, 0)
        assertTrue(isWithinLocalSleepWindow(LocalTime.of(23, 45), sleep, wake))
        assertTrue(isWithinLocalSleepWindow(LocalTime.of(7, 59), sleep, wake))
        assertFalse(isWithinLocalSleepWindow(LocalTime.of(8, 0), sleep, wake))
        assertFalse(isWithinLocalSleepWindow(LocalTime.of(14, 0), sleep, wake))
    }
}

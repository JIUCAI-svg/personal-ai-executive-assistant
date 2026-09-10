package com.forward.assistant

import java.time.LocalDateTime
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
    fun snapshotDateKeepsItsOwnDayAcrossMidnight() {
        assertEquals("2026-09-04", snapshotDateFrom("2026-09-04T23:59:09.627"))
        assertEquals("2026-09-05", snapshotDateFrom("2026-09-05T00:01:02.000"))
        assertEquals("2026-09-09", snapshotDateFrom("", "2026-09-09"))
        assertEquals("2026-09-09", snapshotDateFrom("garbage", "2026-09-09"))
    }

    @Test
    fun heartbeatKeyCollapsesEachHalfHourSlot() {
        assertEquals("heartbeat:2026-09-10-00:00", heartbeatIdempotencyKey(LocalDateTime.of(2026, 9, 10, 0, 0)))
        assertEquals("heartbeat:2026-09-10-00:00", heartbeatIdempotencyKey(LocalDateTime.of(2026, 9, 10, 0, 29, 59)))
        assertEquals("heartbeat:2026-09-10-00:30", heartbeatIdempotencyKey(LocalDateTime.of(2026, 9, 10, 0, 30)))
        assertEquals("heartbeat:2026-09-10-08:00", heartbeatIdempotencyKey(LocalDateTime.of(2026, 9, 10, 8, 14)))
        assertEquals("heartbeat:2026-09-10-23:30", heartbeatIdempotencyKey(LocalDateTime.of(2026, 9, 10, 23, 59)))
    }
}

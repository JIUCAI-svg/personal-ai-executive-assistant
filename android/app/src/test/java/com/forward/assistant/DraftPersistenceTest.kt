package com.forward.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Focused unit tests for the pure per-thread draft logic ([ThreadDrafts]).
 * The same key construction and write semantics that the Android store applies
 * to SharedPreferences are exercised here against an in-memory map, covering
 * keying, thread switching, clearing, and save/load round-trips.
 */
class DraftPersistenceTest {
    private fun apply(map: MutableMap<String, String>, write: Pair<String, String?>) {
        val key = write.first
        val value = write.second
        if (value == null) map.remove(key) else map[key] = value
    }

    private fun <T> read(map: Map<String, T>, threadId: String?): String =
        ThreadDrafts.read({ map[it] as String? }, threadId)

    @Test
    fun blankThreadMapsToStableKey() {
        assertNotEquals(ThreadDrafts.key("thread-1"), ThreadDrafts.key("thread-2"))
        assertEquals(ThreadDrafts.key(null), ThreadDrafts.key("   "))
        assertTrue(ThreadDrafts.key("thread-1").contains("thread-1"))
    }

    @Test
    fun roundTripKeepsDraft() {
        val map = mutableMapOf<String, String>()
        apply(map, ThreadDrafts.write("thread-1", "待发送草稿"))
        assertEquals("待发送草稿", read(map, "thread-1"))
    }

    @Test
    fun draftsAreIsolatedPerThreadOnSwitch() {
        val map = mutableMapOf<String, String>()
        apply(map, ThreadDrafts.write("thread-1", "草稿甲"))
        // switch to another thread and compose a new draft
        apply(map, ThreadDrafts.write("thread-2", "草稿乙"))
        // switching back restores each thread's own draft
        assertEquals("草稿甲", read(map, "thread-1"))
        assertEquals("草稿乙", read(map, "thread-2"))
    }

    @Test
    fun savingBlankClearsTheDraft() {
        val map = mutableMapOf<String, String>()
        apply(map, ThreadDrafts.write("thread-1", "草稿甲"))
        assertEquals("草稿甲", read(map, "thread-1"))
        apply(map, ThreadDrafts.write("thread-1", "   "))
        assertEquals("", read(map, "thread-1"))
    }

    @Test
    fun fallbackSwitchSavesOldAndRestoresTarget() {
        val result = ThreadDrafts.switch("old", "旧稿", "目标稿")
        assertEquals("old", result.previousThreadId)
        assertEquals("旧稿", result.previousDraft)
        assertEquals("目标稿", result.targetDraft)
    }

    @Test
    fun lifecycleSnapshotRemainsBoundToCapturedThread() {
        val result = ThreadDrafts.snapshot("captured", "生命周期草稿")
        assertEquals("captured", result.threadId)
        assertEquals("生命周期草稿", result.draft)
    }
    @Test
    fun clearRemovesOnlyTheTargetThreadDraft() {
        val map = mutableMapOf<String, String>()
        apply(map, ThreadDrafts.write("thread-1", "草稿甲"))
        apply(map, ThreadDrafts.write("thread-2", "草稿乙"))
        apply(map, ThreadDrafts.clear("thread-1"))
        assertEquals("", read(map, "thread-1"))
        assertEquals("草稿乙", read(map, "thread-2"))
    }
}

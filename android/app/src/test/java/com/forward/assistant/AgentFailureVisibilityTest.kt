package com.forward.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentFailureVisibilityTest {
    @Test
    fun durableAgentErrorWinsOverTransportFailure() {
        assertEquals(
            "HTTP 403: Insufficient account balance",
            agentFailureText("HTTP 403: Insufficient account balance", IllegalStateException("AI 网关请求失败"))
        )
    }

    @Test
    fun failedRunCardIsKeptUntilDurableTranscriptContainsThatRun() {
        val localFailure = ChatMessage(
            fromAssistant = true,
            text = "HTTP 403: Access blocked by Cloudflare",
            isError = true,
            requestId = "request-1"
        )
        val beforePersistence = mergeTranscriptWithLocalRunFailures(
            listOf(ChatMessage(false, "在吗")),
            listOf(ChatMessage(false, "在吗"), localFailure)
        )
        assertEquals(2, beforePersistence.size)
        assertTrue(beforePersistence.last().isError)

        val persistedFailure = localFailure.copy()
        val afterPersistence = mergeTranscriptWithLocalRunFailures(
            listOf(ChatMessage(false, "在吗"), persistedFailure),
            beforePersistence
        )
        assertEquals(2, afterPersistence.size)
        assertTrue(afterPersistence.last().isError)
    }

    @Test
    fun connectionAbortIsATransientTransportError() {
        assertTrue(isTransientTransportAbort(IllegalStateException("Software caused connection abort")))
        assertTrue(isTransientTransportAbort(IllegalStateException("Connection reset")))
    }

    @Test
    fun connectionAbortCardsAreNotKeptAfterSuccessfulReply() {
        val abort = ChatMessage(
            fromAssistant = true,
            text = "Software caused connection abort",
            isError = true,
            requestId = "request-abort"
        )
        val reply = ChatMessage(true, "在的。现在是 15:16", requestId = "request-ok")
        val merged = mergeTranscriptWithLocalRunFailures(
            listOf(ChatMessage(false, "你好"), reply),
            listOf(ChatMessage(false, "你好"), reply, abort)
        )
        assertEquals(2, merged.size)
        assertEquals("在的。现在是 15:16", merged.last().text)
    }
}

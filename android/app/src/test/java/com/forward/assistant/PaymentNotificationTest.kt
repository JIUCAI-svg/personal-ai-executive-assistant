package com.forward.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentNotificationTest {

    @Test
    fun verificationCodesAreMasked() {
        val masked = maskVerificationCodes("【支付宝】验证码 482913，请勿泄露")
        assertFalse(masked.contains("482913"))
        assertTrue(masked.contains("••••••"))
        assertTrue(masked.contains("验证码"))
    }

    @Test
    fun wechatPaymentIsParsedAsExpense() {
        val payment = parsePayment("微信支付", "已支付¥25.00")
        assertNotNull(payment)
        assertEquals(25.00, payment!!.amount, 0.001)
        assertEquals("expense", payment.direction)
    }

    @Test
    fun alipayIncomeIsParsed() {
        val payment = parsePayment("支付宝", "收款到账 1,234.56元")
        assertNotNull(payment)
        assertEquals(1234.56, payment!!.amount, 0.001)
        assertEquals("income", payment.direction)
    }

    @Test
    fun refundIsClassifiedAsIncome() {
        val payment = parsePayment("京东", "退款成功 59.90元已原路退回")
        assertNotNull(payment)
        assertEquals("income", payment!!.direction)
    }

    @Test
    fun ordinaryChatMessageIsNotAPayment() {
        assertNull(parsePayment("妈妈", "今晚回家吃饭吗"))
    }

    @Test
    fun merchantIsExtractedWhenPresent() {
        val payment = parsePayment("微信支付", "向 瑞幸咖啡 支付25.00元")
        assertNotNull(payment)
        assertEquals("瑞幸咖啡", payment!!.merchant)
    }

    @Test
    fun zeroAmountIsIgnored() {
        assertNull(parsePayment("微信支付", "已支付¥0.00"))
    }
}

# 向前 Android App

这是 `向前` 的原生 Android MVP，使用 Kotlin 与 Jetpack Compose 构建。

## 当前能力

- 今日动态计划与当前任务。
- 对话输入：完成、外出、疲惫触发计划重排。
- 原生 Android 通知权限与测试提醒。
- 记忆与知识库同步状态入口。

## 构建

本机开发环境已将 Android SDK 放在项目根目录的 `.tooling/android-sdk`。

```powershell
cd E:\ACE\personal-ai-executive-assistant\android
..\.tooling\gradle\gradle-8.13\bin\gradle.bat assembleDebug
```

产物位置：`app\build\outputs\apk\debug\app-debug.apk`。

默认 AI 网关地址为云端公网 IP：
`http://YOUR-SERVER-IP/forward-assistant/api/assistant/respond`

如需本地覆盖地址或令牌，在被 Git 忽略的 `local.properties` 中配置
`aiGatewayUrl` 和 `aiGatewayToken`。

## 数据边界

当前版本是离线原生 MVP。电脑上的 Obsidian 桥接仍在 Web 端运行；后续接入 Supabase 后，Android 会读取云端同步的任务、计划、对话和知识库索引。

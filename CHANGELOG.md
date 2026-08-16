# Changelog

本项目的版本更新与用户可见修改记录在此文件中。

## [0.0.2] - 2026-08-16

### 修复

- 修复 macOS 主窗口关闭后，从 Dock 再次激活应用却无法恢复窗口的问题。
- 补回 macOS 原生“编辑”菜单，使输入框支持 `Cmd+V` 粘贴，以及撤销、剪切、复制和全选等标准操作。
- 修复“测试连接”错误调用 Harness 未注册的 `llm.discoverModels` 接口而显示失败的问题。
- “测试连接”现在直接验证模型服务的 `/models` 端点与 API Key，不产生对话 Token 费用。
- 为超时、无效凭证、错误端点、限流和异常响应提供明确的中文提示。

### 验证

- TypeScript 主进程与渲染进程类型检查通过。
- 7 个测试文件、18 项单元测试全部通过。
- Harness 协议与自动恢复冒烟测试通过。
- Apple Silicon 本地应用重新打包并验证可启动、可恢复窗口。

### 发布说明

- 本版本发布源码与版本说明。
- 完善 GitHub 源码安装、环境检查、首次配置、验证、打包和常见问题说明。
- 明确要求 macOS 14+、Apple Silicon、原生 arm64 Node.js 24+，并在打包配置中声明最低系统版本。
- 修复干净 `npm ci` 后缺少 Electron runtime、导致开发启动和打包失败的问题。
- 未附带未经 Developer ID 签名和 Apple 公证的 macOS 安装包。

## [0.0.1] - 2026-08-16

### 首次发布

- 提供 DSH Desktop 的 Apple Silicon MVP 源码。
- 集成本地 DeepSeek Harness sidecar、项目管理、任务会话、审批、收件箱、设置与诊断功能。

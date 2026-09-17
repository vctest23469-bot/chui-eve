# 开发与验证

## 结构

| 目录/模块                                                 | 职责                                             |
| --------------------------------------------------------- | ------------------------------------------------ |
| `src/main.cjs` / `preload.cjs`                            | 窗口生命周期、权限和受限 IPC                     |
| `engine.cjs` / `audio.cjs` / `media.cjs`                  | 录音保存、队列、解码、分段与 Range 回听          |
| `models.cjs` / `*-worker.*` / `speech-gate.cjs`           | 本地 ASR 模型、独立推理与 VAD                    |
| `model-api.cjs`                                           | API 地址校验、加密配置、请求取消/超时与响应边界  |
| `insights.cjs` / `meeting-template.cjs`                   | 长文本摘要、合并、行动项依据验证与缓存           |
| `renderer.js` / `insights-ui.js` / `model-settings-ui.js` | 工作台、导图、摘要设置                           |
| `tests/`                                                  | 文件恢复、任务隔离、音频协议、API 安全与失败路径 |
| `scripts/`                                                | 模型安装、必要运行时准备、打包及隔离 UI 验证     |

## 本地启动

```sh
npm ci
node scripts/prepare-runtime.cjs
zsh scripts/setup-mlx.sh 4bit
npm start
```

`runtime` 不进 Git。本地转写使用独立 Node 22.23.2 或 Python 环境；sherpa 的原生外部缓冲区与 Electron 的 V8 沙箱不兼容，不能以 Electron 的 Node 模式替代该运行时。可选 Fun-ASR worker 保留为实验引擎，通用 Release 不包含其原生二进制或模型，不宣称已经过同等效果验收。

## 验证

```sh
npm test
npm run test:ui
node scripts/insights-ui-check.cjs
node scripts/theme-check.cjs

# 需要自行提供有语音的公开/合成 WAV 样本
CHUI_TEST_AUDIO=/path/to/sample.wav node scripts/ui-check.cjs
CHUI_TEST_AUDIO=/path/to/sample.wav node scripts/live-check.cjs
```

UI 检查使用独立临时数据目录，不修改用户会议。`test:ui` 的 API 为本机 HTTP 模拟服务，用于验证协议、错误与完整产物链路；不能证明某个真实供应商模型的效果、额度或稳定性。截图均为合成演示数据。真实麦克风、会议软件的系统音频和目标机器安装需另做端到端验证。

## 打包

```sh
npm run package
```

打包按白名单只纳入生产源码、FFmpeg、sherpa/VAD 运行时和必要许可证；排除模型、Python 环境、测试、脚本、Git 元数据及历史测试产物。原生二进制删除上游构建机的无效绝对 rpath 和调试符号，等长归一化仅用于诊断的构建路径，然后重新签名；需对最终压缩包解压后的应用做实际回归。

FFmpeg 来自未修改的官方 8.0.1 源码，以音频专用 LGPL 配置构建，无 GPL/nonfree 外部编解码器和网络协议。对应源码压缩包与构建方式随 Release 提供。

发布前必须检查暂存区、待推送历史、提交身份、文案、图片与安装包元数据；检查规则与原始隐私样本不放进发布仓库。发布后的远端提交与下载产物需回读核对。发布脚本不会自动强制推送或覆盖旧历史。

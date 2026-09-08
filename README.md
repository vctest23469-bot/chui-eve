# Chui Eve

面向 Apple Silicon Mac 的本地会议录制与音频转写应用。独立实现，以 EVE 的 macOS 原生视觉语言为参考，不依赖或修改 EVE 应用源码。

## 使用

安装后打开 `/Applications/Chui Eve.app`。

- **会议**：选择麦克风、填写名称，点击「开始会议」。选择「同时录制电脑声音」可采集线上会议；首次需要在 macOS 授予麦克风、屏幕及系统音频录制权限。
- **文件**：选择「导入音频 / 视频」或拖入文件，支持多选。FFmpeg 将 MP3、M4A、WAV、FLAC、MP4 等统一解码为 16 kHz 单声道。
- **整理**：搜索记录、修改标题、点击正文编辑，离开编辑区自动保存。点击时间戳回听。
- **导出**：TXT、Markdown、SRT、JSON。SRT 使用分段边界，不是逐字对齐。
- **恢复**：中断任务保留音频，重新转写会重建当前结果。移入应用废纸篓只移动文件，未永久删除。
- 关闭窗口会收起到菜单栏，录音继续；退出应用会保存录音尾段。睡眠/设备断开仍可能中断输入。

## 本地数据与模型

记录存放在 `~/Library/Application Support/Chui Eve/library/records/<UUID>/`，包含 `audio.wav` 和原子替换写入的 `record.json`。不连接外部转写 API。

原有模型：`~/Library/Application Support/Eve Recorder/models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25`。

可选 MLX 模型：`~/Library/Application Support/Chui Eve/models/Qwen3-ASR-1.7B-4bit`，Python 环境：`~/Library/Application Support/Chui Eve/mlx-env`。设置内可切换。模型加载只使用本地路径，不在使用中自动下载。

## 开发与安装

```sh
npm ci
npm start
npm test
npm run package
node scripts/install.cjs
```

打包前需准备 `runtime/node`、`runtime/ffmpeg`、`runtime/sherpa-runtime/`。当前本机安装使用既有 EVE 中的独立 sherpa-onnx 1.12.34 运行时与 FFmpeg，Node 22.14.0；这些文件独立复制进 Chui Eve 包，原 EVE 不变。模型缓存独立于应用包。

`scripts/package.cjs` 输出 `dist/Chui Eve-darwin-arm64/Chui Eve.app`；`install.cjs` 将旧版 Chui Eve 备份，再复制并进行本机 ad-hoc 签名。本包未做 Apple 公证，不是对外发行版。

## 实现要点

- Electron 主进程负责文件异步 I/O、队列与窗口；模型在独立 Node / Python 进程中常驻。
- 长文件最多 15 秒一段，优先在尾部低能量位置切分，避免一次读入整场会议。
- 实时录音由 AudioWorklet 处理；停顿约 0.65 秒或满 12 秒分段。会议任务优先于未开始的文件分段，推理限时 90 秒。
- 推理故障不会停止已开始的录音保存；失败、无有效语音、已完成分开显示。
- 本机音频协议支持 HTTP Range，播放器可以读取准确时长、拖动回听，不把整个大文件塞入渲染器。
- IPC 只暴露明确的应用操作，渲染器启用隔离、沙箱与 CSP；不加载远程页面。

## 验证

- `npm test`：任务隔离、尾段保存、恢复、无效音频、失败保护、字幕格式、Range 播放、分段连续性与实时优先调度。
- `node scripts/bench.cjs sherpa` / `node scripts/bench.cjs mlx`：相同样本的模型对照。
- `node scripts/ui-check.cjs`：真实 Electron 窗口，验证导入、编辑持久化、回听、深浅色和 375px 布局。
- `node scripts/live-check.cjs`：通过已知语音 MediaStream 验证 AudioWorklet、录音保存和真实 ASR；不等同于真实会议室或会议软件验收。
- `node scripts/stress.cjs`：5 分钟音频持续转写，记录事件循环延迟与主进程内存。

截图和执行数据位于 `artifacts/`（不入版本库）。

## 当前边界

实时为分段返回，并非逐字流式字幕；暂不自动分离说话人、不生成 AI 纪要。录制系统声音仍依赖 macOS 权限与会议软件的实际输出设备，需在你的会议软件内完成一次端到端使用验证。单声道混音不能可靠拆分重叠发言。

## 上游与许可

产品研究参考 [EVE](https://github.com/nexmoe/eve)、[Meetily](https://github.com/Zackriya-Solutions/meetily)、[Buzz](https://github.com/chidiwilliams/buzz)、[Vibe](https://github.com/thewh1teagle/vibe)。按用户要求，本地定制版使用已安装 EVE 的原始应用图标，并参照其 popover 玻璃材质与主题色；应用功能独立实现。图标来源：`/Applications/Eve Recorder.app/Contents/Resources/icon.icns`。

运行时依赖 Electron（MIT）、Node.js（MIT 及其附属许可）、sherpa-onnx（Apache-2.0）、ONNX Runtime（MIT）、FFmpeg（当前既有二进制含 nonfree，仅供本机使用，不可对外再分发）。运行时许可在 `runtime/licenses/`；模型许可按各模型卡，Qwen3-ASR 模型为 Apache-2.0。MLX 实现来自 [mlx-audio](https://github.com/Blaizzy/mlx-audio)。

## 本机模型选型结果（2026-09-07）

默认保留 Qwen3-ASR 0.6B ONNX INT8；Qwen3-ASR 1.7B MLX 4-bit 已安装，可在设置内切换。1.7B 权重通过上游 SHA-256 校验。

| 样本 | 0.6B 字符错误率 | 1.7B 字符错误率 |
|---|---:|---:|
| 中文快语速 | 10.0% | 11.54% |
| 中文绕口令 | 15.0% | 5.71% |
| 英法意西混合语种 | 38.0% | 54.0% |

参照随模型提供的测试音频及文本，忽略标点与大小写；仅三条样本，不能外推真实会议准确率。1.7B 在复杂中文上有收益，但没有全面改善，故不强制替换默认引擎。MLX 推理峰值内存约 2.4 GiB，三段音频均快于实时；首段包含 GPU 冷启动开销。

0.6B 处理 5 分钟音频耗时约 72 秒，调度进程峰值 RSS 57 MB、最大事件循环延迟 43 ms（不含独立模型进程内存）。已验证 14.55 秒实时语音输入及尾段保存；真实会议室噪声、线上会议软件与系统音频权限仍需在实际使用环境验证。


## 摘要与思维导图

在记录右上角点击「提炼摘要」或「思维导图」。首次调用 GPT-5.5 同时生成摘要、主题要点与明确行动项，之后可在正文、摘要和导图间切换。导图支持主题收起、展开与缩放；结果随记录自动保存，可复制或导出 Markdown 大纲。修改原文后显示过期提示，点击「重新提炼」更新。

转写音频仍在本地；**摘要会将转写文字发送至 GPT-5.5**，使用本机 Codex 的 ChatGPT 登录及额度。通过 `codex exec -m gpt-5.5 --output-schema` 调用，独立临时工作目录、只读沙箱、关闭工具与用户配置，不保存 CLI 会话。优先探测 ChatGPT/Codex 应用内的 CLI；自定义路径使用 `CHUI_CODEX_PATH`。登录过期、额度不足、网络失败会显示失败状态，不以空结果冒充成功。一次只运行一个摘要任务，可取消；关闭应用中断后可重新提炼。

长文本按 24,000 字符分组并递归合并，不截断长录音。结果是 AI 提炼，需结合原文核对。验收：`npm test`；`node scripts/insights-ui-check.cjs`（隔离测试库，不修改用户录音）。

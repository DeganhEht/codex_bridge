# Codex Bridge

<p align="center"><b>简体中文</b> | <a href="README.en.md">English</a> | <a href="README.ja.md">日本語</a></p>

在 Codex 桌面应用里，让 GPT 和 DeepSeek 接着同一个任务轮流干活：一个任务固定保留
`[GPT]` 和 `[DeepSeek]` 两个端点，只同步新增内容，不重复建任务。

> 目前只支持 Windows 10/11。本页是快速上手；第一次用命令行的人请照着
> [手把手安装](docs/install.md) 做，或者直接用下面的「让 Codex 帮你装」。

## 来源与致谢

本项目基于 [kaidongli30-cpu/Codex-Deepseek-Handoff](https://github.com/kaidongli30-cpu/Codex-Deepseek-Handoff)
（MIT License，Copyright (c) 2026 kaidongli30-cpu）深度改造：上游提供了「把 GPT 任务
交给 DeepSeek 继续」的基础与安装流程，本仓库把交接改成**固定双端点增量同步**，
并补齐桌面端可用性与排障细节，改动清单见 [CHANGELOG.md](CHANGELOG.md)。上游版权与
许可声明原样保留在 [LICENSE](LICENSE)。

第三方资源：DeepSeek 官方模型目录与官方 Codex 接入脚本由你本机自行安装，本仓库
**不再分发**这些官方文件，也不分发 DeepSeek 品牌图标；安装器只复用你本机已经完成
的官方接入结果。这些内容的所有权归 DeepSeek 官方所有。

本项目的实现建立在两个官方组件之上：**Codex 桌面版**（通过它自带的 `app-server` 执行
任务）与 **DeepSeek 官方 API**。本项目是第三方工具，与 OpenAI、DeepSeek 官方没有隶属
或背书关系，这两个名称归各自权利人所有。

维护者：本仓库的改造与维护由 `DeganhEht` 完成。

## 这个项目解决什么问题

DeepSeek 官方已经提供了接入 Codex 的方式，但切换配置后经常出现：

- GPT 模式里能看到的任务，切到 DeepSeek 模式就看不到了；
- DeepSeek 的新回复，切回 GPT 后接不上；
- DeepSeek 的推理记录或联网搜索记录，会让 GPT 报格式错误。

本项目在中间加了一层本地「任务交接」：你点桌面快捷方式并勾选任务的那一刻，
它把新增内容同步到另一侧，再以对应模式打开 Codex。

```text
GPT 里干活 → 完全关闭 Codex → 双击「交接给deepseek」→ 勾选任务 → 在 DeepSeek 里继续
DeepSeek 里干活 → 完全关闭 Codex → 双击「交接给GPT」→ 勾选任务 → 回到 GPT 继续
```

## 使用前必须知道的三件事

1. **本项目不是 Codex，也不提供 DeepSeek API key。** 你需要先安装 Codex，并拥有
   自己的 DeepSeek 官方 API key。
2. **切换前必须完全关闭 Codex。** 不要让 GPT 模式和 DeepSeek 模式同时运行。
3. **交接过程中只点击一次快捷方式。** 记录较多时需要等待，工具完成后才会显示窗口。

## 让 Codex 帮你装（推荐）

不用手敲命令：把下面整段复制给 Codex 桌面版（或任何能操作你电脑的 Codex 会话），
它会自己读仓库、按步骤装好，并在需要你动手时停下来问你。

````text
请帮我在本机安装 Codex Bridge：https://github.com/DeganhEht/codex_bridge

要求：
1. 先读仓库里的 README.md 和 docs/install.md，再动手，不要凭记忆猜步骤。
2. 按顺序执行，每一步开始前用一句话说明你要做什么。
3. 遇到必须由我操作的步骤（安装 PowerShell 7 / Node.js、运行 DeepSeek 官方脚本并填
   API key、完全关闭 Codex）先停下来等我确认。
4. 安装脚本先用 -WhatIf 预览，确认没有报错再正式执行，不要跳过预览。
5. 装完确认桌面出现「交接给deepseek」和「交接给GPT」两个快捷方式，并用一个测试任务
   验证：GPT 说一句话 → 交接 → DeepSeek 能看到并回复 → 再交接回 GPT。
6. 任何一步失败就把完整报错原文贴给我，不要自动跳过或临时改成别的做法。

先告诉我你打算怎么做，等我回复“开始”再执行。
````

以后要更新到最新版本，可以这样让 Codex 做（不会动你的 `config.toml`）：

````text
请把 https://github.com/DeganhEht/codex_bridge 更新到最新版本：在项目目录执行 git pull，
然后运行 work/thread-localizer/launcher/install.ps1 -SourceRoot <项目目录>
-SkipConfiguration -SkipShortcuts。不要修改 config.toml，也不要重建桌面快捷方式。
````

交接失败或报错时，把日志交给 Codex 读：

````text
我刚才用 Codex Bridge 交接任务失败了。请读
%USERPROFILE%\.codex\model-switcher\handoff-logs\ 和
%USERPROFILE%\.codex\model-switcher\thread-localizer\reports\ 下最新的日志与报告，
告诉我失败原因和最小修复步骤，先不要修改任何文件。
````

日常交接不需要提示词：用下面两个快捷方式就行。

## 手动安装（快速版）

前置：Windows 10/11、[PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows)、
[Node.js 22.13+](https://nodejs.org/en/download)、已能登录的 Codex 桌面版、自己的
DeepSeek 官方 API key。

1. 先完成 **DeepSeek 官方接入**（本项目不分发官方文件，必须由官方脚本完成）：

   ```powershell
   $officialSetup = Join-Path $env:TEMP 'codex-deepseek-setup-en.ps1'
   Invoke-WebRequest -Uri 'https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.ps1' -OutFile $officialSetup
   notepad $officialSetup
   pwsh -NoProfile -ExecutionPolicy Bypass -File $officialSetup
   ```

   确认 DeepSeek 官方方式能正常回复一条测试消息，然后完全关闭 Codex。

2. 取得本项目并在项目根目录打开 PowerShell 7：

   ```powershell
   git clone https://github.com/DeganhEht/codex_bridge.git
   cd codex_bridge
   pwsh
   ```

   也可以直接在仓库页面点 `Code` → `Download ZIP`，解压后在那个目录的地址栏输入
   `pwsh` 打开。

3. 先预览、再安装：

   ```powershell
   pwsh -NoProfile -ExecutionPolicy Bypass -File ".\work\thread-localizer\launcher\install.ps1" -SourceRoot "$PWD" -WhatIf
   pwsh -NoProfile -ExecutionPolicy Bypass -File ".\work\thread-localizer\launcher\install.ps1" -SourceRoot "$PWD"
   ```

4. 桌面出现 `交接给deepseek` 和 `交接给GPT` 就算装好了。第一次建议拿一个不重要的
   测试任务走一遍完整来回；逐条步骤见 [手把手安装](docs/install.md)。

## 日常使用

两个快捷方式代表“目标模式”，都支持**只打开、不交接**：

| 当前模式 | 点击 | 结果 |
| --- | --- | --- |
| GPT | `交接给deepseek` | 列出 GPT 侧任务，勾选后交接并打开 Codex（DeepSeek 模式） |
| DeepSeek | `交接给deepseek` | 选「仅打开 Codex（继续当前模式）」，启动适配器并打开上次任务 |
| DeepSeek | `交接给GPT` | 列出全部 DeepSeek 侧任务（含 DeepSeek 模式里新产生的对话），勾选后同步并打开 Codex（GPT 模式） |
| GPT | `交接给GPT` | 同上，用于把遗留的 DeepSeek 侧对话带回 GPT；也可只打开 Codex |

- 一次勾选多个任务时，每个任务都会**逐个打开一次**，这样它们都会出现在侧栏；
  最后前台停在真正新交接的那条上。处理 2 个及以上任务会弹出汇总提示（含
  `codex://threads/...` 链接），同样内容写入
  `%USERPROFILE%\.codex\model-switcher\handoff-logs\last-handoff.json`。
- **不要**在刚用完 DeepSeek 后直接点任务栏里的官方 Codex 图标：那会绕过交接，
  刚产生的 DeepSeek 内容可能还没同步到 GPT 侧。
- **关机随时安全：**关闭 DeepSeek 模式的 Codex 不会改配置、不会自动回程、不会重开
  窗口，只停掉本机适配器。再次打开时点对应快捷方式选「仅打开 Codex」即可恢复上次
  任务；想切到另一个模式再勾选任务，增量会补齐。
- **直接点 Codex 图标也能用：**安装器会注册一个名为 `CodexDeepSeekAdapterGuard` 的
  计划任务（登录时 + 每分钟一次）。它只在「配置是 DeepSeek 模式 + Codex 正在运行 +
  适配器没在监听」时才把适配器拉起来，所以不走快捷方式也不会再遇到"没人应答"。
  它不改 `config.toml`、不建/删快捷方式、不结束任何进程，也不会和两个桌面入口抢；
  延迟最多约 1 分钟，想要立刻恢复仍然点 `交接给deepseek` → 「仅打开 Codex」最快。

### 任务名标记与选择顺序

交接完成后，同一件事的两个任务会分别改名成 `[GPT] 原名` 与 `[DeepSeek] 原名`：

- 前缀只加一次，重复交接不会叠加；你自己改过的名字会被保留，只重加前缀；
- 标记失败不会中断交接，只记进报告，下次交接补齐；
- 选择器默认按“最近更新”倒序，点击「时间 / Provider·模型 / 任务 / 工作目录」表头
  可切换升降序，搜索、多选、全选照旧可用。

## 常见问题

### 1. 安装器提示找不到 `models-deepseek.json`

说明 DeepSeek 官方接入还没完成，或官方模型目录不在预期位置。重新运行官方脚本，
确认 DeepSeek 能独立打开 Codex 并正常回复，完全关闭 Codex 后再运行本项目安装器。
不要自己创建空的 `models-deepseek.json`。

### 2. 点击快捷方式后很久没有窗口

先不要连续点击，等待交接完成。如果出现错误弹窗，记下弹窗完整文字、报告路径，以及
当时是从 GPT 切到 DeepSeek 还是反向。详细排查见 [故障排查](docs/troubleshooting.md)。

### 3. 交接过的任务在侧栏里看不到

桌面端侧栏会跳过 `preview` 为空的任务，而交接生成的端点没有跑过回合。当前版本会在
交接时自动把源任务的第一条用户消息补写到目标端点，**再点一次对应快捷方式并勾选该
任务**即可补齐；写入前会备份 `state_5.sqlite`，失败自动回滚。

### 4. DeepSeek 里发消息报 `missing field call_id`

旧版本把 GPT 历史里一条缺少 `call_id` 的工具结果项原样注入 DeepSeek 任务，接口会
拒绝整次请求。当前版本在交接时不再写入这类条目，DeepSeek 模式的请求也会经过本机
适配器把它剔除（本地聊天记录不动），剔除记录写在
`%USERPROFILE%\.codex\model-switcher\handoff-logs\adapter-compat-<时间戳>.txt`。

### 5. DeepSeek 模式一直提示网络连接中断

先分清是「没人应答」还是「出网受阻」——两者的表现一样：

- **没人应答（最常见）**：DeepSeek 模式的请求全部发给本机适配器
  `127.0.0.1:10101`，它没在跑时每个请求都会在本地被拒绝。用
  `交接给deepseek` → 「仅打开 Codex」会确保它启动；健康检查能看到
  `"pid"` 和 `"lifetime"`（其中 `codexRunning` 说明它是否认到 Codex）。
  现在的适配器**不会因为启动器窗口被关掉而退出**：只有 Codex 退出超过 30 秒才会
  自我清理；交接失败回滚到 DeepSeek 时，启动器也会把适配器重新拉起来。
- **出网受阻**：适配器会自动读取 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`，
  直连 443 被阻断而本机代理正常时（例如 `http://127.0.0.1:7892`）会走代理，
  没有代理仍保持直连。健康检查里的 `proxyConfigured` / `proxyRequests` 可以确认；
  代理错误同样记进 `adapter-compat-<时间戳>.txt`。

仍然建议：进 DeepSeek 模式一律走 `交接给deepseek`，因为它负责启动这个适配器。

更多问题（格式错误、联网搜索记录冲突、图片能力、旧任务重名、协议缓存等）见
[故障排查文档](docs/troubleshooting.md)。

## 如何卸载

先完全关闭 Codex，然后在 PowerShell 7 中先预览再执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1" -WhatIf
pwsh -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1"
```

默认卸载只移除本项目安装的受管配置、两个快捷方式和程序文件；DeepSeek 官方模型目录、
已加密保存的 API key、交接 manifest 与报告都会保留。

## 默认设置

- DeepSeek 默认思考强度 `max`，默认联网搜索 `live`；
- OpenAI/GPT 尽量保留任务原来使用的模型；
- 交接器会记住每个任务最后使用的 DeepSeek 模型与思考强度，切回 GPT 再切回来时优先
  恢复；只有从未用过 DeepSeek 的任务才用默认值；
- 普通用户不需要手动改 `config.toml`。

## 隐私与安全边界

本项目只在你本机调用 Codex 自带的 `app-server`：不运营中转服务器、不上传聊天记录、
不把 API key 写进仓库、不直接修改 `state_5.sqlite` / 源 rollout；写入前先生成
dry-run 报告，发现当前 Codex 协议不兼容时停止而不是猜测字段。详细说明见
[安全边界文档](docs/safety.md)。

## 给开发者

```powershell
npm test
pwsh -NoProfile -File ".\scripts\check-powershell.ps1"
pwsh -NoProfile -File ".\scripts\test-picker-sorting.ps1"
pwsh -NoProfile -File ".\scripts\test-sidebar-sync.ps1"
pwsh -NoProfile -File ".\scripts\test-handoff-result-contract.ps1"

npm run schema-check          # 只检查/缓存 app-server 协议，不跑模型回合
npm run dry-run:deepseek      # 只生成报告
npm run dry-run:openai
```

默认模型设置位于 [work/thread-localizer/data/handoff-settings.json](work/thread-localizer/data/handoff-settings.json)。
DeepSeek 的模型 slug 必须存在于本机官方 `models-deepseek.json` 中；部分 Desktop 会过滤
第三方模型名，启动器因此只在 DeepSeek 模式启动一个绑定 `127.0.0.1` 的模型名适配器
（把兼容名换回官方 slug，并剔除缺 `call_id` 的无主工具结果项），GPT 请求不经过它。

进一步阅读：[架构说明](docs/architecture.md)、[兼容性矩阵](docs/compatibility.md)、
[故障排查](docs/troubleshooting.md)、[安全边界](docs/safety.md)、
[命令行与协议细节](work/thread-localizer/README.md)、[发布流程](docs/publishing.md)。

## 开源许可

本项目采用 [MIT License](LICENSE)。DeepSeek 官方模型目录和品牌图标不随本仓库重新
分发。请不要把个人图标、API key、Codex 数据库、任务报告或聊天记录提交到公开仓库。

# Codex-DeepSeek-Handoff

<p align="center"><b>简体中文</b> | <a href="README.en.md">English</a> | <a href="README.ja.md">日本語</a></p>

在 Codex 桌面应用中，让 GPT 和 DeepSeek 接着同一个任务继续聊。

> 这是一个目前只支持 Windows 的本地任务交接工具。第一次使用命令行也没关系，
> 下面会从“怎么下载项目”开始，一步一步说明。

## 来源与致谢

本项目基于 [kaidongli30-cpu/Codex-Deepseek-Handoff](https://github.com/kaidongli30-cpu/Codex-Deepseek-Handoff)
（MIT License，Copyright (c) 2026 kaidongli30-cpu）深度改造而来：上游提供了
「把 GPT 任务交给 DeepSeek 继续」的基础与安装流程，本仓库在其之上把交接改成
**固定双端点增量同步**，并补齐了桌面端可用性与排障细节。

相对上游的主要改动（详见 [CHANGELOG.md](CHANGELOG.md)）：

- 固定双端点：每个逻辑任务保留一个 GPT 端点与一个 DeepSeek 端点，只同步新增内容，
  不再反复创建新任务。
- 桌面启动器：一次交接多个任务、按时间排序的多选界面、`仅打开 Codex`、
  交接后逐个打开目标任务，并记录 `last-handoff.json` / `last-opened.json`。
- 端点标记：自动加 `[GPT]` / `[DeepSeek]` 前缀，同时保留你手动改过的名字。
- 兼容性：模型名适配器支持 `HTTPS_PROXY` / `HTTP_PROXY`，并清洗 DeepSeek 无法接受的
  无主工具结果项（缺 `call_id`）。
- 侧栏可见性：补齐桌面端侧栏登记与 `preview`，让交接生成的任务能直接出现在侧栏。
- 关机安全：关闭 DeepSeek 模式的 Codex 后不再自动改配置或自动回程；同步只发生在
  你点击快捷方式并选择任务时。

第三方资源说明：DeepSeek 的官方模型目录与官方 Codex 接入脚本由用户本机自行安装，
本仓库**不再分发**这些官方文件，也不分发 DeepSeek 品牌图标；安装器只复用你本机已经
完成的官方接入结果。这些内容的所有权归 DeepSeek 官方所有。

维护者：本仓库的改造与维护由 `DeganhEht` 完成；原始项目与设计思路来自
上表中的上游仓库，特此致谢。

## 这个项目解决什么问题？

DeepSeek 官方已经提供了接入 Codex 的方式，但切换配置后，经常会出现这样的情况：

- GPT 模式里原来能看到的任务，在 DeepSeek 模式里看不到；
- DeepSeek 新回复的内容，切回 GPT 后不能接着使用；
- DeepSeek 产生的推理记录或联网搜索记录，可能让 GPT 报格式错误。

本项目在 GPT 和 DeepSeek 之间增加了一层本地“任务交接”。每个逻辑任务会保留一个 GPT 端点和一个 DeepSeek 端点，后续只同步新增内容，不会每次都复制出新任务。直观过程如下：

```text
在 GPT 中工作
    ↓
完全关闭 Codex
    ↓
点击桌面的“交接给deepseek”
    ↓
工具第一次建立 DeepSeek 配对任务，再打开 DeepSeek 模式的 Codex
    ↓
在 DeepSeek 中继续原任务
    ↓
完全关闭 Codex
    ↓
点击桌面的“交接给GPT”
    ↓
工具把 DeepSeek 新增内容同步回原 GPT 配对任务，再打开 GPT 模式的 Codex
```

两边看到的是同一个工作过程的接力版本。DeepSeek 的回复可以交回 GPT，GPT 的
新回复也可以继续交给 DeepSeek。

## 使用前必须知道的三件事

1. **本项目不是 Codex，也不提供 DeepSeek API key。** 你需要先安装 Codex，
   并拥有自己的 DeepSeek 官方 API key。
2. **切换前必须完全关闭 Codex。** 不要让 GPT 模式和 DeepSeek 模式同时运行。
3. **交接过程中只点击一次快捷方式。** 聊天记录较多时可能需要等待；工具完成
   交接后才会显示 Codex 窗口。

## 安装前准备

### 第 1 项：确认你使用的是 Windows

目前支持：

- Windows 10
- Windows 11

macOS 和 Linux 目前没有经过本项目验证。

### 第 2 项：确认 Codex 可以正常打开

先用你平时的方式打开 Codex，确认能够登录 ChatGPT/OpenAI，并能进入一个现有
任务。确认后完全关闭 Codex。

如果你还没有安装 Codex，请先从 [OpenAI 官方入口](https://developers.openai.com/)
完成安装和登录，再回来继续。

### 第 3 项：安装 PowerShell 7

PowerShell 是下面用来复制和运行安装命令的窗口。Windows 自带的旧版叫
“Windows PowerShell”，本项目推荐使用 **PowerShell 7**。

打开 Windows 开始菜单，搜索并打开 `PowerShell 7`。在窗口中复制下面这条命令，
然后按回车：

```powershell
$PSVersionTable.PSVersion
```

只要第一行显示的主版本号是 `7`，这一项就通过了。

如果找不到 PowerShell 7，可以按照微软官方说明安装：

- [微软：在 Windows 上安装 PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows)

Windows 11 用户也可以在终端中执行：

```powershell
winget install --id Microsoft.PowerShell --source winget
```

安装完成后关闭旧窗口，重新打开 `PowerShell 7`。

### 第 4 项：安装 Node.js

在 PowerShell 7 中执行：

```powershell
node --version
```

本项目要求 **Node.js 22.13.0 或更高版本**，推荐安装当前的 Node.js 24 LTS。
例如，显示 `v22.13.0`、更高的 `v22...` 或 `v24...` 都可以使用；
`v20...` 及更早版本不受支持。

如果版本过低或提示无法识别 `node`，请到 Node.js 官方网站下载当前的
**LTS（长期支持版）**：

- [Node.js 官方下载页面](https://nodejs.org/en/download)

安装时保持默认选项即可。安装完成后重新打开 PowerShell 7，再执行一次
`node --version`。

### 第 5 项：准备 DeepSeek API key

你需要拥有自己的 DeepSeek 官方 API key。不要把 API key 发给别人，也不要写进
本项目的文件或提交到 GitHub。DeepSeek 官方说明见：

- [DeepSeek API 官方文档](https://api-docs.deepseek.com/api/deepseek-api/)

如果你已经能通过 DeepSeek 官方方式打开 Codex，可以直接进入下一节。

## 下载本项目

### 方法 A：下载 ZIP（推荐新手使用）

1. 打开本仓库页面：<https://github.com/DeganhEht/codex_bridge>
2. 点击页面上方绿色的 `Code` 按钮。
3. 点击 `Download ZIP`。
4. 下载完成后，在资源管理器中找到这个 ZIP 文件。
5. 右键 ZIP 文件，选择“全部解压”。
6. 进入解压后的文件夹。

请继续进入文件夹，直到你能同时看到下面这些内容：

```text
README.md
package.json
work 文件夹
scripts 文件夹
```

看到这些文件，才说明你位于正确的“项目根目录”。

### 在正确的文件夹中打开 PowerShell 7

1. 保持上面的项目根目录窗口打开。
2. 点击资源管理器顶部的地址栏。
3. 删除地址栏中原来的文字。
4. 输入 `pwsh`。
5. 按回车。

系统会打开一个 PowerShell 7 窗口，而且它已经位于正确的项目文件夹中。

执行下面这条命令检查：

```powershell
Test-Path ".\work\thread-localizer\launcher\install.ps1"
```

如果输出：

```text
True
```

说明位置正确。如果输出 `False`，请关闭 PowerShell，回到资源管理器继续进入真正
包含 `README.md`、`package.json` 和 `work` 的那一层文件夹，再重新输入 `pwsh`。

## 第一次安装

### 第 1 步：先完成 DeepSeek 官方接入

本项目不会重新分发 DeepSeek 官方模型目录，因此必须先运行 DeepSeek 官方 Codex
配置脚本。

在刚才打开的 PowerShell 7 中，复制下面整段命令，然后按回车：

```powershell
$officialSetup = Join-Path $env:TEMP 'codex-deepseek-setup-en.ps1'
Invoke-WebRequest `
  -Uri 'https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.ps1' `
  -OutFile $officialSetup
notepad $officialSetup
```

记事本会打开刚下载的官方脚本。检查下载地址确实是
`cdn.deepseek.com`，看完后关闭记事本，再回到 PowerShell 7 执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File $officialSetup
```

按照官方脚本的提示配置 DeepSeek API key。

完成后：

1. 完全关闭 PowerShell 和 Codex。
2. 用 DeepSeek 官方脚本创建的方式打开一次 Codex。
3. 确认 DeepSeek 能正常回复一条测试消息。
4. 再次完全关闭 Codex。

如果 DeepSeek 本身还不能正常回复，请先不要安装本项目。只有官方基础接入已经
成功，本项目的任务交接层才能正常工作。

### 第 2 步：预览本项目将执行的安装操作

重新回到项目根目录，按照前面的方式在地址栏输入 `pwsh`，打开 PowerShell 7。

复制下面整段命令并按回车：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File ".\work\thread-localizer\launcher\install.ps1" `
  -SourceRoot "$PWD" `
  -WhatIf
```

这里的 `-WhatIf` 意思是“只预览，不真正修改”。窗口中会出现多行
`What if:`，最后还会看到：

```text
"whatIf": true
```

这一步不会迁移任务、不会启动 Codex，也不会发送任何模型请求。

如果这里直接出现红色错误，请先查看本文后面的“常见问题”，不要反复执行正式
安装命令。

### 第 3 步：正式安装

预览没有报错后，在同一个 PowerShell 7 窗口执行下面这段命令。它和上一步的
区别是没有 `-WhatIf`：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File ".\work\thread-localizer\launcher\install.ps1" `
  -SourceRoot "$PWD"
```

安装器会：

- 备份 Codex 的相关配置；
- 检查新配置能否被当前 Codex 读取；
- 安装任务交接工具；
- 在桌面创建两个快捷方式。

安装器不会直接修改 Codex 的任务数据库，不会删除原任务，也不会自动发送消息。

### 第 4 步：确认桌面快捷方式

安装成功后，桌面上应该出现：

```text
交接给deepseek
交接给GPT
```

它们的作用分别是：

| 快捷方式 | 什么时候点击 | 会做什么 |
| --- | --- | --- |
| `交接给deepseek` | 当前使用 GPT，下一次想用 DeepSeek | 先把 GPT 任务交给 DeepSeek，再打开 Codex |
| `交接给GPT` | 当前使用 DeepSeek，下一次想回到 GPT | 先清理并交接 DeepSeek 任务，再打开 Codex |

## 第一次进行任务交接

建议第一次使用一个不重要的测试任务完成验收。

### 从 GPT 切换到 DeepSeek

1. 先用正常的 GPT 登录方式打开 Codex。
2. 新建一个测试任务，发送一句容易辨认的话，例如：

   ```text
   这是 GPT 和 DeepSeek 交接测试。
   ```

3. 等 GPT 回复完成。
4. 完全关闭 Codex。
5. 等待几秒，确认 Codex 窗口已经全部消失。
6. 双击桌面的 `交接给deepseek`。
7. 在弹出的选择器里勾选刚才的测试任务，点“交接选中任务”。
8. **只点击一次，然后等待。**交接完成后，Codex 会自动以 DeepSeek 配置打开
   这个任务。
9. 确认能看到 GPT 的测试消息和回复。
10. 在同一个任务中让 DeepSeek 再回复一句。
11. 用完直接关闭 Codex 即可：工具不会自动改配置、不会自动回程，关机也安全。

### 从 DeepSeek 切回 GPT

1. 等 DeepSeek 回复完全结束。
2. 完全关闭 Codex。
3. 等待几秒。
4. 双击桌面的 `交接给GPT`。
5. 在选择器里勾选要带回 GPT 的任务（包括在 DeepSeek 里新产生的对话），
   点“交接选中任务”。
6. **只点击一次，然后等待。**工具会先处理 DeepSeek 与 GPT 不兼容的推理和
   联网搜索记录，再把 Codex 以 GPT 配置打开。
7. 确认能看到 DeepSeek 刚刚发送的内容。
8. 再给 GPT 发送一条消息，确认 GPT 能正常回复。

以上全部通过，就说明双向任务交接已经跑通。

## 日常应该怎么用？

两个快捷方式代表“目标模式”，都支持**只打开、不交接**：

- **`交接给deepseek`：**关闭 Codex 后点击。选择器会列出 GPT 侧任务，勾选后交接、
  写入 DeepSeek 配置、启动本机适配器并打开 Codex（DeepSeek 模式）；
  也可以直接点 **“仅打开 Codex（继续当前模式）”**，只启动适配器并打开上次那条
  任务。
- **`交接给GPT`：**关闭 Codex 后点击。选择器会列出所有 DeepSeek 侧任务
  （包括在 DeepSeek 模式里新产生的对话），勾选后同步并打开 Codex（GPT 模式）。

一次勾选多个任务时：本次选中的每个任务都会被**逐个打开一次**，这样它们都会
出现在 Codex 侧栏（按 `[GPT]` / `[DeepSeek]` 前缀可以找到），最后前台停在本轮
真正新交接的那条上。凡是本次处理了 2 个及以上任务，都会弹出一个汇总提示，
列出每个任务的名字和 `codex://threads/...` 链接；同样的内容也会写进
`%USERPROFILE%\.codex\model-switcher\handoff-logs\last-handoff.json`。

不要在刚用完 DeepSeek 后直接点击任务栏里的官方 Codex 图标。那样会绕过交接
步骤，刚产生的 DeepSeek 内容可能暂时没有出现在 GPT 任务中。

### 关机与重新打开

- **关闭 DeepSeek 模式的 Codex 不会触发任何自动动作：**工具只停掉本机适配器，
  保持 `config.toml` 现状后退出，不写配置、不重开窗口、不做同步。因此
  “关闭 Codex → 直接关机”随时安全。
- 同步只发生在你点快捷方式并勾选任务的那一刻，不存在“关机打断同步”的问题。
- 重新打开时，点对应快捷方式再选 **“仅打开 Codex（继续当前模式）”** 即可：
  它会优先用深链恢复上次打开的那条任务；没有记录时退回普通启动。
- 关闭 DeepSeek 模式的 Codex 之后，适配器已经退出：如果这时改用任务栏里的
  官方 Codex 图标，配置仍是 DeepSeek 但没有适配器，请求会失败。要用 DeepSeek
  就一律走 `交接给deepseek`。

### 任务名标记与选择顺序

交接完成后，同一件事的两个任务会分别改名为：

```text
[GPT] 原来的任务名
[DeepSeek] 原来的任务名
```

- 前缀只加一次，重复交接不会变成 `[GPT] [GPT] ...`。
- 如果你自己改过任务名，下次交接会保留你改的名字，只重新加前缀。
- 标记失败不会中断交接，只会在报告里记录，下次交接再补。
- 打开任务选择器时，默认按“最近更新”倒序排列（最新的在最上面）；点击
  「时间 / Provider·模型 / 任务 / 工作目录」表头可以切换排序方向，
  搜索框和复选框照旧可用。

## 为什么点击快捷方式后没有立刻出现 Codex？

这是正常设计，不代表快捷方式坏了。

工具必须先完成：

1. 查找需要交接的任务；
2. 检查是否已经交接过，防止重复任务；
3. 创建新的目标任务；
4. 转换不兼容的记录；
5. 完整验证交接结果；
6. 记录交接结果（配对模式保留两端任务，不删除原任务）；
7. 最后才打开 Codex。

任务越多，等待时间可能越长。交接期间再次点击快捷方式不会让它更快，也可能让
你误以为程序没有反应，所以请耐心等待第一次点击的结果。

如果选的是 **“仅打开 Codex（继续当前模式）”**，上面的交接步骤全部跳过，
只会多花 1–2 秒启动 DeepSeek 适配器（GPT 模式则更快）。

## 常见问题

### 1. 安装器提示找不到 `models-deepseek.json`

说明 DeepSeek 官方基础配置还没有成功完成，或者官方模型目录不在预期位置。

处理方法：

1. 重新运行本文“先完成 DeepSeek 官方接入”中的官方脚本。
2. 确认 DeepSeek 能独立打开 Codex 并正常回复。
3. 完全关闭 Codex。
4. 再运行本项目安装器。

不要自己创建一个空的 `models-deepseek.json`，空文件不能代替官方模型目录。

### 2. 点击快捷方式后很久没有窗口

先不要连续点击。等待任务交接完成。如果出现错误弹窗，请记录：

- 弹窗里的完整文字；
- 弹窗提供的报告路径；
- 当前是从 GPT 切换到 DeepSeek，还是从 DeepSeek 切回 GPT。

详细排查方法见 [故障排查文档](docs/troubleshooting.md)。

### 3. 任务出现在“最近”里，没有自动置顶

只要任务能够打开、消息完整并且可以继续回复，就说明交接成功。是否置顶属于
Codex 界面状态，不影响任务上下文。需要时可以手动置顶。

### 4. 出现两个相同名字的旧任务

新版本会给配对任务分别加上 `[GPT]` / `[DeepSeek]` 前缀。早期测试或失败交接
留下的旧任务可能没有标记，不要只根据名字判断；先打开并确认哪一个是最新、
可以继续回复的任务。不要直接修改 Codex 数据库或 rollout 文件。

### 5. GPT 报 `Invalid input[*].content ... maximum length 0`

这通常说明旧的 DeepSeek 推理记录没有完成兼容处理。当前版本会在
DeepSeek → GPT 交接时清理新目标中的不兼容 `content`。请保留错误报告，
不要手动修改任务数据库或 rollout。详见 [故障排查文档](docs/troubleshooting.md)。

### 6. 使用 DeepSeek 联网搜索后，切回 GPT 报错

DeepSeek 与 GPT 的联网搜索记录 ID 格式可能不同。本项目会在交回 GPT 时同步
调整检索调用和结果之间的关联 ID；发现冲突时会停止并报告，而不是删除记录。

### 7. DeepSeek 能回复，但看不懂图片

任务交接工具只负责保存和转换任务上下文，不会给模型增加视觉能力。能否看图取决于
你选择的 DeepSeek 模型及其接口能力。

### 8. 在 DeepSeek 里发消息报 `missing field call_id`

旧版本把 GPT 历史里一条缺少 `call_id` 的工具结果项原样注入 DeepSeek 任务，
DeepSeek 的接口会因此拒绝整次请求（`input: missing field call_id`）。

当前版本在两处处理它：交接时不再把这种条目写入 DeepSeek 任务；DeepSeek 模式的
请求会经过本机适配器，适配器只在发往 DeepSeek 的请求里剔除这类无主工具结果项，
本地聊天记录不动。剔除记录写在：

```text
%USERPROFILE%\.codex\model-switcher\handoff-logs\adapter-compat-<时间戳>.txt
```

如果更换 Codex 版本后仍出现类似报错，请保留该日志和报告路径再排查。

### 9. 某个任务报“没有可注入的 Responses 历史项”

这是旧版本的一个缺陷：上次同步之后，源任务里只多出了记账/结束类事件（例如一条
`task_complete`），没有可注入的正文项，旧版本会把整个任务判为失败。现在这种增量
会记为“无需交接”并推进同步位置；如果这些事件里仍然嵌着消息内容，则照常镜像到
目标任务。两种情况都会写进交接报告（`paired-delta-without-response-items` /
`paired-delta-projection-only`）。

### 10. 我已经在 DeepSeek 模式，只想打开 Codex

直接点 `交接给deepseek`，在选择器里选 **“仅打开 Codex（继续当前模式）”**。
工具不会写配置、不会做同步，只会启动适配器并打开上次那条任务。
GPT 模式下同理：点 `交接给GPT` 后选这个按钮。

### 11. 关机前需要先切回 GPT 吗

不需要。关闭 DeepSeek 模式的 Codex 之后，工具不会写配置、不会自动回程、
也不会重新打开窗口，直接关机是安全的。下次要用的时候，点 `交接给deepseek` 选
“仅打开 Codex”继续；之后想切回 GPT，点 `交接给GPT` 勾选任务即可，增量会
自动补齐。

### 12. DeepSeek 模式一直提示网络连接中断

适配器会自动读取 `HTTPS_PROXY` / `HTTP_PROXY` 和 `NO_PROXY`。如果电脑的直连
443 被阻断、但本机代理（例如 `http://127.0.0.1:7892`）正常运行，DeepSeek 请求
会通过代理发送；无代理环境仍保持直连。适配器健康检查会显示
`proxyConfigured` / `proxyRequests`，代理错误会记录在：

```text
%USERPROFILE%\.codex\model-switcher\handoff-logs\adapter-compat-<时间戳>.txt
```

### 13. 交接过的任务在侧栏里看不到

桌面端侧栏走的是只读数据库的快速列表，**`preview` 为空的任务会被跳过**，而交接
生成的端点因为没跑过回合，`preview` 一直是空的。当前版本会在交接时自动把源任务
的第一条用户消息文案补写到目标端点（`preview` / `first_user_message` / `title`），
整个过程在 Codex 关闭时进行：

- 只在目标端点的该列还是空的时候写入，不覆盖已有内容；
- 写入前把 `state_5.sqlite`（含 `-wal`/`-shm`）备份到
  `%USERPROFILE%\.codex\model-switcher\thread-localizer\reports\state-backups\`；
- 写入后用回读校验，校验失败会自动从备份恢复；
- 交接报告里会记录 `previewBackfill` 的结果。

因此如果之前有看不到的交接任务，**再点一次对应快捷方式并勾选该任务**即可补齐。

## 如何卸载？

卸载前先完全关闭 Codex。

打开 PowerShell 7，先执行预览命令：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1" `
  -WhatIf
```

确认预览没有异常后，正式卸载：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File "$env:USERPROFILE\.codex\model-switcher\uninstall.ps1"
```

默认卸载只移除本项目安装的受管配置、两个快捷方式和程序文件。以下内容会保留：

- DeepSeek 官方模型目录；
- 已加密保存的 API key；
- 任务交接 manifest；
- 交接报告和 manifest。

## 默认设置

- DeepSeek 默认思考强度：`max`
- DeepSeek 默认联网搜索：`live`
- OpenAI/GPT：尽量保留任务原来使用的 GPT 模型

如果以后更换 DeepSeek 模型，新模型必须先由官方目录声明，并且支持 Codex 所需的
Responses API。普通用户不需要手动修改 `config.toml`。

## 隐私与安全边界

本项目在你的电脑本地调用 Codex 自带的 `app-server`：

- 不运营聊天中转服务器；
- 不把聊天记录上传到本项目作者的服务器；
- 不把 API key 写入 Git；
- 不直接修改 `state_5.sqlite`、`session_index.jsonl` 或源 rollout；
- 写入前生成 dry-run 报告，旧任务会保留到新任务完成验收；
- 交接不再生成累计任务备份，成功后通过官方协议删除上一棒旧任务；
- 发现当前 Codex 协议不兼容时停止，而不是猜测字段继续操作；
- 使用交接 manifest 防止同一个任务被重复复制；
- 使用每用户锁防止重复点击造成多个交接程序同时运行。

详细说明见 [安全边界文档](docs/safety.md)。

## 给开发者的内容

如果你只想安装和使用，到这里就可以停止阅读。下面内容面向准备检查代码、调试协议
或参与开发的人。

### 本地测试

在项目根目录执行：

```powershell
npm test
pwsh -NoProfile -File ".\scripts\check-powershell.ps1"
pwsh -NoProfile -File ".\scripts\test-picker-sorting.ps1"
pwsh -NoProfile -File ".\scripts\test-sidebar-sync.ps1"
pwsh -NoProfile -File ".\scripts\test-handoff-result-contract.ps1"
```

也可以在根目录直接运行 `npm run test:powershell`、`npm run test:picker`
`npm run test:sidebar` 和 `npm run test:contract`。

### 协议检查与 dry-run

```powershell
npm run schema-check
npm run dry-run:deepseek
npm run dry-run:openai
```

`schema-check` 只检查或缓存 Codex app-server 协议，不启动模型回合。dry-run 只
生成报告；第一次修改迁移逻辑时，应先用单个任务验收，再扩大范围。

### 修改默认模型

提供商默认设置位于：

[work/thread-localizer/data/handoff-settings.json](work/thread-localizer/data/handoff-settings.json)

- OpenAI 使用 `preserve-existing`，尽量回到任务此前使用的 GPT 模型。
- DeepSeek 默认使用 `deepseek-v4-pro + max`。进入 DeepSeek 模式后，可在 Codex
  原生模型菜单中为当前任务切换 V4 Pro/V4 Flash 与 Low/High/Max。
- 部分 Codex Desktop 会过滤第三方模型名。启动器会生成两个本机兼容菜单项，
  并且只在 DeepSeek 模式启动一个绑定 `127.0.0.1` 的模型名称适配器。它把
  兼容名称换回官方 DeepSeek slug，并剔除 DeepSeek 接口无法接受的“无主工具
  结果项”（缺 `call_id` 的工具结果）；GPT 请求不会经过它，消息正文、工具调用、
  搜索记录和返回流也不会被它改写。
- 交接器会记住每个任务最后使用的 DeepSeek 模型和思考强度；下次从 GPT 交接
  回来时优先恢复。只有从未使用过 DeepSeek 的任务才采用默认值。
- DeepSeek 模型 slug 必须存在于本机官方 `models-deepseek.json` 中。

### 进一步阅读

- [架构说明](docs/architecture.md)
- [兼容性矩阵](docs/compatibility.md)
- [故障排查](docs/troubleshooting.md)
- [安全边界](docs/safety.md)
- [命令行与协议细节](work/thread-localizer/README.md)
- [English README](README.en.md)
- [日本語 README](README.ja.md)

## 开源许可

本项目采用 [MIT License](LICENSE)。

DeepSeek 官方模型目录和品牌图标不会随本仓库重新分发；安装器复用用户本机已经
完成的官方配置。请不要把个人图标、API key、Codex 数据库、任务报告或聊天记录
提交到公开仓库。

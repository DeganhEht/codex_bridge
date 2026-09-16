# 手把手安装与首次交接

这是 [README](../README.md) 的详细版，适合第一次使用命令行的人。如果你更希望让
Codex 自己完成安装，直接使用 README 里的「让 Codex 帮你装」提示词即可。

全部步骤在 Windows 10/11 + PowerShell 7 上完成。

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

### 方法 B：使用 git

如果你已经装好 Git，可以在 PowerShell 7 中执行：

```powershell
git clone https://github.com/DeganhEht/codex_bridge.git
cd codex_bridge
```

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

如果这里直接出现红色错误，请先查看 [故障排查](troubleshooting.md)，不要反复执行
正式安装命令。

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
| `交接给GPT` | 当前使用 DeepSeek，下一次想回到 GPT | 先同步 DeepSeek 任务，再打开 Codex |

两个入口都支持只打开、不交接（选择器里的「仅打开 Codex」）。

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

## 遇到问题

- 安装或使用中报错：先看 [故障排查](troubleshooting.md)；
- 交接失败：报告写在
  `%USERPROFILE%\.codex\model-switcher\thread-localizer\reports\`；
- 适配器日志写在
  `%USERPROFILE%\.codex\model-switcher\handoff-logs\`；
- 让 Codex 帮你读日志：把 README 里「让 Codex 帮你装」的排障提示词复制过去即可。

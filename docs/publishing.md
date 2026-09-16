# 发布到 GitHub

发布目标：**https://github.com/DeganhEht/codex_bridge**（独立仓库，未 Fork 上游）。

本仓库是 [kaidongli30-cpu/Codex-Deepseek-Handoff](https://github.com/kaidongli30-cpu/Codex-Deepseek-Handoff)
（MIT，Copyright (c) 2026 kaidongli30-cpu）的改造版。MIT 许可允许直接发布改造版，
唯一要求是发行物里保留上游的版权与许可声明。本仓库已经做到：

- README（中/英/日）的「来源与致谢」写明基于上游改造，且不复述上游代码的归属；
- `LICENSE` 同时保留上游版权行和本仓库的修改版权行。

所以**没有 Fork 也不影响发布和使用**，区别只是 GitHub 不会自动显示
`forked from kaidongli30-cpu/Codex-Deepseek-Handoff` 标签；引用与致谢由 README 和
本文档承担。

## 1. 发布前的检查

```powershell
npm test
pwsh -NoProfile -File .\scripts\check-powershell.ps1
pwsh -NoProfile -File .\scripts\test-picker-sorting.ps1
pwsh -NoProfile -File .\scripts\test-sidebar-sync.ps1
pwsh -NoProfile -File .\scripts\test-handoff-result-contract.ps1
pwsh -NoProfile -File .\scripts\test-install-layout.ps1
```

再确认没有把私人内容提交进去：

- 不要提交 `work/thread-localizer/reports/`、`outputs/`、`*.dpapi`、`*.ico`、
  Codex 的 `state_5.sqlite`、rollout 或任何聊天记录（`.gitignore` 已覆盖大部分）；
- 确认仓库里没有 `C:\Users\<你>` 之类的个人路径；
- 确认没有 API key。

`LICENSE` 必须保留上游的 MIT 版权声明；README 顶部的「来源与致谢」也不要删除。

## 2. 首次推送

远端 `main` 上已经有一条 GitHub 生成的 `Initial commit`（只有占位 `README.md`
和 `LICENSE`）。先把它并进来，推送就是普通快进而不是强推；冲突时以本仓库内容
为准：

```powershell
git remote add bridge https://github.com/DeganhEht/codex_bridge.git
git fetch bridge
git merge bridge/main --allow-unrelated-histories
# 若提示 README.md / LICENSE 冲突，保留本地版本：
git checkout --ours -- README.md LICENSE
git add README.md LICENSE
git commit
git push bridge release/public-v1.2.0:main
git tag -f v1.2.0
git push bridge v1.2.0
```

> 不要用 `git push --force`：那会丢掉 GitHub 上已有的 `Initial commit`。

之后日常更新只需要 `git push bridge release/public-v1.2.0:main`。

## 3. Release 说明草稿

在 GitHub 的 **Releases → Draft a new release** 里，Tag 选 `v1.2.0`，标题和说明
可以直接复制下面这段：

````markdown
### Codex Bridge v1.2.0 — 在 GPT 与 DeepSeek 之间接力同一个 Codex 任务

基于 [kaidongli30-cpu/Codex-Deepseek-Handoff](https://github.com/kaidongli30-cpu/Codex-Deepseek-Handoff)（MIT）改造的 Windows 本地工具：让同一个任务在 GPT 和 DeepSeek 之间来回接着用，而不是每次重新开一个任务。

**这个版本做了什么**

- 固定双端点：一个逻辑任务固定保留 `[GPT]` 和 `[DeepSeek]` 两个任务，之后只增量同步新增内容，不再反复复制出新任务。
- 桌面启动器：`交接给deepseek` / `交接给GPT` 两个快捷方式点开后是多选选择器，可以按时间 / Provider·模型 / 任务 / 工作目录排序，勾选后一次性交接多个任务。
- 只打开不交接：选择器里的「仅打开 Codex」直接进入当前模式并回到上次打开的任务，适合关机后继续。
- 关机安全：关闭 DeepSeek 模式的 Codex 不会自动改配置或自动回程；配置写入只发生在你点快捷方式并选定任务的那一刻。
- 侧栏可见：交接过去的任务会正常出现在侧栏（补齐桌面端的侧栏登记与 `preview`），不需要记深链接。
- DeepSeek 兼容：模型名适配器支持 `HTTPS_PROXY` / `HTTP_PROXY`，并清洗 DeepSeek 严格校验会拒绝的无主工具结果（`missing field call_id`）。

**运行要求**

- Windows 10 / 11，PowerShell 7，Node.js 22.13 及以上
- 已安装 Codex 桌面版并能登录
- 自己的 DeepSeek 官方 API key（官方模型目录与官方接入脚本由你本机自行安装，本仓库不分发，也不分发 DeepSeek 品牌图标）

**安装**

下载源码包解压后，在项目根目录打开 PowerShell 7，按照 `README.md` 的「手动安装（快速版）」
或 `docs/install.md` 的完整步骤执行；安装脚本先用 `-WhatIf` 预览再实际运行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File ".\work\thread-localizer\launcher\install.ps1" `
  -SourceRoot "$PWD"
```

**许可与致谢**

MIT License。上游版权归 kaidongli30-cpu，本仓库的改造版权归 DeganhEht，两份声明都保留在 `LICENSE` 中。完整改动见 `CHANGELOG.md`。
````

## 4. 网络与凭据

- 本机 git 的 HTTPS 走 Windows schannel，若报
  `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`，
  先启动本机代理再推送：

```powershell
git config --global http.proxy http://127.0.0.1:7892
```

  推送完成后如不再需要，执行 `git config --global --unset http.proxy`。
- 推送凭据使用 GitHub Personal Access Token（HTTPS）或 SSH key；本机未安装
  `gh` CLI，如需使用可先 `winget install GitHub.cli` 再 `gh auth login`。

## 5. 发布包（可选）

如果只想先给别人一个压缩包，可以用 git 归档（只含已提交文件，不含 `.git`）：

```powershell
git archive --format=zip -o .\Codex-Bridge-v1.2.0.zip HEAD
```

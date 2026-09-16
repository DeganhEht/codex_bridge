import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(toolRoot, "..", "..");

test("handoff settings keep the provider defaults required by the product", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(toolRoot, "data", "handoff-settings.json"), "utf8"));
  assert.equal(settings.handoffMode, "paired");
  assert.equal(settings.managedProviders.deepseek.activeModel, "deepseek-v4-pro");
  assert.equal(settings.managedProviders.deepseek.modelAliases["deepseek-v4-pro"], "gpt-5.6-sol");
  assert.equal(settings.managedProviders.deepseek.modelAliases["deepseek-flash"], "gpt-5.6-terra");
  assert.equal(settings.managedProviders.deepseek.modelPolicy, "preserve-existing");
  assert.equal(settings.managedProviders.deepseek.reasoningEffort, "max");
  assert.equal(settings.managedProviders.deepseek.reasoningPolicy, "preserve-existing");
  assert.equal(settings.managedProviders.deepseek.webSearch, "live");
  assert.equal(settings.managedProviders.openai.modelPolicy, "preserve-existing");
});

test("the desktop launcher is portable and keeps max reasoning plus live search", () => {
  const launcher = fs.readFileSync(path.join(toolRoot, "launcher", "codex-desktop-model-launcher.ps1"), "utf8");
  assert.doesNotMatch(launcher, /[A-Za-z]:\\Users\\[^\\]+\\Documents\\Codex/);
  assert.match(launcher, /CODEX_HANDOFF_ROOT/);
  assert.match(launcher, /Get-DeepSeekModeSetting 'reasoningEffort'/);
  assert.match(launcher, /Get-DeepSeekModeSetting 'webSearch'/);
  assert.match(launcher, /models-deepseek-picker\.json/);
  assert.match(launcher, /model-name-adapter\.mjs/);
  assert.match(launcher, /'low', 'high', 'max'/);
  assert.match(launcher, /Get-CurrentMode/);
  assert.match(launcher, /Open-CodexForMode/);
  assert.match(launcher, /仅打开 Codex（继续当前模式）/);
  assert.match(launcher, /last-opened\.json/);
  assert.match(launcher, /last-handoff\.json/);
  assert.match(launcher, /Show-HandoffSummaryNotice/);
  assert.match(launcher, /Write-HandoffSummary/);
  assert.match(launcher, /Sync-CodexSidebarRegistrations/);
  assert.match(launcher, /thread-workspace-root-hints/);
  assert.match(launcher, /projectless-thread-ids/);
  assert.match(launcher, /codex:\/\/threads\/\$TargetThreadId/);
  assert.match(launcher, /Get-DesktopTargetThreadId/);
  assert.match(launcher, /Get-DesktopTargetThreadIds/);
  assert.match(launcher, /Open-CodexTargetThreads/);
  assert.match(launcher, /CheckBoxes = \$true/);
  assert.match(launcher, /全选/);
  assert.match(launcher, /Add_ColumnClick/);
  assert.match(launcher, /SortTime/);
  assert.match(launcher, /--log-dir/);
  // 关闭 DeepSeek 模式的 Codex 不再自动回程，也不再自动恢复 GPT 配置。
  assert.doesNotMatch(launcher, /\$returnTaskIds/);
  assert.doesNotMatch(launcher, /^\s*Restore-GptMode\s*;?\s*$/m);
  assert.doesNotMatch(launcher, /Invoke-BatchHandoff -TargetProvider 'openai'/);
});

test("DeepSeek request compatibility keeps orphan tool outputs out of requests", () => {
  const adapter = fs.readFileSync(path.join(toolRoot, "src", "model-name-adapter.mjs"), "utf8");
  const normalizer = fs.readFileSync(path.join(toolRoot, "src", "openai-rollout-normalizer.mjs"), "utf8");
  const batch = fs.readFileSync(path.join(toolRoot, "src", "batch-handoff-engine.mjs"), "utf8");
  assert.match(adapter, /dropOrphanToolOutputItems/);
  assert.match(adapter, /adapter-compat-/);
  assert.match(normalizer, /dropOrphanToolOutputs/);
  assert.match(normalizer, /targetProvider/);
  assert.match(batch, /ensurePairTags/);
  assert.match(batch, /tagPairedEndpoints/);
});

test("the key helper resolves its secret beside the installed tool", () => {
  const helper = fs.readFileSync(path.join(repoRoot, "work", "model-switcher", "get-deepseek-key.ps1"), "utf8");
  assert.doesNotMatch(helper, /[A-Za-z]:\\Users\\[^\\]+\\\.codex/);
  assert.match(helper, /Join-Path\s+\$installRoot\s+'deepseek-api-key\.dpapi'/);
});

test("the installer reuses the official catalog and installs both handoff entries", () => {
  const installer = fs.readFileSync(path.join(toolRoot, "launcher", "install.ps1"), "utf8");
  const shortcuts = fs.readFileSync(path.join(toolRoot, "launcher", "create-handoff-shortcuts.ps1"), "utf8");
  assert.match(installer, /找不到 DeepSeek 官方模型目录/);
  assert.doesNotMatch(installer, /Copy-FileChecked[^\n]+models-deepseek\.json/);
  assert.match(installer, /initialize-handoff\.ps1/);
  assert.match(installer, /移除旧版累计任务备份模块/);
  assert.match(shortcuts, /交接给GPT\.lnk/);
  assert.match(shortcuts, /交接给deepseek\.lnk/);
  // 旧名字只允许出现在「需要清理的旧快捷方式」列表里，不能再作为新建目标。
  assert.match(shortcuts, /\$legacyShortcuts = @\([\s\S]*任务交接GPT\.lnk[\s\S]*\)/);
});

test("configuration bootstrap is marker-scoped and validates before writing", () => {
  const initializer = fs.readFileSync(path.join(toolRoot, "launcher", "initialize-handoff.ps1"), "utf8");
  assert.match(initializer, /Codex desktop model switcher: mode \(managed; do not edit\)/);
  assert.match(initializer, /\[model_providers\.deepseek\]/);
  assert.match(initializer, /Test-CandidateConfig -Candidate \$candidate/);
  assert.match(initializer, /config\..+before-handoff-install\.toml/);
});

test("handoff verifies replacements then deletes predecessors without cumulative task backups", () => {
  const handoff = fs.readFileSync(path.join(toolRoot, "src", "handoff-engine.mjs"), "utf8");
  const batch = fs.readFileSync(path.join(toolRoot, "src", "batch-handoff-engine.mjs"), "utf8");
  assert.doesNotMatch(handoff, /createTimestampedBackup/);
  assert.doesNotMatch(handoff, /request\("thread\/fork"/);
  assert.match(handoff, /request\("thread\/start"/);
  assert.match(handoff, /request\("thread\/inject_items"/);
  assert.match(handoff, /appendProjectionEvents/);
  assert.match(handoff, /independentHistory/);
  assert.match(batch, /useStateDbOnly:\s*false/);
  assert.match(handoff, /client\.request\("thread\/delete"/);
  assert.doesNotMatch(batch, /archiveTestThread|thread\/archive/);
  assert.match(batch, /sourceDeleted: true/);
});

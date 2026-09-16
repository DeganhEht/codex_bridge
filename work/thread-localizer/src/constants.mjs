import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PROJECT_ROOT = path.resolve(TOOL_ROOT, "..", "..");

export const DEFAULT_PROVIDER = "openai";
export const DEEPSEEK_MODEL = "deepseek-v4-pro";
export const USER_THREAD_SOURCE = "user";

export const CODEX_HOME = path.resolve(
  process.env.CODEX_HOME || path.join(process.env.USERPROFILE || os.homedir(), ".codex"),
);
export const CODEX_SCHEMA_ROOT = process.env.CODEX_SCHEMA_ROOT
  ? path.resolve(process.env.CODEX_SCHEMA_ROOT)
  : null;
export const CODEX_SCHEMA_CACHE_ROOT = path.resolve(
  process.env.CODEX_SCHEMA_CACHE_ROOT
    || path.join(CODEX_HOME, "model-switcher", "app-server-schema"),
);
export const PROJECT_CWD = path.resolve(process.env.THREAD_LOCALIZER_CWD || PROJECT_ROOT);
export const SESSION_INDEX_PATH = path.join(CODEX_HOME, "session_index.jsonl");
export const BATCH_HANDOFF_MANIFEST_PATH = path.join(TOOL_ROOT, "data", "batch-handoff-manifest.json");
export const HANDOFF_SETTINGS_PATH = path.join(TOOL_ROOT, "data", "handoff-settings.json");
export const REPORT_DIR = path.join(TOOL_ROOT, "reports");

export const REQUIRED_METHODS = [
  "initialize",
  "thread/list",
  "thread/read",
  "thread/items/list",
  "thread/delete",
  "thread/start",
  "thread/inject_items",
  "thread/name/set",
];

export const DEFAULT_CLIENT_INFO = {
  name: "codex-thread-localizer",
  title: "Codex Thread Localizer",
  version: "0.1.0",
};

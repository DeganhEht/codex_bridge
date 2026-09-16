import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs/promises";
import path from "node:path";
import { CODEX_HOME, DEFAULT_CLIENT_INFO } from "./constants.mjs";
import { jsonRpcErrorMessage } from "./utils.mjs";

export class AppServerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AppServerError";
    this.code = details.code;
    this.data = details.data;
  }
}

export async function findCodexBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
    try {
      const entries = await fs.readdir(binRoot, { withFileTypes: true });
      const candidates = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(binRoot, entry.name, "codex.exe");
        try {
          const stat = await fs.stat(candidate);
          candidates.push({ candidate, mtime: stat.mtimeMs });
        } catch {
          // Ignore incomplete installation directories.
        }
      }
      candidates.sort((a, b) => b.mtime - a.mtime);
      if (candidates[0]) return candidates[0].candidate;
    } catch {
      // Fall through to PATH lookup.
    }
  }
  return "codex";
}

export class AppServerClient {
  constructor({ codexBin, cwd, timeoutMs = 60_000, configOverrides = {} } = {}) {
    this.codexBin = codexBin;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.configOverrides = configOverrides;
    this.child = null;
    this.readline = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stderrTail = "";
    this.closed = false;
  }

  async start() {
    if (this.child) return;
    const binary = this.codexBin || await findCodexBinary();
    const args = ["app-server", "--stdio"];
    for (const [key, value] of Object.entries(this.configOverrides || {})) {
      args.push("-c", `${key}=${tomlLiteral(value)}`);
    }
    this.child = spawn(binary, args, {
      cwd: this.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.readline = readline.createInterface({ input: this.child.stdout });
    this.readline.on("line", (line) => this.#handleLine(line));
    this.child.stderr.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-2000);
    });
    this.child.on("error", (error) => this.#rejectPending(new AppServerError("无法启动 Codex app-server", { data: error.message })));
    this.child.on("exit", (code, signal) => {
      this.closed = true;
      const stderr = this.stderrTail.trim();
      const detail = stderr ? `\n${stderr}` : "";
      this.#rejectPending(new AppServerError(
        `Codex app-server 已退出（退出码 ${code ?? "未知"}${signal ? `，信号 ${signal}` : ""}）。${detail}`,
        { data: { code, signal, stderr } },
      ));
    });

    await this.request("initialize", {
      clientInfo: DEFAULT_CLIENT_INFO,
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized");
  }

  request(method, params = {}) {
    if (!this.child || this.closed) {
      return Promise.reject(new AppServerError("app-server 尚未启动或已关闭"));
    }
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppServerError(`app-server 请求超时: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.child.stdin.write(`${message}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new AppServerError(`无法写入 app-server 请求: ${method}`, { data: error.message }));
      }
    });
  }

  notify(method, params = {}) {
    if (!this.child || this.closed) return;
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async close() {
    if (!this.child) return;
    this.closed = true;
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    this.readline?.close();
    try {
      this.child.stdin.end();
    } catch {
      // Process may already have exited.
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { this.child.kill(); } catch { /* no-op */ }
        resolve();
      }, 750);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  #handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || message.id === null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      const error = new AppServerError(
        `app-server ${pending.method} 失败: ${String(message.error.message || "未知错误")}`,
        { code: message.error.code, data: message.error.data },
      );
      pending.reject(error);
    } else {
      pending.resolve(message.result);
    }
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function tomlLiteral(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value === null) return "null";
  throw new TypeError("app-server config override 只支持字符串、布尔值或数字");
}

export async function createAppServerClient(options = {}) {
  const client = new AppServerClient(options);
  await client.start();
  return client;
}


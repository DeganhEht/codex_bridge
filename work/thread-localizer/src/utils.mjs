import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export function nowIso() {
  return new Date().toISOString();
}

export function timestampForPath(date = new Date()) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "-");
}

export async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

export async function readJsonl(filePath) {
  const text = await fsp.readFile(filePath, "utf8");
  const records = [];
  const errors = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      records.push({ line: index + 1, value: JSON.parse(line) });
    } catch (error) {
      errors.push({ line: index + 1, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { records, errors };
}

export async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function atomicWriteJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(temporaryPath, filePath);
}

export function jsonRpcErrorMessage(error) {
  if (error && typeof error === "object") {
    const code = "code" in error ? `code=${String(error.code)}` : "";
    const message = "message" in error ? String(error.message) : "app-server request failed";
    return [code, message].filter(Boolean).join(" ");
  }
  return String(error);
}

export function responseThread(result) {
  if (!result || typeof result !== "object") return null;
  if (result.thread && typeof result.thread === "object") return result.thread;
  if (result.id && typeof result.id === "string") return result;
  return null;
}

export function responseCursor(result) {
  if (!result || typeof result !== "object") return null;
  return result.nextCursor ?? result.next_cursor ?? result.cursor ?? null;
}

export function responseItems(result) {
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.items)) return result.items;
  return [];
}

export function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      options[key] = argv[index + 1];
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { positionals, options };
}

export function countVisibleMessages(items) {
  return items.filter((item) => {
    const value = item?.item && typeof item.item === "object" ? item.item : item;
    if (!value || typeof value !== "object") return false;
    if (["userMessage", "agentMessage", "UserMessage", "AgentMessage"].includes(value.type)) return true;
    return value.type === "message" && (value.role === "user" || value.role === "assistant");
  }).length;
}

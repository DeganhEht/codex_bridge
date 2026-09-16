import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";

const PRODUCT = "Codex-DeepSeek-Handoff model-name-adapter";
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const TOOL_OUTPUT_TYPES = new Set(["function_call_output", "custom_tool_call_output"]);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`invalid argument: ${key || "<empty>"}`);
    values[key.slice(2)] = value;
  }
  return values;
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw new Error("request body exceeds 32 MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function copyHeaders(headers, bodyLength) {
  const result = { ...headers };
  for (const name of ["host", "connection", "content-length", "transfer-encoding"]) delete result[name];
  result["content-length"] = String(bodyLength);
  return result;
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseProxyUrl(value) {
  if (!value) return null;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
    const parsed = new URL(candidate);
    if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hostMatchesNoProxy(hostname, port, noProxy) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  const entries = String(noProxy || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.includes("*")) return true;
  for (let entry of entries) {
    let entryHost = entry;
    let entryPort = null;
    if (entry.startsWith("[")) {
      const close = entry.indexOf("]");
      if (close >= 0) {
        entryHost = entry.slice(1, close);
        if (entry[close + 1] === ":") entryPort = entry.slice(close + 2);
      }
    } else {
      const colon = entry.lastIndexOf(":");
      if (colon > 0 && entry.indexOf(":") === colon) {
        entryHost = entry.slice(0, colon);
        entryPort = entry.slice(colon + 1);
      }
    }
    if (entryPort && entryPort !== String(port)) continue;
    if (entryHost.startsWith(".")) entryHost = entryHost.slice(1);
    if (host === entryHost || host.endsWith(`.${entryHost}`)) return true;
  }
  return false;
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost"
    || host === "127.0.0.1"
    || host === "::1"
    || host === "[::1]";
}

export function resolveProxyForTarget(targetUrl, env = process.env) {
  const target = targetUrl instanceof URL ? targetUrl : new URL(targetUrl);
  if (isLoopbackHost(target.hostname)) return null;
  const noProxy = env.NO_PROXY || env.no_proxy || "";
  if (hostMatchesNoProxy(target.hostname, target.port || (target.protocol === "https:" ? 443 : 80), noProxy)) {
    return null;
  }
  const raw = target.protocol === "https:"
    ? (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy)
    : (env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy);
  return parseProxyUrl(raw);
}

function proxyAuthorization(proxy) {
  if (!proxy.username && !proxy.password) return null;
  const username = decodeURIComponent(proxy.username || "");
  const password = decodeURIComponent(proxy.password || "");
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

class HttpsConnectProxyAgent extends https.Agent {
  constructor(proxy) {
    super({ keepAlive: false });
    this.proxy = proxy;
  }

  createConnection(options, callback) {
    const targetHost = options.hostname || options.host;
    const targetPort = Number(options.port || 443);
    const proxyTransport = this.proxy.protocol === "https:" ? https : http;
    const headers = {
      Host: `${targetHost}:${targetPort}`,
      Connection: "close",
    };
    const authorization = proxyAuthorization(this.proxy);
    if (authorization) headers["Proxy-Authorization"] = authorization;
    const connectRequest = proxyTransport.request({
      protocol: this.proxy.protocol,
      hostname: this.proxy.hostname,
      port: Number(this.proxy.port || (this.proxy.protocol === "https:" ? 443 : 80)),
      method: "CONNECT",
      path: `${targetHost}:${targetPort}`,
      headers,
      rejectUnauthorized: options.rejectUnauthorized,
    });
    let settled = false;
    const finish = (error, socket) => {
      if (settled) return;
      settled = true;
      callback(error, socket);
    };
    connectRequest.once("connect", (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        finish(new Error(`HTTPS proxy CONNECT failed with status ${response.statusCode}`));
        return;
      }
      if (head?.length) socket.unshift(head);
      const tlsSocket = tls.connect({
        socket,
        servername: options.servername || targetHost,
        rejectUnauthorized: options.rejectUnauthorized,
        ca: options.ca,
        cert: options.cert,
        key: options.key,
      });
      tlsSocket.once("secureConnect", () => finish(null, tlsSocket));
      tlsSocket.once("error", (error) => finish(error));
    });
    connectRequest.once("error", (error) => finish(error));
    connectRequest.end();
  }
}

/**
 * DeepSeek 的 Responses 接口要求每个工具结果都带 call_id；缺失时整次请求会被
 * 反序列化错误拒绝（input: missing field `call_id`）。这里只丢弃完全没有
 * call_id 的结果项，带 call_id 但调用项在更早历史里的正常情况不动。
 */
export function dropOrphanToolOutputItems(items) {
  const dropped = [];
  const kept = [];
  for (const item of items || []) {
    if (item && typeof item === "object" && TOOL_OUTPUT_TYPES.has(item.type)) {
      const callId = item.call_id;
      if (typeof callId !== "string" || callId.length === 0) {
        dropped.push({
          id: item.id ?? null,
          name: item.name ?? null,
          type: item.type ?? null,
        });
        continue;
      }
    }
    kept.push(item);
  }
  return { kept, dropped };
}

export function prepareRequestBody(body, aliases) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch (error) {
    return {
      outgoing: body,
      model: null,
      rewritten: false,
      dropped: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.model !== "string") {
    return {
      outgoing: body,
      model: null,
      rewritten: false,
      dropped: [],
      parseError: "JSON request does not contain a model name",
    };
  }
  const actualModel = aliases[parsed.model];
  const isNativeModelName = Object.values(aliases).includes(parsed.model);
  if (!actualModel && !isNativeModelName) {
    throw new Error(`unsupported picker model: ${parsed.model}`);
  }
  if (actualModel) parsed.model = actualModel;

  let dropped = [];
  if (Array.isArray(parsed.input)) {
    const sanitized = dropOrphanToolOutputItems(parsed.input);
    dropped = sanitized.dropped;
    if (dropped.length > 0) parsed.input = sanitized.kept;
  }
  return {
    outgoing: Buffer.from(JSON.stringify(parsed), "utf8"),
    model: parsed.model,
    rewritten: Boolean(actualModel),
    dropped,
    parseError: null,
  };
}

export function rewriteRequestBody(body, aliases) {
  return prepareRequestBody(body, aliases).outgoing;
}

export function createAdapterServer({ upstreamBaseUrl, aliases, logDir = null }) {
  const upstream = new URL(upstreamBaseUrl);
  const transport = upstream.protocol === "https:" ? https : http;
  if (!["http:", "https:"].includes(upstream.protocol)) throw new Error("upstream must use http or https");
  const proxy = resolveProxyForTarget(upstream);
  const proxyAgent = proxy && upstream.protocol === "https:"
    ? new HttpsConnectProxyAgent(proxy)
    : null;
  const stats = {
    jsonRequests: 0,
    modelRewrites: 0,
    droppedToolOutputs: 0,
    passthroughRequests: 0,
    upstreamErrors: 0,
    proxyConfigured: Boolean(proxy),
    proxyUrl: proxy ? `${proxy.protocol}//${proxy.hostname}:${proxy.port || (proxy.protocol === "https:" ? 443 : 80)}` : null,
    proxyRequests: 0,
  };
  const logRoot = logDir ? path.resolve(logDir) : null;
  const logFile = logRoot
    ? path.join(logRoot, `adapter-compat-${new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "-")}.txt`)
    : null;
  let logQueue = Promise.resolve();
  const appendCompatLog = (text) => {
    if (!logFile) return;
    logQueue = logQueue
      .then(async () => {
        await fs.mkdir(path.dirname(logFile), { recursive: true });
        await fs.appendFile(logFile, `${new Date().toISOString()} ${text}\n`, "utf8");
      })
      .catch(() => {});
  };

  return http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/__handoff_model_adapter_health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ product: PRODUCT, pid: process.pid, stats }));
      return;
    }

    try {
      const incomingBody = await readBody(request);
      const contentType = String(request.headers["content-type"] || "").toLowerCase();
      let outgoingBody = incomingBody;
      if (contentType.includes("application/json")) {
        const prepared = prepareRequestBody(incomingBody, aliases);
        outgoingBody = prepared.outgoing;
        stats.jsonRequests += 1;
        if (prepared.rewritten) stats.modelRewrites += 1;
        if (prepared.dropped.length > 0) {
          stats.droppedToolOutputs += prepared.dropped.length;
          appendCompatLog(
            `dropped-orphan-tool-outputs=${prepared.dropped.length} items=${JSON.stringify(prepared.dropped)}`,
          );
        }
        if (prepared.parseError) {
          stats.passthroughRequests += 1;
          appendCompatLog(`passthrough unparsed-json-request reason=${prepared.parseError}`);
        }
      }
      const target = new URL(request.url || "/", upstream);
      const forwardedHeaders = copyHeaders(request.headers, outgoingBody.length);
      let requestTransport = transport;
      let requestTarget = target;
      const requestOptions = {
        method: request.method,
        headers: forwardedHeaders,
      };
      if (proxy) {
        stats.proxyRequests += 1;
        if (upstream.protocol === "http:") {
          requestTransport = proxy.protocol === "https:" ? https : http;
          requestTarget = proxy;
          requestOptions.hostname = proxy.hostname;
          requestOptions.port = Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80));
          requestOptions.path = target.toString();
          requestOptions.headers.host = target.host;
          const authorization = proxyAuthorization(proxy);
          if (authorization) requestOptions.headers["proxy-authorization"] = authorization;
        } else {
          requestOptions.agent = proxyAgent;
        }
      }
      const upstreamRequest = requestTransport.request(requestTarget, requestOptions, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstreamRequest.on("error", (error) => {
        stats.upstreamErrors += 1;
        appendCompatLog(`upstream-error=${error.message}`);
        if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "DeepSeek upstream request failed", detail: error.message }));
      });
      upstreamRequest.end(outgoingBody);
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid --port");
  if (!args.upstream || !args.settings) throw new Error("--upstream and --settings are required");
  const settings = JSON.parse(await fs.readFile(args.settings, "utf8"));
  const actualToPicker = settings?.managedProviders?.deepseek?.modelAliases;
  if (!actualToPicker || typeof actualToPicker !== "object") throw new Error("DeepSeek modelAliases missing");
  const aliases = Object.fromEntries(Object.entries(actualToPicker).map(([actual, picker]) => [picker, actual]));
  const logDir = args["log-dir"]
    ? path.resolve(args["log-dir"])
    : path.resolve(path.dirname(args.settings), "..", "..", "handoff-logs");
  const server = createAdapterServer({ upstreamBaseUrl: args.upstream, aliases, logDir });
  server.listen(port, "127.0.0.1");
  server.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });

  const parentPid = Number(args["parent-pid"]);
  if (Number.isInteger(parentPid) && parentPid > 0) {
    const timer = setInterval(() => {
      try { process.kill(parentPid, 0); } catch { server.close(() => process.exit(0)); }
    }, 2000);
    timer.unref();
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}` ||
    import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

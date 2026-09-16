import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPickerCatalog } from "../src/build-picker-catalog.mjs";
import {
  createAdapterServer,
  nextAdapterLifetimeState,
  prepareRequestBody,
  resolveProxyForTarget,
  rewriteRequestBody,
} from "../src/model-name-adapter.mjs";

const actualToPicker = {
  "deepseek-flash": "gpt-5.6-terra",
  "deepseek-v4-pro": "gpt-5.6-sol",
};
const pickerToActual = Object.fromEntries(Object.entries(actualToPicker).map(([actual, picker]) => [picker, actual]));

test("picker catalog keeps DeepSeek capabilities while using allowlisted runtime slugs", () => {
  const source = {
    models: [
      { slug: "deepseek-flash", display_name: "DeepSeek-Flash", supported_reasoning_levels: [{ effort: "max" }] },
      { slug: "deepseek-v4-pro", display_name: "DeepSeek-V4-Pro", supported_reasoning_levels: [{ effort: "max" }] },
    ],
  };
  const result = buildPickerCatalog(source, { managedProviders: { deepseek: { modelAliases: actualToPicker } } });
  assert.deepEqual(result.models.map((model) => [model.slug, model.display_name]), [
     ["gpt-5.6-terra", "DeepSeek-Flash"],
    ["gpt-5.6-sol", "DeepSeek-V4-Pro"],
  ]);
});

test("request rewrite changes only the model field", () => {
  const original = { model: "gpt-5.6-sol", input: [{ role: "user", content: [{ type: "input_text", text: "keep me" }] }] };
  const rewritten = JSON.parse(rewriteRequestBody(Buffer.from(JSON.stringify(original)), pickerToActual));
  assert.equal(rewritten.model, "deepseek-v4-pro");
  assert.deepEqual(rewritten.input, original.input);
});

test("adapter streams the upstream response and preserves request content", async (context) => {
  let received;
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: first\n\n");
    response.end("data: second\n\n");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  context.after(() => upstream.close());
  const upstreamPort = upstream.address().port;

  const adapter = createAdapterServer({ upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`, aliases: pickerToActual });
  await new Promise((resolve) => adapter.listen(0, "127.0.0.1", resolve));
  context.after(() => adapter.close());
  const adapterPort = adapter.address().port;

  const payload = { model: "gpt-5.6-terra", input: [{ role: "user", content: [{ type: "input_text", text: "unchanged" }] }] };
  const response = await fetch(`http://127.0.0.1:${adapterPort}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-only" },
    body: JSON.stringify(payload),
  });
  assert.equal(await response.text(), "data: first\n\ndata: second\n\n");
  assert.equal(received.model, "deepseek-flash");
  assert.deepEqual(received.input, payload.input);
});

test("request rewrite keeps the body identical apart from the model field", () => {
  const original = {
    model: "gpt-5.6-terra",
    input: [{ type: "function_call_output", call_id: "call-1", output: "ok" }],
    stream: true,
    metadata: { trace: "keep" },
  };
  const prepared = prepareRequestBody(Buffer.from(JSON.stringify(original)), pickerToActual);
  assert.equal(prepared.rewritten, true);
  assert.equal(prepared.dropped.length, 0);
  assert.equal(prepared.outgoing.toString("utf8"), JSON.stringify({ ...original, model: "deepseek-flash" }));
});

test("native DeepSeek model names pass through without rewriting", () => {
  const prepared = prepareRequestBody(
    Buffer.from(JSON.stringify({ model: "deepseek-v4-pro", input: [] })),
    pickerToActual,
  );
  assert.equal(prepared.rewritten, false);
  assert.equal(JSON.parse(prepared.outgoing.toString("utf8")).model, "deepseek-v4-pro");
});

test("unparsable request bodies pass through instead of failing the request", () => {
  const body = Buffer.from("not-json");
  const prepared = prepareRequestBody(body, pickerToActual);
  assert.ok(prepared.parseError);
  assert.ok(prepared.outgoing.equals(body));
});

test("adapter drops orphan tool outputs, logs them and reports counters", async (context) => {
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-adapter-compat-"));
  context.after(async () => {
    await fs.rm(logDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  let received = null;
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    received = { text: body.toString("utf8"), contentLength: Number(request.headers["content-length"]) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  context.after(() => upstream.close());

  const adapter = createAdapterServer({
    upstreamBaseUrl: `http://127.0.0.1:${upstream.address().port}`,
    aliases: pickerToActual,
    logDir,
  });
  await new Promise((resolve) => adapter.listen(0, "127.0.0.1", resolve));
  context.after(() => adapter.close());
  const adapterBase = `http://127.0.0.1:${adapter.address().port}`;

  const payload = {
    model: "gpt-5.6-sol",
    input: [
      { type: "function_call", id: "call-1", call_id: "call-1", name: "exec_command" },
      { type: "function_call_output", id: "fco-1", call_id: "call-1", output: "ok" },
      { type: "function_call_output", id: "fco-orphan", name: "send_message_to_thread", output: "delegation" },
    ],
  };
  const response = await fetch(`${adapterBase}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-only" },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);

  const forwarded = JSON.parse(received.text);
  assert.equal(forwarded.model, "deepseek-v4-pro");
  assert.deepEqual(forwarded.input.map((item) => item.id), ["call-1", "fco-1"]);
  assert.equal(received.contentLength, Buffer.byteLength(received.text));

  const health = await (await fetch(`${adapterBase}/__handoff_model_adapter_health`)).json();
  assert.equal(health.stats.droppedToolOutputs, 1);
  assert.equal(health.stats.modelRewrites, 1);

  const logFiles = (await fs.readdir(logDir)).filter((name) => name.startsWith("adapter-compat-"));
  assert.equal(logFiles.length, 1);
  const logText = await fs.readFile(path.join(logDir, logFiles[0]), "utf8");
  assert.match(logText, /dropped-orphan-tool-outputs=1/);
  assert.match(logText, /fco-orphan/);
});

test("large DeepSeek request bodies are sanitized without touching other items", () => {
  const filler = Array.from({ length: 4000 }, (_, index) => ({
    type: "message",
    role: index % 2 === 0 ? "user" : "assistant",
    content: [{ type: "output_text", text: "x".repeat(1500) }],
  }));
  const input = [
    ...filler,
    { type: "function_call_output", id: "fco-orphan", name: "send_message_to_thread", output: "delegation" },
  ];
  const body = Buffer.from(JSON.stringify({ model: "gpt-5.6-sol", input }));
  assert.ok(body.length > 6 * 1024 * 1024, `测试请求体过小: ${body.length}`);

  const prepared = prepareRequestBody(body, pickerToActual);
  assert.equal(prepared.dropped.length, 1);
  assert.equal(prepared.dropped[0].id, "fco-orphan");
  const forwarded = JSON.parse(prepared.outgoing.toString("utf8"));
  assert.equal(forwarded.input.length, filler.length);
  assert.equal(forwarded.model, "deepseek-v4-pro");
});

test("adapter replaces encrypted_content parts that DeepSeek would reject", () => {
  const input = [
    {
      type: "message",
      role: "assistant",
      content: [
        { type: "input_text", text: "kept text" },
        { type: "encrypted_content", encrypted_content: "gAAAA-ciphertext" },
      ],
    },
    {
      type: "function_call_output",
      id: "fco-1",
      call_id: "call_1",
      output: [{ type: "encrypted_content", encrypted_content: "gAAAA-only" }],
    },
  ];
  const prepared = prepareRequestBody(
    Buffer.from(JSON.stringify({ model: "gpt-5.6-sol", input })),
    pickerToActual,
  );

  assert.equal(prepared.stripped.length, 2);
  assert.deepEqual(
    prepared.stripped.map((entry) => [entry.type, entry.field, entry.count, entry.callId]),
    [["message", "content", 1, null], ["function_call_output", "output", 1, "call_1"]],
  );
  const forwarded = JSON.parse(prepared.outgoing.toString("utf8"));
  assert.equal(forwarded.model, "deepseek-v4-pro");
  assert.deepEqual(forwarded.input[0].content, [{ type: "input_text", text: "kept text" }]);
  assert.equal(forwarded.input[1].call_id, "call_1");
  assert.deepEqual(forwarded.input[1].output, [
    { type: "input_text", text: "[encrypted content omitted]" },
  ]);
  assert.equal(JSON.stringify(forwarded).includes("encrypted_content"), false);
  assert.equal(JSON.stringify(input).includes("gAAAA-ciphertext"), true, "原始请求不能被就地修改");
});

test("adapter leaves request bodies without encrypted_content parts unchanged", () => {
  const original = {
    model: "gpt-5.6-sol",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "keep me" }] }],
  };
  const prepared = prepareRequestBody(Buffer.from(JSON.stringify(original)), pickerToActual);
  assert.deepEqual(prepared.stripped, []);
  assert.deepEqual(prepared.dropped, []);
  const forwarded = JSON.parse(prepared.outgoing.toString("utf8"));
  assert.deepEqual(forwarded.input, original.input);
});

test("adapter keeps serving while Codex runs, even after the launcher window is gone", () => {
  let result = nextAdapterLifetimeState(
    { everSawCodex: false, codexAbsentSince: null },
    { now: 1_000, parentAlive: true, codexRunning: true },
  );
  assert.equal(result.exit, false);
  result = nextAdapterLifetimeState(result.state, {
    now: 60_000,
    parentAlive: false,
    codexRunning: true,
  });
  assert.equal(result.state.everSawCodex, true);
  assert.equal(result.state.codexAbsentSince, null);
  assert.equal(result.exit, false);
});

test("adapter exits after Codex has been gone for the grace period", () => {
  let result = nextAdapterLifetimeState(
    { everSawCodex: true, codexAbsentSince: null },
    { now: 1_000, parentAlive: false, codexRunning: false },
  );
  assert.equal(result.state.codexAbsentSince, 1_000);
  assert.equal(result.exit, false);
  result = nextAdapterLifetimeState(result.state, { now: 29_000, parentAlive: false, codexRunning: false });
  assert.equal(result.exit, false);
  result = nextAdapterLifetimeState(result.state, { now: 32_000, parentAlive: false, codexRunning: false });
  assert.equal(result.exit, true);
});

test("adapter waits for the first Codex start and never exits while the launcher lives", () => {
  let result = nextAdapterLifetimeState(
    { everSawCodex: false, codexAbsentSince: null },
    { now: 0, parentAlive: false, codexRunning: false },
  );
  assert.equal(result.exit, false);
  result = nextAdapterLifetimeState(result.state, { now: 60_000, parentAlive: false, codexRunning: false });
  assert.equal(result.exit, false);
  result = nextAdapterLifetimeState(result.state, { now: 200_000, parentAlive: false, codexRunning: false });
  assert.equal(result.exit, true);

  const supervised = nextAdapterLifetimeState(
    { everSawCodex: true, codexAbsentSince: null },
    { now: 10_000_000, parentAlive: true, codexRunning: false },
  );
  assert.equal(supervised.exit, false);
});

test("adapter resets the absent timer when Codex comes back", () => {
  let result = nextAdapterLifetimeState(
    { everSawCodex: true, codexAbsentSince: null },
    { now: 0, parentAlive: false, codexRunning: false },
  );
  assert.equal(result.state.codexAbsentSince, 0);
  result = nextAdapterLifetimeState(result.state, { now: 5_000, parentAlive: false, codexRunning: true });
  assert.equal(result.state.codexAbsentSince, null);
  assert.equal(result.exit, false);
});

test("proxy selection respects HTTPS_PROXY and NO_PROXY", () => {
  const env = {
    HTTPS_PROXY: "http://127.0.0.1:7892",
    HTTP_PROXY: "http://127.0.0.1:7893",
    NO_PROXY: "localhost,127.0.0.1,.internal.example",
  };
  assert.equal(resolveProxyForTarget("https://api.deepseek.com", env)?.port, "7892");
  assert.equal(resolveProxyForTarget("http://api.deepseek.com", env)?.port, "7893");
  assert.equal(resolveProxyForTarget("https://localhost:4443", env), null);
  assert.equal(resolveProxyForTarget("https://api.internal.example", env), null);
  assert.equal(resolveProxyForTarget("http://127.0.0.1:1234", env), null);
});

test("adapter forwards HTTP upstreams through configured HTTP_PROXY", async (context) => {
  const saved = {
    http: process.env.HTTP_PROXY,
    https: process.env.HTTPS_PROXY,
    noProxy: process.env.NO_PROXY,
  };
  context.after(() => {
    if (saved.http === undefined) delete process.env.HTTP_PROXY;
    else process.env.HTTP_PROXY = saved.http;
    if (saved.https === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = saved.https;
    if (saved.noProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = saved.noProxy;
  });
  let proxySawRequest = false;
  let upstreamSawRequest = false;
  const upstream = http.createServer(async (request, response) => {
    upstreamSawRequest = true;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  context.after(() => upstream.close());
  const upstreamPort = upstream.address().port;

  const proxy = http.createServer((request, response) => {
    proxySawRequest = true;
    const target = new URL(request.url);
    const forward = http.request({
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers: request.headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    request.pipe(forward);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  context.after(() => proxy.close());

  process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  process.env.HTTPS_PROXY = "";
  process.env.NO_PROXY = "";
  const adapter = createAdapterServer({
    upstreamBaseUrl: `http://example.test:${upstreamPort}`,
    aliases: pickerToActual,
  });
  await new Promise((resolve) => adapter.listen(0, "127.0.0.1", resolve));
  context.after(() => adapter.close());

  const response = await fetch(`http://127.0.0.1:${adapter.address().port}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.6-terra", input: [] }),
  });
  assert.equal(response.status, 200);
  assert.equal(proxySawRequest, true);
  assert.equal(upstreamSawRequest, true);
  assert.deepEqual(await response.json(), { ok: true });
});

test("adapter attempts HTTPS CONNECT through configured HTTPS_PROXY", async (context) => {
  const saved = { https: process.env.HTTPS_PROXY, noProxy: process.env.NO_PROXY };
  context.after(() => {
    if (saved.https === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = saved.https;
    if (saved.noProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = saved.noProxy;
  });
  let connectPath = null;
  const proxy = http.createServer();
  proxy.on("connect", (request, socket) => {
    connectPath = request.url;
    socket.write("HTTP/1.1 502 Bad Gateway\\r\\nConnection: close\\r\\n\\r\\n");
    socket.destroy();
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  context.after(() => proxy.close());
  process.env.HTTPS_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  process.env.NO_PROXY = "";

  const adapter = createAdapterServer({
    upstreamBaseUrl: "https://api.example.test/",
    aliases: pickerToActual,
  });
  await new Promise((resolve) => adapter.listen(0, "127.0.0.1", resolve));
  context.after(() => adapter.close());
  const response = await fetch(`http://127.0.0.1:${adapter.address().port}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.6-terra", input: [] }),
  });
  assert.equal(response.status, 502);
  assert.equal(connectPath, "api.example.test:443");
});

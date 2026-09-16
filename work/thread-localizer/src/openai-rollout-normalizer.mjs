function isResponseItem(record, payloadType) {
  return record?.value?.type === "response_item"
    && record.value.payload?.type === payloadType;
}

const TOOL_OUTPUT_TYPES = new Set(["function_call_output", "custom_tool_call_output"]);

function isWebSearchEvent(record) {
  return record?.value?.type === "event_msg"
    && typeof record.value.payload?.type === "string"
    && record.value.payload.type.startsWith("web_search_");
}

function isToolOutputRecord(record) {
  return record?.value?.type === "response_item"
    && TOOL_OUTPUT_TYPES.has(record.value.payload?.type);
}

/**
 * DeepSeek 的 Responses 接口要求每个工具结果都带 call_id，缺失时整次请求会被反序列化错误拒绝。
 * 只丢弃完全没有 call_id 的结果项：带 call_id 但调用项位于更早增量里的情况是正常的，
 * 不能按“找不到调用项”来删除。
 */
export function dropOrphanToolOutputs(records) {
  const droppedOrphanToolOutputs = [];
  const normalizedRecords = records.filter((record) => {
    if (!isToolOutputRecord(record)) return true;
    const payload = record.value.payload;
    const callId = payload?.call_id;
    if (typeof callId === "string" && callId.length > 0) return true;
    droppedOrphanToolOutputs.push({
      id: payload?.id ?? null,
      name: payload?.name ?? null,
      type: payload?.type ?? null,
    });
    return false;
  });
  return { records: normalizedRecords, droppedOrphanToolOutputs };
}

export function clearThreadBoundEncryptedReasoning(records) {
  let clearedEncryptedReasoningCount = 0;
  const normalizedRecords = records.map((record) => {
    if (!isResponseItem(record, "reasoning")) return record;
    const encrypted = record.value.payload?.encrypted_content;
    if (typeof encrypted !== "string" || encrypted.length === 0) return record;
    clearedEncryptedReasoningCount += 1;
    return {
      ...record,
      value: {
        ...record.value,
        payload: { ...record.value.payload, encrypted_content: null },
      },
    };
  });
  return { records: normalizedRecords, clearedEncryptedReasoningCount };
}

const ENCRYPTED_CONTENT_PLACEHOLDER = "[encrypted content omitted]";

export function stripEncryptedPartsFromContentArray(parts) {
  if (!Array.isArray(parts)) return { parts, strippedCount: 0 };
  const kept = [];
  let strippedCount = 0;
  for (const part of parts) {
    if (part && typeof part === "object" && part.type === "encrypted_content") {
      strippedCount += 1;
      continue;
    }
    kept.push(part);
  }
  if (strippedCount === 0) return { parts, strippedCount: 0 };
  return {
    parts: kept.length > 0 ? kept : [{ type: "input_text", text: ENCRYPTED_CONTENT_PLACEHOLDER }],
    strippedCount,
  };
}

/**
 * DeepSeek 的 Responses 接口只接受 input_text / input_image / input_file 三种内容片段。
 * GPT 侧的多 agent 消息会把正文放进 encrypted_content 片段（例如 send_message_to_thread
 * 的结果），原样注入时 DeepSeek 会用反序列化错误拒绝整次请求
 * （input: unknown variant `encrypted_content`）。这里把这些片段替换成占位文本，
 * 保留消息与 call_id 结构，并且避免留下空数组。
 */
export function stripEncryptedContentParts(records) {
  let strippedEncryptedContentPartCount = 0;
  const normalizedRecords = (records || []).map((record) => {
    const payload = record?.value?.payload;
    if (record?.value?.type !== "response_item" || !payload || typeof payload !== "object") {
      return record;
    }
    let nextPayload = null;
    for (const field of ["content", "output"]) {
      const result = stripEncryptedPartsFromContentArray(payload[field]);
      if (result.strippedCount === 0) continue;
      strippedEncryptedContentPartCount += result.strippedCount;
      nextPayload = { ...(nextPayload || payload), [field]: result.parts };
    }
    if (!nextPayload) return record;
    return { ...record, value: { ...record.value, payload: nextPayload } };
  });
  return { records: normalizedRecords, strippedEncryptedContentPartCount };
}

function openAIWebSearchId(sourceId) {
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    throw new Error("联网搜索调用缺少可转换的字符串 ID");
  }
  if (sourceId.startsWith("ws_")) return sourceId;
  return sourceId.startsWith("call_")
    ? `ws_${sourceId.slice("call_".length)}`
    : `ws_${sourceId}`;
}

function buildWebSearchIdMap(records) {
  const allWebSearchIds = new Set();
  const replacements = new Map();
  for (const record of records) {
    if (!isResponseItem(record, "web_search_call")) continue;
    const id = record.value.payload.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("联网搜索调用缺少可转换的字符串 ID");
    }
    if (allWebSearchIds.has(id)) {
      throw new Error(`联网搜索调用 ID 重复：${id}`);
    }
    allWebSearchIds.add(id);
    if (!id.startsWith("ws_")) replacements.set(id, openAIWebSearchId(id));
  }

  const replacementIds = new Set();
  for (const [sourceId, targetId] of replacements) {
    if (allWebSearchIds.has(targetId) || replacementIds.has(targetId)) {
      throw new Error(`联网搜索调用 ID 转换后冲突：${sourceId} -> ${targetId}`);
    }
    replacementIds.add(targetId);
  }
  return replacements;
}

export function normalizeOpenAIRolloutRecords(records, { targetProvider = "openai" } = {}) {
  if (targetProvider !== "openai") {
    const stripped = stripEncryptedContentParts(records);
    const dropped = dropOrphanToolOutputs(stripped.records);
    return {
      records: dropped.records,
      normalizedReasoningCount: 0,
      normalizedWebSearchCallIdCount: 0,
      normalizedWebSearchEventReferenceCount: 0,
      totalNormalizedCount: 0,
      droppedOrphanToolOutputs: dropped.droppedOrphanToolOutputs,
      droppedOrphanToolOutputCount: dropped.droppedOrphanToolOutputs.length,
      strippedEncryptedContentPartCount: stripped.strippedEncryptedContentPartCount,
    };
  }
  const webSearchIdMap = buildWebSearchIdMap(records);
  let normalizedReasoningCount = 0;
  let normalizedWebSearchCallIdCount = 0;
  let normalizedWebSearchEventReferenceCount = 0;

  const normalizedRecords = records.map((record) => {
    const value = record?.value;
    if (isResponseItem(record, "reasoning") && Array.isArray(value.payload.content)) {
      normalizedReasoningCount += 1;
      return { ...record, value: { ...value, payload: { ...value.payload, content: null } } };
    }
    if (isResponseItem(record, "web_search_call") && webSearchIdMap.has(value.payload.id)) {
      normalizedWebSearchCallIdCount += 1;
      return {
        ...record,
        value: { ...value, payload: { ...value.payload, id: webSearchIdMap.get(value.payload.id) } },
      };
    }
    if (isWebSearchEvent(record) && webSearchIdMap.has(value.payload.call_id)) {
      normalizedWebSearchEventReferenceCount += 1;
      return {
        ...record,
        value: { ...value, payload: { ...value.payload, call_id: webSearchIdMap.get(value.payload.call_id) } },
      };
    }
    return record;
  });

  const remainingInvalidIds = normalizedRecords
    .filter((record) => isResponseItem(record, "web_search_call"))
    .map((record) => record.value.payload.id)
    .filter((id) => typeof id !== "string" || !id.startsWith("ws_"));
  if (remainingInvalidIds.length > 0) {
    throw new Error(`仍有 ${remainingInvalidIds.length} 个联网搜索调用 ID 不符合 OpenAI 格式`);
  }

  return {
    records: normalizedRecords,
    normalizedReasoningCount,
    normalizedWebSearchCallIdCount,
    normalizedWebSearchEventReferenceCount,
    totalNormalizedCount: normalizedReasoningCount
      + normalizedWebSearchCallIdCount
      + normalizedWebSearchEventReferenceCount,
    droppedOrphanToolOutputs: [],
    droppedOrphanToolOutputCount: 0,
    strippedEncryptedContentPartCount: 0,
  };
}

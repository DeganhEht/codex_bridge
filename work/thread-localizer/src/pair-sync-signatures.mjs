import crypto from "node:crypto";

/**
 * payload 里值为 null 的字段和“字段不存在”等价：app-server 落盘时会给自己补默认的
 * null（例如 reasoning 的 content），也会丢掉它不认识的 null 字段。如果某个对象
 * 因为去掉 null 而变成空对象，同样按“不存在”处理。
 */
const DROP_VALUE = Symbol("drop-value");

function dropNullValues(value) {
  if (Array.isArray(value)) return value.map(dropNullValues);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null) continue;
      const normalized = dropNullValues(entry);
      if (normalized === DROP_VALUE) continue;
      result[key] = normalized;
    }
    return Object.keys(result).length === 0 ? DROP_VALUE : result;
  }
  return value;
}

/**
 * 目标端点的记录信封（timestamp / ordinal / metadata 等）由 app-server 自己重建，
 * 而注入时送给它的只有 payload。因此验收与重复块检测只在 type + payload 层比较：
 * 源记录的信封字段一律不参与，避免 app-server 丢掉某个信封字段就让整块指纹对不上。
 */
function canonicalValue(record) {
  const value = record?.value ?? record ?? null;
  if (!value || typeof value !== "object") return value ?? null;
  const payload = dropNullValues(structuredClone(value.payload ?? null));
  return {
    type: value.type ?? null,
    payload: payload === DROP_VALUE ? null : payload,
  };
}

export function canonicalRecordSignature(record) {
  return JSON.stringify(canonicalValue(record));
}

export function recordsFingerprint(records) {
  const hash = crypto.createHash("sha256");
  for (const record of records || []) hash.update(`${canonicalRecordSignature(record)}\n`);
  return hash.digest("hex");
}

export function findContiguousBlockOccurrences(records, expectedRecords) {
  const actual = (records || []).map(canonicalRecordSignature);
  const expected = (expectedRecords || []).map(canonicalRecordSignature);
  if (expected.length === 0 || expected.length > actual.length) return [];
  const occurrences = [];
  for (let start = 0; start <= actual.length - expected.length; start += 1) {
    if (expected.every((signature, index) => actual[start + index] === signature)) {
      occurrences.push(start);
    }
  }
  return occurrences;
}

export function repeatedTailInfo(records, baseRecordCount) {
  const tail = (records || []).slice(baseRecordCount);
  if (tail.length < 2) return null;
  for (let copies = Math.min(8, tail.length); copies >= 2; copies -= 1) {
    if (tail.length % copies !== 0) continue;
    const blockLength = tail.length / copies;
    const block = tail.slice(0, blockLength).map(canonicalRecordSignature);
    let repeated = true;
    for (let copy = 1; copy < copies && repeated; copy += 1) {
      const offset = copy * blockLength;
      repeated = block.every((signature, index) => (
        tail[offset + index] && canonicalRecordSignature(tail[offset + index]) === signature
      ));
    }
    if (repeated) {
      return {
        baseRecordCount,
        totalRecordCount: tail.length + baseRecordCount,
        blockRecordCount: blockLength,
        copies,
        fingerprint: recordsFingerprint(tail.slice(0, blockLength)),
      };
    }
  }
  return null;
}

function collectDifferingPaths(expected, actual, prefix, out, budget) {
  if (out.length >= budget.remaining) return out;
  const expectedIsArray = Array.isArray(expected);
  const actualIsArray = Array.isArray(actual);
  const expectedIsObject = expected && typeof expected === "object";
  const actualIsObject = actual && typeof actual === "object";
  if (!expectedIsObject || !actualIsObject) {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) out.push(prefix || "(root)");
    return out;
  }
  if (expectedIsArray || actualIsArray) {
    if (!expectedIsArray || !actualIsArray) {
      out.push(prefix || "(root)");
      return out;
    }
    if (expected.length !== actual.length) out.push(`${prefix}.length`);
    const max = Math.max(expected.length, actual.length);
    for (let index = 0; index < max && out.length < budget.remaining; index += 1) {
      collectDifferingPaths(expected[index], actual[index], `${prefix}[${index}]`, out, budget);
    }
    return out;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    if (out.length >= budget.remaining) break;
    collectDifferingPaths(expected[key], actual[key], prefix ? `${prefix}.${key}` : key, out, budget);
  }
  return out;
}

/**
 * 指纹验收失败时给出可读的差异摘要，避免只能看到“找到 0 份预期历史块”而无从下手。
 */
export function summarizeBlockDifferences(actualRecords, expectedRecords, { limit = 4 } = {}) {
  const actual = (actualRecords || []).map(canonicalRecordSignature);
  const expected = (expectedRecords || []).map(canonicalRecordSignature);
  const comparedRecords = Math.min(actual.length, expected.length);
  let mismatchedRecords = 0;
  const fieldCounts = new Map();
  const sampleIndexes = [];
  for (let index = 0; index < comparedRecords; index += 1) {
    if (actual[index] === expected[index]) continue;
    mismatchedRecords += 1;
    if (sampleIndexes.length < limit) sampleIndexes.push(index);
    const paths = collectDifferingPaths(
      JSON.parse(expected[index]),
      JSON.parse(actual[index]),
      "",
      [],
      { remaining: 8 },
    );
    for (const path of paths) fieldCounts.set(path, (fieldCounts.get(path) || 0) + 1);
  }
  const fields = [...fieldCounts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path))
    .slice(0, limit);
  return {
    comparedRecords,
    mismatchedRecords,
    lengthDelta: actual.length - expected.length,
    fields,
    sampleIndexes,
  };
}

export function formatBlockDifferenceSummary(summary) {
  if (!summary) return "差异摘要不可用";
  const parts = [`比较 ${summary.comparedRecords} 条，其中 ${summary.mismatchedRecords} 条不同`];
  if (summary.lengthDelta !== 0) parts.push(`长度差 ${summary.lengthDelta} 条`);
  if (summary.fields.length > 0) {
    parts.push(`字段差异：${summary.fields.map((field) => `${field.path}×${field.count}`).join("、")}`);
  }
  if (summary.sampleIndexes.length > 0) {
    parts.push(`首个不同记录位置：${summary.sampleIndexes.join("、")}`);
  }
  return parts.join("；");
}

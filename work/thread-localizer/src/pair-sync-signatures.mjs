import crypto from "node:crypto";

function canonicalValue(record) {
  const value = structuredClone(record?.value ?? record ?? null);
  if (value && typeof value === "object") {
    delete value.timestamp;
    delete value.ordinal;
    if (
      value.type === "response_item"
      && value.payload?.type === "reasoning"
      && value.payload.content === null
    ) {
      delete value.payload.content;
    }
  }
  return value;
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

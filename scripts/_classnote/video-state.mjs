import { randomUUID } from "node:crypto";
import { link, rename, unlink, writeFile } from "node:fs/promises";

/** 같은 디렉터리에 완성한 뒤 교체한다. 프로세스 중단으로 재개 기록이 반만 덮이는 것을 막는다. */
export async function writeVideoState(filePath, value, { createOnly = false } = {}) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
    if (createOnly) await link(temporary, filePath);
    else await rename(temporary, filePath);
  } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** 새 제출 링크 토큰 — 32바이트 난수(base64url 43자). 원문은 링크에만 실리고 DB엔 해시만 남는다. */
export const newSubmitToken = (): string => randomBytes(32).toString("base64url");

/** DB에 저장·조회하는 값(sha256 hex 64자). */
export const hashSubmitToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

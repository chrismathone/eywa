import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertLease, extendLease, probeFailureText, uploadAssets } from "./video-review-extract-job.mjs";
import {
  failureOutcome, frameName, frameTimes, lastFrameName, lastFrameTime, mmssTag, plannedFiles, REVIEW_EXTRACT_MAX_ATTEMPTS, reviewError,
} from "./video-review-extract-rules.mjs";
import { claimNextReview, extractNextReview } from "./video-review-extract.mjs";

// 영상 설명 AI 참고 메모 — 추출 규칙(화면 시각·이름·실패 판정)과 줄 집기. DB는 가짜.
// 이름은 서버 storage-paths.ts의 정규식과 같아야 한다(근거 위치로 쓰인다).
const NAME_RE = /^(audio\.mp3|f\d{2}_\d{2}m\d{2}s\.jpg|last_\d{2}m\d{2}s_hi\.jpg)$/;

describe("화면 시각·이름", () => {
  it("12장을 고르게 · 각 칸의 가운데", () => {
    const t = frameTimes(120);
    expect(t).toHaveLength(12);
    expect(t[0]).toBe(5);
    expect(t[11]).toBe(115);
  });
  it("짧은 영상은 초 수만큼 · 최소 5장 · 길이를 모르면 없음", () => {
    expect(frameTimes(8)).toHaveLength(8);
    expect(frameTimes(2)).toHaveLength(5);
    expect(frameTimes(0)).toEqual([]);
    expect(frameTimes(Number.NaN)).toEqual([]);
  });
  it("이름 규칙", () => {
    expect(mmssTag(65.9)).toBe("01m05s");
    expect(frameName(0, 5)).toBe("f01_00m05s.jpg");
    expect(lastFrameTime(125.3)).toBeCloseTo(124.6);
    expect(lastFrameName(124.6)).toBe("last_02m04s_hi.jpg");
    expect(lastFrameTime(0.3)).toBe(0);
  });
  it("올릴 파일 = 소리 + 화면 + 마지막 장면, 모두 서버 이름 규칙에 맞고 16개 이하", () => {
    const files = plannedFiles(83);
    expect(files[0].name).toBe("audio.mp3");
    expect(files.at(-1).size).toBe(1920);
    expect(files.length).toBe(14);
    expect(files.every((f) => NAME_RE.test(f.name))).toBe(true);
    expect(new Set(files.map((f) => f.name)).size).toBe(files.length);
  });
});

describe("실패 판정", () => {
  const now = new Date("2026-10-21T00:00:00Z");
  it("일시 오류는 5·15·60분 뒤 다시", () => {
    expect(failureOutcome(1, new Error("x"), now).availableAt.toISOString()).toBe("2026-10-21T00:05:00.000Z");
    expect(failureOutcome(2, new Error("x"), now).availableAt.toISOString()).toBe("2026-10-21T00:15:00.000Z");
    expect(failureOutcome(4, new Error("x"), now).availableAt.toISOString()).toBe("2026-10-21T01:00:00.000Z");
  });
  it("횟수를 다 쓰거나 원본이 깨졌으면 그만둔다 · 소리 없는 영상은 건너뜀", () => {
    expect(failureOutcome(REVIEW_EXTRACT_MAX_ATTEMPTS, new Error("x"), now).stage).toBe("failed");
    const broken = failureOutcome(1, reviewError("드라이브 원본 파일이 깨져 있어 열 수 없습니다.", { permanent: true }), now);
    expect(broken).toMatchObject({ stage: "failed", reason: "드라이브 원본 파일이 깨져 있어 열 수 없습니다." });
    expect(failureOutcome(1, reviewError("소리가 없는 영상", { permanent: true, skip: true }), now).stage).toBe("skipped");
  });
});

describe("줄 집기", () => {
  it("이 지점의 추출 대기만 잠그고, 없으면 일하지 않는다", async () => {
    const sql = vi.fn(async (strings) => {
      const text = strings.join("?");
      expect(text).toContain("stage = 'extract'");
      expect(text).toContain("for update skip locked");
      return [];
    });
    expect(await claimNextReview(sql, "t", "tok")).toBeNull();
    expect(await extractNextReview("t", { sql, token: () => "tok" })).toEqual({ worked: false });
  });
});

describe("잠금을 잃은 실행은 더 하지 않는다", () => {
  const row = { id: "r1", video_id: "v1" };
  const env = { CLASSNOTE_SHARE_BASE: "https://app.test", CLASSNOTE_INTERNAL_SECRET: "s" };
  async function files() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vr-"));
    const list = [{ name: "audio.mp3", contentType: "audio/mpeg" }, { name: "f01_00m01s.jpg", contentType: "image/jpeg" }];
    for (const f of list) { f.file = path.join(dir, f.name); await writeFile(f.file, "x"); }
    return list;
  }

  it("assertLease — 잃었거나 끝내는 중이면 던진다", () => {
    expect(() => assertLease({ leaseLost: true })).toThrow("잠금");
    const ac = new AbortController(); ac.abort(new Error("stop"));
    expect(() => assertLease({ leaseLost: false }, ac.signal)).toThrow("stop");
    expect(() => assertLease({ leaseLost: false })).not.toThrow();
  });

  it("extendLease — 0행이면 잃은 것", async () => {
    const track = { leaseLost: false };
    await extendLease(async () => [], "t", "r1", "tok", track);
    expect(track.leaseLost).toBe(true);
  });

  it("주소를 받기 전에 잠금을 다시 확인하고, 잃었으면 서버를 부르지 않는다", async () => {
    const fetchImpl = vi.fn();
    const track = { leaseLost: false };
    await expect(uploadAssets("t", row, "tok", await files(), { env, fetchImpl, sql: async () => [] }, track)).rejects.toThrow("잠금");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("잠금 토큰을 함께 보내고, 올리는 도중 잃으면 남은 파일을 올리지 않는다", async () => {
    const track = { leaseLost: false };
    const puts = [];
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith("/api/internal/video-review/upload")) {
        expect(JSON.parse(init.body)).toMatchObject({ reviewId: "r1", videoId: "v1", lockToken: "tok" });
        return { ok: true, status: 200, json: async () => ({ uploads: [
          { name: "audio.mp3", path: "p/audio.mp3", signedUrl: "https://s/1" },
          { name: "f01_00m01s.jpg", path: "p/f01.jpg", signedUrl: "https://s/2" }] }) };
      }
      puts.push(url);
      track.leaseLost = true; // 첫 파일을 올린 뒤 잠금을 잃었다
      return { ok: true, status: 200 };
    });
    await expect(uploadAssets("t", row, "tok", await files(), { env, fetchImpl, sql: async () => [{ id: "r1" }] }, track)).rejects.toThrow("잠금");
    expect(puts).toEqual(["https://s/1"]);
  });
});

describe("ffprobe 실패 문구 정리", () => {
  it("실행 명령 줄과 경로·잠금 토큰을 버리고 원인만 남긴다", () => {
    const msg = "Command failed: ffprobe -v error /Users/x/review-abc-123e4567/source.mp4\n/Users/x/review-abc-123e4567/source.mp4: No such file or directory";
    const out = probeFailureText(msg);
    expect(out).toBe("…: No such file or directory");
    expect(out).not.toMatch(/review-|Users/);
  });
  it("공백·한글이 든 아는 경로는 통째로 가린다", () => {
    const src = "/v/새 볼륨/학원 지점/review-a-b/source.mp4";
    const out = probeFailureText(`Command failed: ffprobe ${src}\n${src}: Invalid argument`, [src]);
    expect(out).toBe("…: Invalid argument");
  });
  it("원인 줄이 없으면 '알 수 없는 오류'", () => {
    expect(probeFailureText("Command failed: ffprobe /a/b.mp4")).toBe("알 수 없는 오류");
  });
});

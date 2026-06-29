import { describe, it, expect, afterEach } from "vitest";
import { getMediaBackend } from "./backend";

const orig = process.env.MEDIA_STORAGE_BACKEND;
afterEach(() => {
  if (orig === undefined) delete process.env.MEDIA_STORAGE_BACKEND;
  else process.env.MEDIA_STORAGE_BACKEND = orig;
});

describe("getMediaBackend — env 분기 (기본 gcs)", () => {
  it("미설정 → gcs", () => {
    delete process.env.MEDIA_STORAGE_BACKEND;
    expect(getMediaBackend()).toBe("gcs");
  });
  it('"supabase" → supabase', () => {
    process.env.MEDIA_STORAGE_BACKEND = "supabase";
    expect(getMediaBackend()).toBe("supabase");
  });
  it("잡값 → gcs(폴백)", () => {
    process.env.MEDIA_STORAGE_BACKEND = "firebase";
    expect(getMediaBackend()).toBe("gcs");
  });
});

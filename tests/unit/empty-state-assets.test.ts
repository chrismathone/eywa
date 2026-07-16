import { readdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { EMPTY_STATE_IMAGES } from "@/components/empty-state-assets";

const ASSET_ROOT = path.join(process.cwd(), "public", "empty-states");
const SAFE_EDGE_PX = 16;
const MIN_TRANSPARENT_RATIO = 0.5;
const MAX_TRANSPARENT_RATIO = 0.9;

describe("empty-state illustration assets", () => {
  it("contains only the canonical transparent PNG files", async () => {
    const actual = (await readdir(ASSET_ROOT)).filter((file) => file.endsWith(".png")).sort();
    const expected = Object.values(EMPTY_STATE_IMAGES)
      .map((assetPath) => path.basename(assetPath))
      .sort();

    expect(actual).toEqual(expected);
  });

  it.each(Object.entries(EMPTY_STATE_IMAGES))("keeps %s background-independent", async (_, assetPath) => {
    const filePath = path.join(process.cwd(), "public", ...assetPath.split("/").filter(Boolean));
    const image = sharp(filePath);
    const metadata = await image.metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(640);
    expect(metadata.hasAlpha).toBe(true);

    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const totalPixels = info.width * info.height;
    let transparentPixels = 0;
    let visiblePixels = 0;
    let magentaPixels = 0;
    let maxSafeEdgeAlpha = 0;

    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const offset = (y * info.width + x) * info.channels;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const alpha = data[offset + 3];

        if (alpha === 0) transparentPixels += 1;
        if (alpha > 16) {
          visiblePixels += 1;
          if (red > 200 && blue > 200 && green < 100 && red - green > 80 && blue - green > 80) {
            magentaPixels += 1;
          }
        }

        if (
          x < SAFE_EDGE_PX ||
          y < SAFE_EDGE_PX ||
          x >= info.width - SAFE_EDGE_PX ||
          y >= info.height - SAFE_EDGE_PX
        ) {
          maxSafeEdgeAlpha = Math.max(maxSafeEdgeAlpha, alpha);
        }
      }
    }

    const transparentRatio = transparentPixels / totalPixels;
    expect(transparentRatio).toBeGreaterThanOrEqual(MIN_TRANSPARENT_RATIO);
    expect(transparentRatio).toBeLessThanOrEqual(MAX_TRANSPARENT_RATIO);
    expect(visiblePixels).toBeGreaterThan(0);
    expect(maxSafeEdgeAlpha).toBe(0);
    expect(magentaPixels).toBe(0);
  });
});

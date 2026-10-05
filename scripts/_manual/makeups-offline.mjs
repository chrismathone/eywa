/** Text-only supplement. No demoSession, environment files, or production connection. */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { documentHtml, faceBlocks, toPdf } from "./render.mjs";

const output = process.argv[2];
const executablePath = process.argv[3];
if (!output || !executablePath) throw new Error("Output directory and local Chrome executable required");
fs.mkdirSync(output, { recursive: true });
const page = JSON.parse(fs.readFileSync("docs/manual/pages/makeups/overview.json", "utf8"));
page.setup = page.steps;
const blocks = faceBlocks({ crumb: "수업 / 보강관리", title: "보강관리", page,
  stamp: "2026-10-05 · 수학 시범 운영", offNote: page.noShotNote });
const html = documentHtml([{ id: "makeups", foot: "에이와 · 보강관리 사용 안내", blocks, newPage: true }]);
const browser = await chromium.launch({ executablePath });
try {
  const result = await toPdf(browser, html, path.join(output, "AYWA_보강관리_사용안내_2026-10-05.pdf"),
    { maxPages: 3, htmlFile: path.join(output, "makeups-manual.html") });
  fs.writeFileSync(path.join(output, "makeups-manual-layout.json"), JSON.stringify(result, null, 2));
  if (!result.ok) throw new Error(result.bad.join("\n"));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }

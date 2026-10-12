/**
 * Real-browser scroll regression, without a server or login:
 *   node tests/browser/shell-scroll.mjs
 * Uses production shell classes and styles with long tables/forms. A DOM-only
 * test cannot detect absolute sr-only content increasing the document height.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
const tailwind = require("@tailwindcss/postcss");
const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const shell = read("src/app/(shell)/layout.tsx");
const mainClasses = [...shell.matchAll(/<main\b[^>]*className="([^"]+)"/g)].map((m) => m[1]);
const compact = mainClasses.find((classes) => classes.includes("compact-main"));
const admin = mainClasses.find((classes) => !classes.includes("compact-main"));
const embed = /: "(embed-main[^"]+)"/.exec(shell)?.[1];
const keepalive = /KEEPALIVE_MAIN_CLASS\s*=\s*"([^"]+)"/.exec(read("src/components/workspace/keepalive-frame.ts"))?.[1];
const platform = /<main className="([^"]+)"/.exec(read("src/app/(super-admin)/layout.tsx"))?.[1];
const cssPath = resolve(root, "src/app/globals.css");
const { css } = await postcss([tailwind({ base: root })]).process(read(cssPath), { from: cssPath });
const ledgerCss = read("src/features/video-homework/components/video-homework-management.module.css");

const header = '<header class="h-12 shrink-0">메뉴</header>';
const shells = [
  { name: "teacher", classes: compact, before: header + '<div class="shrink-0">컴퓨터 알림을 켜 주세요.</div>' },
  { name: "student", classes: compact, before: header },
  { name: "embed", classes: embed },
  { name: "keepalive", classes: keepalive },
  { name: "admin", classes: admin, before: header },
  { name: "platform", classes: platform, before: header },
];
for (const { name, classes } of shells) assert.ok(classes, `Missing ${name} main in production source`);

function ledger(groups, students) {
  const rows = Array.from({ length: students }, (_, i) => `<tr><th>학생 ${i + 1}</th><td>중2</td><td>1 / 2</td><td>완료</td></tr>`).join("");
  return Array.from({ length: groups }, (_, i) => `<section class="group">
    <button class="groupHeading">수학 ${i + 1}반</button>
    <div class="tableScroll" tabindex="0"><table class="table" style="width:560px">
      <caption class="sr-only">학생별 영상 과제 장부</caption>
      <thead><tr><th>학생</th><th>학교 · 학년</th><th>완료</th><th>1회</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div><div class="groupFooter">학생 목록</div>
  </section>`).join("");
}

const fixtures = [
  { name: "video-ledger", html: ledger(8, 5) },
  { name: "scrollable-table", html: ledger(3, 25), tableScroll: true },
  { name: "long-form", html: Array.from({ length: 12 }, (_, i) => `<section style="height:180px"><label>항목 ${i + 1}<input class="sr-only" type="file"></label></section>`).join("") },
];

function html(config, content) {
  return `<html class="h-full"><head><style>${css}\n${ledgerCss}</style></head>
    <body class="min-h-full"><div class="flex h-screen flex-col${config.name === "keepalive" ? "" : " overflow-hidden"}">
    ${config.before ?? ""}<main tabindex="0" class="${config.classes}">${content}<button id="last-action">마지막 작업</button></main>
    </div></body></html>`;
}

async function dimensions(page) {
  return page.evaluate(() => {
    const doc = document.scrollingElement;
    const main = document.querySelector("main");
    return {
      rootHeight: doc.scrollHeight, viewportHeight: doc.clientHeight,
      rootWidth: doc.scrollWidth, viewportWidth: doc.clientWidth,
      rootTop: doc.scrollTop, mainHeight: main.scrollHeight,
      mainViewport: main.clientHeight, mainTop: main.scrollTop,
      headerTop: document.querySelector("header")?.getBoundingClientRect().top ?? 0,
    };
  });
}

function checkRoot(metrics, context) {
  assert.equal(metrics.rootHeight, metrics.viewportHeight, `${context}: extra document vertical scroll`);
  assert.equal(metrics.rootWidth, metrics.viewportWidth, `${context}: extra document horizontal scroll`);
  assert.equal(metrics.rootTop, 0, `${context}: document moved`);
  assert.equal(metrics.headerTop, 0, `${context}: header moved`);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let checked = 0;
  for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    // Negative controls prove the fixture detects the reported bug, not just a hidden scrollbar.
    for (const name of ["teacher", "embed"]) {
      const config = shells.find((item) => item.name === name);
      await page.setContent(html({ ...config, classes: config.classes.replace(/\brelative\b/g, "") }, fixtures[0].html));
      const metrics = await dimensions(page);
      assert.ok(metrics.rootHeight > metrics.viewportHeight, `${name}: baseline should reproduce the extra scrollbar`);
    }
    for (const config of shells) {
      for (const fixture of fixtures) {
        const context = `${config.name}/${fixture.name}/${viewport.width}`;
        await page.setContent(html(config, fixture.html));
        const initial = await dimensions(page);
        checkRoot(initial, context);
        assert.ok(initial.mainHeight > initial.mainViewport, `${context}: main must still scroll`);
        if (fixture.tableScroll) {
          const table = await page.locator(".tableScroll").first().evaluate((el) => {
            el.scrollTop = 100;
            el.scrollLeft = 100;
            return { top: el.scrollTop, left: el.scrollLeft, wide: el.scrollWidth > el.clientWidth };
          });
          assert.ok(table.top > 0, `${context}: long table must still scroll`);
          if (viewport.width < 560) assert.ok(table.wide && table.left > 0, `${context}: narrow table must scroll horizontally`);
        }
        // Keyboard focus must reach the bottom through main, without moving the shell.
        await page.locator("#last-action").focus();
        const focused = await dimensions(page);
        checkRoot(focused, context);
        assert.ok(focused.mainTop > 0, `${context}: final action must be reachable`);
        await page.locator("#last-action").hover();
        await page.mouse.wheel(0, 1200);
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        // A CSS overflow:hidden patch can hide the scrollbar but still allow this movement.
        await page.evaluate(() => window.scrollTo(0, 200));
        checkRoot(await dimensions(page), context);
        checked++;
      }
    }
  }
  console.log(`PASS: ${checked} shell/content/viewport cases; 6 negative controls reproduced the bug.`);
} finally {
  await browser.close();
}

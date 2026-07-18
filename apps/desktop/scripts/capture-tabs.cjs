// Headless capture harness: load the StudyNote dev page, snapshot the topbar,
// and dump DOM + computed styles for every .page-tabs button so we have
// evidence before/after any CSS change.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const URL = "http://127.0.0.1:1420/";
const OUT_DIR = path.resolve("D:/openclaw/learn-alone/plan/slice-07-self-test/captures");

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  page.on("console", (msg) => console.log(`[console:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));

  console.log(`navigating to ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".page-tabs", { timeout: 8000 });

  const topbar = await page.locator(".topbar").first();
  await topbar.screenshot({ path: path.join(OUT_DIR, "topbar-initial.png") });

  const probe = await page.evaluate(() => {
    const root = document.querySelector(".page-tabs");
    if (!root) return { error: "no .page-tabs" };
    const buttons = Array.from(root.querySelectorAll("button"));
    return {
      rootBox: root.getBoundingClientRect(),
      rootStyles: {
        display: getComputedStyle(root).display,
        gap: getComputedStyle(root).gap,
        alignItems: getComputedStyle(root).alignItems,
        flexWrap: getComputedStyle(root).flexWrap,
        overflow: getComputedStyle(root).overflow,
        width: getComputedStyle(root).width,
        height: getComputedStyle(root).height
      },
      buttons: buttons.map((btn) => {
        const rect = btn.getBoundingClientRect();
        const labels = btn.querySelector(".page-tab-labels");
        const small = btn.querySelector(".page-tab-labels small");
        return {
          text: btn.innerText.replace(/\s+/g, " ").trim(),
          disabled: btn.disabled,
          classes: btn.className,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          styles: {
            display: getComputedStyle(btn).display,
            minWidth: getComputedStyle(btn).minWidth,
            flex: getComputedStyle(btn).flex,
            padding: getComputedStyle(btn).padding,
            overflow: getComputedStyle(btn).overflow
          },
          labelsBox: labels ? labels.getBoundingClientRect() : null,
          labelsStyles: labels
            ? {
                display: getComputedStyle(labels).display,
                minWidth: getComputedStyle(labels).minWidth,
                maxWidth: getComputedStyle(labels).maxWidth,
                overflow: getComputedStyle(labels).overflow
              }
            : null,
          smallBox: small ? small.getBoundingClientRect() : null,
          smallText: small ? small.innerText : null
        };
      })
    };
  });

  fs.writeFileSync(
    path.join(OUT_DIR, "probe-before.json"),
    JSON.stringify(probe, null, 2)
  );
  console.log("wrote probe-before.json + topbar-initial.png");

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

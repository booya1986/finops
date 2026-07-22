import puppeteer from "puppeteer";
import { mkdirSync } from "node:fs";

const base = process.env.FINOPS_DASH_URL ?? "http://127.0.0.1:3737";
const out =
  process.env.FINOPS_DASH_SCREENSHOTS ?? "/tmp/finops-dashboard-verify";
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.goto(base, { waitUntil: "networkidle0" });
await page.evaluate(
  (path) =>
    fetch("/api/summary")
      .then((response) => {
        if (!response.ok) throw new Error(`summary ${response.status}`);
        return response.json();
      })
      .then((data) => ({ path, month: data.month })),
  out,
);

const tabs = [
  "תמונה פיננסית",
  "חשבונות וכרטיסים",
  "הוצאות",
  "יעדים והתחייבויות",
  "ניהול",
];
const results = [];
for (let index = 0; index < tabs.length; index += 1) {
  const label = tabs[index];
  await page.evaluate((text) => {
    const button = [...document.querySelectorAll("nav button")].find((node) =>
      node.textContent?.includes(text),
    );
    if (!(button instanceof HTMLElement))
      throw new Error(`tab not found: ${text}`);
    button.click();
  }, label);
  await new Promise((resolve) => setTimeout(resolve, 650));
  const state = await page.evaluate(() => ({
    title: document.querySelector("main h1")?.textContent ?? "",
    titleAlign: document.querySelector("main h1")
      ? getComputedStyle(document.querySelector("main h1")).textAlign
      : "",
    tableAlign: document.querySelector('[data-slot="table-head"]')
      ? getComputedStyle(document.querySelector('[data-slot="table-head"]'))
          .textAlign
      : null,
    legendItems: document.querySelectorAll(
      '[data-testid="chart-legend"] > span',
    ).length,
    categoryRows: document.querySelectorAll(
      '[data-testid="category-breakdown"] button',
    ).length,
    merchantRows: document.querySelectorAll(
      '[data-testid="merchant-summary"] [data-slot="table-body"] [data-slot="table-row"]',
    ).length,
    transferRows: document.querySelectorAll(
      '[data-testid="transfer-breakdown"] > div > div',
    ).length,
    transferPanel: Boolean(
      document.querySelector('[data-testid="transfer-breakdown"]'),
    ),
    recurringPanels: document.querySelectorAll(
      '[data-testid="recurring-panel"]',
    ).length,
    overflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    buttons: document.querySelectorAll("main button").length,
  }));
  await page.screenshot({
    path: `${out}/desktop-${index + 1}.png`,
    fullPage: true,
  });
  results.push({ label, ...state });
}

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.goto(base, { waitUntil: "networkidle0" });
await new Promise((resolve) => setTimeout(resolve, 500));
const mobile = await page.evaluate(() => ({
  title: document.querySelector("main h1")?.textContent ?? "",
  overflow:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  menu: Boolean(
    [...document.querySelectorAll("button")].find(
      (node) => node.getAttribute("aria-label") === "פתיחת ניווט",
    ),
  ),
}));
await page.evaluate(() => {
  const menu = [...document.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === "פתיחת ניווט",
  );
  if (!(menu instanceof HTMLElement)) throw new Error("mobile menu not found");
  menu.click();
});
await new Promise((resolve) => setTimeout(resolve, 250));
await page.evaluate(() => {
  const sheet = document.querySelector('[data-slot="sheet-content"]');
  const spending =
    sheet &&
    [...sheet.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("הוצאות"),
    );
  if (!(spending instanceof HTMLElement))
    throw new Error("mobile spending tab not found");
  spending.click();
});
await new Promise((resolve) => setTimeout(resolve, 650));
Object.assign(
  mobile,
  await page.evaluate(() => ({
    spendingTitle: document.querySelector("main h1")?.textContent ?? "",
    menuClosed: !document.querySelector('[data-slot="sheet-content"]'),
    spendingRows: document.querySelectorAll(
      '[data-testid="category-breakdown"] button',
    ).length,
  })),
);
await page.screenshot({ path: `${out}/mobile-overview.png`, fullPage: true });

await browser.close();

const overview = results.find((item) => item.label === "תמונה פיננסית");
const accounts = results.find((item) => item.label === "חשבונות וכרטיסים");
const spending = results.find((item) => item.label === "הוצאות");
const commitments = results.find((item) => item.label === "יעדים והתחייבויות");
const invariantErrors = [
  ...(results.some((item) => item.overflow !== 0)
    ? ["desktop horizontal overflow"]
    : []),
  ...(overview?.legendItems !== 3 ? ["cashflow legend missing"] : []),
  ...(!accounts?.transferPanel ? ["transfer breakdown missing"] : []),
  ...(!spending?.categoryRows ? ["category breakdown empty"] : []),
  ...(!spending?.merchantRows ? ["merchant table empty"] : []),
  ...(commitments?.recurringPanels !== 2 ? ["recurring panels missing"] : []),
  ...(!mobile.menuClosed ? ["mobile menu did not close"] : []),
  ...(mobile.overflow !== 0 ? ["mobile horizontal overflow"] : []),
  ...errors,
];

console.log(
  JSON.stringify({ results, mobile, errors, invariantErrors }, null, 2),
);
if (invariantErrors.length) process.exitCode = 1;

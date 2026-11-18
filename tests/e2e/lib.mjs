// Shared helpers for browser tests: local static server + Edge/Chrome with a
// fake camera that plays a .y4m file (Chromium's --use-file-for-fake-video-capture).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function startServer({ port = 8123, prefix = "" } = {}) {
  const args = ["run", "scripts/serve.py", String(port), "."];
  if (prefix) args.push("--prefix", prefix);
  const proc = spawn("uv", args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const notFound = [];
  proc.stderr.on("data", (d) => {
    for (const line of String(d).split("\n"))
      if (line.startsWith("404")) notFound.push(line.trim());
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("server did not start")),
      30000,
    );
    proc.stdout.on("data", (d) => {
      if (String(d).includes("serving")) {
        clearTimeout(timer);
        resolve({
          url: `http://127.0.0.1:${port}${prefix ? "/" + prefix.replace(/^\/|\/$/g, "") : ""}/`,
          notFound,
          // "uv run" starts python as a child; on Windows kill the whole tree.
          stop: () =>
            process.platform === "win32"
              ? spawnSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
                  stdio: "ignore",
                })
              : proc.kill(),
        });
      }
    });
    proc.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
}

function browserChannel() {
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  if (process.env.E2E_CHANNEL) return process.env.E2E_CHANNEL;
  return existsSync(edge) ? "msedge" : "chrome";
}

export async function launch({ y4m, headless = true } = {}) {
  const args = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ];
  if (y4m) args.push(`--use-file-for-fake-video-capture=${y4m}`);
  const browser = await chromium.launch({
    channel: browserChannel(),
    headless,
    args,
  });
  return browser;
}

export async function newPage(
  browser,
  { width = 1280, height = 800, origin } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height },
    acceptDownloads: true,
  });
  if (origin) await context.grantPermissions(["camera"], { origin });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  return { context, page, consoleErrors };
}

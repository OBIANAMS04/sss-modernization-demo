// Minimal headless-Chrome driver over the DevTools protocol, for evidence screenshots and
// UI checks. No dependencies: Node 22+ provides fetch and WebSocket.
//
// Set CHROME_PATH if Chrome is not in the default Windows location.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launch({ width = 1280, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'sss-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let target;
  for (let i = 0; i < 75 && !target; i++) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('Chrome did not start (is CHROME_PATH right?)');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let nextId = 0;
  const pending = new Map();
  const waiters = new Set();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const w of waiters) if (w.method === msg.method) w.resolve(msg.params);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const nextEvent = (method) => {
    const w = { method };
    const promise = new Promise((resolve) => (w.resolve = resolve)).finally(() => waiters.delete(w));
    waiters.add(w);
    return promise;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  const viewport = (h) => send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile: false });
  await viewport(height);

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  const page = {
    send,
    evaluate,

    async goto(url) {
      const loaded = nextEvent('Page.loadEventFired');
      await send('Page.navigate', { url });
      await loaded;
    },

    /** Stores a session ({ token, user } from /auth/login) the way the app's login does. */
    async signIn(site, session) {
      await page.goto(`${site}/login`);
      await evaluate(
        `localStorage.setItem('auth_token', ${JSON.stringify(session.token)});
         localStorage.setItem('user_data', ${JSON.stringify(JSON.stringify(session.user))}); true`
      );
    },

    async waitForText(text, timeout = 15000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await evaluate(`!!document.body && document.body.innerText.includes(${JSON.stringify(text)})`)) {
          await sleep(250); // let the rest of the render settle
          return;
        }
        await sleep(150);
      }
      throw new Error(`Timed out waiting for "${text}" on ${await evaluate('location.href')}`);
    },

    hasText: (text) => evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`),

    /** Clicks the first button, link or summary whose visible text is exactly `label`. */
    async click(label, selector = 'button, a, summary') {
      const found = await evaluate(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.innerText.trim() === ${JSON.stringify(label)});
        if (!el) return 'missing';
        if (el.disabled) return 'disabled';
        el.click();
        return 'clicked';
      })()`);
      if (found !== 'clicked') throw new Error(`"${label}" is ${found}`);
    },

    /** Types into a field with real input events, so React sees the change. */
    async type(selector, text) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await send('Input.insertText', { text });
    },

    async select(selector, value) {
      await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    },

    /** Saves a PNG of the whole page (not just the viewport). */
    async screenshot(file) {
      const { cssContentSize } = await send('Page.getLayoutMetrics');
      await viewport(Math.max(height, Math.ceil(cssContentSize.height)));
      await sleep(200);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await viewport(height);
      writeFileSync(file, Buffer.from(data, 'base64'));
    },

    async pdf(file) {
      const { data } = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
      writeFileSync(file, Buffer.from(data, 'base64'));
    },

    async close() {
      ws.close();
      chrome.kill();
      await sleep(500);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {} // Chrome can hold the profile briefly on Windows; it lives in the temp folder
    },
  };
  return page;
}

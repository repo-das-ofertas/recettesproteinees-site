import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const PIXEL = '1874896807167169';
const SCRIPT = 'https://painel.labofertas.com/api/lp/script?k=32718227c9bc42596f45178a0cd614fd';
const SID = '11111111-1111-4111-8111-111111111111';

const LAB_STUB = String.raw`(function (w, d) {
'use strict';
if (w.__labVisita) return;
w.__labVisita = 1;
var sid = '${SID}';
var PREFIXO = 'lv_';
var decorar = function (a) {
  var k = /hotmart\./i.test(a.hostname) ? 'xcod' : 'lab';
  var href = a.href, hash = '', i = href.indexOf('#'), base, partes, j, nome, fica = [];
  if (i >= 0) { hash = href.slice(i); href = href.slice(0, i); }
  i = href.indexOf('?');
  base = i >= 0 ? href.slice(0, i) : href;
  partes = i >= 0 && href.slice(i + 1) ? href.slice(i + 1).split('&') : [];
  for (j = 0; j < partes.length; j++) {
    nome = partes[j].split('=')[0];
    if (nome === k) {
      if (partes[j].indexOf('=' + PREFIXO) < 0) return;
      continue;
    }
    fica.push(partes[j]);
  }
  fica.unshift(k + '=' + PREFIXO + sid);
  var done = base + '?' + fica.join('&') + hash;
  if (done !== a.href) a.href = done;
};
var toque = function (ev) {
  var a = ev.target;
  while (a && a.nodeName !== 'A') a = a.parentNode;
  if (!a || !a.href || String(a.protocol).indexOf('http') !== 0) return;
  if (a.hostname === location.hostname) return;
  if (!/hotmart\./i.test(a.hostname)) return;
  decorar(a);
};
d.addEventListener('click', toque, true);
d.addEventListener('mousedown', toque, true);
d.addEventListener('auxclick', toque, true);
d.addEventListener('contextmenu', toque, true);
d.addEventListener('touchstart', toque, { capture: true, passive: true });
})(window, document);
`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startSite() {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.woff': 'font/woff',
    '.txt': 'text/plain'
  };
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const rel = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function waitForJson(port) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const list = await response.json();
        const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Chrome DevTools did not open: ' + last);
}

test('local page sends one PageView and preserves checkout attribution', { timeout: 90000 }, async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-track-'));
  const debugPort = await freePort();
  const site = await startSite();
  const sitePort = site.address().port;
  const external = [];
  let chrome;
  let ws;
  const pending = new Map();
  let seq = 0;

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('timeout ' + method));
    }, 20000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

  try {
    chrome = spawn('/usr/bin/google-chrome', [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--remote-debugging-port=${debugPort}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${userData}`,
      '--no-first-run',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-client-side-phishing-detection',
      '--metrics-recording-only',
      '--mute-audio',
      '--disable-breakpad',
      '--disable-features=Translate,BackForwardCache',
      '--host-resolver-rules=MAP connect.facebook.net 127.0.0.1, MAP www.facebook.com 127.0.0.1, MAP facebook.com 127.0.0.1, MAP www.facebook.net 127.0.0.1, MAP painel.labofertas.com 127.0.0.1',
      'about:blank'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    chrome.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    const page = await waitForJson(debugPort);
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
        return;
      }
      if (message.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = message.params;
      const url = request.url;
      let host = '';
      try { host = new URL(url).hostname; } catch { host = ''; }
      if (host === '127.0.0.1' || host === 'localhost') {
        send('Fetch.continueRequest', { requestId }).catch(() => {});
        return;
      }
      external.push(url);
      const body = url.includes('fbevents.js') ? '\n' : (url.startsWith('https://painel.labofertas.com/api/lp/script') ? LAB_STUB : '\n');
      send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }],
        body: Buffer.from(body).toString('base64')
      }).catch(() => {});
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    const query = new URLSearchParams({
      utm_source: 'qa',
      utm_medium: 'cpc',
      utm_campaign: 'proteicas-fr',
      utm_content: 'primaire',
      utm_term: 'proteine',
      fbclid: 'IwAR_qa_fbclid',
      off: 'hacked',
      checkoutMode: '99',
      email: 'qa@example.com',
      xcod: 'evil',
      lab_teste: '1',
      sck: 'nope'
    });
    await send('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?${query}` });

    const ready = async () => {
      const started = Date.now();
      let lastError = '';
      while (Date.now() - started < 20000) {
        try {
          const state = await evaluate(send, `({
            flag: window.__lpMetaPageView || '',
            lab: window.__labVisita || 0,
            href: (document.querySelector('[data-cta="hero"]') || {}).href || ''
          })`);
          if (state && state.flag === PIXEL && state.lab === 1 && state.href.includes('pay.hotmart.com')) return;
        } catch (error) {
          lastError = error.message;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('page did not initialize tracking\n' + lastError + '\n' + stderr.slice(-1500));
    };
    await ready();

    const before = await evaluate(send, `(() => {
      const queued = window.fbq.queue.map((args) => Array.from(args));
      window.fbq.callMethod = function () { (window.__sent = window.__sent || []).push(Array.from(arguments)); };
      window.fbq.queue = [];
      const snippet = [...document.scripts].map((s) => s.textContent).find((text) => text.includes('__lpMetaPageView'));
      window.eval(snippet);
      window.eval(snippet);
      const links = [...document.querySelectorAll('[data-checkout="front"]')].map((a) => ({ cta: a.getAttribute('data-cta'), href: a.href }));
      return {
        queued,
        sent: window.__sent || [],
        flag: window.__lpMetaPageView,
        fbevents: document.querySelectorAll('script[src*="fbevents.js"]').length,
        labTags: document.querySelectorAll('script[data-lp-labofertas]').length,
        labSrc: (document.querySelector('script[data-lp-labofertas]') || {}).src || '',
        links,
        noteHidden: document.querySelector('[data-pixel-note]').hidden,
        price: document.querySelector('.preco').textContent,
        guarantee: document.querySelector('.garantie').textContent,
        app: document.querySelector('[data-app-link]').href,
        htmlHasTr: document.documentElement.outerHTML.includes('facebook.com/tr')
      };
    })()`);

    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const blockStart = indexHtml.indexOf('if(c.labofertasScript &&');
    const block = extractBalanced(indexHtml, blockStart);
    await evaluate(send, `(() => { var c = window.SITE_CONFIG;\n${block}\n${block}\nreturn document.querySelectorAll('script[data-lp-labofertas]').length; })()`);

    const afterRepeat = await evaluate(send, `document.querySelectorAll('script[data-lp-labofertas]').length`);
    assert.equal(afterRepeat, 1);

    const clicked = await evaluate(send, `(() => {
      document.addEventListener('click', (ev) => {
        let node = ev.target;
        while (node && node.nodeName !== 'A') node = node.parentNode;
        if (node && node.getAttribute('data-checkout') === 'front') ev.preventDefault();
      }, true);
      const bar = document.querySelector('.barra-compra');
      bar.hidden = false;
      bar.classList.add('on');
      bar.removeAttribute('inert');
      bar.setAttribute('aria-hidden', 'false');
      const sticky = bar.querySelector('a');
      sticky.hidden = false;
      sticky.tabIndex = 0;
      for (const name of ['hero', 'offre', 'sticky', 'sticky']) {
        document.querySelector('[data-cta="' + name + '"]').click();
      }
      return {
        host: location.hostname,
        links: [...document.querySelectorAll('[data-checkout="front"]')].map((a) => ({ cta: a.getAttribute('data-cta'), href: a.href }))
      };
    })()`);

    assert.deepEqual(before.queued, [['init', PIXEL], ['track', 'PageView']]);
    assert.deepEqual(before.sent, []);
    assert.equal(before.flag, PIXEL);
    assert.equal(before.fbevents, 1);
    assert.equal(before.labTags, 1);
    assert.equal(before.labSrc, SCRIPT);
    assert.equal(before.noteHidden, false);
    assert.equal(before.htmlHasTr, false);
    assert.equal(before.price.includes('14,90'), true);
    assert.equal(before.guarantee.includes('30 jours'), true);
    assert.equal(before.app, 'https://repo-das-ofertas.github.io/recettesproteinees-app/');
    assert.deepEqual(before.links.map((link) => link.cta), ['hero', 'offre', 'sticky']);
    for (const link of before.links) assertCheckout(link.href, { xcod: null });

    assert.equal(clicked.host, '127.0.0.1');
    assert.deepEqual(clicked.links.map((link) => link.cta), ['hero', 'offre', 'sticky']);
    for (const link of clicked.links) assertCheckout(link.href, { xcod: `lv_${SID}` });

    const fbevents = external.filter((url) => url.includes('fbevents.js'));
    const lab = external.filter((url) => url.startsWith('https://painel.labofertas.com/api/lp/script'));
    const leaked = external.filter((url) => !url.includes('fbevents.js') && !url.startsWith('https://painel.labofertas.com/api/lp/script'));
    assert.equal(fbevents.length, 1);
    assert.equal(fbevents[0], 'https://connect.facebook.net/en_US/fbevents.js');
    assert.equal(lab.length, 1);
    assert.equal(lab[0], SCRIPT);
    assert.deepEqual(leaked, []);
    assert.equal(external.some((url) => url.includes('facebook.com/tr') || url.includes('/api/lp/evento') || url.includes('Purchase') || url.includes('InitiateCheckout')), false);

    console.log(JSON.stringify({
      kind: 'local-intercepted-browser',
      metaReceipt: false,
      capi: false,
      pageViewQueued: before.queued,
      pageViewAfterSecondInit: before.sent,
      fbeventsRequests: fbevents.length,
      labScriptRequests: lab.length,
      otherExternalRequests: leaked,
      ctasBeforeScriptXcod: before.links,
      ctasAfterScriptXcod: clicked.links
    }));
  } finally {
    if (ws) ws.close();
    if (chrome) chrome.kill('SIGKILL');
    await new Promise((resolve) => site.close(resolve));
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

function extractBalanced(source, start) {
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced block');
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

function assertCheckout(href, expected) {
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, 'https://pay.hotmart.com/C108373300X');
  assert.equal(url.searchParams.get('off'), '5p3g52zw');
  assert.equal(url.searchParams.get('checkoutMode'), '10');
  assert.equal(url.searchParams.get('utm_source'), 'qa');
  assert.equal(url.searchParams.get('utm_medium'), 'cpc');
  assert.equal(url.searchParams.get('utm_campaign'), 'proteicas-fr');
  assert.equal(url.searchParams.get('utm_content'), 'primaire');
  assert.equal(url.searchParams.get('utm_term'), 'proteine');
  assert.equal(url.searchParams.get('fbclid'), 'IwAR_qa_fbclid');
  assert.equal(url.searchParams.get('xcod'), expected.xcod);
  for (const blocked of ['email', 'lab_teste', 'sck', 'off']) {
    if (blocked === 'off') continue;
    assert.equal(url.searchParams.has(blocked), false, blocked);
  }
  assert.equal(href.includes('hacked'), false);
  assert.equal(href.includes('checkoutMode=99'), false);
  assert.equal(href.includes('qa@example.com'), false);
  assert.equal(href.includes('xcod=evil'), false);
  assert.equal((href.match(/[?&]xcod=/g) || []).length, expected.xcod ? 1 : 0);
  assert.equal((href.match(/[?&]off=/g) || []).length, 1);
  assert.equal((href.match(/[?&]checkoutMode=/g) || []).length, 1);
}

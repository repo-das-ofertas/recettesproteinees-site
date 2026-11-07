import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const PIXEL = '1874896807167169';
const SCRIPT = 'https://painel.labofertas.com/api/lp/script?k=32718227c9bc42596f45178a0cd614fd';
const CHECKOUT = 'https://pay.hotmart.com/C108373300X?off=5p3g52zw&checkoutMode=10';

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'site-config.js'), 'utf8');

function loadConfig() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(configSource, sandbox);
  return sandbox.window.SITE_CONFIG;
}

function extractBalanced(source, needle) {
  const start = source.indexOf(needle);
  assert.notEqual(start, -1, needle);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced ' + needle);
}

function inlineScript(html, includes) {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html))) {
    if (match[1].includes(includes)) return match[1];
  }
  throw new Error('missing inline script ' + includes);
}

function runPixel(config, times) {
  const created = [];
  const document = {
    createElement() {
      const el = {};
      created.push(el);
      return el;
    },
    getElementsByTagName() {
      return [{ parentNode: { insertBefore() {} } }];
    }
  };
  const sandbox = { document };
  sandbox.window = sandbox;
  sandbox.SITE_CONFIG = config;
  vm.createContext(sandbox);
  vm.runInContext(inlineScript(indexHtml, '__lpMetaPageView').repeat(times), sandbox);
  const queue = sandbox.fbq ? Array.from(sandbox.fbq.queue, (args) => Array.from(args)) : [];
  return { created, queue, flag: sandbox.__lpMetaPageView };
}

function checkoutHref(search) {
  const pick = extractBalanced(indexHtml, 'function pickTrackingParams()');
  const build = extractBalanced(indexHtml, 'function buildCheckoutHref(');
  const sandbox = { URL, URLSearchParams, location: { search }, result: '' };
  vm.createContext(sandbox);
  vm.runInContext(`${pick}\n${build}\nresult = buildCheckoutHref(${JSON.stringify(CHECKOUT)});`, sandbox);
  return sandbox.result;
}

test('public config enables only the given pixel and LabOfertas script', () => {
  const cfg = loadConfig();
  assert.deepEqual(Object.keys(cfg), [
    'checkoutUrl',
    'pixelId',
    'labofertasScript',
    'appUrl',
    'merciUrl',
    'showIncompleteFaq',
    'production'
  ]);
  assert.equal(cfg.pixelId, PIXEL);
  assert.equal(cfg.labofertasScript, SCRIPT);
  assert.equal(cfg.checkoutUrl, CHECKOUT);
  assert.equal(cfg.appUrl, 'https://repo-das-ofertas.github.io/recettesproteinees-app/');
  assert.equal(cfg.merciUrl, 'merci/');
  assert.equal(cfg.showIncompleteFaq, false);
  assert.equal(cfg.production, true);
  assert.throws(() => {
    cfg.pixelId = 'other';
  });
  const scriptUrl = new URL(cfg.labofertasScript);
  assert.equal(scriptUrl.origin, 'https://painel.labofertas.com');
  assert.equal(scriptUrl.pathname, '/api/lp/script');
  assert.deepEqual([...scriptUrl.searchParams.keys()], ['k']);
});

test('pixel id and script URL stay in site-config only', () => {
  const product = ['index.html', 'merci/index.html', 'cgv/index.html', 'confidentialite/index.html', '404.html', 'typographie.js'];
  for (const rel of product) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.equal(text.includes(PIXEL), false, rel);
    assert.equal(text.includes('painel.labofertas.com'), false, rel);
    assert.equal(text.includes('fbevents.js'), rel === 'index.html', rel);
  }
});

test('product files carry no CAPI token, Purchase or InitiateCheckout', () => {
  const files = ['index.html', 'site-config.js', 'merci/index.html', 'cgv/index.html', 'confidentialite/index.html', '404.html', 'typographie.js'];
  const forbidden = [
    /access_token/i,
    /client_secret/i,
    /graph\.facebook\.com/,
    /\bEAA[A-Za-z0-9]{10,}/,
    /Bearer\s+[A-Za-z0-9._-]{8,}/,
    /Purchase/,
    /InitiateCheckout/,
    /fbq\(\s*'trackCustom'/
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const pattern of forbidden) assert.equal(pattern.test(text), false, `${rel} ${pattern}`);
  }
  const events = [...indexHtml.matchAll(/fbq\(\s*'track'\s*,\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(events, ['PageView']);
  assert.equal(indexHtml.match(/fbq\(\s*'init'/g).length, 1);
  assert.equal(indexHtml.match(/createElement\('script'\)/g).length, 1);
  assert.equal(indexHtml.includes('if(f.fbq)return'), true);
  assert.equal(indexHtml.includes('https://connect.facebook.net/en_US/fbevents.js'), true);
});

test('PageView initializer is idempotent and stays idle without a pixel', () => {
  const once = runPixel(loadConfig(), 1);
  assert.deepEqual(once.queue, [['init', PIXEL], ['track', 'PageView']]);
  assert.equal(once.created.length, 1);
  assert.equal(once.created[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
  assert.equal(once.flag, PIXEL);

  const twice = runPixel(loadConfig(), 2);
  assert.deepEqual(twice.queue, [['init', PIXEL], ['track', 'PageView']]);
  assert.equal(twice.created.length, 1);

  const sent = [];
  flushedQueueDrain(indexHtml, sent);
  assert.deepEqual(sent, []);

  for (const pixelId of ['', 'PENDENTE', 'pixel-PENDENTE-1']) {
    const idle = runPixel({ pixelId }, 2);
    assert.deepEqual(idle.queue, []);
    assert.equal(idle.created.length, 0);
    assert.equal(idle.flag, undefined);
  }
});

function flushedQueueDrain(html, sent) {
  const created = [];
  const document = {
    createElement() {
      created.push({});
      return {};
    },
    getElementsByTagName() {
      return [{ parentNode: { insertBefore() {} } }];
    }
  };
  const sandbox = { document };
  sandbox.window = sandbox;
  sandbox.SITE_CONFIG = loadConfig();
  vm.createContext(sandbox);
  const snippet = inlineScript(html, '__lpMetaPageView');
  vm.runInContext(snippet, sandbox);
  sandbox.fbq.callMethod = function callMethod() {
    sent.push(Array.from(arguments));
  };
  sandbox.fbq.queue.length = 0;
  vm.runInContext(snippet, sandbox);
}

test('LabOfertas tag is inserted once with the configured URL', () => {
  const block = extractBalanced(indexHtml, 'if(c.labofertasScript &&');
  const tags = [];
  const document = {
    createElement() {
      return {
        setAttribute(name, value) {
          this[name] = value;
        }
      };
    },
    querySelector(selector) {
      assert.equal(selector, 'script[data-lp-labofertas]');
      return tags[0] || null;
    },
    head: {
      appendChild(el) {
        tags.push(el);
      }
    }
  };
  const sandbox = { document, window: { SITE_CONFIG: loadConfig() } };
  vm.createContext(sandbox);
  vm.runInContext(`var c = window.SITE_CONFIG;\n${block}\n${block}`, sandbox);
  assert.equal(tags.length, 1);
  assert.equal(tags[0].src, SCRIPT);
  assert.equal(tags[0].async, true);
  assert.equal(tags[0]['data-lp-labofertas'], '1');
});

test('checkout keeps off and checkoutMode and forwards only utm_* and fbclid', () => {
  assert.equal(checkoutHref(''), CHECKOUT);
  assert.equal(checkoutHref('?'), CHECKOUT);

  const href = checkoutHref('?utm_source=qa&utm_medium=cpc&utm_campaign=proteicas-fr&utm_content=primaire&utm_term=proteine&fbclid=IwAR_qa_fbclid&off=hacked&checkoutMode=99&email=qa@example.com&xcod=evil&lab_teste=1&sck=nope&ref=nope');
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
  for (const blocked of ['email', 'xcod', 'lab_teste', 'sck', 'ref']) {
    assert.equal(url.searchParams.get(blocked), null, blocked);
  }
  assert.equal(href.includes('hacked'), false);
  assert.equal(href.includes('checkoutMode=99'), false);
  assert.equal(href.includes('qa@example.com'), false);

  const empty = new URL(checkoutHref('?utm_source=&fbclid=&utm_campaign=kept'));
  assert.equal(empty.searchParams.get('utm_source'), null);
  assert.equal(empty.searchParams.get('fbclid'), null);
  assert.equal(empty.searchParams.get('utm_campaign'), 'kept');
  assert.equal(empty.searchParams.get('off'), '5p3g52zw');

  const ignored = new URL(checkoutHref('?utm=not-a-prefix&xutm_source=no&FBCLID=KeepCase'));
  assert.equal(ignored.searchParams.get('utm'), null);
  assert.equal(ignored.searchParams.get('xutm_source'), null);
  assert.equal(ignored.searchParams.get('FBCLID'), 'KeepCase');
  assert.equal(ignored.searchParams.get('checkoutMode'), '10');
});

test('landing copy, price and guarantee anchors are unchanged', () => {
  assert.equal(indexHtml.includes('14,90'), true);
  assert.equal(indexHtml.includes('30 jours'), true);
  assert.equal(indexHtml.includes('data-cta="hero"'), true);
  assert.equal(indexHtml.includes('data-cta="offre"'), true);
  assert.equal(indexHtml.includes('data-cta="sticky"'), true);
  assert.equal(indexHtml.includes('data-checkout="front"'), true);
  assert.equal(indexHtml.includes('Cette page utilise le Pixel Meta (événement PageView uniquement).'), true);
  assert.equal(fs.readFileSync(path.join(root, 'CNAME'), 'utf8').trim(), 'recettesproteinees.com');
});

test('privacy page states configured PageView and LabOfertas script', () => {
  const text = fs.readFileSync(path.join(root, 'confidentialite/index.html'), 'utf8');
  const sales = text.slice(text.indexOf('<h2>Pages de vente</h2>'), text.indexOf('<h2>Droits relatifs'));
  assert.equal(sales.includes('est vide'), false);
  assert.equal(sales.includes('aucun pixel'), false);
  assert.equal(sales.includes('activée plus tard'), false);
  assert.equal(sales.includes('pixel Meta'), true);
  assert.equal(sales.includes('événement PageView uniquement'), true);
  assert.equal(sales.includes('script LabOfertas'), true);
  assert.equal(sales.includes(PIXEL), false);
  assert.equal(sales.includes('painel.labofertas.com'), false);
  for (const absent of ['Purchase', 'InitiateCheckout', 'CAPI', 'Conversions', 'consentement']) {
    assert.equal(sales.includes(absent), false, absent);
  }
  assert.equal(text.includes('Dernière mise à jour : 7 novembre 2026'), true);
  assert.equal(text.includes('<h2>Achat et paiement (Hotmart)</h2>'), true);
  assert.equal(text.includes('<h2>Mini-application</h2>'), true);
  assert.equal(text.includes('<h2>Droits relatifs à vos données</h2>'), true);
  assert.equal(text.includes('https://www.cnil.fr/'), true);
});

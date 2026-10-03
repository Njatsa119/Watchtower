// Node 20+, no dependencies. Each source is isolated: if one fails, old values are kept.
import fs from 'node:fs';
const H = { 'User-Agent': 'watchtower/1.0', Accept: 'application/json' };
const j = async u => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
let old = {}; try { old = JSON.parse(fs.readFileSync('data.json', 'utf8')); } catch {}
const D = { ...old, errors: [] };
D.assets = D.assets || {};
const step = async (name, fn) => { try { await fn(); } catch (e) { D.errors.push(name + ': ' + e.message); } };

// 1) Prices (CoinGecko, no key)
await step('prices', async () => {
  const m = await j('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&price_change_percentage=24h');
  for (const x of m) {
    const k = x.symbol.toUpperCase();
    D.assets[k] = { ...(D.assets[k] || {}), n: x.name, p: x.current_price, ch: +(x.price_change_percentage_24h || 0).toFixed(2), hi: x.high_24h, lo: x.low_24h };
  }
  D.asOf = new Date().toISOString();
});

// 2) Candles (Coinbase public API, no key). Stored as [open, high, low, close, volume], oldest first.
for (const [k, pid] of [['BTC', 'BTC-USD'], ['ETH', 'ETH-USD']]) {
  await step('candles ' + k, async () => {
    const a = (D.assets[k] = D.assets[k] || {}); a.candles = a.candles || {};
    for (const [tf, g] of [[1, 3600], [6, 21600], [24, 86400]]) {
      const r = await j(`https://api.exchange.coinbase.com/products/${pid}/candles?granularity=${g}`);
      a.candles[tf] = r.slice(0, 80).reverse().map(([t, l, h, o, c, v]) => [o, h, l, c, +Number(v).toFixed(2)]);
    }
  });
}

// 3) Global market + Fear & Greed
await step('global', async () => {
  const g = (await j('https://api.coingecko.com/api/v3/global')).data;
  D.global = { cap: g.total_market_cap.usd, dom: +g.market_cap_percentage.btc.toFixed(1) };
});
await step('fng', async () => {
  const f = (await j('https://api.alternative.me/fng/?limit=1')).data[0];
  D.fng = { value: +f.value, label: f.value_classification };
});

// 4) News via RSS
const rss = async (u, src) => {
  const t = await (await fetch(u, { headers: H })).text();
  return [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10).map(m => {
    const g = tag => ((m[1].match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)) || [])[1] || '').trim();
    return { src, title: g('title'), link: g('link'), date: g('pubDate') };
  });
};
await step('news', async () => {
  const all = [];
  for (const [u, s] of [['https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk'], ['https://cointelegraph.com/rss', 'Cointelegraph']]) {
    try { all.push(...await rss(u, s)); } catch (e) { D.errors.push('rss ' + s + ': ' + e.message); }
  }
  if (all.length) D.news = all.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 16);
});

// 5) Stocks (optional: needs free FINNHUB_KEY secret)
if (process.env.FINNHUB_KEY) {
  await step('stocks', async () => {
    D.stocks = [];
    for (const s of ['SPY', 'QQQ', 'NVDA', 'TSLA', 'COIN']) {
      const q = await j(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${process.env.FINNHUB_KEY}`);
      D.stocks.push({ sym: s, p: q.c, ch: +(q.dp || 0).toFixed(2) });
    }
  });
}
fs.writeFileSync('data.json', JSON.stringify(D));
console.log('ok', D.asOf, D.errors);

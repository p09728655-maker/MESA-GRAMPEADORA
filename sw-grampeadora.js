// Service worker do dashboard Hora a Hora · Mesa Grampeadora.
// Estratégia network-first: sempre busca a versão mais nova online e só usa o
// cache como reserva quando a rede pisca. Assim a TV não fica em branco se o
// Wi-Fi oscilar, e deploys novos aparecem sem ficar presos em versão antiga.

const CACHE = 'grampeadora-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Nunca cachear a chamada JSONP ao Apps Script (dados ao vivo).
  if (e.request.url.indexOf('script.google.com') !== -1) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

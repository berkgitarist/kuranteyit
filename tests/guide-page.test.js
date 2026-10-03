import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('ayrıntılı kullanım kılavuzu bağımsız sayfa olarak bulunur', async () => {
  const html = await readFile(new URL('guide.html', root), 'utf8');

  assert.match(html, /Kuran Teyit Ayrıntılı Kullanım Kılavuzu/);

  // Temel kılavuz bölümleri
  assert.match(html, /id="kuran-oku"/);
  assert.match(html, /id="arama"/);
  assert.match(html, /id="analiz"/);
  assert.match(html, /id="notlar"/);
  assert.match(html, /id="kaynaklar"/);
  assert.match(html, /id="sorun-giderme"/);

  // 1989 Authorized English Version karşılaştırması
  assert.match(html, /id="baski-1989"/);
  assert.match(html, /1989 Baskısı/);
  assert.match(html, /Authorized English Version/);

  // Kılavuz içinde inline event kullanılmamalı
  assert.doesNotMatch(html, /\bonclick\s*=|\boninput\s*=/);
});

test('ana uygulamadaki kılavuz düğmesi bağımsız sayfaya yönlendirir', async () => {
  const script = await readFile(new URL('js/script.js', root), 'utf8');

  assert.match(
    script,
    /window\.location\.assign\('\.\/guide\.html'\)/
  );

  assert.match(
    script,
    /function displayGuidePage\(\)/
  );

  assert.doesNotMatch(script, /const GUIDE_CONTENT/);
});

test('kılavuz görünümü tema ve arama betiğini kullanır', async () => {
  const script = await readFile(new URL('js/guide.js', root), 'utf8');

  assert.match(script, /quranAppSettings/);
  assert.match(script, /setupGuideSearch/);
  assert.match(script, /returnToApplication/);
});

test('çevrimdışı uygulama kabuğu kılavuz dosyalarını içerir', async () => {
  const serviceWorker = await readFile(
    new URL('service-worker.js', root),
    'utf8'
  );

  assert.match(serviceWorker, /kuran-teyit-v64/);
  assert.match(serviceWorker, /\.\/guide\.html/);
  assert.match(serviceWorker, /\.\/js\/guide\.js/);
});
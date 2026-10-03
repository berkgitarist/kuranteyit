import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('dinamik HTML içinde inline event handler bırakılmaz', async () => {
  const script = await readFile(
    new URL('js/script.js', root),
    'utf8'
  );

  assert.equal(
    /\bonclick\s*=|\bontoggle\s*=/.test(script),
    false
  );
});

test('uygulama ES modülü ve PWA manifestiyle açılır', async () => {
  const html = await readFile(
    new URL('index.html', root),
    'utf8'
  );

  assert.match(html, /type="module"/);
  assert.match(html, /manifest\.webmanifest/);

  assert.doesNotMatch(
    html,
    /<html[^>]+class="dark-theme"/
  );
});

test('ilk ve son Kur’an sayfaları özel ilk ayet ekranına bağlanır', async () => {
  const script = await readFile(
    new URL('js/script.js', root),
    'utf8'
  );

  assert.match(
    script,
    /function goToFirstRevealedVersePage/
  );

  assert.match(
    script,
    /getLastAvailableQuranPage\(\)/
  );

  assert.match(
    script,
    /STATE\.currentPage <= FIRST_QURAN_DATA_PAGE[\s\S]*view: 'first-revelation'/
  );

  assert.match(
    script,
    /STATE\.currentPage >= actualLastPage[\s\S]*view: 'first-revelation'/
  );

  assert.match(
    script,
    /data-action="navigate-adjacent"/
  );
});

test('açılış ekranı her açılışta üç saniye görünür', async () => {
  const script = await readFile(
    new URL('js/script.js', root),
    'utf8'
  );

  assert.match(
    script,
    /const visibleDuration = alreadySeen \? 3000 : 3000;/
  );
});

test('sayfa ve manuel özel ekran URL hash üretmez', async () => {
  const navigation = await readFile(
    new URL('js/modules/navigation-utils.js', root),
    'utf8'
  );

  assert.match(
    navigation,
    /Normal sayfa geçişleri ve manuel özel ekran temiz URL kullanır/
  );

  assert.doesNotMatch(
    navigation,
    /#sayfa=|#ilk-ayet/
  );
});
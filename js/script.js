import {
  escapeHtml,
  escapeRegExp,
  normalizeTurkishText,
  normalizeSearchText,
  getSearchMatchScore,
  expandVerseRefs
} from './modules/core-utils.js';
import {
  parseRouteHash,
  buildRouteHash,
  createHistoryState
} from './modules/navigation-utils.js';
import {
  normalizeMealData
} from './modules/meal-normalizer.js';
import {
  openInternalPage,
  setupNativeBackButton,
  setupNativeSameWindowInternalLinks
} from './modules/platform-utils.js';

/* =========================================================
   KURAN TEYİT — VERİ KAYNAĞI VE HAK BİLDİRİMİ

   Bu uygulamadaki üçüncü taraf metin/veri dosyalarının kaynak kökeni:

   1) QuranTFT / SubmitterTech
      - https://github.com/SubmitterTech/quran-tft/tree/main/app/src/assets/translations/tr
      - https://github.com/SubmitterTech/quran-tft/tree/main/app/src
      - https://qurantft.com/
      Kullanılan veri grupları: ana İngilizce/Türkçe çeviri verileri,
      Arapça karşılaştırma verilerinin bir bölümü, konu haritaları ve ekler.

   2) Açık Kuran
      - https://github.com/acik-kuran
      - https://acikkuran.com/
      Kullanılan veri grupları: Erhan Aktaş Türkçe/Arapça çeviri verileri
      ve kelime çevirisi/kök verileri.

   3) Kuran Rehberi
      - https://github.com/eyupipler/Kuran-Rehberi/tree/main/data/translations
      Kullanılan veri grupları: uygulamadaki çeşitli karşılaştırmalı meal
      dosyalarının kaynaklandığı veri koleksiyonu.

   ÖNEMLİ:
   Bu yorum yalnızca veri kökenini ve atfı belgeler. Bir içeriğin GitHub'da
   herkese açık olması veya burada kaynak gösterilmesi, tek başına yeniden
   dağıtım lisansı ya da yazılı kullanım izni oluşturmaz. Her çeviri/veri
   dosyası için kaynak depodaki LICENSE/NOTICE/README koşulları ile çevirmen,
   yayıncı ve veri sahibinin hakları ayrıca doğrulanmalıdır.
========================================================= */

/* GÜNCELLEME: İngilizce kelime yardım alanları genişletildi. */
const CONFIG = {
  batchSize: 3,

  mealFiles: [
    'Abdülbaki Gölpınarlı.json',
    'Diyanet İşleri.json',
    'Diyanet Vakfı.json',
    'Edip Yüksel.json',
    'Elmalılı Hamdi Yazır.json',
    'İbn-i Kesir.json',
    'Muhammed Esed.json',
    'Mustafa İslamoğlu.json',
    'Ömer Nasuhi Bilmen.json',
    'Süleyman Ateş.json',
    'Süleymaniye.json',
    "Tefhim-ul Kur'an.json",
    'Yaşar Nuri Öztürk.json',
    'Yusuf Ali (İngilizce).json',
    'kuran_erhan_aktas.json'
  ],

  dataPaths: {
    en: './data/qurantft.json',
    quran1989: './data/quran1989.json',
    tr: './data/quran_tr.json',
    translit: './data/Turkce_Transkript.json',
    ai: './data/yapayzekaceviri.json',
    dictionary: './data/manual-dictionary.json',
    contextualDictionary: './data/contextual-dictionary.json',
    arabic2: './data/mealler/quran_arapca2.json',
    erhanArabic: './data/mealler/kuran_erhan_aktas.json',
    wordTranslations: './data/word-translations.json',
    mapTr: './data/map_tr.json',
    mapEn: './data/map.json',
    appendicesTr: './data/appendices_tr.json'
  }
};

const FIRST_QURAN_DATA_PAGE = 23;
const LAST_QURAN_DATA_PAGE = 604;

const STATE = {
  currentPage: FIRST_QURAN_DATA_PAGE,
  currentView: 'page',
  totalPages: LAST_QURAN_DATA_PAGE,
  data: {
    en: {},
    quran1989: null,
    tr: {},
    translit: {},
    ai: {},
    meals: {},
    dictionary: {},
    contextualDictionary: {},
    arabic2: {},
    erhanArabic: {},
    wordTranslations: {},
    mapTr: {},
    mapEn: {}
  },

  metadata: {
    sureNames: {},
    sureToPageMap: {},
    pageToSuraMap: {},
    verseToPageMap: {}
  },

  settings: {
    theme: 'dark',
    fontSize: 'small',
    translation: 'Diyanet İşleri',
    showTransliteration: true,
    showMeals: true,
    showAiTranslation: false
  }
};

const DOM = {
  quranContent: document.getElementById('quranContent'),
  content: document.getElementById('quranContent'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  searchInput: document.getElementById('searchInput'),
  autocomplete: document.getElementById('autocomplete'),
  suraMenu: document.getElementById('suraMenu'),
  wordTooltip: document.getElementById('wordTooltip'),
  sidebar: document.getElementById('sidebar'),
  sidebarOverlay: document.getElementById('sidebarOverlay'),
  body: document.body,
  introVerse: document.getElementById('introVerse')
};

const SEARCH_INDEX = {
  quran: [],
  meals: [],
  quranTokenMap: new Map(),
  mealTokenMap: new Map(),
  ready: false,
  mealsReady: false
};


/* =========================
   İngilizce öncelikli araştırma
   - Tek kelimede mevcut sözlük ters yönde kullanılır.
   - Türkçe giriş ayrıca Türkçe ana metinde birebir aranır; İngilizce sonuçlar önceliklidir.
   - Virgül, iki veya daha fazla araştırma kavramını ayırır.
   - Eski arama hiçbir zaman kaldırılmaz; çözülemeyen sorgu mevcut aramaya geri döner.
========================= */
const RESEARCH_SEARCH_STATE = {
  manualSource: null,
  contextualSource: null,
  reverseTurkishToEnglish: new Map(),
  englishTerms: new Map()
};

const RESEARCH_SEARCH_LIMITS = {
  maxTerms: 10,
  maxActiveCandidatesPerConcept: 3,
  maxVisibleAlternativeCandidates: 4,
  candidatePriorityWindow: 12,
  maxAggregateCards: 180,
  maxConceptCards: 80
};

const RESEARCH_ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'from',
  'with', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'he', 'she', 'it', 'they', 'we', 'you', 'i', 'his', 'her', 'their',
  'our', 'your', 'my', 'this', 'that', 'these', 'those'
]);

const SURA_SEARCH_CACHE = {
  exact: new Map(),
  items: [],
  queryResults: new Map()
};

const PAGE_CACHE = new Map();
const MAX_PAGE_CACHE = 20;

const MEALS_STATE = {
  status: 'idle',
  loadPromise: null,
  loadedCount: 0,
  index: Object.create(null)
};

const FEATURE_STATE = {
  ai: { status: 'idle', promise: null },
  quran1989: { status: 'idle', promise: null },
  dictionary: { status: 'idle', promise: null },
  arabicComparisons: { status: 'idle', promise: null },
  analysis: { status: 'idle', promise: null }
};

/*
  contextual-dictionary.json icindeki _alias_index buyuk/kucuk harf
  ayrimlarini koruyabilir (ornegin GOD / god). Bu nedenle exact alias
  aramasi her zaman once yapilir; case-insensitive arama yalnizca tek
  bir canonical kayda giden, cakismasiz alias ailelerinde kullanilir.
*/
const CONTEXTUAL_DICTIONARY_LOOKUP = {
  source: null,
  foldedAliasIndex: new Map(),
  foldedConflicts: new Set()
};

const TOPIC_INDEX = {
  tr: new Map(),
  en: new Map()
};

const EVIDENCE_COPY_CACHE = {
  dataRoot: './data/evidence',
  suraPromises: new Map()
};

const NAVIGATION_STATE = {
  applyingHistory: false,
  initialized: false,
  lastRoute: null
};

let activeSearchQuery = '';
let pendingHighlight = null;
let tooltipDelegationReady = false;
let activeSearchRequestId = 0;
let activeAnalysisRequestId = 0;
let lastDialogTrigger = null;
let loadingOperationCount = 0;

// Arama sonucundan bir ayete gidildiğinde sol üst geri düğmesiyle
// aynı arama sonuçlarına dönmek için geçici gezinme bilgisi.
const SEARCH_RETURN_STATE = {
  pending: null,
  active: null,
  fallbackTimer: null
};

// Analiz panelinden bir ayete gidildiğinde, geri dönüş için
// analiz edilen ayeti ve panelin kaydırma konumunu saklar.
let analysisReturnState = null;

const QURAN_READER_STATE = {
  html: '',
  suras: [],
  fontLevel: 0
};

const APPENDIX_READER_STATE = {
  status: 'idle',
  promise: null,
  data: null,
  appendices: [],
  html: '',
  previewHoverReady: false,
  fontLevel: 0
};

const APPENDIX_FONT_STORAGE_KEY = 'kuranTeyitAppendixFontLevel';
const APPENDIX_FONT_MIN_LEVEL = -2;
const APPENDIX_FONT_MAX_LEVEL = 3;

const QURAN_READER_FONT_STORAGE_KEY = 'kuranTeyitQuranReaderFontLevel';
const QURAN_READER_FONT_MIN_LEVEL = -2;
const QURAN_READER_FONT_MAX_LEVEL = 3;

function parseApplicationRoute(hash = window.location.hash) {
  const normalizedHash = String(hash || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase();

  if (normalizedHash === 'reader') {
    return { view: 'reader' };
  }

  if (normalizedHash === 'appendices') {
    return { view: 'appendices' };
  }

  return parseRouteHash(hash);
}

/* =========================
   Başlangıç
========================= */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Uygulama başlatılıyor...');

  loadSettings();
  applySettings();
  registerServiceWorker();

  try {
    await Promise.all([
      showIntroVerse(),
      loadInitialData()
    ]);

    if (STATE.settings.showAiTranslation) {
      try {
        await ensureFeatureLoaded('ai');
      } catch (error) {
        STATE.settings.showAiTranslation = false;
        showNotification('AI çeviri verisi yüklenemedi; uygulama temel metinlerle açıldı.', 'warning');
      }
    }

    processMetadata();
    buildSuraSearchCache();
    buildSuraMenu();
    setupEventListeners();
    setupFloatingBackToTopButton();
    setupAppendixImageFallback();
    setupNativeSameWindowInternalLinks();
    await setupNativeBackButton();

    const initialRoute = parseApplicationRoute(window.location.hash);
    await applyRoute(initialRoute, {
      historyMode: 'replace',
      restoreScroll: true
    });

    if (!NAVIGATION_STATE.initialized) {
      NAVIGATION_STATE.initialized = true;
    }

    console.log('İlk ekran hazır.');

    const scheduleIndexBuild = window.requestIdleCallback || ((callback) => setTimeout(callback, 120));

    scheduleIndexBuild(() => {
      try {
        buildSearchIndex();
        console.log('Arama indeksi hazır.');
      } catch (error) {
        console.error('Arama indeksi oluşturulamadı:', error);
      }
    });
  } catch (error) {
    console.error('Başlangıç hatası:', error);
    ensureQuranView();
    DOM.content.innerHTML = `
      <div class="error-message" style="text-align:center;padding:40px;">
        <h2>Uygulama başlatılamadı</h2>
        <p>${escapeHtml(error.message || 'Temel veri dosyaları yüklenemedi.')}</p>
        <button type="button" class="toggle-btn" data-action="reload-app">
          Yeniden Dene
        </button>
      </div>
    `;
  }
});

async function clearDevelopmentServiceWorkerState() {
  const isLocalDevelopment =
    (location.hostname === '127.0.0.1' || location.hostname === 'localhost') &&
    Boolean(location.port);

  if (!isLocalDevelopment || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => key.startsWith('kuran-teyit-'))
          .map((key) => caches.delete(key))
      );
    }

    console.info('Yerel geliştirme Service Worker önbelleği temizlendi.');
  } catch (error) {
    console.warn('Yerel Service Worker temizlenemedi:', error);
  }

  return true;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    if (await clearDevelopmentServiceWorkerState()) {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js');

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showNotification('Kuran Teyit için yeni sürüm hazır. Yenilemede uygulanacak.', 'info', 6000);
          }
        });
      });
    } catch (error) {
      console.warn('Service Worker kaydedilemedi:', error);
    }
  });
}

/* =========================
   Yardımcılar
========================= */

let currentVerseAudio = null;

function getGlobalAyahNumber(suraNum, verseNum) {
  const counts = {
    1:7,2:286,3:200,4:176,5:120,6:165,7:206,8:75,9:129,10:109,11:123,12:111,13:43,14:52,15:99,16:128,
    17:111,18:110,19:98,20:135,21:112,22:78,23:118,24:64,25:77,26:227,27:93,28:88,29:69,30:60,31:34,
    32:30,33:73,34:54,35:45,36:83,37:182,38:88,39:75,40:85,41:54,42:53,43:89,44:59,45:37,46:35,47:38,
    48:29,49:18,50:45,51:60,52:49,53:62,54:55,55:78,56:96,57:29,58:22,59:24,60:13,61:14,62:11,63:11,
    64:18,65:12,66:12,67:30,68:52,69:52,70:44,71:28,72:28,73:20,74:56,75:40,76:31,77:50,78:40,79:46,
    80:42,81:29,82:19,83:36,84:25,85:22,86:17,87:19,88:26,89:30,90:20,91:15,92:21,93:11,94:8,95:8,
    96:19,97:5,98:8,99:8,100:11,101:11,102:8,103:3,104:9,105:5,106:4,107:7,108:3,109:6,110:3,111:5,
    112:4,113:5,114:6
  };

  let total = 0;
  for (let i = 1; i < Number(suraNum); i++) {
    total += counts[i];
  }

  return total + Number(verseNum);
}

function speakVerse(suraNum, verseNum) {
  stopSpeech();

  const ayahNumber = getGlobalAyahNumber(
    suraNum,
    verseNum
  );

  const audioUrl =
    `https://cdn.islamic.network/quran/audio/128/ar.alafasy/${ayahNumber}.mp3`;

  currentVerseAudio = new Audio(audioUrl);

  currentVerseAudio
    .play()
    .catch((error) => {
      console.error(
        'Arapça ses oynatılamadı:',
        error
      );

      showNotification(
        'Arapça ses oynatılamadı. İnternet bağlantısını kontrol edin.',
        'warning'
      );
    });
}


function stopSpeech() {
  if (currentVerseAudio) {
    currentVerseAudio.pause();
    currentVerseAudio.currentTime = 0;
    currentVerseAudio = null;
  }

  const nativeTextToSpeech =
    window.Capacitor?.Plugins?.TextToSpeech;

  if (nativeTextToSpeech) {
    nativeTextToSpeech
      .stop()
      .catch((error) => {
        console.warn(
          'Yerel ses durdurulamadı:',
          error
        );
      });
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}


function speakEnglishVerse(suraNum, verseNum) {
  stopSpeech();

  const page = getVersePage(
    String(suraNum),
    String(verseNum)
  );

  const text =
    STATE.data.en?.[page]
      ?.sura?.[String(suraNum)]
      ?.verses?.[String(verseNum)] || '';

  if (!text) {
    showNotification(
      'Bu ayet için İngilizce metin bulunamadı.',
      'warning'
    );

    return;
  }

  const nativeTextToSpeech =
    window.Capacitor?.Plugins?.TextToSpeech;

  if (nativeTextToSpeech) {
    nativeTextToSpeech
      .speak({
        text: text,
        lang: 'en-US',
        rate: 0.9,
        pitch: 1.0,
        volume: 1.0
      })
      .catch((error) => {
        console.error(
          'Yerel İngilizce sesli okuma hatası:',
          error
        );

        showNotification(
          'İngilizce sesli okuma başlatılamadı. Telefonun metin okuma ayarlarını kontrol edin.',
          'warning'
        );
      });

    return;
  }

  if ('speechSynthesis' in window) {
    const utterance =
      new SpeechSynthesisUtterance(text);

    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;

    window.speechSynthesis.speak(
      utterance
    );

    return;
  }

  showNotification(
    'Bu cihazda İngilizce sesli okuma kullanılamıyor.',
    'warning'
  );
}

function showNotification(message, type = 'info', duration = 3600) {
  console.log(`[${type}] ${message}`);

  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `app-toast app-toast-${type}`;
  toast.setAttribute('role', type === 'warning' || type === 'error' ? 'alert' : 'status');

  const text = document.createElement('span');
  text.className = 'app-toast-message';
  text.textContent = String(message || '');

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'app-toast-close';
  closeButton.setAttribute('aria-label', 'Bildirimi kapat');
  closeButton.textContent = '×';

  const removeToast = () => {
    toast.classList.add('app-toast-leaving');
    setTimeout(() => toast.remove(), 180);
  };

  closeButton.addEventListener('click', removeToast);
  toast.append(text, closeButton);
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('app-toast-visible'));
  setTimeout(removeToast, duration);
}

function setPageCache(pageNum, html) {
  if (PAGE_CACHE.has(pageNum)) PAGE_CACHE.delete(pageNum);
  PAGE_CACHE.set(pageNum, html);

  if (PAGE_CACHE.size > MAX_PAGE_CACHE) {
    const oldestKey = PAGE_CACHE.keys().next().value;
    PAGE_CACHE.delete(oldestKey);
  }
}

function clearPageCache() {
  PAGE_CACHE.clear();
}

/* =========================
   Intro
========================= */
function showIntroVerse() {
  return new Promise((resolve) => {
    const intro = DOM.introVerse;
    const skipButton = document.getElementById('skipIntroBtn');

    if (!intro) {
      resolve();
      return;
    }

    let alreadySeen = false;

    try {
      alreadySeen = localStorage.getItem('kuranTeyitIntroSeenV1') === 'true';
    } catch (error) {
      console.warn('Açılış ekranı tercihi okunamadı:', error);
    }
    const visibleDuration = alreadySeen ? 3000 : 3000;
    let finished = false;
    let hideTimer = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hideTimer);
      skipButton?.removeEventListener('click', finish);

      intro.classList.add('fade-out');

      setTimeout(() => {
        intro.classList.add('hidden');
        intro.style.display = 'none';
        intro.setAttribute('aria-hidden', 'true');
        try {
          localStorage.setItem('kuranTeyitIntroSeenV1', 'true');
        } catch (error) {
          console.warn('Açılış ekranı tercihi kaydedilemedi:', error);
        }
        resolve();
      }, alreadySeen ? 120 : 300);
    };

    intro.classList.remove('hidden', 'fade-out');
    intro.style.display = 'flex';
    intro.setAttribute('aria-hidden', 'false');

    skipButton?.addEventListener('click', finish);
    hideTimer = setTimeout(finish, visibleDuration);
  });
}

/* =========================
   Ayarlar
========================= */
function loadSettings() {
  const allowedThemes = new Set([
    'light', 'dark', 'green', 'indigo', 'brown',
    'sky', 'blackyellow', 'bluemaize', 'redpeach', 'greenolive'
  ]);
  const allowedFontSizes = new Set(['small', 'medium', 'large']);

  try {
    const savedSettings = JSON.parse(localStorage.getItem('quranAppSettings') || '{}');

    STATE.settings = {
      ...STATE.settings,
      ...savedSettings,
      theme: allowedThemes.has(savedSettings.theme)
        ? savedSettings.theme
        : STATE.settings.theme,
      fontSize: allowedFontSizes.has(savedSettings.fontSize)
        ? savedSettings.fontSize
        : STATE.settings.fontSize,
      showTransliteration: savedSettings.showTransliteration !== false,
      showMeals: savedSettings.showMeals !== false,
      showAiTranslation: savedSettings.showAiTranslation === true
    };
  } catch (error) {
    console.warn('Ayarlar yüklenemedi:', error);
  }
}

async function saveSettings(options = {}) {
  const { refreshPage = true } = options;
  try {
    if (STATE.settings.showAiTranslation) {
      try {
        await ensureFeatureLoaded('ai');
      } catch (error) {
        STATE.settings.showAiTranslation = false;
        showNotification('AI çeviri verisi yüklenemediği için bu seçenek kapatıldı.', 'warning');
      }
    }

    localStorage.setItem('quranAppSettings', JSON.stringify(STATE.settings));
    applySettings();
    clearPageCache();

    if (SEARCH_INDEX.ready) {
      buildSearchIndex();
    }

    if (
      refreshPage &&
      STATE.data.en[STATE.currentPage] &&
      STATE.data.tr[STATE.currentPage]
    ) {
      displayPage(STATE.currentPage);
    }

    return true;
  } catch (error) {
    console.error('Ayarlar kaydedilirken hata:', error);
    showNotification('Ayarlar kaydedilemedi.', 'warning');
    return false;
  }
}

function applySettings() {
  const themeClasses = [
    'light-theme',
    'dark-theme',
    'green-theme',
    'indigo-theme',
    'brown-theme',
    'sky-theme',
    'blackyellow-theme',
    'bluemaize-theme',
    'redpeach-theme',
    'greenolive-theme'
  ];

  const root = document.documentElement;
  root.classList.remove(...themeClasses);
  DOM.body.classList.remove(...themeClasses);
  root.classList.add(`${STATE.settings.theme}-theme`);
  DOM.body.classList.add(`${STATE.settings.theme}-theme`);
  root.dataset.theme = STATE.settings.theme;

  let rootSize = 16;

  switch (STATE.settings.fontSize) {
    case 'small':
      rootSize = 14;
      break;
    case 'large':
      rootSize = 20;
      break;
    default:
      rootSize = 16;
  }

  root.style.fontSize = `${rootSize}px`;
  root.style.setProperty(
    '--verse-arabic-size',
    STATE.settings.fontSize === 'small'
      ? '22px'
      : STATE.settings.fontSize === 'large'
        ? '34px'
        : '28px'
  );
}

/* =========================
   Görünüm
========================= */
function ensureQuranView() {
  if (DOM.quranContent) {
    DOM.quranContent.classList.remove('hidden');
    DOM.quranContent.style.display = 'block';
  }

  const contentArea = document.querySelector('.content-area');

  if (contentArea) {
    contentArea.style.padding = '';
  }

  if (DOM.introVerse) {
    DOM.introVerse.classList.add('hidden');
    DOM.introVerse.classList.remove('fade-out');
    DOM.introVerse.style.display = 'none';
    DOM.introVerse.setAttribute('aria-hidden', 'true');
  }
}

/* =========================
   Loading
========================= */
function showLoading(text = 'Yükleniyor...') {
  const loadingOverlay = DOM.loadingOverlay;
  if (!loadingOverlay) return;

  loadingOperationCount += 1;
  loadingOverlay.style.display = 'flex';
  loadingOverlay.setAttribute('aria-busy', 'true');

  const loadingText = document.querySelector('.loading-text');
  if (loadingText) loadingText.textContent = text;
}

function hideLoading() {
  const loadingOverlay = DOM.loadingOverlay;
  if (!loadingOverlay) return;

  loadingOperationCount = Math.max(0, loadingOperationCount - 1);

  if (loadingOperationCount === 0) {
    loadingOverlay.style.display = 'none';
    loadingOverlay.setAttribute('aria-busy', 'false');

    const progressBar = document.querySelector('.progress-bar');
    if (progressBar instanceof HTMLElement) progressBar.style.width = '0%';
  }
}

function updateLoadingProgress(percent) {
  const progressBar = document.querySelector('.progress-bar');
  if (progressBar) progressBar.style.width = `${percent}%`;

  const loadingText = document.querySelector('.loading-text');
  if (loadingText) loadingText.textContent = `Yükleniyor... %${Math.round(percent)}`;
}

/* =========================
   Eventler
========================= */
function prepareStaticView() {
  setQuranReaderNavigationMode(false);
  STATE.currentView = 'static';

  const currentRoute = history.state?.route;
  const fallbackRoute = currentRoute?.view === 'analysis'
    ? history.state?.parentRoute || { view: 'page', page: STATE.currentPage }
    : { view: 'page', page: STATE.currentPage };

  closeAnalysisPanel({ updateHistory: false, restoreFocus: false });
  closeSearchResultsPanel({ restoreFocus: false });
  clearAnalysisReturnState();
  updateHistoryRoute(fallbackRoute, 'replace');
}

function setupEventListeners() {
  document.getElementById('prevPage')?.addEventListener('click', () => {
    if (restoreSearchResultsFromHistory()) return;

    if (history.state?.readerReturn === true || history.state?.appendicesReturn === true) {
      history.back();
      return;
    }

    if (STATE.currentView === 'reader' || STATE.currentView === 'appendices') {
      if (history.length > 1) history.back();
      else goToPage(STATE.currentPage || FIRST_QURAN_DATA_PAGE, { historyMode: 'replace' });
      return;
    }

    if (restoreAnalysisPanelFromHistory()) return;
    navigateAdjacent('previous');
  });

  document.getElementById('nextPage')?.addEventListener('click', () => {
    if (STATE.currentView === 'reader' || STATE.currentView === 'appendices') return;
    clearAnalysisReturnState();
    navigateAdjacent('next');
  });

  const menuToggleButton = document.getElementById('menuToggle');
  let logoClickTimer = null;
  let logoClickCount = 0;

  menuToggleButton?.addEventListener('click', () => {
    logoClickCount += 1;

    if (logoClickCount === 1) {
      logoClickTimer = setTimeout(() => {
        logoClickCount = 0;
        logoClickTimer = null;
        toggleSidebar();
      }, 280);
      return;
    }

    clearTimeout(logoClickTimer);
    logoClickTimer = null;
    logoClickCount = 0;
    closeSidebar();
    activeSearchQuery = '';

    if (DOM.searchInput) DOM.searchInput.value = '';
    if (DOM.autocomplete) {
      DOM.autocomplete.innerHTML = '';
      DOM.autocomplete.style.display = 'none';
    }

    goToVerse(1, 1, { source: 'logo' });
  });

  document.getElementById('closeMenu')?.addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebar);

  document.getElementById('settingsPage')?.addEventListener('click', () => {
    prepareStaticView();
    displaySettingsPage();
    closeSidebar();
  });

  document.getElementById('quranTeyitPage')?.addEventListener('click', () => {
    activeSearchQuery = '';

    if (DOM.searchInput) {
      DOM.searchInput.value = '';
    }

    if (DOM.autocomplete) {
      DOM.autocomplete.innerHTML = '';
      DOM.autocomplete.style.display = 'none';
    }

    closeSidebar();

    goToPage(FIRST_QURAN_DATA_PAGE, {
      historyMode: 'push'
    });
  });

  document.getElementById('quranReadPage')?.addEventListener('click', () => {
    prepareStaticView();
    displayQuranReaderPage({
      historyMode: 'push',
      scrollTop: 0
    });
    closeSidebar();
  });

  document.getElementById('appendicesReadPage')?.addEventListener('click', async () => {
    prepareStaticView();
    closeSidebar();
    await displayAppendicesReaderPage({
      historyMode: 'push',
      scrollTop: 0
    });
  });

  document.getElementById('notesPage')?.addEventListener('click', () => {
    prepareStaticView();
    displayNotesPage();
    closeSidebar();
  });

  document.getElementById('guidePage')?.addEventListener('click', () => {
    prepareStaticView();
    displayGuidePage();
    closeSidebar();
  });
  document
  .getElementById('evidencePage')
  ?.addEventListener('click', () => {
    const query = String(
      DOM.searchInput?.value || ''
    ).trim();

    const targetUrl = query
      ? `./evidence.html?q=${encodeURIComponent(query)}`
      : './evidence.html';

    closeSidebar();

    openInternalPage(targetUrl, {
      newTabOnWeb: true
    });
  });

  document.getElementById('privacyPage')?.addEventListener('click', () => {
    prepareStaticView();
    displayPrivacyPage();
    closeSidebar();
  });

  document.getElementById('licensesPage')?.addEventListener('click', () => {
    prepareStaticView();
    displayLicensesPage();
    closeSidebar();
  });

  document.addEventListener('click', handleDelegatedAction);
  document.addEventListener('toggle', handleDelegatedToggle, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (document.getElementById('analysisPanel')) {
      closeAnalysisPanel();
      return;
    }

    if (document.getElementById('searchResultsPanel')) {
      closeSearchResultsPanel();
    }
  });

  window.addEventListener('popstate', async (event) => {
    const pendingSearchReturn = SEARCH_RETURN_STATE.pending;

    if (SEARCH_RETURN_STATE.fallbackTimer) {
      clearTimeout(SEARCH_RETURN_STATE.fallbackTimer);
      SEARCH_RETURN_STATE.fallbackTimer = null;
    }

    SEARCH_RETURN_STATE.pending = null;
    SEARCH_RETURN_STATE.active = null;

    const route = event.state?.route || parseApplicationRoute(window.location.hash);
    await applyRoute(route, { historyMode: 'none', restoreScroll: true });

    if (pendingSearchReturn) {
      await reopenSearchResultsFromReturnState(pendingSearchReturn);
    }

    updatePreviousButtonState();
  });

  window.addEventListener('hashchange', async () => {
    if (NAVIGATION_STATE.applyingHistory) return;

    const route = parseApplicationRoute(window.location.hash);
    const currentStateRoute = history.state?.route;

    if (JSON.stringify(route) === JSON.stringify(currentStateRoute)) return;
    await applyRoute(route, { historyMode: 'replace', restoreScroll: true });
  });

  let scrollFrame = null;
  window.addEventListener('scroll', () => {
    if (scrollFrame) return;

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      const currentState = history.state;
      if (!currentState?.route) return;

      const panelBody = document.querySelector('#analysisPanel .analysis-panel-body');
      const nextState = {
        ...currentState,
        pageScrollTop: window.scrollY,
        analysisScrollTop: panelBody?.scrollTop || currentState.analysisScrollTop || 0
      };

      history.replaceState(nextState, '', window.location.href);
    });
  }, { passive: true });

  setupSearch();
  setupWordTooltipDelegation();
}

function setupFloatingBackToTopButton() {
  if (document.getElementById('floatingBackToTopButton')) return;

  const button = document.createElement('button');
  button.id = 'floatingBackToTopButton';
  button.type = 'button';
  button.className = 'floating-back-to-top';
  button.setAttribute('aria-label', 'Sayfan\u0131n en \u00fcst\u00fcne \u00e7\u0131k');
  button.setAttribute('title', 'Yukar\u0131 \u00e7\u0131k');
  button.innerHTML = '<span aria-hidden="true">&#8593;</span>';

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  );

  button.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion.matches ? 'auto' : 'smooth'
    });
  });

  document.body.appendChild(button);
  button.classList.add('is-visible');
}

function handleDelegatedToggle(event) {
  const details = event.target.closest('details[data-action="arabic-details"]');
  if (!details || !details.open) return;

  loadArabicDetails(
    details.dataset.sura,
    details.dataset.verse,
    details
  );
}

function handleDelegatedAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;
  const sura = target.dataset.sura;
  const verse = target.dataset.verse;

  switch (action) {
    case 'go-sura':
      goToSura(sura);
      break;
    case 'go-page':
      goToPage(Number(target.dataset.page));
      break;
    case 'navigate-adjacent':
      navigateAdjacent(target.dataset.direction);
      break;
    case 'go-first-revelation':
      goToFirstRevealedVersePage();
      break;
    case 'speak-arabic':
      speakVerse(sura, verse);
      break;
    case 'stop-audio':
      stopSpeech();
      break;
    case 'speak-english':
      speakEnglishVerse(sura, verse);
      break;
    case 'toggle-1989':
      toggle1989Edition(target, sura, verse);
      break;
    case 'toggle-footnote':
      toggleNote(target.dataset.target);
      break;
    case 'toggle-meal':
      toggleMeal(target.dataset.target, sura, verse);
      break;
    case 'open-analysis':
      openAnalysisPanel(sura, verse, { trigger: target });
      break;
    case 'close-analysis':
      closeAnalysisPanel();
      break;
    case 'toggle-note-input':
      toggleNoteInput(target.dataset.target, sura, verse);
      break;
    case 'save-note':
      saveNote(sura, verse);
      break;
    case 'cancel-note':
      cancelNote(sura, verse);
      break;
    case 'edit-note':
      editLocalNote(sura, verse);
      break;
    case 'remove-note':
      removeLocalNote(sura, verse);
      break;
    case 'reader-open-verse':
      openVerseFromQuranReader(sura, verse);
      break;
    case 'reader-font-decrease':
      changeQuranReaderFontLevel(-1);
      break;
    case 'reader-font-increase':
      changeQuranReaderFontLevel(1);
      break;
    case 'reader-font-reset':
      setQuranReaderFontLevel(0);
      break;
    case 'reader-top':
    case 'appendices-top':
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'appendices-toggle-verse-preview':
      toggleAppendixVersePreview(target, { pinned: true });
      break;
    case 'appendices-font-decrease':
      changeAppendixFontLevel(-1);
      break;
    case 'appendices-font-increase':
      changeAppendixFontLevel(1);
      break;
    case 'appendices-font-reset':
      setAppendixFontLevel(0);
      break;
    case 'notes-go-verse':
      goToVerseFromNotes(sura, verse);
      break;
    case 'notes-remove':
      removeLocalNoteFromList(sura, verse);
      break;
    case 'show-privacy':
      displayPrivacyPage();
      break;
    case 'show-licenses':
      displayLicensesPage();
      break;
    case 'return-quran':
      goToPage(STATE.currentPage);
      break;
    case 'export-notes':
      exportLocalNotes();
      break;
    case 'import-notes':
      openNotesImportDialog();
      break;
    case 'toggle-notes':
      toggleNotesVisibility();
      break;
    case 'reload-app':
      window.location.reload();
      break;
    default:
      break;
  }
}

/* =========================
   Sidebar
========================= */
function toggleSidebar() {
  const isOpen = !DOM.sidebar.classList.contains('hidden');
  if (isOpen) closeSidebar();
  else openSidebar();
}

function openSidebar() {
  if (!DOM.sidebar || !DOM.sidebarOverlay) {
    return;
  }

  DOM.sidebar.classList.remove('hidden');
  DOM.sidebarOverlay.classList.remove('hidden');

  DOM.sidebar.setAttribute(
    'aria-hidden',
    'false'
  );

  DOM.sidebarOverlay.setAttribute(
    'aria-hidden',
    'false'
  );

  document
    .getElementById('menuToggle')
    ?.setAttribute(
      'aria-expanded',
      'true'
    );

  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  if (!DOM.sidebar || !DOM.sidebarOverlay) {
    return;
  }

  DOM.sidebar.classList.add('hidden');
  DOM.sidebarOverlay.classList.add('hidden');

  DOM.sidebar.setAttribute(
    'aria-hidden',
    'true'
  );

  DOM.sidebarOverlay.setAttribute(
    'aria-hidden',
    'true'
  );

  document
    .getElementById('menuToggle')
    ?.setAttribute(
      'aria-expanded',
      'false'
    );

  document.body.style.overflow = '';
}

/* =========================
   Veri yükleme
========================= */
async function loadInitialData() {
  showLoading('Temel Kuran verileri yükleniyor...');

  try {
    const results = await Promise.allSettled([
      loadDataFile(CONFIG.dataPaths.en, 'en'),
      loadDataFile(CONFIG.dataPaths.tr, 'tr'),
      loadDataFile(CONFIG.dataPaths.translit, 'translit')
    ]);

    const [englishResult, turkishResult, transliterationResult] = results;

    if (englishResult.status === 'rejected' || turkishResult.status === 'rejected') {
      const missing = [];
      if (englishResult.status === 'rejected') missing.push('İngilizce ana metin');
      if (turkishResult.status === 'rejected') missing.push('Türkçe ana metin');

      throw new Error(`${missing.join(' ve ')} yüklenemedi.`);
    }

    if (transliterationResult.status === 'rejected') {
      console.warn('Okunuş verisi yüklenemedi:', transliterationResult.reason);
      showNotification('Okunuş verisi yüklenemedi; uygulama temel metinlerle açıldı.', 'warning');
    }
  } finally {
    hideLoading();
  }
}

async function loadDataFile(path, key) {
  const response = await fetch(path, { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error(`${key} dosyası yüklenemedi: ${response.status}`);
  }

  const json = await response.json();
  STATE.data[key] = json;
  console.log(`${key} verisi yüklendi.`);
  return json;
}

function normalizeQuran1989Data(data) {
  if (data?.verses && typeof data.verses === 'object' && !Array.isArray(data.verses)) {
    return data;
  }

  if (!Array.isArray(data)) {
    return { verses: {} };
  }

  const verses = Object.create(null);

  data.forEach((item) => {
    if (!item || typeof item !== 'object') return;

    const verseId = String(item['Ayet no'] || '').trim();
    const verseText = String(item.Ayet || '').trim();

    if (!/^\d{1,3}:\d{1,3}$/.test(verseId) || !verseText) return;

    verses[verseId] = {
      text: verseText,
      footnotes: Array.isArray(item.Dipnot)
        ? item.Dipnot.filter(Boolean).map((note) => String(note))
        : [],
      passageTitle: item['Pasaj Başlığı'] ?? null,
      suraTitle: String(item['Ayet adı'] || '')
    };
  });

  return {
    _meta: {
      edition: '1989 Authorized English Version',
      sourceFormat: 'V2_FULL',
      verseCount: Object.keys(verses).length
    },
    verses
  };
}

async function ensureFeatureLoaded(featureName) {
  const feature = FEATURE_STATE[featureName];

  if (!feature) {
    throw new Error(`Bilinmeyen özellik: ${featureName}`);
  }

  if (feature.status === 'ready') return true;
  if (feature.status === 'loading') return feature.promise;

  feature.status = 'loading';

  feature.promise = (async () => {
    try {
      if (featureName === 'ai') {
        await loadDataFile(CONFIG.dataPaths.ai, 'ai');
      } else if (featureName === 'quran1989') {
        await loadDataFile(CONFIG.dataPaths.quran1989, 'quran1989');
        STATE.data.quran1989 = normalizeQuran1989Data(STATE.data.quran1989);
        console.log(
          `1989 baskisi hazir (${Object.keys(STATE.data.quran1989.verses || {}).length} ayet).`
        );
      } else if (featureName === 'dictionary') {
        const results = await Promise.allSettled([
          loadDataFile(
            CONFIG.dataPaths.contextualDictionary,
            'contextualDictionary'
          ),
          loadDataFile(
            CONFIG.dataPaths.dictionary,
            'dictionary'
          )
        ]);

        const [contextualResult, manualResult] = results;

        if (contextualResult.status === 'rejected') {
          console.warn(
            'Bağlamsal sözlük yüklenemedi; mevcut sözlük kullanılacak:',
            contextualResult.reason
          );
          STATE.data.contextualDictionary = {};
        }

        if (manualResult.status === 'rejected') {
          console.warn(
            'Mevcut manual sözlük yüklenemedi; bağlamsal sözlük kullanılacak:',
            manualResult.reason
          );
          STATE.data.dictionary = {};
        }

        if (results.every((result) => result.status === 'rejected')) {
          throw new Error('Kelime sözlükleri yüklenemedi.');
        }
      } else if (featureName === 'arabicComparisons') {
        const results = await Promise.allSettled([
          loadDataFile(CONFIG.dataPaths.arabic2, 'arabic2'),
          loadDataFile(CONFIG.dataPaths.erhanArabic, 'erhanArabic')
        ]);

        if (results.every((result) => result.status === 'rejected')) {
          throw new Error('Arapça karşılaştırma verileri yüklenemedi.');
        }
      } else if (featureName === 'analysis') {
        const results = await Promise.allSettled([
          loadDataFile(CONFIG.dataPaths.mapTr, 'mapTr'),
          loadDataFile(CONFIG.dataPaths.mapEn, 'mapEn')
        ]);

        if (results.every((result) => result.status === 'rejected')) {
          throw new Error('Konu haritaları yüklenemedi.');
        }

        buildTopicIndexes();
      }

      feature.status = 'ready';
      return true;
    } catch (error) {
      feature.status = 'error';
      console.error(`${featureName} özelliği yüklenemedi:`, error);
      throw error;
    } finally {
      if (feature.status !== 'loading') {
        feature.promise = null;
      }
    }
  })();

  return feature.promise;
}

function processMetadata() {
  STATE.metadata.sureNames = {};
  STATE.metadata.sureToPageMap = {};
  STATE.metadata.pageToSuraMap = {};
  STATE.metadata.verseToPageMap = {};

  for (const page in STATE.data.tr) {
    const pageObj = STATE.data.tr[page];
    if (!pageObj?.sura) continue;

    STATE.metadata.pageToSuraMap[page] = Object.keys(pageObj.sura);

    for (const suraNum in pageObj.sura) {
      const sura = pageObj.sura[suraNum];

      if (!STATE.metadata.sureNames[suraNum]) {
        const titles = sura.titles;
        if (titles && titles['1']) {
          const lines = titles['1'].split('\n').map((l) => l.trim()).filter(Boolean);
          const sureLine = lines.find((l) => l.startsWith('Sure '));
          const parantezLine = lines.find((l) => l.startsWith('('));

          if (sureLine) {
            let cleanedTitle = sureLine.replace(/^Sure\s*/, '').trim();
            if (parantezLine) cleanedTitle += ' ' + parantezLine;
            STATE.metadata.sureNames[suraNum] = cleanedTitle;
            STATE.metadata.sureToPageMap[suraNum] = parseInt(page);
          }
        }
      }

      const verses = sura.verses || {};
      for (const verseNum in verses) {
        STATE.metadata.verseToPageMap[`${suraNum}:${verseNum}`] = parseInt(page);
      }
    }
  }
}

function getVersePage(suraNum, verseNum) {
  return STATE.metadata.verseToPageMap[`${String(suraNum)}:${String(verseNum)}`] ?? null;
}

function getSuraStartPage(suraNum) {
  return STATE.metadata.sureToPageMap[String(suraNum)] ?? null;
}

function verseExists(suraNum, verseNum) {
  const page = getVersePage(suraNum, verseNum);

  return Boolean(
    page &&
    STATE.data.en?.[page]?.sura?.[String(suraNum)]?.verses?.[String(verseNum)] !== undefined
  );
}

/* =========================
   Arama index
========================= */
function addSearchTokens(tokenMap, normalizedText, itemIndex) {
  const tokens = new Set(String(normalizedText || '').split(/\s+/).filter(Boolean));

  tokens.forEach((token) => {
    if (!tokenMap.has(token)) tokenMap.set(token, new Set());
    tokenMap.get(token).add(itemIndex);
  });
}

function buildSearchIndex() {
  SEARCH_INDEX.quran = [];
  SEARCH_INDEX.quranTokenMap.clear();
  SEARCH_INDEX.ready = false;

  function pushSearchItem({ source, page = null, suraNum, verseNum, text }) {
    const cleanText = String(text || '');
    if (!cleanText) return;

    const normalized = normalizeSearchText(cleanText);
    const itemIndex = SEARCH_INDEX.quran.length;

    SEARCH_INDEX.quran.push({
      type: 'quran',
      source,
      page: Number(page) || getVersePage(String(suraNum), String(verseNum)),
      suraNum: String(suraNum),
      verseNum: String(verseNum),
      text: cleanText,
      normalized
    });

    addSearchTokens(SEARCH_INDEX.quranTokenMap, normalized, itemIndex);
  }

  ['tr', 'en'].forEach((source) => {
    const data = STATE.data[source];

    for (const page of Object.keys(data)) {
      const pageObject = data[page];
      if (!pageObject?.sura) continue;

      for (const suraNum of Object.keys(pageObject.sura)) {
        const verses = pageObject.sura[suraNum]?.verses || {};

        for (const verseNum of Object.keys(verses)) {
          pushSearchItem({
            source,
            page,
            suraNum,
            verseNum,
            text: verses[verseNum]
          });
        }
      }
    }
  });

  for (const suraNum of Object.keys(STATE.data.translit || {})) {
    const verses = STATE.data.translit[suraNum]?.verses || {};

    for (const verseNum of Object.keys(verses)) {
      pushSearchItem({
        source: 'translit',
        suraNum,
        verseNum,
        text: verses[verseNum]
      });
    }
  }

  if (FEATURE_STATE.ai.status === 'ready') {
    for (const suraNum of Object.keys(STATE.data.ai || {})) {
      const verses = STATE.data.ai[suraNum]?.verses || {};

      for (const verseNum of Object.keys(verses)) {
        pushSearchItem({
          source: 'ai',
          suraNum,
          verseNum,
          text: verses[verseNum]
        });
      }
    }
  }

  SEARCH_INDEX.ready = true;
  console.log('Quran search index hazır:', SEARCH_INDEX.quran.length);
}

function buildMealsSearchIndex() {
  SEARCH_INDEX.meals = [];
  SEARCH_INDEX.mealTokenMap.clear();

  for (const [mealName, verseIndex] of Object.entries(MEALS_STATE.index)) {
    for (const [verseId, payload] of Object.entries(verseIndex || {})) {
      const [suraNum, verseNum] = verseId.split(':');
      const text = String(payload?.text || payload?.translation || '');
      if (!text) continue;

      const normalized = normalizeSearchText(text);
      const itemIndex = SEARCH_INDEX.meals.length;

      SEARCH_INDEX.meals.push({
        type: 'meal',
        mealName,
        suraNum,
        verseNum,
        page: getVersePage(suraNum, verseNum),
        text,
        normalized
      });

      addSearchTokens(SEARCH_INDEX.mealTokenMap, normalized, itemIndex);
    }
  }

  SEARCH_INDEX.mealsReady = true;
  console.log('Meal search index hazır:', SEARCH_INDEX.meals.length);
}

function getIndexedSearchCandidates(items, tokenMap, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const candidateIndexes = new Set();

  queryTokens.forEach((queryToken) => {
    const exact = tokenMap.get(queryToken);
    exact?.forEach((index) => candidateIndexes.add(index));

    if (queryToken.length >= 3) {
      for (const [token, indexes] of tokenMap) {
        if (
          token.startsWith(queryToken) ||
          queryToken.startsWith(token) ||
          (Math.abs(token.length - queryToken.length) <= 2 && token[0] === queryToken[0])
        ) {
          indexes.forEach((index) => candidateIndexes.add(index));
        }
      }
    }
  });

  // Çok kısa veya hiç aday üretmeyen aramalarda davranışı koru.
  if (candidateIndexes.size === 0) {
    return normalizedQuery.length <= 2 ? items : items.slice(0, Math.min(items.length, 5000));
  }

  return [...candidateIndexes].map((index) => items[index]).filter(Boolean);
}

/* =========================
   Meal yükleme
========================= */
async function loadMeals() {
  if (MEALS_STATE.status === 'ready') return true;
  if (MEALS_STATE.status === 'loading') return MEALS_STATE.loadPromise;

  MEALS_STATE.status = 'loading';
  MEALS_STATE.loadedCount = 0;
  MEALS_STATE.index = Object.create(null);

  MEALS_STATE.loadPromise = (async () => {
    showLoading('Mealler yükleniyor...');

    try {
      for (let index = 0; index < CONFIG.mealFiles.length; index += CONFIG.batchSize) {
        const batch = CONFIG.mealFiles.slice(index, index + CONFIG.batchSize);

        await Promise.allSettled(
          batch.map(async (file) => {
            const filePath = `./data/mealler/${file}`;
            const response = await fetch(filePath, { cache: 'force-cache' });

            if (!response.ok) {
              throw new Error(`${file}: ${response.status}`);
            }

            const json = await response.json();
            const mealName = file.replace(/\.json$/i, '');

            STATE.data.meals[mealName] = json;
            MEALS_STATE.index[mealName] = normalizeMealData(json);
            MEALS_STATE.loadedCount += 1;
          })
        );

        updateLoadingProgress(
          Math.min(100, ((index + batch.length) / CONFIG.mealFiles.length) * 100)
        );
      }

      if (MEALS_STATE.loadedCount === 0) {
        throw new Error('Hiçbir meal dosyası yüklenemedi.');
      }

      MEALS_STATE.status = 'ready';
      buildMealsSearchIndex();
      console.log(`Mealler hazır (${MEALS_STATE.loadedCount}/${CONFIG.mealFiles.length})`);
      return true;
    } catch (error) {
      MEALS_STATE.status = 'error';
      console.error('Meal yükleme hatası:', error);
      showNotification('Meal dosyaları yüklenemedi.', 'warning');
      throw error;
    } finally {
      hideLoading();
      MEALS_STATE.loadPromise = null;
    }
  })();

  return MEALS_STATE.loadPromise;
}

function areMealsReady() {
  return MEALS_STATE.status === 'ready';
}

const WORD_TRANSLATIONS_STATE = {
  status: 'idle',
  loadPromise: null
};

/* =========================
   Menü / Sure listesi
========================= */
function buildSuraMenu() {
  const sortedSuraNums = Object.keys(STATE.metadata.sureNames)
    .sort((a, b) => Number(a) - Number(b));

  DOM.suraMenu.innerHTML = sortedSuraNums
    .map((suraNum) => `
      <li>
        <button
          type="button"
          class="sura-menu-link"
          data-action="go-sura"
          data-sura="${escapeHtml(suraNum)}"
        >
          ${escapeHtml(STATE.metadata.sureNames[suraNum])}
        </button>
      </li>
    `)
    .join('');
}

/* =========================
   Sayfa geçişi
========================= */
function showFirstRevealedVersePage() {
  ensureQuranView();
  setQuranReaderNavigationMode(false);
  closeSearchResultsPanel({ restoreFocus: false });
  STATE.currentView = 'first-revelation';

  DOM.content.innerHTML = `
    <div class="first-revelation-page">
      <div class="first-revelation-card">
        <img
          src="assets/images/logo-main.png"
          alt="Kuran Teyit logosu"
          class="first-revelation-logo"
          width="1024"
          height="1024"
        >

        <div class="first-revelation-site">
          KURAN TEYİT
        </div>

        <h2 class="first-revelation-title">
          İlk İnen Ayet
        </h2>

        <button
          type="button"
          class="first-revelation-back-btn"
          data-action="go-page"
          data-page="${FIRST_QURAN_DATA_PAGE}"
        >
          Fatiha Suresine Dön
        </button>

        <div class="first-revelation-arabic" dir="rtl">
          اقْرَأْ بِاسْمِ رَبِّكَ الَّذِي خَلَقَ
        </div>

        <div class="first-revelation-reading">
          İkra' bismi rabbikellezî halak.
        </div>

        <div class="first-revelation-translation">
          Oku, yaratan Rabbinin adıyla.
        </div>

        <div class="first-revelation-reference">
          Alak Suresi • 1. Ayet
        </div>
      </div>
    </div>
  `;

  window.scrollTo({ top: 0, behavior: 'auto' });
}

function goToFirstRevealedVersePage(options = {}) {
  const {
    historyMode = 'push',
    preserveAnalysisReturn = false
  } = options;

  if (!preserveAnalysisReturn) clearAnalysisReturnState();
  closeAnalysisPanel({ updateHistory: false, restoreFocus: false });
  showFirstRevealedVersePage();

  updateHistoryRoute(
    { view: 'first-revelation' },
    historyMode,
    { pageScrollTop: 0 }
  );

  return true;
}

function updateHistoryRoute(route, mode = 'push', extra = {}) {
  if (mode === 'none' || NAVIGATION_STATE.applyingHistory) return;

  const method = mode === 'replace' ? 'replaceState' : 'pushState';
  const state = createHistoryState(route, extra);
  const hash = buildRouteHash(route);
  const cleanUrl = `${window.location.pathname}${window.location.search}${hash}`;

  // Sayfa numarası ve manuel özel ekran URL'ye yazılmaz.
  history[method](state, '', cleanUrl);
  NAVIGATION_STATE.lastRoute = route;
}

function getLastAvailableQuranPage() {
  /*
    Öncelikle Kur'an'ın son ayeti olan
    114:6'nın bulunduğu gerçek veri sayfasını bulur.
  */
  const nasLastVersePage = Number(
    STATE.metadata.verseToPageMap['114:6']
  );

  if (
    Number.isInteger(nasLastVersePage) &&
    STATE.data.en?.[nasLastVersePage] &&
    STATE.data.tr?.[nasLastVersePage]
  ) {
    return nasLastVersePage;
  }

  /*
    114:6 haritası bulunamazsa, Türkçe ve İngilizce
    verilerde ortak bulunan en yüksek sayfa numarasını bulur.
  */
  const availablePages = Object
    .keys(STATE.data.tr || {})
    .map(Number)
    .filter((page) => {
      return (
        Number.isInteger(page) &&
        Boolean(STATE.data.en?.[page]) &&
        Boolean(STATE.data.tr?.[page])
      );
    });

  if (availablePages.length > 0) {
    return Math.max(...availablePages);
  }

  /*
    Veri henüz hazır değilse mevcut sabit değer
    yalnızca yedek olarak kullanılır.
  */
  return LAST_QURAN_DATA_PAGE;
}


function getAdjacentTarget(direction) {
  const actualLastPage =
    getLastAvailableQuranPage();

  /*
    Özel "İlk İnen Ayet" ekranındayken:
    Sol ok → Nas Suresi
    Sağ ok → Fatiha Suresi
  */
  if (STATE.currentView === 'first-revelation') {
    return direction === 'previous'
      ? {
          view: 'page',
          page: actualLastPage
        }
      : {
          view: 'page',
          page: FIRST_QURAN_DATA_PAGE
        };
  }

  /*
    Fatiha sayfasından geriye gidildiğinde
    özel İlk İnen Ayet ekranı açılır.
  */
  if (direction === 'previous') {
    return STATE.currentPage <= FIRST_QURAN_DATA_PAGE
      ? {
          view: 'first-revelation'
        }
      : {
          view: 'page',
          page: STATE.currentPage - 1
        };
  }

  /*
    Nas Suresi'nin son sayfasından ileri gidildiğinde
    özel İlk İnen Ayet ekranı açılır.
  */
  return STATE.currentPage >= actualLastPage
    ? {
        view: 'first-revelation'
      }
    : {
        view: 'page',
        page: STATE.currentPage + 1
      };
}

function navigateAdjacent(direction) {
  const normalizedDirection = direction === 'previous' ? 'previous' : 'next';
  const target = getAdjacentTarget(normalizedDirection);

  if (target.view === 'first-revelation') {
    return goToFirstRevealedVersePage();
  }

  return goToPage(target.page);
}

function validatePageNumber(pageNum) {
  const page = Number(pageNum);

  return Number.isInteger(page) &&
    page >= FIRST_QURAN_DATA_PAGE &&
    page <= LAST_QURAN_DATA_PAGE &&
    Boolean(STATE.data.en[page] && STATE.data.tr[page]);
}

async function applyRoute(route, options = {}) {
  const {
    historyMode = 'none',
    restoreScroll = false
  } = options;

  const targetRoute = route?.view ? route : { view: 'quran' };
  NAVIGATION_STATE.applyingHistory = historyMode === 'none';

  try {
    if (targetRoute.view === 'analysis') {
      if (!verseExists(targetRoute.sura, targetRoute.verse)) {
        showNotification('Bağlantıdaki analiz ayeti bulunamadı.', 'warning');
        return goToPage(FIRST_QURAN_DATA_PAGE, { historyMode: 'replace' });
      }

      const page = getVersePage(targetRoute.sura, targetRoute.verse);
      pendingHighlight = {
        suraNum: String(targetRoute.sura),
        verseNum: String(targetRoute.verse),
        query: '',
        openMeal: false,
        mealName: ''
      };

      renderQuranPage(page, { scrollTop: restoreScroll ? history.state?.pageScrollTop : null });
      await openAnalysisPanel(targetRoute.sura, targetRoute.verse, {
        historyMode,
        scrollTop: restoreScroll ? history.state?.analysisScrollTop : 0,
        trigger: null,
        parentRoute: history.state?.parentRoute || null
      });
      return true;
    }

    if (targetRoute.view === 'verse') {
      const analysisPanel = document.getElementById('analysisPanel');

      if (analysisPanel) {
        let parentRoute = null;

        try {
          parentRoute = JSON.parse(analysisPanel.dataset.parentRoute || 'null');
        } catch (error) {
          parentRoute = null;
        }

        const targetIsParent = parentRoute &&
          JSON.stringify(parentRoute) === JSON.stringify(targetRoute);

        if (!targetIsParent) {
          const panelBody = analysisPanel.querySelector('.analysis-panel-body');
          analysisReturnState = {
            suraNum: analysisPanel.dataset.analysisSura,
            verseNum: analysisPanel.dataset.analysisVerse,
            scrollTop: panelBody?.scrollTop || 0
          };
          updatePreviousButtonState();
        }
      }

      return goToVerse(targetRoute.sura, targetRoute.verse, {
        historyMode,
        source: 'history',
        restoreScroll,
        query: ''
      });
    }

    if (targetRoute.view === 'reader') {
      displayQuranReaderPage({
        historyMode,
        scrollTop: restoreScroll
          ? history.state?.pageScrollTop
          : 0,
        focusVerseId: history.state?.readerVerseId || ''
      });
      return true;
    }

    if (targetRoute.view === 'appendices') {
      await displayAppendicesReaderPage({
        historyMode,
        scrollTop: restoreScroll
          ? history.state?.pageScrollTop
          : 0,
        focusAppendix: history.state?.appendixNumber || ''
      });
      return true;
    }

    if (targetRoute.view === 'first-revelation') {
      return goToFirstRevealedVersePage({
        historyMode
      });
    }

    if (targetRoute.view === 'page') {
      return goToPage(targetRoute.page, {
        historyMode,
        restoreScroll
      });
    }

    return goToPage(FIRST_QURAN_DATA_PAGE, {
      historyMode: historyMode === 'none' ? 'replace' : historyMode
    });
  } finally {
    NAVIGATION_STATE.applyingHistory = false;
  }
}

function renderQuranPage(pageNum, options = {}) {
  const { scrollTop = null } = options;

  ensureQuranView();
  setQuranReaderNavigationMode(false);
  closeSearchResultsPanel({ restoreFocus: false });

  if (!validatePageNumber(pageNum)) {
    console.warn('Geçersiz veya eksik sayfa:', pageNum);
    showNotification('İstenen Kur’an sayfası bulunamadı.', 'warning');
    return false;
  }

  STATE.currentPage = Number(pageNum);
  STATE.currentView = 'page';
  displayPage(STATE.currentPage);

  if (Number.isFinite(scrollTop)) {
    requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: 'auto' }));
  } else if (!pendingHighlight) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return true;
}

function goToPage(pageNum, options = {}) {
  const {
    historyMode = 'push',
    restoreScroll = false,
    preserveAnalysisReturn = false
  } = options;

  if (!preserveAnalysisReturn) clearAnalysisReturnState();
  closeAnalysisPanel({ updateHistory: false, restoreFocus: false });

  if (!renderQuranPage(pageNum, {
    scrollTop: restoreScroll ? history.state?.pageScrollTop : null
  })) {
    return false;
  }

  updateHistoryRoute(
    { view: 'page', page: Number(pageNum) },
    historyMode,
    { pageScrollTop: window.scrollY }
  );

  return true;
}

function goToSura(suraNum, options = {}) {
  const page = getSuraStartPage(suraNum);

  if (!page) {
    showNotification('Sure başlangıç sayfası bulunamadı.', 'warning');
    return false;
  }

  closeSidebar();

  return goToVerse(suraNum, 1, {
    source: 'sura',
    ...options
  });
}

function goToVerse(suraNum, verseNum, options = {}) {
  const {
    historyMode = 'push',
    source = 'normal',
    query = activeSearchQuery || '',
    openMeal = false,
    mealName = '',
    restoreScroll = false
  } = options;

  const sura = String(suraNum);
  const verse = String(verseNum);
  const returnToReader = history.state?.route?.view === 'reader';
  const returnToAppendices = history.state?.route?.view === 'appendices';

  if (returnToReader) {
    saveQuranReaderPosition(`${sura}:${verse}`);
  }

  if (returnToAppendices) {
    saveAppendicesReaderPosition(history.state?.appendixNumber || '');
  }

  const page = getVersePage(sura, verse);

  if (!page || !verseExists(sura, verse)) {
    showNotification(`${sura}:${verse} ayeti bulunamadı.`, 'warning');
    return false;
  }

  if (source !== 'analysis' && source !== 'history') {
    clearAnalysisReturnState();
  }

  closeAnalysisPanel({ updateHistory: false, restoreFocus: false });

  pendingHighlight = {
    suraNum: sura,
    verseNum: verse,
    query,
    openMeal,
    mealName
  };

  if (!renderQuranPage(page, {
    scrollTop: restoreScroll ? history.state?.pageScrollTop : null
  })) {
    pendingHighlight = null;
    return false;
  }

  updateHistoryRoute(
    { view: 'verse', sura, verse },
    historyMode,
    { pageScrollTop: window.scrollY }
  );

  if (returnToReader && historyMode === 'push') {
    history.replaceState(
      {
        ...history.state,
        readerReturn: true,
        readerVerseId: `${sura}:${verse}`
      },
      '',
      window.location.href
    );
  }

  if (returnToAppendices && historyMode === 'push') {
    history.replaceState(
      {
        ...history.state,
        appendicesReturn: true,
        appendixNumber: String(history.state?.appendixNumber || '')
      },
      '',
      window.location.href
    );
  }

  return true;
}


/* =========================
   Scroll / highlight
========================= */
async function _applyHighlightAndScroll(suraNum, verseNum, query, openMeal, mealName) {
  const targetElement = document.querySelector(
    `.verse[data-verse-id="${String(suraNum)}:${String(verseNum)}"]`
  );

  if (!targetElement) {
    console.warn(`Ayet bulunamadı: ${suraNum}:${verseNum}`);
    return;
  }

const headerEl = document.querySelector('.header-bar');
const headerHeight = headerEl ? headerEl.offsetHeight : 0;

let scrollTarget = targetElement;

/*
  Ayetin hemen üzerinde pasaj başlığı varsa
  İngilizce başlıktan başlayarak ekranda göster.
*/
let previousElement = targetElement.previousElementSibling;
let passageTitleTarget = null;

while (
  previousElement &&
  (
    previousElement.classList.contains('passage-title') ||
    previousElement.classList.contains('passage-title-tr')
  )
) {
  passageTitleTarget = previousElement;
  previousElement = previousElement.previousElementSibling;
}

if (passageTitleTarget) {
  scrollTarget = passageTitleTarget;
} else if (String(verseNum) === '1') {
  const suraContainer = targetElement.closest('.sura');

  if (String(suraNum) === '1') {
    scrollTarget =
      document.querySelector('.page-header') ||
      suraContainer ||
      targetElement;
  } else {
    scrollTarget =
      suraContainer ||
      targetElement;
  }
}

const top = Math.max(
  0,
  scrollTarget.getBoundingClientRect().top +
    window.pageYOffset -
    headerHeight -
    8
);

  window.scrollTo({
    top,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth'
  });

  targetElement.classList.add('verse-search-highlight');
  setTimeout(() => targetElement.classList.remove('verse-search-highlight'), 5000);

  if (query) {
    applyTemporaryHighlightToVerse(targetElement, query, 5000);
  }

  if (openMeal) {
    setTimeout(async () => {
      await ensureMealOpen(suraNum, verseNum, query, mealName);
    }, 700);
  }
}

function applyTemporaryHighlightToVerse(
  verseElement,
  query,
  duration = 5000
) {
  if (!verseElement || !query) {
    return;
  }

  const cleanQuery =
    String(query).trim();

  if (!cleanQuery) {
    return;
  }

  const selectors = [
    '.verse-arabic',
    '.verse-text',
    '.verse-text-tr'
  ];

  const changedElements = [];

  selectors.forEach((selector) => {
    const element =
      verseElement.querySelector(selector);

    if (!element) {
      return;
    }

    const originalHtml =
      element.innerHTML;

    const walker =
      document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT
      );

    const textNodes = [];

    while (walker.nextNode()) {
      const node =
        walker.currentNode;

      if (
        node.parentElement?.closest(
          'button'
        )
      ) {
        continue;
      }

      textNodes.push(node);
    }

    let changed = false;

    textNodes.forEach((textNode) => {
      const text =
        textNode.nodeValue || '';

      const regex =
        new RegExp(
          escapeRegExp(cleanQuery),
          'gi'
        );

      if (!regex.test(text)) {
        return;
      }

      const wrapper =
        document.createElement('span');

      wrapper.innerHTML =
        escapeHtml(text).replace(
          new RegExp(
            escapeRegExp(cleanQuery),
            'gi'
          ),
          '<span class="search-result-highlight">$&</span>'
        );

      textNode.replaceWith(
        ...wrapper.childNodes
      );

      changed = true;
    });

    if (changed) {
      changedElements.push({
        element,
        originalHtml
      });
    }
  });

  setTimeout(() => {
    changedElements.forEach(
      ({ element, originalHtml }) => {
        if (!element.isConnected) {
          return;
        }

        element.innerHTML =
          originalHtml;
      }
    );

    decorateVerseWords();
  }, duration);
}

/* =========================
   Not map
========================= */
function mapNotesToVerses(notesData) {
  const noteMap = {};
  if (!notesData) return noteMap;

  notesData.forEach((note) => {
    const match = note.match(/^\*+\s*(\d+:\d+(-\d+)?)/);
    if (!match) return;

    const range = match[1];
    if (range.includes('-')) {
      const [start, end] = range.split('-');
      const [suraStart, verseStart] = start.split(':').map(Number);
      const [, verseEnd] = end.includes(':')
        ? end.split(':').map(Number)
        : [suraStart, Number(end)];

      for (let i = verseStart; i <= verseEnd; i++) {
        const key = `${suraStart}:${i}`;
        if (!noteMap[key]) noteMap[key] = [];
        noteMap[key].push(note);
      }
    } else {
      if (!noteMap[range]) noteMap[range] = [];
      noteMap[range].push(note);
    }
  });

  return noteMap;
}

/* =========================
   HTML üretimi
========================= */
function getArabic2Text(suraNum, verseNum) {
  const suraData = STATE.data.arabic2?.[String(suraNum)];
  if (!Array.isArray(suraData)) return '';

  const found = suraData.find((item) => String(item.verse) === String(verseNum));
  return found?.text || '';
}

function getErhanArabicText(suraNum, verseNum) {
  const surah = STATE.data.erhanArabic?.surahs?.find(
    (s) => String(s.id) === String(suraNum)
  );

  if (!surah || !Array.isArray(surah.verses)) return '';

  const verse = surah.verses.find(
    (v) => String(v.verse_number) === String(verseNum)
  );

  return verse?.verse || '';
}

async function loadWordTranslations() {
  if (WORD_TRANSLATIONS_STATE.status === 'ready') return;

  if (WORD_TRANSLATIONS_STATE.status === 'loading') {
    return WORD_TRANSLATIONS_STATE.loadPromise;
  }

  WORD_TRANSLATIONS_STATE.status = 'loading';

  WORD_TRANSLATIONS_STATE.loadPromise = loadDataFile(
    CONFIG.dataPaths.wordTranslations,
    'wordTranslations'
  )
    .then(() => {
      WORD_TRANSLATIONS_STATE.status = 'ready';
      console.log('Kelime çevirileri yüklendi.');
    })
    .catch((err) => {
      WORD_TRANSLATIONS_STATE.status = 'error';
      console.error('Kelime çevirileri yüklenemedi:', err);
      throw err;
    });

  return WORD_TRANSLATIONS_STATE.loadPromise;
}

function getWordTranslationHtml(suraNum, verseNum) {
  const key = `${suraNum}:${verseNum}`;
  const words = STATE.data.wordTranslations?.[key];

  if (!Array.isArray(words) || words.length === 0) {
    return '<div class="word-translation-empty">Kelime çevirisi bulunamadı.</div>';
  }

  return `
    <div class="word-translation-box">
      <div class="word-translation-title">🔤 Kelime Çevirisi</div>

      <div class="word-translation-table">
        <div class="word-translation-head">
          <span>#</span>
          <span>Kelime</span>
          <span>Okunuş</span>
          <span>Anlam</span>
          <span>Kök</span>
        </div>

        ${words.map((item, index) => `
          <div class="word-translation-row">
            <span>${item.sort || index + 1}</span>
            <strong class="word-arabic" dir="rtl">${escapeHtml(item.arabic || '')}</strong>
            <span>${escapeHtml(item.transcription_tr || '')}</span>
            <span>${escapeHtml(item.translation_tr || '')}</span>
            <span class="word-root" dir="rtl">${escapeHtml(item.root?.arabic || '')}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

async function loadArabicDetails(suraNum, verseNum, detailsElement = null) {
  const comparisonBox = document.getElementById(`arabic-comparison-${suraNum}-${verseNum}`);
  const wordBox = document.getElementById(`word-translation-${suraNum}-${verseNum}`);

  if (detailsElement?.dataset.loaded === 'true') return;

  if (comparisonBox) {
    comparisonBox.innerHTML = '<div class="word-translation-loading">Karşılaştırmalı Arapça veriler yükleniyor...</div>';
  }

  if (wordBox && wordBox.dataset.loaded !== 'true') {
    wordBox.innerHTML = '<div class="word-translation-loading">Kelime çevirileri yükleniyor...</div>';
  }

  const [comparisonResult, wordsResult] = await Promise.allSettled([
    ensureFeatureLoaded('arabicComparisons'),
    loadWordTranslations()
  ]);

  if (comparisonBox) {
    if (comparisonResult.status === 'fulfilled') {
      const arabic2Text = getArabic2Text(suraNum, verseNum);
      const erhanArabicText = getErhanArabicText(suraNum, verseNum);

      comparisonBox.innerHTML = `
        ${arabic2Text
          ? `
            <div class="arabic-label">İkinci Arapça - quran_arapca2.json</div>
            <div class="verse-arabic verse-arabic-2">${escapeHtml(arabic2Text)}</div>
          `
          : ''}

        ${erhanArabicText
          ? `
            <div class="arabic-label">Erhan Aktaş Arapçası - kuran_erhan_aktas.json</div>
            <div class="verse-arabic verse-arabic-2">${escapeHtml(erhanArabicText)}</div>
          `
          : ''}

        ${!arabic2Text && !erhanArabicText
          ? '<div class="optional-data-hint">Bu ayet için karşılaştırmalı Arapça metin bulunamadı.</div>'
          : ''}
      `;
    } else {
      comparisonBox.innerHTML = '<div class="word-translation-empty">Karşılaştırmalı Arapça veriler yüklenemedi.</div>';
    }
  }

  if (wordBox) {
    if (wordsResult.status === 'fulfilled') {
      wordBox.innerHTML = getWordTranslationHtml(suraNum, verseNum);
      wordBox.dataset.loaded = 'true';
    } else {
      wordBox.innerHTML = '<div class="word-translation-empty">Kelime çevirileri yüklenemedi.</div>';
    }
  }

  if (detailsElement) detailsElement.dataset.loaded = 'true';
  decorateVerseWords();
}

function findVerseData(suraNum, verseNum) {
  const page = getVersePage(String(suraNum), String(verseNum));
  const enVerse = STATE.data.en?.[page]?.sura?.[suraNum]?.verses?.[verseNum] || '';
  const trVerse = STATE.data.tr?.[page]?.sura?.[suraNum]?.verses?.[verseNum] || '';
  const arabic = STATE.data.en?.[page]?.sura?.[suraNum]?.encrypted?.[verseNum] || '';
  const translit = STATE.data.translit?.[suraNum]?.verses?.[verseNum] || '';

  return {
    verseId: `${suraNum}:${verseNum}`,
    sura: String(suraNum),
    verse: String(verseNum),
    page,
    arabic,
    english: enVerse,
    turkish: trVerse,
    transliteration: translit
  };
}

function buildAnalysisContext(suraNum, verseNum) {
  const mainVerse = findVerseData(String(suraNum), String(verseNum));
  const topics = findTopicsForVerse(String(suraNum), String(verseNum));
  const referenceVerses = getUniqueReferenceVerses(topics, 30);

  return {
    mainVerse,
    topics,
    referenceVerses
  };
}

function compareEvidenceVerseIds(left, right) {
  const [leftSura, leftVerse] = String(left).split(':').map(Number);
  const [rightSura, rightVerse] = String(right).split(':').map(Number);

  if (leftSura !== rightSura) return leftSura - rightSura;
  return leftVerse - rightVerse;
}

function collectEvidenceVerseIds(value) {
  const result = new Set();

  function visit(currentValue, depth = 0) {
    if (
      currentValue === null ||
      currentValue === undefined ||
      depth > 8
    ) {
      return;
    }

    if (typeof currentValue === 'string') {
      const matches = currentValue.match(/\b\d{1,3}:\d{1,3}\b/g);
      matches?.forEach((match) => result.add(match));
      return;
    }

    if (Array.isArray(currentValue)) {
      currentValue.forEach((item) => visit(item, depth + 1));
      return;
    }

    if (typeof currentValue === 'object') {
      Object.entries(currentValue).forEach(([key, item]) => {
        if (/^\d{1,3}:\d{1,3}$/.test(key)) result.add(key);
        visit(item, depth + 1);
      });
    }
  }

  visit(value);
  return [...result].sort(compareEvidenceVerseIds);
}

async function loadEvidenceSuraForCopy(suraNumber) {
  const normalizedSura = String(Number(suraNumber));

  if (!/^\d{1,3}$/.test(normalizedSura) || normalizedSura === '0') {
    throw new Error(`Geçersiz sure numarası: ${suraNumber}`);
  }

  if (!EVIDENCE_COPY_CACHE.suraPromises.has(normalizedSura)) {
    const loadPromise = fetch(
      `${EVIDENCE_COPY_CACHE.dataRoot}/suras/${normalizedSura}.json`,
      { cache: 'no-cache' }
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `${normalizedSura}. sure araştırma verisi yüklenemedi (${response.status})`
          );
        }

        return response.json();
      })
      .catch((error) => {
        EVIDENCE_COPY_CACHE.suraPromises.delete(normalizedSura);
        throw error;
      });

    EVIDENCE_COPY_CACHE.suraPromises.set(normalizedSura, loadPromise);
  }

  return EVIDENCE_COPY_CACHE.suraPromises.get(normalizedSura);
}

async function loadEvidenceVerseForCopy(verseId) {
  const match = String(verseId || '').match(/^(\d{1,3}):(\d{1,3})$/);
  if (!match) return null;

  const suraNumber = String(Number(match[1]));
  const verseNumber = String(Number(match[2]));
  const suraData = await loadEvidenceSuraForCopy(suraNumber);

  return suraData?.verses?.[verseNumber] || null;
}

function getEvidenceCopyGroups(verse) {
  if (!verse || typeof verse !== 'object') return [];

  const sourceVerseId = verse.id || `${verse.sura}:${verse.verse}`;
  const groups = [];
  const uniqueIds = (ids) => ids
    .filter(Boolean)
    .filter((verseId) => verseId !== sourceVerseId)
    .filter((verseId, index, array) => array.indexOf(verseId) === index);

  const previousAndNext = uniqueIds([
    verse.previous_verse,
    verse.next_verse
  ]);

  if (previousAndNext.length) {
    groups.push({
      title: 'Önceki ve sonraki ayet',
      ids: previousAndNext,
      experimental: false
    });
  }

  const lexicalIds = uniqueIds(
    collectEvidenceVerseIds(verse.lexical_neighbors)
  ).slice(0, 10);

  if (lexicalIds.length) {
    groups.push({
      title: 'Sözcüksel bağlantılar',
      ids: lexicalIds,
      experimental: false
    });
  }

  const clauseIds = uniqueIds(
    collectEvidenceVerseIds(verse.similar_phrase_patterns)
  ).slice(0, 10);

  if (clauseIds.length) {
    groups.push({
      title: 'Benzer cümlecik kalıpları',
      ids: clauseIds,
      experimental: false
    });
  }

  const themeIds = uniqueIds([
    ...collectEvidenceVerseIds(verse.filtered_theme_neighbors),
    ...collectEvidenceVerseIds(verse.topic_candidates)
  ]).slice(0, 10);

  if (themeIds.length) {
    groups.push({
      title: 'Deneysel tema bağlantıları',
      ids: themeIds,
      experimental: true
    });
  }

  return groups;
}

async function loadEvidenceCopyContext(verseId) {
  const sourceVerse = await loadEvidenceVerseForCopy(verseId);

  if (!sourceVerse) {
    throw new Error(`${verseId} için ayet araştırma verisi bulunamadı.`);
  }

  const groups = getEvidenceCopyGroups(sourceVerse);
  const relatedIds = [
    ...new Set(groups.flatMap((group) => group.ids))
  ];

  const relatedEntries = await Promise.all(
    relatedIds.map(async (relatedVerseId) => {
      try {
        return [
          relatedVerseId,
          await loadEvidenceVerseForCopy(relatedVerseId)
        ];
      } catch (error) {
        console.warn(
          `${relatedVerseId} araştırma bağlantısı yüklenemedi:`,
          error
        );

        return [relatedVerseId, null];
      }
    })
  );

  const relatedVerseMap = new Map(relatedEntries);

  return {
    sourceVerse,
    groups: groups.map((group) => ({
      ...group,
      verses: group.ids.map((relatedVerseId) => ({
        verseId: relatedVerseId,
        verse: relatedVerseMap.get(relatedVerseId) || null
      }))
    }))
  };
}

function getCopyValue(value, fallback = '—') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function buildTopicCopyItems(topics) {
  return topics.map((topic) => ({
    title: getCopyValue(topic.title, 'Başlıksız konu'),
    verses: topic.refs.slice(0, 12).map((ref) => {
      const [sura, verse] = String(ref).split(':');
      const verseData = findVerseData(sura, verse);

      return {
        verseId: ref,
        turkish: getCopyValue(
          verseData.turkish,
          'Türkçe çeviri bulunamadı.'
        )
      };
    })
  }));
}

function buildAnalysisCopyPayload(context, evidenceContext, evidenceError = null) {
  const title = `Ayet Analizi ${context.mainVerse.verseId}`;
  const turkishTopics = buildTopicCopyItems(context.topics.tr);
  const englishTopics = buildTopicCopyItems(context.topics.en);
  const plainLines = [
    title.toLocaleUpperCase('tr-TR'),
    '',
    'ANA AYET',
    `Ayet: ${context.mainVerse.verseId}`,
    `Arapça: ${getCopyValue(context.mainVerse.arabic)}`,
    `TR: ${getCopyValue(context.mainVerse.turkish)}`,
    `EN: ${getCopyValue(context.mainVerse.english)}`,
    `Okunuş: ${getCopyValue(context.mainVerse.transliteration)}`,
    '',
    'İLGİLİ KONULAR',
    '',
    'TÜRKÇE KONULAR'
  ];

  const appendPlainTopics = (topics, emptyText) => {
    if (!topics.length) {
      plainLines.push(emptyText);
      return;
    }

    topics.forEach((topic) => {
      plainLines.push(topic.title);
      topic.verses.forEach((verse) => {
        plainLines.push(`  ${verse.verseId} — ${verse.turkish}`);
      });
      plainLines.push('');
    });
  };

  appendPlainTopics(turkishTopics, 'Konu bulunamadı.');
  plainLines.push('İNGİLİZCE KONULAR');
  appendPlainTopics(englishTopics, 'Topic bulunamadı.');
  plainLines.push('AYET ARAŞTIRMA SONUÇLARI');
  plainLines.push(`Arama: ${context.mainVerse.verseId}`);
  plainLines.push('Arama türü: Ayet numarası');
  plainLines.push(`Bulunan ayet: ${evidenceContext ? 1 : 0}`);
  plainLines.push('');

  const baseStyle = [
    'font-family:Arial,Helvetica,sans-serif',
    'font-size:11pt',
    'line-height:1.5',
    'color:#111827',
    'max-width:900px'
  ].join(';');
  const sectionHeadingStyle = [
    'margin:24px 0 10px',
    'padding-bottom:5px',
    'border-bottom:2px solid #2563eb',
    'font-size:16pt',
    'color:#1e3a8a'
  ].join(';');
  const subHeadingStyle = [
    'margin:16px 0 8px',
    'font-size:13pt',
    'color:#1f2937'
  ].join(';');
  const cardStyle = [
    'margin:0 0 14px',
    'padding:12px 14px',
    'border:1px solid #94a3b8',
    'border-radius:6px',
    'background:#f8fafc'
  ].join(';');

  const renderHtmlTopics = (topics, emptyText) => {
    if (!topics.length) return `<p>${escapeHtml(emptyText)}</p>`;

    return topics.map((topic) => `
      <div style="${cardStyle}">
        <p style="margin:0 0 7px;"><strong>${escapeHtml(topic.title)}</strong></p>
        <ul style="margin:0;padding-left:22px;">
          ${topic.verses.map((verse) => `
            <li style="margin:3px 0;">
              <strong>${escapeHtml(verse.verseId)}</strong>
              — ${escapeHtml(verse.turkish)}
            </li>
          `).join('')}
        </ul>
      </div>
    `).join('');
  };

  let html = `
    <div style="${baseStyle}">
      <h1 style="margin:0 0 18px;font-size:20pt;color:#0f172a;">
        ${escapeHtml(title)}
      </h1>

      <h2 style="${sectionHeadingStyle}">Ana Ayet</h2>
      <div style="${cardStyle}">
        <p style="margin:0 0 10px;"><strong>Ayet:</strong> ${escapeHtml(context.mainVerse.verseId)}</p>
        <p dir="rtl" style="margin:0 0 12px;text-align:right;font-size:18pt;line-height:1.9;font-family:'Traditional Arabic','Arial',sans-serif;">
          ${escapeHtml(getCopyValue(context.mainVerse.arabic))}
        </p>
        <p style="margin:6px 0;"><strong>TR:</strong> ${escapeHtml(getCopyValue(context.mainVerse.turkish))}</p>
        <p style="margin:6px 0;"><strong>EN:</strong> ${escapeHtml(getCopyValue(context.mainVerse.english))}</p>
        <p style="margin:6px 0;"><strong>Okunuş:</strong> ${escapeHtml(getCopyValue(context.mainVerse.transliteration))}</p>
      </div>

      <h2 style="${sectionHeadingStyle}">İlgili Konular</h2>
      <h3 style="${subHeadingStyle}">Türkçe Konular</h3>
      ${renderHtmlTopics(turkishTopics, 'Konu bulunamadı.')}
      <h3 style="${subHeadingStyle}">İngilizce Konular</h3>
      ${renderHtmlTopics(englishTopics, 'Topic bulunamadı.')}

      <h2 style="${sectionHeadingStyle}">Ayet Araştırma Sonuçları</h2>
      <div style="${cardStyle}">
        <p style="margin:4px 0;"><strong>Arama:</strong> ${escapeHtml(context.mainVerse.verseId)}</p>
        <p style="margin:4px 0;"><strong>Arama türü:</strong> Ayet numarası</p>
        <p style="margin:4px 0;"><strong>Bulunan ayet:</strong> ${evidenceContext ? '1' : '0'}</p>
      </div>
  `;

  if (evidenceContext) {
    const sourceVerse = evidenceContext.sourceVerse;
    const sourceVerseId = sourceVerse.id ||
      `${sourceVerse.sura}:${sourceVerse.verse}`;

    plainLines.push('KAYNAK AYET');
    plainLines.push(sourceVerseId);
    plainLines.push(`Arapça: ${getCopyValue(sourceVerse.text_ar)}`);
    plainLines.push(`English: ${getCopyValue(sourceVerse.text_en)}`);
    plainLines.push(`Türkçe: ${getCopyValue(sourceVerse.text_tr)}`);
    plainLines.push('');

    html += `
      <h3 style="${subHeadingStyle}">Kaynak Ayet — ${escapeHtml(sourceVerseId)}</h3>
      <div style="${cardStyle}">
        <p dir="rtl" style="margin:0 0 12px;text-align:right;font-size:18pt;line-height:1.9;font-family:'Traditional Arabic','Arial',sans-serif;">
          ${escapeHtml(getCopyValue(sourceVerse.text_ar))}
        </p>
        <p style="margin:6px 0;"><strong>English:</strong> ${escapeHtml(getCopyValue(sourceVerse.text_en))}</p>
        <p style="margin:6px 0;"><strong>Türkçe:</strong> ${escapeHtml(getCopyValue(sourceVerse.text_tr))}</p>
      </div>
    `;

    evidenceContext.groups.forEach((group) => {
      plainLines.push(group.title.toLocaleUpperCase('tr-TR'));

      group.verses.forEach(({ verseId, verse }) => {
        plainLines.push(
          `${verseId} — ${getCopyValue(
            verse?.text_tr,
            'Türkçe çeviri bulunamadı.'
          )}`
        );
      });

      if (group.experimental) {
        plainLines.push(
          'Not: Deneysel tema bağlantıları istatistiksel bağlantı adaylarıdır; kesin hüküm veya kesin anlam kanıtı değildir.'
        );
      }

      plainLines.push('');

      html += `
        <h3 style="${subHeadingStyle}">${escapeHtml(group.title)}</h3>
        <div style="${cardStyle}">
          <ul style="margin:0;padding-left:22px;">
            ${group.verses.map(({ verseId, verse }) => `
              <li style="margin:5px 0;">
                <strong>${escapeHtml(verseId)}</strong>
                — ${escapeHtml(getCopyValue(
                  verse?.text_tr,
                  'Türkçe çeviri bulunamadı.'
                ))}
              </li>
            `).join('')}
          </ul>
          ${group.experimental
            ? `
              <p style="margin:10px 0 0;padding:8px;border-left:4px solid #d97706;background:#fffbeb;">
                <strong>Not:</strong> Deneysel tema bağlantıları istatistiksel bağlantı adaylarıdır;
                kesin hüküm veya kesin anlam kanıtı değildir.
              </p>
            `
            : ''}
        </div>
      `;
    });
  } else {
    const errorMessage = getCopyValue(
      evidenceError?.message,
      'Ayet araştırma verisi yüklenemedi.'
    );

    plainLines.push(errorMessage);
    html += `
      <div style="${cardStyle};border-color:#dc2626;background:#fef2f2;">
        <strong>Ayet araştırma verisi yüklenemedi:</strong>
        ${escapeHtml(errorMessage)}
      </div>
    `;
  }

  html += '</div>';

  return {
    html,
    text: plainLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  };
}

function copyHtmlWithSelection(html) {
  const copyArea = document.createElement('div');
  copyArea.contentEditable = 'true';
  copyArea.setAttribute('aria-hidden', 'true');
  copyArea.style.position = 'fixed';
  copyArea.style.left = '-100000px';
  copyArea.style.top = '0';
  copyArea.style.width = '900px';
  copyArea.style.opacity = '0';
  copyArea.innerHTML = html;
  document.body.appendChild(copyArea);

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(copyArea);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let copied = false;

  try {
    copied = document.execCommand('copy');
  } catch (error) {
    console.warn('Biçimli kopyalama yöntemi çalışmadı:', error);
  }

  selection?.removeAllRanges();
  copyArea.remove();
  return copied;
}

function copyPlainTextWithTextarea(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-100000px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;

  try {
    copied = document.execCommand('copy');
  } catch (error) {
    console.warn('Düz metin kopyalama yöntemi çalışmadı:', error);
  }

  textarea.remove();
  return copied;
}

async function writeAnalysisClipboard(html, text) {
  if (
    navigator.clipboard?.write &&
    typeof ClipboardItem !== 'undefined'
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })
      ]);
      return;
    } catch (error) {
      console.warn('Modern biçimli pano API kullanılamadı:', error);
    }
  }

  if (copyHtmlWithSelection(html)) return;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn('Düz metin pano API kullanılamadı:', error);
    }
  }

  if (copyPlainTextWithTextarea(text)) return;
  throw new Error('Tarayıcı panoya erişim izni vermedi.');
}

function prepareAnalysisCopyButton(panel, context) {
  const button = panel.querySelector('[data-action="copy-analysis"]');
  const status = panel.querySelector('.analysis-copy-status');

  panel.analysisCopyState = {
    ready: false,
    context,
    evidenceContext: null,
    evidenceError: null
  };

  loadEvidenceCopyContext(context.mainVerse.verseId)
    .then((evidenceContext) => {
      if (!panel.isConnected) return;

      panel.analysisCopyState = {
        ready: true,
        context,
        evidenceContext,
        evidenceError: null
      };

      if (button) {
        button.disabled = false;
        button.textContent = 'Kopyala';
      }

      if (status) {
        status.classList.remove('error');
        status.textContent = 'Word için biçimli kopyalama hazır.';
      }
    })
    .catch((error) => {
      console.error('Ayet araştırma kopyalama verisi hazırlanamadı:', error);
      if (!panel.isConnected) return;

      panel.analysisCopyState = {
        ready: true,
        context,
        evidenceContext: null,
        evidenceError: error
      };

      if (button) {
        button.disabled = false;
        button.textContent = 'Kopyala';
      }

      if (status) {
        status.classList.add('error');
        status.textContent =
          'Araştırma verisi yüklenemedi; analiz bölümleri yine kopyalanabilir.';
      }
    });
}

async function copyAnalysisPanelContent(panel, button) {
  const copyState = panel.analysisCopyState;

  if (!copyState?.ready) {
    showNotification(
      'Kopyalama verisi henüz hazırlanıyor. Lütfen kısa bir süre bekleyin.',
      'warning'
    );
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Kopyalanıyor...';

  try {
    const payload = buildAnalysisCopyPayload(
      copyState.context,
      copyState.evidenceContext,
      copyState.evidenceError
    );

    await writeAnalysisClipboard(payload.html, payload.text);

    button.textContent = 'Kopyalandı ✓';
    showNotification(
      'Ana ayet, ilgili konular ve ayet araştırma sonuçları Word için kopyalandı.',
      'success',
      5000
    );
  } catch (error) {
    console.error('Ayet analizi kopyalanamadı:', error);
    button.textContent = 'Kopyalanamadı';
    showNotification(
      'Kopyalama başarısız oldu. Tarayıcı veya uygulama pano iznini kontrol edin.',
      'error',
      6000
    );
  } finally {
    setTimeout(() => {
      if (!button.isConnected) return;
      button.disabled = false;
      button.textContent = originalText || 'Kopyala';
    }, 1600);
  }
}

function flattenMapTopics(mapObj, lang = 'tr') {
  const results = [];

  function walk(node, path = []) {
    if (!node || typeof node !== 'object') return;

    for (const key of Object.keys(node)) {
      const value = node[key];
      const nextPath = [...path, key];

      if (typeof value === 'string') {
        const refs = expandVerseRefs(value);

        if (refs.length) {
          results.push({
            lang,
            title: nextPath.join(' > '),
            rawRefs: value,
            refs
          });
        }
      } else if (value && typeof value === 'object') {
        walk(value, nextPath);
      }
    }
  }

  walk(mapObj);
  return results;
}

function buildTopicIndexes() {
  TOPIC_INDEX.tr.clear();
  TOPIC_INDEX.en.clear();

  for (const language of ['tr', 'en']) {
    const mapData = language === 'tr' ? STATE.data.mapTr : STATE.data.mapEn;
    const topics = flattenMapTopics(mapData, language);

    topics.forEach((topic) => {
      topic.refs.forEach((verseId) => {
        if (!TOPIC_INDEX[language].has(verseId)) {
          TOPIC_INDEX[language].set(verseId, []);
        }

        TOPIC_INDEX[language].get(verseId).push(topic);
      });
    });
  }
}

function findTopicsForVerse(suraNum, verseNum) {
  const verseId = `${suraNum}:${verseNum}`;

  return {
    tr: TOPIC_INDEX.tr.get(verseId) || [],
    en: TOPIC_INDEX.en.get(verseId) || []
  };
}

function getUniqueReferenceVerses(topics, limit = 20) {
  const seen = new Set();
  const refs = [];

  [...topics.tr, ...topics.en].forEach((topic) => {
    topic.refs.forEach((ref) => {
      if (seen.has(ref)) return;
      seen.add(ref);
      refs.push(ref);
    });
  });

  return refs
    .slice(0, limit)
    .map((ref) => {
      const [sura, verse] = ref.split(':');
      return findVerseData(sura, verse);
    })
    .filter((verseData) => verseData.page);
}

function updatePreviousButtonState() {
  const previousButton = document.getElementById('prevPage');
  if (!previousButton) return;

  const hasSearchReturn = Boolean(
    history.state?.route?.view === 'verse' &&
    (history.state?.searchReturn?.query || SEARCH_RETURN_STATE.active?.query)
  );

  const label = hasSearchReturn
    ? 'Arama sonuçlarına dön'
    : analysisReturnState
      ? 'Ayet analizine dön'
      : 'Önceki sayfa';

  previousButton.setAttribute('aria-label', label);
  previousButton.title = label;
}

function clearAnalysisReturnState() {
  analysisReturnState = null;
  updatePreviousButtonState();
}

function openVerseFromAnalysis(suraNum, verseNum) {
  const panel = document.getElementById('analysisPanel');

  if (!panel) {
    goToVerse(suraNum, verseNum);
    return;
  }

  const panelBody = panel.querySelector('.analysis-panel-body');

  analysisReturnState = {
    suraNum: panel.dataset.analysisSura,
    verseNum: panel.dataset.analysisVerse,
    scrollTop: panelBody?.scrollTop || 0
  };

  if (history.state?.route?.view === 'analysis') {
    history.replaceState({
      ...history.state,
      analysisScrollTop: analysisReturnState.scrollTop
    }, '', window.location.href);
  }

  updatePreviousButtonState();
  closeAnalysisPanel({ updateHistory: false, restoreFocus: false });
  goToVerse(suraNum, verseNum, {
    source: 'analysis',
    historyMode: 'push'
  });
}

function restoreAnalysisPanelFromHistory() {
  if (!analysisReturnState) return false;

  const savedState = analysisReturnState;
  clearAnalysisReturnState();

  if (history.state?.route?.view === 'verse' && history.length > 1) {
    history.back();
    return true;
  }

  openAnalysisPanel(savedState.suraNum, savedState.verseNum, {
    scrollTop: savedState.scrollTop,
    historyMode: 'replace'
  });

  return true;
}

function trapDialogFocus(panel, event) {
  if (event.key !== 'Tab') return;

  const focusable = [...panel.querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden && element.offsetParent !== null);

  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function openAnalysisPanel(suraNum, verseNum, options = {}) {
  const requestId = ++activeAnalysisRequestId;
  const {
    scrollTop = 0,
    historyMode = 'push',
    trigger = document.activeElement,
    parentRoute: requestedParentRoute = null
  } = options;

  if (!verseExists(suraNum, verseNum)) {
    showNotification(`${suraNum}:${verseNum} ayeti analiz için bulunamadı.`, 'warning');
    return false;
  }

  clearAnalysisReturnState();

  showLoading('Ayet analizi hazırlanıyor...');

  try {
    await ensureFeatureLoaded('analysis');
  } catch (error) {
    showNotification('Konu haritaları yüklenemedi; temel ayet bilgisi gösteriliyor.', 'warning');
  } finally {
    hideLoading();
  }

  if (requestId !== activeAnalysisRequestId) return false;

  const context = buildAnalysisContext(suraNum, verseNum);
  const existing = document.getElementById('analysisPanel');
  if (existing) existing.remove();

  lastDialogTrigger = trigger instanceof HTMLElement ? trigger : null;

  const panel = document.createElement('section');
  panel.id = 'analysisPanel';
  panel.className = 'analysis-panel';
  panel.dataset.analysisSura = context.mainVerse.sura;
  panel.dataset.analysisVerse = context.mainVerse.verse;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'analysisPanelTitle');

  panel.innerHTML = `
    <div class="analysis-panel-header">
      <h2 id="analysisPanelTitle">🔎 Ayet Analizi ${escapeHtml(context.mainVerse.verseId)}</h2>
      <button
        type="button"
        data-action="close-analysis"
        class="analysis-close-btn"
        aria-label="Ayet analizini kapat"
      >✕</button>
    </div>

    <div class="analysis-panel-body">
      <h3>Ana Ayet</h3>

      <div class="analysis-card">
        <div class="analysis-arabic">${escapeHtml(context.mainVerse.arabic)}</div>
        <p><strong>TR:</strong> ${escapeHtml(context.mainVerse.turkish)}</p>
        <p><strong>EN:</strong> ${escapeHtml(context.mainVerse.english)}</p>
        <p><strong>Okunuş:</strong> ${escapeHtml(context.mainVerse.transliteration)}</p>
      </div>

      <h3>İlgili Konular</h3>
      <div class="analysis-card">
        <h4>Türkçe Konular</h4>
        ${context.topics.tr.length
          ? context.topics.tr.map((topic) => `
              <div class="analysis-topic">
                <strong>${escapeHtml(topic.title)}</strong>
                <div class="analysis-topic-verses">${renderTopicReferenceVerses(topic)}</div>
              </div>
            `).join('')
          : '<p>Konu bulunamadı.</p>'}

        <h4>İngilizce Konular</h4>
        ${context.topics.en.length
          ? context.topics.en.map((topic) => `
              <div class="analysis-topic">
                <strong>${escapeHtml(topic.title)}</strong>
                <div class="analysis-topic-verses">${renderTopicReferenceVerses(topic)}</div>
              </div>
            `).join('')
          : '<p>Topic bulunamadı.</p>'}
      </div>

      <h3>Referans Ayetler</h3>
      <div class="analysis-card">
        ${context.referenceVerses.length
          ? context.referenceVerses.map((verseData) => `
              <button
                type="button"
                class="analysis-ref-verse analysis-verse-link"
                data-sura="${escapeHtml(verseData.sura)}"
                data-verse="${escapeHtml(verseData.verse)}"
                aria-label="${escapeHtml(verseData.verseId)} ayetine git"
              >
                <strong class="analysis-verse-id">${escapeHtml(verseData.verseId)}</strong>
                <span class="analysis-arabic-small">${escapeHtml(verseData.arabic)}</span>
                <span><strong>TR:</strong> ${escapeHtml(verseData.turkish)}</span>
                <span><strong>EN:</strong> ${escapeHtml(verseData.english)}</span>
              </button>
            `).join('')
          : '<p>Referans ayet bulunamadı.</p>'}
      </div>

      <div class="analysis-copy-section">
        <button
          type="button"
          class="toggle-btn analysis-copy-btn"
          data-action="copy-analysis"
          data-sura="${escapeHtml(context.mainVerse.sura)}"
          data-verse="${escapeHtml(context.mainVerse.verse)}"
          disabled
        >Kopyalama verisi hazırlanıyor...</button>

        <p class="analysis-copy-status" role="status" aria-live="polite">
          Ayet Araştırma sonuçları hazırlanıyor.
        </p>
      </div>
    </div>
  `;

  panel.addEventListener('click', (event) => {
    const copyButton = event.target.closest('[data-action="copy-analysis"]');

    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();
      copyAnalysisPanelContent(panel, copyButton);
      return;
    }

    const target = event.target.closest('.analysis-verse-link');
    if (!target) return;
    openVerseFromAnalysis(target.dataset.sura, target.dataset.verse);
  });

  panel.addEventListener('keydown', (event) => trapDialogFocus(panel, event));

  document.body.appendChild(panel);
  document.body.classList.add('analysis-open');
  prepareAnalysisCopyButton(panel, context);

  const currentHistoryState = history.state;
  const currentHistoryRoute = currentHistoryState?.route;
  const parentRoute = requestedParentRoute ||
    (currentHistoryRoute?.view === 'analysis'
      ? currentHistoryState?.parentRoute
      : currentHistoryRoute) || {
      view: 'verse',
      sura: String(suraNum),
      verse: String(verseNum)
    };

  panel.dataset.parentRoute = JSON.stringify(parentRoute);

  updateHistoryRoute(
    { view: 'analysis', sura: String(suraNum), verse: String(verseNum) },
    historyMode,
    {
      analysisScrollTop: Number(scrollTop) || 0,
      parentRoute
    }
  );

  requestAnimationFrame(() => {
    const panelBody = panel.querySelector('.analysis-panel-body');
    if (panelBody) panelBody.scrollTop = Number(scrollTop) || 0;
    panel.querySelector('.analysis-close-btn')?.focus();
  });

  return true;
}

function renderTopicReferenceVerses(topic, limit = 12) {
  return topic.refs.slice(0, limit).map((ref) => {
    const [sura, verse] = ref.split(':');
    const verseData = findVerseData(sura, verse);

    if (!verseData.page) return '';

    return `
      <button
        type="button"
        class="analysis-topic-verse analysis-verse-link"
        data-sura="${escapeHtml(verseData.sura)}"
        data-verse="${escapeHtml(verseData.verse)}"
        aria-label="${escapeHtml(verseData.verseId)} ayetine git"
      >
        <span class="analysis-verse-id">${escapeHtml(verseData.verseId)}</span>
        <span class="analysis-verse-text">
          ${escapeHtml(verseData.turkish || 'Türkçe çeviri bulunamadı.')}
        </span>
      </button>
    `;
  }).join('');
}

function closeAnalysisPanel(options = {}) {
  const {
    updateHistory = true,
    restoreFocus = true
  } = options;

  activeAnalysisRequestId += 1;

  const panel = document.getElementById('analysisPanel');
  if (!panel) {
    document.body.classList.remove('analysis-open');
    return;
  }

  const currentState = history.state;
  panel.remove();
  document.body.classList.remove('analysis-open');

  if (restoreFocus && lastDialogTrigger?.isConnected) {
    lastDialogTrigger.focus();
  }

  lastDialogTrigger = null;

  if (updateHistory && currentState?.route?.view === 'analysis') {
    if (currentState.parentRoute && history.length > 1) {
      history.back();
    } else {
      goToVerse(
        currentState.route.sura,
        currentState.route.verse,
        { historyMode: 'replace', source: 'history' }
      );
    }
  }
}

function buildPageHtml(pageNum) {
  const enPage = STATE.data.en[pageNum];
  const trPage = STATE.data.tr[pageNum];

  if (!enPage?.sura || !trPage?.sura) {
    return '<div class="error-message">Bu sayfanın metin verileri eksik.</div>';
  }

  const suraNums = Object.keys(enPage.sura)
    .sort((a, b) => Number(a) - Number(b));

  const pageTitle = suraNums
    .map((num) => STATE.metadata.sureNames[num] || `Sure ${num}`)
    .join(' | ') || 'Bilinmeyen';

  let html = `
    <div class="page-header">
      <h1>${escapeHtml(pageTitle)}</h1>
    </div>
  `;

  const enNotesMap = mapNotesToVerses(enPage.notes?.data);
  const trNotesMap = mapNotesToVerses(trPage.notes?.data);

  for (const suraNum of suraNums) {
    const enSura = enPage.sura[suraNum];
    const trSura = trPage.sura[suraNum] || { verses: {} };

    html += '<div class="sura">';

    const verseKeys = Object.keys(enSura.verses || {})
      .sort((a, b) => Number(a) - Number(b));

    for (const verseNum of verseKeys) {
      if (enSura.titles?.[verseNum]) {
        html += `
          <div class="passage-title">${escapeHtml(enSura.titles[verseNum])}</div>
          ${trSura.titles?.[verseNum]
            ? `<div class="passage-title-tr">${escapeHtml(trSura.titles[verseNum])}</div>`
            : ''}
        `;
      }

      const verseKey = `${suraNum}:${verseNum}`;
      const hasNotes = Boolean(enNotesMap[verseKey]?.length || trNotesMap[verseKey]?.length);
      const transliterationText = STATE.data.translit?.[String(suraNum)]?.verses?.[String(verseNum)] || '';
      const hasUserNote = getLocalNote(suraNum, verseNum);

      html += `
        <article
          class="verse"
          data-verse-id="${escapeHtml(verseKey)}"
          data-sura="${escapeHtml(suraNum)}"
          data-verse="${escapeHtml(verseNum)}"
        >
          <div class="verse-header">
            <div></div>

            <div class="verse-number">${suraNum} : ${verseNum}</div>

            <details
              class="arabic-section"
              data-action="arabic-details"
              data-sura="${escapeHtml(suraNum)}"
              data-verse="${escapeHtml(verseNum)}"
            >
              <summary>Arapça</summary>

              <div class="arabic-dropdown-content">
                <div class="arabic-label">Standart Arapça - qurantft.json</div>
                <div class="verse-arabic">${escapeHtml(enSura.encrypted?.[verseNum] || '')}</div>

                <div
                  id="arabic-comparison-${suraNum}-${verseNum}"
                  class="arabic-comparison-container"
                  aria-live="polite"
                >
                  <div class="optional-data-hint">
                    Karşılaştırmalı Arapça metinler açıldığında yüklenir.
                  </div>
                </div>

                <div
                  id="word-translation-${suraNum}-${verseNum}"
                  class="word-translation-container"
                  aria-live="polite"
                ></div>
              </div>
            </details>
          </div>
      `;

      if (STATE.settings.showTransliteration) {
        html += `
          <div class="verse-transliteration">
            ${transliterationText
              ? `
                <span class="audio-control-group">
                  <button
                    type="button"
                    class="audio-control-btn audio-play-btn"
                    data-action="speak-arabic"
                    data-sura="${escapeHtml(suraNum)}"
                    data-verse="${escapeHtml(verseNum)}"
                    title="Sesi oynat"
                    aria-label="${escapeHtml(verseKey)} Arapça sesini oynat"
                  >
                    <span class="audio-play-icon" aria-hidden="true"></span>
                  </button>

                  <button
                    type="button"
                    class="audio-control-btn audio-stop-btn"
                    data-action="stop-audio"
                    title="Sesi durdur"
                    aria-label="Sesi durdur"
                  >
                    <span class="audio-stop-icon" aria-hidden="true"></span>
                  </button>
                </span>
              `
              : ''}

            <span class="transliteration-text">${escapeHtml(transliterationText)}</span>
          </div>
        `;
      }

      html += `
        <div class="verse-text verse-text-with-audio">
          <span class="verse-english-main">
            <span class="verse-text-content">${escapeHtml(enSura.verses[verseNum])}</span>

            <button
              type="button"
              class="inline-speak-btn audio-control-btn audio-play-btn"
              data-action="speak-english"
              data-sura="${escapeHtml(suraNum)}"
              data-verse="${escapeHtml(verseNum)}"
              title="İngilizce oku"
              aria-label="${escapeHtml(verseKey)} İngilizce metnini oku"
            >
              <span class="audio-play-icon" aria-hidden="true"></span>
            </button>
          </span>

          <button
            type="button"
            class="verse-1989-link"
            data-action="toggle-1989"
            data-target="quran1989-${suraNum}-${verseNum}"
            data-sura="${escapeHtml(suraNum)}"
            data-verse="${escapeHtml(verseNum)}"
            aria-controls="quran1989-${suraNum}-${verseNum}"
            aria-expanded="false"
            title="1989 Authorized English Version metnini göster"
          >1989 Baskısı</button>
        </div>

        <div
          id="quran1989-${suraNum}-${verseNum}"
          class="verse-1989-panel"
          hidden
          aria-live="polite"
        ></div>

        <div class="verse-text-tr">
          <strong>${escapeHtml(trSura.verses?.[verseNum] || '')}</strong>
        </div>

        <div class="buttons">
          ${hasNotes
            ? `
              <button
                type="button"
                class="toggle-btn dipnot-btn"
                data-action="toggle-footnote"
                data-target="note-${suraNum}-${verseNum}"
                aria-controls="note-${suraNum}-${verseNum}"
                aria-expanded="false"
              >Dipnot</button>
            `
            : ''}

          ${STATE.settings.showMeals
            ? `
              <button
                type="button"
                class="toggle-btn"
                id="meal-btn-${suraNum}-${verseNum}"
                data-action="toggle-meal"
                data-target="meal-${suraNum}-${verseNum}"
                data-sura="${escapeHtml(suraNum)}"
                data-verse="${escapeHtml(verseNum)}"
                aria-controls="meal-${suraNum}-${verseNum}"
                aria-expanded="false"
              >Mealler</button>
            `
            : ''}

          <button
            type="button"
            class="toggle-btn analysis-btn"
            data-action="open-analysis"
            data-sura="${escapeHtml(suraNum)}"
            data-verse="${escapeHtml(verseNum)}"
          >Analiz</button>

          <button
            type="button"
            id="noteBtn-${suraNum}-${verseNum}"
            class="toggle-btn note-btn ${hasUserNote ? 'has-note' : ''}"
            data-action="toggle-note-input"
            data-target="note-input-box-${suraNum}-${verseNum}"
            data-sura="${escapeHtml(suraNum)}"
            data-verse="${escapeHtml(verseNum)}"
          >${hasUserNote ? 'Notlu' : 'Not Al'}</button>
        </div>
      `;

      if (STATE.settings.showAiTranslation) {
        const aiText = STATE.data.ai?.[suraNum]?.verses?.[verseNum] || '';
        html += `
          <div id="ai-translation-${suraNum}-${verseNum}" class="ai-translation">
            <strong>AI ÇEVİRİ:</strong>
            ${aiText ? escapeHtml(aiText) : 'Çeviri bulunamadı.'}
          </div>
        `;
      }

      if (hasNotes) {
        html += `
          <div id="note-${suraNum}-${verseNum}" class="note-box footnote-box hidden">
            ${(enNotesMap[verseKey] || []).map((note) => `
              <div class="footnote-line footnote-en">
                <strong class="footnote-name">EN:</strong>
                <span class="footnote-text">${escapeHtml(note)}</span>
              </div>
            `).join('')}

            ${enNotesMap[verseKey]?.length && trNotesMap[verseKey]?.length
              ? '<div class="note-separator"></div>'
              : ''}

            ${(trNotesMap[verseKey] || []).map((note) => `
              <div class="footnote-line footnote-tr">
                <strong class="footnote-name">TR:</strong>
                <span class="footnote-text">${escapeHtml(note)}</span>
              </div>
            `).join('')}
          </div>
        `;
      }
      html += `
        <div id="user-note-${suraNum}-${verseNum}" class="note-box hidden"></div>
        <div id="meal-${suraNum}-${verseNum}" class="note-box hidden" aria-live="polite"></div>
      </article>
      `;
    }

    html += '</div>';
  }

  html += `
    <div class="page-footer">
      <button
        type="button"
        class="header-btn page-footer-btn"
        data-action="navigate-adjacent"
        data-direction="previous"
      >← Önceki Sayfa</button>

      <button
        type="button"
        class="header-btn page-footer-btn"
        data-action="navigate-adjacent"
        data-direction="next"
      >Sonraki Sayfa →</button>
    </div>
  `;

  return html;
}

function afterPageRender() {
  document.querySelectorAll('.verse-arabic').forEach((el) => {
    el.style.textAlign = 'right';
    el.style.direction = 'rtl';
  });

  decorateVerseWords();
  loadNotesForCurrentPage();
  applySettings();

  if (pendingHighlight) {
    const ph = pendingHighlight;
    pendingHighlight = null;

    requestAnimationFrame(() => {
      _applyHighlightAndScroll(
        ph.suraNum,
        ph.verseNum,
        ph.query,
        ph.openMeal,
        ph.mealName
      );
    });
  }
}

function displayPage(pageNum) {
  if (!STATE.data.en[pageNum] || !STATE.data.tr[pageNum]) {
    console.error(
      `Sayfa verisi bulunamadı. Veri anahtarı: ${pageNum}`
    );

    showFirstRevealedVersePage();
    return;
  }

  if (PAGE_CACHE.has(pageNum)) {
    DOM.content.innerHTML = PAGE_CACHE.get(pageNum);
    afterPageRender();
    return;
  }

  const html = buildPageHtml(pageNum);
  DOM.content.innerHTML = html;
  setPageCache(pageNum, html);
  afterPageRender();
}


/* =========================
   Tooltip - delegation
========================= */
function normalizeDictionaryWord(rawWord) {
  if (!rawWord) return '';

  let word = String(rawWord)
    // Farklı apostrofları standartlaştır
    .replace(/[’‘`´ʼʻ＇]/g, "'")

    // Farklı tire biçimlerini standartlaştır
    .replace(/[‐‒–—﹘﹣－]/g, "-")

    // Aksanları kaldır
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

    .toLowerCase()
    .trim();

  // Baştaki gereksiz karakterleri temizle
  word = word.replace(/^[^a-z0-9]+/g, '');

  // Sondaki yıldız, virgül, noktalama, parantez vb. temizle
  word = word.replace(/[^a-z0-9]+$/g, '');

  // Harfler arasındaki nokta, apostrof ve tireyi koru
  word = word.replace(/[^a-z0-9.'-]/g, '');

  // Art arda gelen işaretleri sadeleştir
  word = word
    .replace(/'{2,}/g, "'")
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.');

  // Baş ve sondaki nokta/apostrof/tireleri tekrar temizle
  word = word.replace(/^['.-]+|['.-]+$/g, '');

  return word;
}


function getDictionaryCandidates(rawWord) {
  const rawText = String(rawWord || '');

  // Orijinal metinde uzun çizgi bulunup bulunmadığını,
  // normalizasyon yapılmadan önce tespit ediyoruz.
  const containsLongDash = /[—–―]/.test(rawText);

  const word = normalizeDictionaryWord(rawText);

  if (!word) return [];

  const candidates = [word];

  // A.L.M. → alm
  if (word.includes('.')) {
    const noDots = word.replace(/\./g, '');

    if (noDots) {
      candidates.push(noDots);
    }
  }

  // Joseph's → joseph
  if (word.endsWith("'s") && word.length > 2) {
    candidates.push(word.slice(0, -2));
  }

  // prophets' → prophets
  if (word.endsWith("'") && word.length > 1) {
    candidates.push(word.slice(0, -1));
  }

  // Shu'aib → shuaib
  if (word.includes("'")) {
    const noApostrophes = word.replace(/'/g, '');

    if (noApostrophes) {
      candidates.push(noApostrophes);
    }
  }

  // well-protected → wellprotected
  // Birleşik kelime tek parça olarak korunur.
  if (word.includes('-')) {
    const noHyphens = word.replace(/-/g, '');

    if (noHyphens) {
      candidates.push(noHyphens);
    }
  }

  /*
    Yalnızca orijinal metinde uzun çizgi varsa parçala:

    earth—you → earth, you
    earth–you → earth, you

    Normal kısa tireli kelimeler parçalanmaz:

    empty-handed
    well-protected
    one-fifth
  */
  if (containsLongDash && word.includes('-')) {
    const parts = word
      .split('-')
      .map((part) => normalizeDictionaryWord(part))
      .filter(Boolean);

    candidates.push(...parts);
  }

  // Tüm işaretleri kaldırılmış son aday.
  const compact = word.replace(/[.'-]/g, '');

  if (compact) {
    candidates.push(compact);
  }

  return [...new Set(candidates)];
}


function getContextualSurfaceCandidates(rawWord) {
  const raw = String(rawWord || '').trim();
  if (!raw) return [];

  const normalizedMarks = raw
    .replace(/[’‘`´ʼʻ＇]/g, "'")
    .replace(/[‐‒–—﹘﹣－]/g, '-');

  const candidates = [raw, normalizedMarks];

  const stripOuterPunctuation = (value) => String(value || '')
    .replace(/^[^A-Za-z0-9]+/g, '')
    .replace(/[^A-Za-z0-9]+$/g, '')
    .trim();

  candidates.push(
    stripOuterPunctuation(raw),
    stripOuterPunctuation(normalizedMarks)
  );

  return [...new Set(candidates.filter(Boolean))];
}


function prepareContextualDictionaryLookup() {
  const source = STATE.data.contextualDictionary;

  if (
    !source ||
    typeof source !== 'object' ||
    !source.entries ||
    typeof source.entries !== 'object'
  ) {
    CONTEXTUAL_DICTIONARY_LOOKUP.source = source || null;
    CONTEXTUAL_DICTIONARY_LOOKUP.foldedAliasIndex = new Map();
    CONTEXTUAL_DICTIONARY_LOOKUP.foldedConflicts = new Set();
    return;
  }

  if (CONTEXTUAL_DICTIONARY_LOOKUP.source === source) {
    return;
  }

  const foldedAliasIndex = new Map();
  const foldedConflicts = new Set();

  const registerFoldedAlias = (alias, canonicalKey) => {
    const folded = normalizeDictionaryWord(alias);
    const canonical = String(canonicalKey || '').trim();

    if (!folded || !canonical || foldedConflicts.has(folded)) {
      return;
    }

    const existing = foldedAliasIndex.get(folded);

    if (existing && existing !== canonical) {
      foldedAliasIndex.delete(folded);
      foldedConflicts.add(folded);
      return;
    }

    foldedAliasIndex.set(folded, canonical);
  };

  Object.entries(source._alias_index || {}).forEach(
    ([alias, canonicalKey]) => {
      registerFoldedAlias(alias, canonicalKey);
    }
  );

  Object.entries(source.entries).forEach(
    ([canonicalKey, entry]) => {
      registerFoldedAlias(canonicalKey, canonicalKey);

      if (Array.isArray(entry?.aliases)) {
        entry.aliases.forEach((alias) => {
          registerFoldedAlias(alias, canonicalKey);
        });
      }
    }
  );

  CONTEXTUAL_DICTIONARY_LOOKUP.source = source;
  CONTEXTUAL_DICTIONARY_LOOKUP.foldedAliasIndex = foldedAliasIndex;
  CONTEXTUAL_DICTIONARY_LOOKUP.foldedConflicts = foldedConflicts;
}


function resolveContextualDictionaryEntry(rawWord) {
  const source = STATE.data.contextualDictionary;
  const entries = source?.entries;

  if (!entries || typeof entries !== 'object') {
    return null;
  }

  const aliasIndex = source?._alias_index || {};
  const exactCandidates = getContextualSurfaceCandidates(rawWord);

  for (const candidate of exactCandidates) {
    if (Object.prototype.hasOwnProperty.call(entries, candidate)) {
      return {
        canonicalKey: candidate,
        entry: entries[candidate],
        matchedAlias: candidate,
        matchType: 'exact'
      };
    }

    const canonicalKey = aliasIndex[candidate];

    if (
      canonicalKey &&
      Object.prototype.hasOwnProperty.call(entries, canonicalKey)
    ) {
      return {
        canonicalKey,
        entry: entries[canonicalKey],
        matchedAlias: candidate,
        matchType: 'alias'
      };
    }
  }

  prepareContextualDictionaryLookup();

  const folded = normalizeDictionaryWord(rawWord);
  const canonicalKey =
    CONTEXTUAL_DICTIONARY_LOOKUP.foldedAliasIndex.get(folded);

  if (
    canonicalKey &&
    Object.prototype.hasOwnProperty.call(entries, canonicalKey)
  ) {
    return {
      canonicalKey,
      entry: entries[canonicalKey],
      matchedAlias: folded,
      matchType: 'folded'
    };
  }

  return null;
}


function decorateVerseWords() {
  /*
    İngilizce sözlük yardımının çalışacağı alanlar:
    - Ana İngilizce ayet metni
    - İngilizce sure / bölüm başlıkları
    - İngilizce dipnot metinleri
  */
  const englishTextSelectors = [
    '.verse-text-content',
    '.passage-title',
    '.footnote-en .footnote-text',
    '.verse-1989-text',
    '.verse-1989-footnote'
  ];

  document
    .querySelectorAll(englishTextSelectors.join(', '))
    .forEach((element) => {
      if (element.dataset.decorated === 'true') {
        return;
      }

      const preservedButtons = Array.from(
        element.querySelectorAll(
          ':scope > .inline-speak-btn'
        )
      );

      const text = Array.from(element.childNodes)
        .filter((node) => {
          return !(
            node.nodeType === Node.ELEMENT_NODE &&
            node.classList?.contains(
              'inline-speak-btn'
            )
          );
        })
        .map((node) => node.textContent || '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) {
        element.dataset.decorated = 'true';
        return;
      }

      const words = text.split(/\s+/);

      element.innerHTML = words
        .map((word) => {
          const candidates =
            getDictionaryCandidates(word);

          const cleanWord =
            candidates[0] || '';

          if (!cleanWord) {
            return escapeHtml(word);
          }

          return `
            <span
              class="word-token"
              data-word="${escapeHtml(cleanWord)}"
              data-candidates="${escapeHtml(
                JSON.stringify(candidates)
              )}"
              data-original="${escapeHtml(
                normalizeDictionaryWord(word)
              )}"
              tabindex="0"
              style="cursor:help;"
            >${escapeHtml(word)}</span>
          `;
        })
        .join(' ');

      preservedButtons.forEach((button) => {
        element.appendChild(
          document.createTextNode(' ')
        );

        element.appendChild(button);
      });

      element.dataset.decorated = 'true';
    });
}

function setupWordTooltipDelegation() {
  if (tooltipDelegationReady) return;
  tooltipDelegationReady = true;

  const tooltip = DOM.wordTooltip;

  if (!tooltip || !DOM.content) return;

  let pinnedToken = null;
  let activeToken = null;
  let animationFrameId = null;

  Object.assign(tooltip.style, {
    position: 'fixed',
    display: 'none',
    pointerEvents: 'auto',
    zIndex: '99999',
    maxWidth: '420px',
    maxHeight: '65vh',
    overflowY: 'auto',
    boxSizing: 'border-box'
  });

  function getTranslationHtml(token) {
    const displayedWord = String(
      token.textContent || ''
    ).trim();

    let candidates = [];

    try {
      candidates = JSON.parse(
        token.dataset.candidates || '[]'
      );
    } catch (error) {
      console.warn(
        'Kelime adayları okunamadı:',
        error
      );
    }

    if (
      !Array.isArray(candidates) ||
      candidates.length === 0
    ) {
      candidates =
        getDictionaryCandidates(displayedWord);
    }

    const originalWord =
      normalizeDictionaryWord(
        token.dataset.original ||
        displayedWord
      );

    const lookupCandidates = [
      originalWord,
      ...candidates
    ].filter(Boolean);

    const uniqueCandidates = [
      ...new Set(lookupCandidates)
    ];

    const foundWords = [];
    const usedMeanings = new Set();

    for (const candidate of uniqueCandidates) {
      const hasCandidate =
        Object.prototype.hasOwnProperty.call(
          STATE.data.dictionary,
          candidate
        );

      if (!hasCandidate) continue;

      const meaning =
        STATE.data.dictionary[candidate];

      if (!meaning) continue;

      const meaningKey =
        String(meaning).trim();

      if (usedMeanings.has(meaningKey)) {
        continue;
      }

      usedMeanings.add(meaningKey);

      foundWords.push({
        word: candidate,
        meaning: meaningKey
      });
    }

    if (foundWords.length > 0) {
      const resultHtml = foundWords
        .map((item) => {
          const translations = String(
            item.meaning
          )
            .split(/\s*,\s*/)
            .filter(Boolean)
            .map((translation, index) => {
              const colors = [
                '#e74c3c',
                '#27ae60',
                '#3498db'
              ];

              const color =
                colors[index % colors.length];

              return `
                <strong style="color:${color}">
                  ${escapeHtml(translation)}
                </strong>
              `;
            })
            .join(', ');

          return `
            <div style="margin-bottom:8px;">
              <strong>
                ${escapeHtml(item.word)}
              </strong>
              ➜
              ${translations}
            </div>
          `;
        })
        .join('<hr>');

      return `
        <div>
          <div style="margin-bottom:8px;">
            "<strong>
              ${escapeHtml(displayedWord)}
            </strong>"
          </div>

          ${resultHtml}
        </div>
      `;
    }

    console.warn(
      'Sözlükte bulunamayan kelime:',
      {
        displayedWord,
        originalWord,
        candidates: uniqueCandidates
      }
    );

    return `
      "${escapeHtml(displayedWord)}"
      ➔
      <span style="color:#e74c3c;">
        Kelime bulunamadı
      </span>
    `;
  }

  function getTokenVerseId(token) {
    const verseElement = token?.closest?.('.verse');
    const verseId = String(
      verseElement?.dataset?.verseId || ''
    ).trim();

    return /^\d{1,3}:\d{1,3}$/.test(verseId)
      ? verseId
      : '';
  }

  function getContextualConfidenceLabel(confidence) {
    switch (String(confidence || '').toLowerCase()) {
      case 'high':
        return 'Yüksek güven';
      case 'medium':
        return 'Orta güven';
      case 'low':
        return 'Düşük güven';
      default:
        return '';
    }
  }

  function getContextualTranslationHtml(token) {
    const displayedWord = String(
      token?.textContent || ''
    ).trim();

    const resolved =
      resolveContextualDictionaryEntry(displayedWord);

    if (!resolved?.entry) {
      return '';
    }

    const entry = resolved.entry;
    const verseId = getTokenVerseId(token);
    const verseOverrides =
      entry?.verse_overrides &&
      typeof entry.verse_overrides === 'object'
        ? entry.verse_overrides
        : {};

    const overrideTranslation = verseId
      ? String(verseOverrides[verseId] || '').trim()
      : '';

    const defaultTranslation =
      entry.default_translation == null
        ? ''
        : String(entry.default_translation).trim();

    const translations = Array.isArray(entry.translations)
      ? entry.translations
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : [];

    const primaryTranslation =
      overrideTranslation ||
      defaultTranslation ||
      translations[0] ||
      '';

    const confidenceLabel =
      getContextualConfidenceLabel(entry.confidence);

    const confidenceClass = [
      'high',
      'medium',
      'low'
    ].includes(String(entry.confidence || '').toLowerCase())
      ? `is-${String(entry.confidence).toLowerCase()}`
      : '';

    if (!primaryTranslation) {
      return `
        <section class="word-contextual-section is-fallback">
          <div class="word-contextual-heading">
            <span class="word-contextual-title">
              Kuran bağlamı
            </span>
            ${confidenceLabel
              ? `<span class="word-contextual-confidence ${confidenceClass}">${escapeHtml(confidenceLabel)}</span>`
              : ''}
          </div>

          <div class="word-contextual-empty">
            Bu kelime için güvenilir bir bağlamsal karşılık kesinleştirilmedi.
            Mevcut sözlük sonucu aşağıda gösteriliyor.
          </div>
        </section>
      `;
    }

    const alternativeTranslations = [];
    const seenTranslations = new Set([
      primaryTranslation
    ]);

    if (
      overrideTranslation &&
      defaultTranslation &&
      defaultTranslation !== primaryTranslation
    ) {
      alternativeTranslations.push(defaultTranslation);
      seenTranslations.add(defaultTranslation);
    }

    translations.forEach((translation) => {
      if (seenTranslations.has(translation)) return;
      seenTranslations.add(translation);
      alternativeTranslations.push(translation);
    });

    const alternativesHtml = alternativeTranslations.length
      ? `
        <div class="word-contextual-alternatives">
          <span class="word-contextual-label">Diğer uygun karşılıklar</span>
          <div class="word-contextual-chips">
            ${alternativeTranslations
              .map((translation) => `
                <span class="word-contextual-chip">
                  ${escapeHtml(translation)}
                </span>
              `)
              .join('')}
          </div>
        </div>
      `
      : '';

    const generalHtml =
      overrideTranslation &&
      defaultTranslation &&
      defaultTranslation !== overrideTranslation
        ? `
          <div class="word-contextual-general">
            <span class="word-contextual-label">Kuran genelinde</span>
            <strong>${escapeHtml(defaultTranslation)}</strong>
          </div>
        `
        : '';

    const contextNote = String(
      entry.context_note || ''
    ).trim();

    const distinctions = Array.isArray(entry.distinctions)
      ? entry.distinctions.filter((item) => item?.note)
      : [];

    const conceptualDetailsHtml =
      contextNote || distinctions.length
        ? `
          <details class="word-contextual-details">
            <summary>Kavramsal not</summary>
            ${contextNote
              ? `<p>${escapeHtml(contextNote)}</p>`
              : ''}
            ${distinctions.length
              ? `
                <ul>
                  ${distinctions
                    .slice(0, 6)
                    .map((item) => `
                      <li>
                        ${item?.from
                          ? `<strong>${escapeHtml(item.from)}:</strong> `
                          : ''}
                        ${escapeHtml(item.note)}
                      </li>
                    `)
                    .join('')}
                </ul>
              `
              : ''}
          </details>
        `
        : '';

    return `
      <section class="word-contextual-section">
        <div class="word-contextual-heading">
          <span class="word-contextual-title">
            Kuran bağlamı
          </span>
          ${confidenceLabel
            ? `<span class="word-contextual-confidence ${confidenceClass}">${escapeHtml(confidenceLabel)}</span>`
            : ''}
        </div>

        <div class="word-contextual-primary">
          <span class="word-contextual-label">
            ${overrideTranslation && verseId
              ? `${escapeHtml(verseId)} ayetinde`
              : 'Önerilen karşılık'}
          </span>
          <strong>
            <span aria-hidden="true">★</span>
            ${escapeHtml(primaryTranslation)}
          </strong>
        </div>

        ${generalHtml}
        ${alternativesHtml}
        ${conceptualDetailsHtml}
      </section>
    `;
  }

  function calculateTooltipPosition(
    clientX,
    clientY
  ) {
    const margin = 10;
    const offset = 14;

    const tooltipWidth =
      tooltip.offsetWidth;

    const tooltipHeight =
      tooltip.offsetHeight;

    let left = clientX + offset;
    let top = clientY + offset;

    if (
      left + tooltipWidth >
      window.innerWidth - margin
    ) {
      left =
        clientX -
        tooltipWidth -
        offset;
    }

    if (
      top + tooltipHeight >
      window.innerHeight - margin
    ) {
      top =
        clientY -
        tooltipHeight -
        offset;
    }

    left = Math.max(
      margin,
      Math.min(
        left,
        window.innerWidth -
        tooltipWidth -
        margin
      )
    );

    top = Math.max(
      margin,
      Math.min(
        top,
        window.innerHeight -
        tooltipHeight -
        margin
      )
    );

    return {
      left,
      top
    };
  }

  function moveTooltip(
    clientX,
    clientY
  ) {
    if (animationFrameId) {
      cancelAnimationFrame(
        animationFrameId
      );
    }

    animationFrameId =
      requestAnimationFrame(() => {
        if (
          tooltip.style.display !== 'block'
        ) {
          return;
        }

        const position =
          calculateTooltipPosition(
            clientX,
            clientY
          );

        tooltip.style.left =
          `${position.left}px`;

        tooltip.style.top =
          `${position.top}px`;

        animationFrameId = null;
      });
  }

  function showTooltipAt(
    clientX,
    clientY,
    html
  ) {
    tooltip.innerHTML = html;
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';
    tooltip.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
      const position =
        calculateTooltipPosition(
          clientX,
          clientY
        );

      tooltip.style.left =
        `${position.left}px`;

      tooltip.style.top =
        `${position.top}px`;

      tooltip.style.visibility =
        'visible';
    });
  }

  function showTooltipNearElement(
    element,
    html
  ) {
    const rect =
      element.getBoundingClientRect();

    const margin = 10;
    const offset = 8;

    tooltip.innerHTML = html;
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';
    tooltip.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
      const tooltipWidth =
        tooltip.offsetWidth;

      const tooltipHeight =
        tooltip.offsetHeight;

      let left = rect.left;
      let top = rect.bottom + offset;

      if (
        left + tooltipWidth >
        window.innerWidth - margin
      ) {
        left =
          window.innerWidth -
          tooltipWidth -
          margin;
      }

      if (
        top + tooltipHeight >
        window.innerHeight - margin
      ) {
        top =
          rect.top -
          tooltipHeight -
          offset;
      }

      left = Math.max(
        margin,
        left
      );

      top = Math.max(
        margin,
        top
      );

      tooltip.style.left =
        `${left}px`;

      tooltip.style.top =
        `${top}px`;

      tooltip.style.visibility =
        'visible';
    });
  }

  function hideTooltip() {
    if (animationFrameId) {
      cancelAnimationFrame(
        animationFrameId
      );

      animationFrameId = null;
    }

    tooltip.style.display = 'none';
    tooltip.style.visibility = 'hidden';
    tooltip.setAttribute('aria-hidden', 'true');

    activeToken = null;
    pinnedToken = null;
  }

  function isTouchDevice() {
    return (
      window
        .matchMedia('(hover: none)')
        .matches ||
      navigator.maxTouchPoints > 0
    );
  }

  function getResearchActionHtml(token) {
    const displayedWord = String(token?.textContent || '').trim();
    const query = normalizeDictionaryWord(
      token?.dataset?.original || displayedWord
    );

    if (!query) return '';

    const verseElement = token.closest('.verse');
    const verseId = String(
      verseElement?.dataset?.verseId || ''
    ).trim();

    const params = new URLSearchParams();
    params.set('q', query);

    if (/^\d{1,3}:\d{1,3}$/.test(verseId)) {
      params.set('verse', verseId);
      params.set('return', `./index.html#ayet=${verseId}`);
    }

    const researchUrl = `./evidence.html?${params.toString()}`;

    return `
      <div class="word-research-action">
        <a
          class="word-more-info-link"
          href="${escapeHtml(researchUrl)}"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="${escapeHtml(displayedWord)} kelimesini Kuran içinde araştır"
        >
          <span aria-hidden="true">🔎</span>
          Daha fazla bilgi
        </a>

        <span class="word-research-caption">
          ${verseId
            ? `${escapeHtml(verseId)} bağlamıyla Kuran içinde araştır`
            : 'Kuran içinde araştır'}
        </span>
      </div>
    `;
  }

  async function getReadyTranslationHtml(token) {
    let loadErrorHtml = '';

    if (FEATURE_STATE.dictionary.status !== 'ready') {
      try {
        await ensureFeatureLoaded('dictionary');
      } catch (error) {
        loadErrorHtml =
          '<span class="word-translation-empty">Sözlük verisi yüklenemedi.</span>';
      }
    }

    if (loadErrorHtml) {
      return `${loadErrorHtml}${getResearchActionHtml(token)}`;
    }

    const contextualHtml =
      getContextualTranslationHtml(token);

    const manualHtml = getTranslationHtml(token);

    const translationHtml = contextualHtml
      ? `
        ${contextualHtml}
        <section class="word-manual-section">
          <div class="word-manual-heading">
            Mevcut sözlük
          </div>
          ${manualHtml}
        </section>
      `
      : manualHtml;

    return `${translationHtml}${getResearchActionHtml(token)}`;
  }

  DOM.content.addEventListener(
    'mouseover',
    async (event) => {
      if (
        isTouchDevice() ||
        pinnedToken
      ) {
        return;
      }

      const token =
        event.target.closest(
          '.word-token'
        );

      if (
        !token ||
        !DOM.content.contains(token)
      ) {
        return;
      }

      if (
        event.relatedTarget &&
        token.contains(
          event.relatedTarget
        )
      ) {
        return;
      }

      activeToken = token;

      showTooltipAt(
        event.clientX,
        event.clientY,
        '<span class="word-translation-loading">Bağlamsal sözlük yükleniyor...</span>'
      );

      const html = await getReadyTranslationHtml(token);
      if (activeToken === token) {
        showTooltipAt(event.clientX, event.clientY, html);
      }
    }
  );

  DOM.content.addEventListener(
    'mousemove',
    (event) => {
      if (
        isTouchDevice() ||
        pinnedToken ||
        !activeToken
      ) {
        return;
      }

      moveTooltip(
        event.clientX,
        event.clientY
      );
    }
  );

  DOM.content.addEventListener(
    'mouseout',
    (event) => {
      if (
        isTouchDevice() ||
        pinnedToken
      ) {
        return;
      }

      const token =
        event.target.closest(
          '.word-token'
        );

      if (
        !token ||
        token !== activeToken
      ) {
        return;
      }

      if (
        event.relatedTarget &&
        (
          token.contains(event.relatedTarget) ||
          tooltip.contains(event.relatedTarget)
        )
      ) {
        return;
      }

      tooltip.style.display = 'none';
      tooltip.style.visibility = 'hidden';
      tooltip.setAttribute('aria-hidden', 'true');
      activeToken = null;
    }
  );

  DOM.content.addEventListener(
    'click',
    async (event) => {
      const token =
        event.target.closest(
          '.word-token'
        );

      if (
        !token ||
        !DOM.content.contains(token)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (pinnedToken === token) {
        hideTooltip();
        return;
      }

      pinnedToken = token;
      activeToken = token;

      showTooltipNearElement(
        token,
        '<span class="word-translation-loading">Sözlük yükleniyor...</span>'
      );

      const html = await getReadyTranslationHtml(token);
      if (pinnedToken === token) {
        showTooltipNearElement(token, html);
      }
    }
  );

  DOM.content.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const token = event.target.closest('.word-token');
    if (!token || !DOM.content.contains(token)) return;

    event.preventDefault();
    pinnedToken = token;
    activeToken = token;
    showTooltipNearElement(token, '<span class="word-translation-loading">Sözlük yükleniyor...</span>');

    const html = await getReadyTranslationHtml(token);
    if (pinnedToken === token) showTooltipNearElement(token, html);
  });

  tooltip.addEventListener('mouseleave', (event) => {
    if (pinnedToken) return;

    if (
      event.relatedTarget &&
      activeToken?.contains(event.relatedTarget)
    ) {
      return;
    }

    tooltip.style.display = 'none';
    tooltip.style.visibility = 'hidden';
    tooltip.setAttribute('aria-hidden', 'true');
    activeToken = null;
  });

  document.addEventListener(
    'click',
    (event) => {
      if (!pinnedToken) return;

      const clickedToken =
        event.target.closest(
          '.word-token'
        );

      const clickedTooltip =
        event.target.closest(
          '#wordTooltip'
        );

      if (
        !clickedToken &&
        !clickedTooltip
      ) {
        hideTooltip();
      }
    }
  );

  window.addEventListener(
    'resize',
    hideTooltip
  );

  window.addEventListener(
    'scroll',
    () => {
      if (pinnedToken) {
        hideTooltip();
      }
    },
    {
      passive: true
    }
  );
}

/* =========================
   Notlar
========================= */
/* =========================
   Yerel Not Sistemi + HTML Not Düzenleyici
========================= */

const LOCAL_NOTES_KEY = 'kuranTeyitNotesV1';
const NOTE_EXPORT_VERSION = 2;
const NOTE_EDITOR_MAX_TEXT_LENGTH = 30000;
const NOTE_EDITOR_MAX_HTML_LENGTH = 120000;

const NOTE_ALLOWED_TAGS = new Set([
  'A', 'B', 'BLOCKQUOTE', 'BR', 'DIV', 'EM', 'H2', 'H3', 'H4', 'HR',
  'I', 'LI', 'OL', 'P', 'S', 'SPAN', 'STRONG', 'SUB', 'SUP', 'U', 'UL'
]);

const NOTE_DROP_TAGS = new Set([
  'BASE', 'BUTTON', 'EMBED', 'FORM', 'IFRAME', 'INPUT', 'LINK', 'MATH',
  'META', 'OBJECT', 'OPTION', 'SCRIPT', 'SELECT', 'STYLE', 'SVG', 'TEXTAREA'
]);

function getAllLocalNotes() {
  try {
    const savedNotes = localStorage.getItem(LOCAL_NOTES_KEY);

    if (!savedNotes) {
      return {};
    }

    const parsedNotes = JSON.parse(savedNotes);

    if (
      !parsedNotes ||
      typeof parsedNotes !== 'object' ||
      Array.isArray(parsedNotes)
    ) {
      return {};
    }

    return parsedNotes;
  } catch (error) {
    console.error('Yerel notlar okunamadı:', error);
    return {};
  }
}

function writeAllLocalNotes(notes) {
  try {
    localStorage.setItem(
      LOCAL_NOTES_KEY,
      JSON.stringify(notes)
    );

    return true;
  } catch (error) {
    console.error('Yerel notlar kaydedilemedi:', error);

    showNotification(
      'Notlar tarayıcıya kaydedilemedi.',
      'warning'
    );

    return false;
  }
}

function getLocalNote(sura, verse) {
  const notes = getAllLocalNotes();
  const verseId = `${sura}:${verse}`;

  return notes[verseId] || null;
}

function getNoteSourceMap(exportObject) {
  if (!exportObject || typeof exportObject !== 'object' || Array.isArray(exportObject)) {
    return {};
  }

  if (
    exportObject.notes &&
    typeof exportObject.notes === 'object' &&
    !Array.isArray(exportObject.notes)
  ) {
    return exportObject.notes;
  }

  return exportObject;
}

function sanitizeNotesForImport(exportObject) {
  const sourceNotes = getNoteSourceMap(exportObject);

  if (!sourceNotes || typeof sourceNotes !== 'object' || Array.isArray(sourceNotes)) {
    throw new Error('Not dosyasındaki notes alanı geçersiz.');
  }

  const entries = Object.entries(sourceNotes);

  if (entries.length > 10000) {
    throw new Error('Not dosyası 10.000 kayıt sınırını aşıyor.');
  }

  const sanitized = {};

  entries.forEach(([rawVerseId, rawNote]) => {
    if (!rawNote || typeof rawNote !== 'object' || Array.isArray(rawNote)) return;

    const verseId = String(rawVerseId || '').trim();
    const match = verseId.match(/^(\d{1,3}):(\d{1,3})$/);
    if (!match) return;

    const [, sura, verse] = match;
    if (!verseExists(sura, verse)) return;

    const rawContent = typeof rawNote.content === 'string'
      ? rawNote.content
      : '';

    const format = rawNote.format === 'html' ? 'html' : 'plain';
    const content = format === 'html'
      ? sanitizeNoteHtml(rawContent)
      : rawContent.trim();

    const plainText = format === 'html'
      ? noteHtmlToPlainText(content)
      : content;

    if (!plainText || plainText.length > NOTE_EDITOR_MAX_TEXT_LENGTH) return;
    if (format === 'html' && content.length > NOTE_EDITOR_MAX_HTML_LENGTH) return;

    const parsedDate = Date.parse(String(rawNote.updatedAt || ''));

    sanitized[verseId] = {
      sura: String(sura),
      verse: String(verse),
      content,
      ...(format === 'html' ? { format: 'html' } : {}),
      updatedAt: Number.isFinite(parsedDate)
        ? new Date(parsedDate).toISOString()
        : new Date().toISOString()
    };
  });

  if (entries.length > 0 && Object.keys(sanitized).length === 0) {
    throw new Error('Dosyada içe aktarılabilecek geçerli not bulunamadı.');
  }

  return sanitized;
}

function normalizeNoteHref(rawHref) {
  const href = String(rawHref || '').trim();
  if (!href) return '';

  try {
    const url = new URL(href, window.location.href);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '';
    return url.href;
  } catch (error) {
    return '';
  }
}

function sanitizeNoteStyle(rawStyle) {
  const style = String(rawStyle || '');
  const safe = [];

  style.split(';').forEach((declaration) => {
    const [rawProperty, ...valueParts] = declaration.split(':');
    const property = String(rawProperty || '').trim().toLowerCase();
    const value = valueParts.join(':').trim().toLowerCase();

    if (!property || !value) return;

    if (
      property === 'text-align' &&
      ['left', 'center', 'right', 'justify'].includes(value)
    ) {
      safe.push(`text-align:${value}`);
      return;
    }

    if (
      property === 'font-weight' &&
      ['bold', '600', '700', '800', '900'].includes(value)
    ) {
      safe.push('font-weight:bold');
      return;
    }

    if (property === 'font-style' && value === 'italic') {
      safe.push('font-style:italic');
      return;
    }

    if (
      property === 'text-decoration' &&
      (value.includes('underline') || value.includes('line-through'))
    ) {
      const decorations = [];
      if (value.includes('underline')) decorations.push('underline');
      if (value.includes('line-through')) decorations.push('line-through');
      safe.push(`text-decoration:${decorations.join(' ')}`);
    }
  });

  return safe.join(';');
}

function sanitizeNoteHtml(rawHtml) {
  const source = String(rawHtml || '').slice(0, NOTE_EDITOR_MAX_HTML_LENGTH);
  const template = document.createElement('template');
  template.innerHTML = source;

  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return;

    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove();
      return;
    }

    const tagName = node.tagName.toUpperCase();

    if (NOTE_DROP_TAGS.has(tagName)) {
      node.remove();
      return;
    }

    [...node.childNodes].forEach(cleanNode);

    if (!NOTE_ALLOWED_TAGS.has(tagName)) {
      const parent = node.parentNode;
      if (!parent) return;

      while (node.firstChild) {
        parent.insertBefore(node.firstChild, node);
      }

      node.remove();
      return;
    }

    const allowedHref = tagName === 'A'
      ? normalizeNoteHref(node.getAttribute('href'))
      : '';

    const safeStyle = sanitizeNoteStyle(node.getAttribute('style'));

    [...node.attributes].forEach((attribute) => {
      node.removeAttribute(attribute.name);
    });

    if (safeStyle) {
      node.setAttribute('style', safeStyle);
    }

    if (tagName === 'A' && allowedHref) {
      node.setAttribute('href', allowedHref);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  };

  [...template.content.childNodes].forEach(cleanNode);
  return template.innerHTML.trim();
}

function noteHtmlToPlainText(html) {
  const container = document.createElement('div');
  container.innerHTML = sanitizeNoteHtml(html);

  return String(container.innerText || container.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function plainTextToEditorHtml(text) {
  const normalized = String(text || '')
    .replace(/\r\n?/g, '\n')
    .slice(0, NOTE_EDITOR_MAX_TEXT_LENGTH);

  if (!normalized.trim()) return '<div><br></div>';

  return normalized
    .split('\n')
    .map((line) => line
      ? `<div>${escapeHtml(line)}</div>`
      : '<div><br></div>')
    .join('');
}

function renderStoredNoteContent(note) {
  if (!note) return '';

  if (note.format === 'html') {
    return sanitizeNoteHtml(note.content || '');
  }

  return escapeHtml(String(note.content || ''))
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>');
}

function getNotePlainText(note) {
  if (!note) return '';

  return note.format === 'html'
    ? noteHtmlToPlainText(note.content || '')
    : String(note.content || '').trim();
}

function saveLocalNote(sura, verse, content, format = 'plain') {
  const normalizedFormat = format === 'html' ? 'html' : 'plain';
  const normalizedContent = normalizedFormat === 'html'
    ? sanitizeNoteHtml(content)
    : String(content || '').trim();

  const plainText = normalizedFormat === 'html'
    ? noteHtmlToPlainText(normalizedContent)
    : normalizedContent;

  if (!verseExists(sura, verse)) {
    showNotification('Not kaydedilecek ayet bulunamadı.', 'warning');
    return false;
  }

  if (!plainText || plainText.length > NOTE_EDITOR_MAX_TEXT_LENGTH) {
    showNotification(
      `Not içeriği 1-${NOTE_EDITOR_MAX_TEXT_LENGTH.toLocaleString('tr-TR')} karakter arasında olmalıdır.`,
      'warning'
    );
    return false;
  }

  if (
    normalizedFormat === 'html' &&
    normalizedContent.length > NOTE_EDITOR_MAX_HTML_LENGTH
  ) {
    showNotification('Biçimli not çok büyük. Lütfen içeriği biraz kısaltın.', 'warning');
    return false;
  }

  const notes = getAllLocalNotes();
  const verseId = `${sura}:${verse}`;

  notes[verseId] = {
    sura: String(sura),
    verse: String(verse),
    content: normalizedContent,
    ...(normalizedFormat === 'html' ? { format: 'html' } : {}),
    updatedAt: new Date().toISOString()
  };

  return writeAllLocalNotes(notes);
}

function deleteLocalNote(sura, verse) {
  const notes = getAllLocalNotes();
  const verseId = `${sura}:${verse}`;

  if (!notes[verseId]) {
    return false;
  }

  delete notes[verseId];

  return writeAllLocalNotes(notes);
}

function loadNotesForCurrentPage() {
  const verseElements = document.querySelectorAll('.verse-number');

  verseElements.forEach((element) => {
    const verseText = element.textContent.trim();
    const match = verseText.match(/^(\d+)\s*:\s*(\d+)$/);

    if (!match) return;

    const [, sura, verse] = match;
    const note = getLocalNote(sura, verse);

    if (note?.content) {
      displayLoadedNote(sura, verse, note);
    } else {
      updateLocalNoteUI(sura, verse);
    }
  });
}

function displayLoadedNote(sura, verse, noteOrContent) {
  const box = document.getElementById(`user-note-${sura}-${verse}`);
  if (!box) return;

  const note = noteOrContent && typeof noteOrContent === 'object'
    ? noteOrContent
    : {
        sura: String(sura),
        verse: String(verse),
        content: String(noteOrContent || ''),
        format: 'plain'
      };

  const wasHidden = box.classList.contains('hidden');
  const noteHtml = renderStoredNoteContent(note);

  box.innerHTML = `
    <div class="saved-note-card">
      <div class="saved-note-row">
        <div class="saved-note-main">
          <strong class="saved-note-title">📝 Notunuz</strong>
          <div class="saved-note-content note-rich-content">
            ${noteHtml}
          </div>
        </div>

        <div class="saved-note-actions">
          <button
            type="button"
            class="toggle-btn"
            data-action="edit-note"
            data-sura="${escapeHtml(String(sura))}"
            data-verse="${escapeHtml(String(verse))}"
          >✏️ Düzenle</button>

          <button
            type="button"
            class="toggle-btn"
            data-action="remove-note"
            data-sura="${escapeHtml(String(sura))}"
            data-verse="${escapeHtml(String(verse))}"
          >🗑️ Sil</button>
        </div>
      </div>
    </div>
  `;

  box.classList.toggle('hidden', wasHidden);

  const noteButton = document.getElementById(`noteBtn-${sura}-${verse}`);

  if (noteButton) {
    noteButton.classList.add('has-note');
    noteButton.textContent = '📝 Notlu';
  }
}

function updateLocalNoteUI(sura, verse) {
  const note = getLocalNote(sura, verse);
  const noteButton = document.getElementById(`noteBtn-${sura}-${verse}`);
  const noteBox = document.getElementById(`user-note-${sura}-${verse}`);

  if (note?.content) {
    if (noteButton) {
      noteButton.classList.add('has-note');
      noteButton.textContent = '📝 Notlu';
    }

    return;
  }

  if (noteButton) {
    noteButton.classList.remove('has-note');
    noteButton.textContent = 'Not Al';
  }

  if (noteBox) {
    noteBox.innerHTML = '';
    noteBox.classList.add('hidden');
  }
}

function getActiveNoteEditor() {
  return document.getElementById('noteEditorOverlay');
}

function updateNoteEditorCounter(editor, counter) {
  if (!editor || !counter) return;

  const textLength = String(editor.innerText || editor.textContent || '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .length;

  counter.textContent = `${textLength.toLocaleString('tr-TR')} / ${NOTE_EDITOR_MAX_TEXT_LENGTH.toLocaleString('tr-TR')}`;
  counter.classList.toggle('is-limit-near', textLength > NOTE_EDITOR_MAX_TEXT_LENGTH * 0.9);
  counter.classList.toggle('is-limit-exceeded', textLength > NOTE_EDITOR_MAX_TEXT_LENGTH);
}

function noteEditorCommand(editor, command, value = null) {
  if (!editor) return;

  editor.focus();

  try {
    document.execCommand(command, false, value);
  } catch (error) {
    console.warn(`Not düzenleyici komutu çalışmadı: ${command}`, error);
  }

  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertSafePastedNoteContent(editor, event) {
  if (!editor || !event.clipboardData) return;

  event.preventDefault();

  const clipboardHtml = event.clipboardData.getData('text/html');
  const clipboardText = event.clipboardData.getData('text/plain');

  if (clipboardHtml) {
    const safeHtml = sanitizeNoteHtml(clipboardHtml);
    noteEditorCommand(editor, 'insertHTML', safeHtml || escapeHtml(clipboardText));
    return;
  }

  noteEditorCommand(editor, 'insertText', clipboardText);
}

function buildNoteEditorToolbar() {
  const button = (label, command, title, value = '') => `
    <button
      type="button"
      class="note-editor-tool"
      data-editor-command="${escapeHtml(command)}"
      ${value ? `data-editor-value="${escapeHtml(value)}"` : ''}
      title="${escapeHtml(title)}"
      aria-label="${escapeHtml(title)}"
    >${label}</button>
  `;

  return `
    <div class="note-editor-toolbar" role="toolbar" aria-label="Not biçimlendirme araçları">
      <div class="note-editor-tool-group">
        ${button('↶', 'undo', 'Geri al')}
        ${button('↷', 'redo', 'Yinele')}
      </div>

      <div class="note-editor-tool-group">
        ${button('<strong>B</strong>', 'bold', 'Kalın')}
        ${button('<em>I</em>', 'italic', 'İtalik')}
        ${button('<u>U</u>', 'underline', 'Altı çizili')}
        ${button('<s>S</s>', 'strikeThrough', 'Üstü çizili')}
      </div>

      <div class="note-editor-tool-group">
        ${button('Başlık', 'formatBlock', 'Başlık', 'H2')}
        ${button('Alt başlık', 'formatBlock', 'Alt başlık', 'H3')}
        ${button('¶', 'formatBlock', 'Normal paragraf', 'P')}
      </div>

      <div class="note-editor-tool-group">
        ${button('• Liste', 'insertUnorderedList', 'Madde işaretli liste')}
        ${button('1. Liste', 'insertOrderedList', 'Numaralı liste')}
        ${button('❝', 'formatBlock', 'Alıntı', 'BLOCKQUOTE')}
        ${button('―', 'insertHorizontalRule', 'Yatay çizgi')}
      </div>

      <div class="note-editor-tool-group">
        ${button('≡', 'justifyLeft', 'Sola hizala')}
        ${button('≣', 'justifyCenter', 'Ortala')}
        ${button('≡→', 'justifyRight', 'Sağa hizala')}
      </div>

      <div class="note-editor-tool-group">
        <button
          type="button"
          class="note-editor-tool"
          data-editor-link="true"
          title="Bağlantı ekle"
          aria-label="Bağlantı ekle"
        >🔗</button>
        ${button('Tx', 'removeFormat', 'Karakter biçimini temizle')}
      </div>
    </div>
  `;
}

function openNoteEditor(sura, verse) {
  if (!verseExists(sura, verse)) {
    showNotification('Not düzenlenecek ayet bulunamadı.', 'warning');
    return false;
  }

  const existingEditor = getActiveNoteEditor();
  if (existingEditor) {
    const currentSura = existingEditor.dataset.sura;
    const currentVerse = existingEditor.dataset.verse;

    if (String(currentSura) === String(sura) && String(currentVerse) === String(verse)) {
      existingEditor.querySelector('#noteEditorContent')?.focus();
      return true;
    }

    if (!closeNoteEditor()) return false;
  }

  const verseData = findVerseData(String(sura), String(verse));
  const suraName = STATE.metadata.sureNames[String(sura)] || `Sure ${sura}`;
  const note = getLocalNote(sura, verse);
  const initialHtml = note?.format === 'html'
    ? sanitizeNoteHtml(note.content || '')
    : plainTextToEditorHtml(note?.content || '');

  const overlay = document.createElement('section');
  overlay.id = 'noteEditorOverlay';
  overlay.className = 'note-editor-overlay';
  overlay.dataset.sura = String(sura);
  overlay.dataset.verse = String(verse);
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'noteEditorTitle');

  overlay.innerHTML = `
    <div class="note-editor-topbar">
      <button type="button" class="note-editor-close-btn" data-note-editor-close>
        ← Kapat
      </button>

      <div class="note-editor-heading">
        <strong id="noteEditorTitle">📝 ${escapeHtml(`${sura}:${verse}`)} Notu</strong>
        <span>${escapeHtml(suraName)}</span>
      </div>

      <button type="button" class="note-editor-save-btn" data-note-editor-save>
        💾 Kaydet
      </button>
    </div>

    <div class="note-editor-scroll">
      <div class="note-editor-document">
        <section class="note-editor-verse-card" aria-label="Notun bağlı olduğu ayet">
          <div class="note-editor-verse-kicker">NOTUN BAĞLI OLDUĞU AYET</div>
          <div class="note-editor-verse-title">
            <strong>${escapeHtml(`${sura}:${verse}`)}</strong>
            <span>${escapeHtml(suraName)}</span>
          </div>

          <div class="note-editor-verse-text note-editor-verse-tr">
            <span>Türkçe</span>
            <p>${escapeHtml(verseData.turkish || 'Türkçe ayet metni bulunamadı.')}</p>
          </div>

          <div class="note-editor-verse-text note-editor-verse-en">
            <span>English</span>
            <p>${escapeHtml(verseData.english || 'English verse text is unavailable.')}</p>
          </div>
        </section>

        ${buildNoteEditorToolbar()}

        <section class="note-editor-paper" aria-label="Not düzenleme sayfası">
          <div
            id="noteEditorContent"
            class="note-editor-content note-rich-content"
            contenteditable="true"
            role="textbox"
            aria-multiline="true"
            spellcheck="true"
            data-placeholder="Notunuzu buraya yazın..."
          ></div>

          <div class="note-editor-meta">
            <span id="noteEditorCharCount">0 / ${NOTE_EDITOR_MAX_TEXT_LENGTH.toLocaleString('tr-TR')}</span>
            <span>Ctrl/Cmd + S ile kaydedebilirsiniz.</span>
          </div>

          <div class="note-editor-bottom-actions">
            <button type="button" class="note-editor-save-btn note-editor-save-btn--large" data-note-editor-save>
              💾 Notu Kaydet
            </button>
          </div>
        </section>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.classList.add('note-editor-open');

  const editor = overlay.querySelector('#noteEditorContent');
  const counter = overlay.querySelector('#noteEditorCharCount');

  editor.innerHTML = initialHtml || '<div><br></div>';
  overlay._initialNoteHtml = sanitizeNoteHtml(editor.innerHTML);

  const onInput = () => updateNoteEditorCounter(editor, counter);
  editor.addEventListener('input', onInput);
  editor.addEventListener('paste', (event) => insertSafePastedNoteContent(editor, event));

  overlay.querySelectorAll('[data-editor-command]').forEach((toolButton) => {
    toolButton.addEventListener('mousedown', (event) => event.preventDefault());
    toolButton.addEventListener('click', () => {
      noteEditorCommand(
        editor,
        toolButton.dataset.editorCommand,
        toolButton.dataset.editorValue || null
      );
    });
  });

  overlay.querySelector('[data-editor-link]')?.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  overlay.querySelector('[data-editor-link]')?.addEventListener('click', () => {
    const selection = window.getSelection();

    if (!selection || selection.isCollapsed) {
      showNotification('Bağlantı vermek için önce metni seçin.', 'warning');
      editor.focus();
      return;
    }

    const href = window.prompt('Bağlantı adresi (https://...)');
    if (!href) return;

    const safeHref = normalizeNoteHref(href);
    if (!safeHref) {
      showNotification('Geçerli bir http/https bağlantısı girin.', 'warning');
      return;
    }

    noteEditorCommand(editor, 'createLink', safeHref);
  });

  overlay.querySelectorAll('[data-note-editor-save]').forEach((saveButton) => {
    saveButton.addEventListener('click', saveActiveNoteEditor);
  });

  overlay.querySelector('[data-note-editor-close]')?.addEventListener('click', () => {
    closeNoteEditor();
  });

  overlay.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;

    if (modifier && String(event.key).toLowerCase() === 's') {
      event.preventDefault();
      saveActiveNoteEditor();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeNoteEditor();
    }
  });

  updateNoteEditorCounter(editor, counter);

  requestAnimationFrame(() => {
    editor.focus({ preventScroll: true });
  });

  return true;
}

function closeNoteEditor(options = {}) {
  const { force = false } = options;
  const overlay = getActiveNoteEditor();

  if (!overlay) return true;

  const editor = overlay.querySelector('#noteEditorContent');
  const currentHtml = sanitizeNoteHtml(editor?.innerHTML || '');
  const initialHtml = String(overlay._initialNoteHtml || '');

  if (!force && currentHtml !== initialHtml) {
    const approved = window.confirm(
      'Kaydedilmemiş değişiklikler var. Not düzenleyiciyi kapatmak istiyor musunuz?'
    );

    if (!approved) return false;
  }

  overlay.remove();
  document.body.classList.remove('note-editor-open');
  return true;
}

function saveActiveNoteEditor() {
  const overlay = getActiveNoteEditor();
  if (!overlay) return false;

  const editor = overlay.querySelector('#noteEditorContent');
  const sura = overlay.dataset.sura;
  const verse = overlay.dataset.verse;
  const safeHtml = sanitizeNoteHtml(editor?.innerHTML || '');
  const plainText = noteHtmlToPlainText(safeHtml);

  if (!plainText) {
    showNotification('⚠️ Not içeriği boş olamaz.', 'warning');
    editor?.focus();
    return false;
  }

  if (plainText.length > NOTE_EDITOR_MAX_TEXT_LENGTH) {
    showNotification(
      `Not ${NOTE_EDITOR_MAX_TEXT_LENGTH.toLocaleString('tr-TR')} karakter sınırını aşıyor.`,
      'warning'
    );
    editor?.focus();
    return false;
  }

  const success = saveLocalNote(sura, verse, safeHtml, 'html');
  if (!success) return false;

  clearPageCache();
  const note = getLocalNote(sura, verse);
  displayLoadedNote(sura, verse, note);

  const inlineBox = document.getElementById(`user-note-${sura}-${verse}`);
  if (inlineBox) inlineBox.classList.remove('hidden');

  updateLocalNoteUI(sura, verse);

  if (document.getElementById('notesList')) {
    loadAndDisplayAllNotes();
  }

  overlay._initialNoteHtml = safeHtml;
  closeNoteEditor({ force: true });

  showNotification('✅ Biçimli not cihazınıza kaydedildi.', 'success');
  return true;
}

function saveNote(sura, verse) {
  const overlay = getActiveNoteEditor();

  if (overlay) {
    return saveActiveNoteEditor();
  }

  return openNoteEditor(sura, verse);
}

function cancelNote() {
  closeNoteEditor();
}

async function toggleNoteInput(id, sura, verse) {
  const existingNote = getLocalNote(sura, verse);
  const savedNoteBox = document.getElementById(`user-note-${sura}-${verse}`);

  if (existingNote?.content && savedNoteBox) {
    savedNoteBox.classList.toggle('hidden');
    return;
  }

  openNoteEditor(sura, verse);
}

function editLocalNote(sura, verse) {
  openNoteEditor(sura, verse);
}

function removeLocalNote(sura, verse) {
  const approved = window.confirm('Bu not silinsin mi?');

  if (!approved) return;

  const deleted = deleteLocalNote(sura, verse);

  if (!deleted) {
    showNotification('Silinecek not bulunamadı.', 'warning');
    return;
  }

  clearPageCache();
  updateLocalNoteUI(sura, verse);

  if (document.getElementById('notesList')) {
    loadAndDisplayAllNotes();
  }

  showNotification('🗑️ Not silindi.', 'success');
}

function loadAndDisplayAllNotes() {
  const notesList = document.getElementById('notesList');
  if (!notesList) return;

  const notes = Object
    .values(getAllLocalNotes())
    .sort((a, b) => {
      const suraDifference = Number(a.sura) - Number(b.sura);
      if (suraDifference !== 0) return suraDifference;
      return Number(a.verse) - Number(b.verse);
    });

  if (notes.length === 0) {
    notesList.innerHTML = `
      <div class="notes-empty-state">
        <strong>Henüz kaydedilmiş notunuz bulunmuyor.</strong>
        <span>Bir ayette “Not Al” düğmesine basarak ilk notunuzu oluşturabilirsiniz.</span>
      </div>
    `;
    return;
  }

  notesList.innerHTML = `
    <div class="notes-card-list">
      ${notes.map((note) => {
        const suraNumber = Number(note.sura);
        const verseNumber = Number(note.verse);
        const suraName = STATE.metadata.sureNames[String(note.sura)] || `Sure ${note.sura}`;
        const updatedDate = note.updatedAt
          ? new Date(note.updatedAt).toLocaleString('tr-TR')
          : '';
        const verseData = findVerseData(String(note.sura), String(note.verse));
        const noteHtml = renderStoredNoteContent(note);

        return `
          <article class="notes-card" data-note-id="${escapeHtml(`${note.sura}:${note.verse}`)}">
            <header class="notes-card-header">
              <div>
                <span class="notes-card-kicker">AYET NOTU</span>
                <h2>${escapeHtml(`${note.sura}:${note.verse}`)} · ${escapeHtml(suraName)}</h2>
              </div>
              <time datetime="${escapeHtml(note.updatedAt || '')}">${escapeHtml(updatedDate)}</time>
            </header>

            <section class="notes-card-verse">
              <span>Türkçe ayet</span>
              <p>${escapeHtml(verseData.turkish || 'Türkçe ayet metni bulunamadı.')}</p>
            </section>

            <section class="notes-card-note">
              <div class="notes-card-note-label">NOT</div>
              <div class="notes-card-note-content note-rich-content">
                ${noteHtml}
              </div>
            </section>

            <footer class="notes-card-actions">
              <button
                type="button"
                class="notes-go-btn"
                data-action="notes-go-verse"
                data-sura="${suraNumber}"
                data-verse="${verseNumber}"
              >📖 Ayete Git</button>

              <button
                type="button"
                class="notes-edit-btn"
                data-action="edit-note"
                data-sura="${suraNumber}"
                data-verse="${verseNumber}"
              >✏️ Düzenle</button>

              <button
                type="button"
                class="notes-delete-btn"
                data-action="notes-remove"
                data-sura="${suraNumber}"
                data-verse="${verseNumber}"
              >🗑️ Sil</button>
            </footer>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function goToVerseFromNotes(sura, verse) {
  const suraNumber = Number(sura);
  const verseNumber = Number(verse);

  if (!Number.isInteger(suraNumber) || !Number.isInteger(verseNumber)) {
    showNotification('Geçersiz ayet bilgisi.', 'warning');
    return;
  }

  goToVerse(suraNumber, verseNumber, {
    source: 'notes',
    query: ''
  });
}

function removeLocalNoteFromList(sura, verse) {
  const approved = window.confirm(
    `${sura}:${verse} ayetine ait not silinsin mi?`
  );

  if (!approved) return;

  const deleted = deleteLocalNote(sura, verse);

  if (!deleted) {
    showNotification('Silinecek not bulunamadı.', 'warning');
    return;
  }

  clearPageCache();
  updateLocalNoteUI(sura, verse);
  loadAndDisplayAllNotes();
  showNotification('🗑️ Not silindi.', 'success');
}

function exportLocalNotes() {
  const notes = getAllLocalNotes();

  if (Object.keys(notes).length === 0) {
    showNotification('Dışa aktarılacak not bulunamadı.', 'warning');
    return;
  }

  const exportData = {
    application: 'KuranTeyit',
    version: NOTE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    notes
  };

  const blob = new Blob(
    [JSON.stringify(exportData, null, 2)],
    { type: 'application/json;charset=utf-8' }
  );

  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = downloadUrl;
  anchor.download = 'KuranTeyit_Notlar.json';

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(downloadUrl);
}

function openNotesImportDialog() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

    if (file.size > MAX_IMPORT_BYTES) {
      showNotification('Not dosyası 4 MB sınırını aşıyor.', 'warning');
      return;
    }

    try {
      const content = await file.text();
      const parsed = JSON.parse(content);
      const importedNotes = sanitizeNotesForImport(parsed);

      const existingNotes = getAllLocalNotes();
      const mergedNotes = {
        ...existingNotes,
        ...importedNotes
      };

      writeAllLocalNotes(mergedNotes);
      loadAndDisplayAllNotes();
      clearPageCache();

      if (STATE.data.en[STATE.currentPage] && STATE.data.tr[STATE.currentPage]) {
        displayPage(STATE.currentPage);
      }

      showNotification(`${Object.keys(importedNotes).length} not içe aktarıldı.`, 'success');
    } catch (error) {
      console.error('Not dosyası içe aktarılamadı:', error);
      showNotification(error.message || 'Not dosyası geçersiz veya bozuk.', 'warning');
    }
  });

  input.click();
}

/* =========================
   Meal
========================= */
function highlightMealText(text, query) {
  if (!text) return '';

  const safeText = escapeHtml(text);

  if (!query) return safeText;

  const q = query.trim();
  if (!q) return safeText;

  const regex = new RegExp(escapeRegExp(escapeHtml(q)), 'gi');

  return safeText.replace(
    regex,
    '<strong class="search-result-highlight">$&</strong>'
  );
}

function highlightMealMatch(element, query) {
  if (!element || !query) {
    return;
  }

  const cleanQuery =
    String(query).trim();

  if (!cleanQuery) {
    return;
  }

  const normalizedQuery =
    normalizeTurkishText(cleanQuery);

  const mealRows =
    element.querySelectorAll(
      '.meal-row'
    );

  mealRows.forEach((row) => {
    const mealText =
      row.querySelector('.meal-text');

    if (!mealText) {
      return;
    }

    const normalizedText =
      normalizeTurkishText(
        mealText.textContent
      );

    if (
      normalizedText.includes(
        normalizedQuery
      )
    ) {
      row.classList.add(
        'meal-highlight'
      );
    } else {
      row.classList.remove(
        'meal-highlight'
      );
    }
  });
}

function getOtherTranslations(
  suraNum,
  verseNum,
  query = '',
  focusedMealName = ''
) {
  const verseId = `${String(suraNum)}:${String(verseNum)}`;
  const rows = [];
  let erhanTranslation = '';
  let erhanArabic = '';

  for (const [mealName, verseIndex] of Object.entries(MEALS_STATE.index)) {
    const payload = verseIndex?.[verseId];
    if (!payload) continue;

    const normalizedName = mealName.toLocaleLowerCase('tr-TR');

    if (normalizedName === 'kuran_erhan_aktas') {
      erhanTranslation = payload.translation || payload.text || '';
      erhanArabic = payload.arabic || '';
      continue;
    }

    const ayetText = payload.text || payload.translation || '';
    if (!ayetText) continue;

    const focusedClass = mealName === focusedMealName ? 'meal-focused-result' : '';

    rows.push(`
      <div class="meal-row ${focusedClass}">
        <strong class="meal-name">${escapeHtml(mealName)}</strong>
        <span class="meal-text">${highlightMealText(ayetText, query)}</span>
      </div>
    `);
  }

  if (erhanTranslation) {
    rows.push(`
      <div class="meal-row">
        <strong class="meal-name">Erhan Aktaş Çeviri</strong>
        <span class="meal-text">${highlightMealText(erhanTranslation, query)}</span>
      </div>
    `);
  }

  if (erhanArabic) {
    rows.push(`
      <div class="meal-row meal-row-arabic">
        <strong class="meal-name">Erhan Aktaş Arapça</strong>
        <span class="meal-text erhan-arabic-text" dir="rtl">
          ${highlightMealText(erhanArabic, query)}
        </span>
      </div>
    `);
  }

  const pageTransliteration =
    STATE.data.translit?.[String(suraNum)]?.verses?.[String(verseNum)] || '';

  if (pageTransliteration) {
    rows.push(`
      <div class="meal-row">
        <strong class="meal-name">Arapça Okunuş</strong>
        <span class="meal-text">${highlightMealText(pageTransliteration, query)}</span>
      </div>
    `);
  }

  if (!rows.length) {
    return '<div class="meal-empty">Bu ayet için diğer mealler bulunamadı.</div>';
  }

  return `<div class="meal-list">${rows.join('')}</div>`;
}

async function toggleMeal(
  id,
  suraNum,
  verseNum,
  query = '',
  focusedMealName = ''
) {
  const element = document.getElementById(id);
  const button = document.getElementById(`meal-btn-${suraNum}-${verseNum}`);

  if (!element) return;

  try {
    if (!areMealsReady()) {
      if (button) {
        button.textContent = 'Yükleniyor...';
        button.disabled = true;
      }

      await loadMeals();
    }

    if (!element.innerHTML.trim() || query || focusedMealName) {
      element.innerHTML = getOtherTranslations(
        suraNum,
        verseNum,
        query,
        focusedMealName
      );
    }

    const isHidden = element.classList.toggle('hidden');
    button?.setAttribute('aria-expanded', String(!isHidden));

    if (!isHidden && query) {
      highlightMealMatch(element, query);
    }
  } catch (error) {
    element.innerHTML = '<div class="meal-empty">Mealler yüklenemedi.</div>';
    element.classList.remove('hidden');
    button?.setAttribute('aria-expanded', 'true');
  } finally {
    if (button) {
      button.textContent = 'Mealler';
      button.disabled = false;
    }
  }
}

async function ensureMealOpen(suraNum, verseNum, query = '', focusedMealName = '') {
  const id = `meal-${suraNum}-${verseNum}`;
  const element = document.getElementById(id);

  if (!element) return null;

  if (!areMealsReady()) {
    await loadMeals();
  }

  element.innerHTML = getOtherTranslations(suraNum, verseNum, query, focusedMealName);
  element.classList.remove('hidden');

  if (query) {
    highlightMealMatch(element, query);
  }

  requestAnimationFrame(() => {
    const headerEl = document.querySelector('.header-bar');
    const headerHeight = headerEl ? headerEl.offsetHeight : 0;
    const top = element.getBoundingClientRect().top + window.pageYOffset - headerHeight - 8;
    window.scrollTo({ top, behavior: 'smooth' });
  });

  return element;
}

/* =========================
   Note toggle
========================= */
async function toggle1989Edition(button, sura, verse) {
  if (!(button instanceof HTMLElement)) return;

  const targetId = String(button.dataset.target || '').trim();
  const panel = targetId ? document.getElementById(targetId) : null;

  if (!panel) {
    showNotification('1989 baskısı alanı bulunamadı.', 'warning');
    return;
  }

  const willOpen = panel.hidden;

  if (!willOpen) {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('is-open');
    return;
  }

  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  button.classList.add('is-open');

  if (panel.dataset.loaded === 'true') {
    return;
  }

  panel.innerHTML = `
    <div class="verse-1989-loading">
      1989 baskısı yükleniyor...
    </div>
  `;

  try {
    await ensureFeatureLoaded('quran1989');

    const verseId = `${sura}:${verse}`;
    const record = STATE.data.quran1989?.verses?.[verseId];

    if (!record?.text) {
      panel.innerHTML = `
        <div class="verse-1989-error">
          Bu ayet için 1989 baskısı metni bulunamadı.
        </div>
      `;
      return;
    }

    const footnotes = Array.isArray(record.footnotes)
      ? record.footnotes.filter(Boolean)
      : [];

    panel.innerHTML = `
      <div class="verse-1989-heading">
        1989 Authorized English Version
      </div>

      <div class="verse-1989-text">
        ${escapeHtml(record.text)}
      </div>

      ${footnotes.length
        ? `
          <div class="verse-1989-footnotes">
            <div class="verse-1989-footnotes-title">Dipnot</div>
            ${footnotes
              .map((note) => `
                <div class="verse-1989-footnote">
                  ${escapeHtml(note)}
                </div>
              `)
              .join('')}
          </div>
        `
        : ''}
    `;

    panel.dataset.loaded = 'true';

    // 1989 ayet ve dipnot kelimelerine de mevcut Türkçe kelime tooltip'ini uygula.
    decorateVerseWords();
  } catch (error) {
    console.error('1989 baskısı yüklenemedi:', error);
    panel.innerHTML = `
      <div class="verse-1989-error">
        1989 baskısı verisi yüklenemedi.
      </div>
    `;
  }
}

function toggleNote(id) {
  const element = document.getElementById(id);

  if (!element) {
    return;
  }

  const isHidden =
    element.classList.toggle('hidden');

  const btn =
    document.querySelector(
      `[data-target="${id}"]`
    );

  if (btn) {
    btn.textContent = 'Dipnot';

    btn.setAttribute(
      'aria-expanded',
      String(!isHidden)
    );
  }
}

/* =========================
   Arama
========================= */
/* =========================
   GELİŞMİŞ ARAMA YARDIMCILARI
========================= */

function parseVerseReference(value) {
  const input = String(value || '').trim();

  const match = input.match(
    /^(\d{1,3})\s*[:\/,\-\s]\s*(\d{1,3})$/
  );

  if (!match) {
    return null;
  }

  const suraNum = Number(match[1]);
  const verseNum = Number(match[2]);

  const numbersAreValid =
    Number.isInteger(suraNum) &&
    Number.isInteger(verseNum) &&
    suraNum >= 1 &&
    suraNum <= 114 &&
    verseNum >= 1;

  if (!numbersAreValid) {
    return {
      suraNum: String(suraNum),
      verseNum: String(verseNum),
      page: null,
      exists: false
    };
  }

  const page = getVersePage(
    String(suraNum),
    String(verseNum)
  );

  const exists =
    STATE.data.en?.[page]?.sura?.[String(suraNum)]?.verses?.[
      String(verseNum)
    ] !== undefined;

  return {
    suraNum: String(suraNum),
    verseNum: String(verseNum),
    page,
    exists
  };
}


function normalizeSuraLookup(value) {
  return normalizeTurkishText(
    String(value || '')
  )
    .replace(/\b(suresi|sure)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function getSuraNameVariants(fullName) {
  const source = String(fullName || '');
  const variants = new Set();

  const nameWithoutNumber = source.replace(
    /^\s*\d+\s*[:.\-]?\s*/,
    ''
  );

  variants.add(
    normalizeSuraLookup(source)
  );

  variants.add(
    normalizeSuraLookup(nameWithoutNumber)
  );

  variants.add(
    normalizeSuraLookup(
      source.replace(/\([^)]*\)/g, ' ')
    )
  );

  variants.add(
    normalizeSuraLookup(
      nameWithoutNumber.replace(/\([^)]*\)/g, ' ')
    )
  );

  const parentheticalMatches =
    source.matchAll(/\(([^)]*)\)/g);

  for (const match of parentheticalMatches) {
    variants.add(
      normalizeSuraLookup(match[1])
    );
  }

  return [...variants].filter(Boolean);
}

function buildSuraSearchCache() {
  SURA_SEARCH_CACHE.exact.clear();
  SURA_SEARCH_CACHE.items = [];
  SURA_SEARCH_CACHE.queryResults.clear();

  for (const suraNum in STATE.metadata.sureNames) {
    const suraName =
      STATE.metadata.sureNames[suraNum];

    const item = {
      type: 'sura',
      suraNum: String(suraNum),
      suraName,
      page:
        STATE.metadata.sureToPageMap[suraNum],
      variants:
        getSuraNameVariants(suraName)
    };

    SURA_SEARCH_CACHE.items.push(item);

    item.variants.forEach((variant) => {
      if (
        variant &&
        !SURA_SEARCH_CACHE.exact.has(variant)
      ) {
        SURA_SEARCH_CACHE.exact.set(
          variant,
          item
        );
      }
    });
  }

  SURA_SEARCH_CACHE.items.sort(
    (a, b) =>
      Number(a.suraNum) -
      Number(b.suraNum)
  );
}

function findExactSura(query) {
  const normalizedQuery =
    normalizeSuraLookup(query);

  if (!normalizedQuery) {
    return null;
  }

  return (
    SURA_SEARCH_CACHE.exact.get(
      normalizedQuery
    ) || null
  );
}


function getFastSuraSuggestions(
  query,
  limit = 5
) {
  const normalizedQuery =
    normalizeSuraLookup(query);

  if (!normalizedQuery) {
    return [];
  }

  const cacheKey =
    `${normalizedQuery}:${limit}`;

  if (
    SURA_SEARCH_CACHE.queryResults.has(
      cacheKey
    )
  ) {
    return SURA_SEARCH_CACHE
      .queryResults
      .get(cacheKey);
  }

  const suggestions = [];

  for (
    const item of
    SURA_SEARCH_CACHE.items
  ) {
    let priority = 99;

    for (const variant of item.variants) {
      if (variant === normalizedQuery) {
        priority = 0;
        break;
      }

      if (
        variant.startsWith(
          normalizedQuery
        )
      ) {
        priority =
          Math.min(priority, 1);

        continue;
      }

      if (
        variant.includes(
          normalizedQuery
        )
      ) {
        priority =
          Math.min(priority, 2);
      }
    }

    if (priority === 99) {
      continue;
    }

    suggestions.push({
      type: 'sura',
      suraNum: item.suraNum,
      suraName: item.suraName,
      page: item.page,
      priority
    });
  }

  const results = suggestions
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return (
          a.priority -
          b.priority
        );
      }

      return (
        Number(a.suraNum) -
        Number(b.suraNum)
      );
    })
    .slice(0, limit);

  SURA_SEARCH_CACHE
    .queryResults
    .set(
      cacheKey,
      results
    );

  return results;
}

function normalizeResearchLookupText(value) {
  return normalizeTurkishText(String(value || ''))
    .replace(/[“”„‟]/g, '"')
    .replace(/[’‘`´ʼʻ＇]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEnglishResearchTerm(value) {
  return normalizeSearchText(String(value || ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function getResearchConfidencePriority(confidence) {
  switch (String(confidence || '').toLowerCase()) {
    case 'high':
      return 35;
    case 'medium':
      return 25;
    case 'low':
      return 10;
    default:
      return 0;
  }
}

function registerResearchEnglishTerm(english, meta = {}) {
  const cleanEnglish = String(english || '').trim();
  const key = normalizeEnglishResearchTerm(cleanEnglish);
  if (!cleanEnglish || !key) return;

  const priority = Number(meta.priority) || 0;
  const current = RESEARCH_SEARCH_STATE.englishTerms.get(key);

  if (!current || priority > current.priority) {
    RESEARCH_SEARCH_STATE.englishTerms.set(key, {
      english: cleanEnglish,
      source: meta.source || 'dictionary',
      priority
    });
  }
}

function registerResearchReverseTranslation(turkish, english, meta = {}) {
  const cleanTurkish = String(turkish || '').trim();
  const cleanEnglish = String(english || '').trim();
  const turkishKey = normalizeResearchLookupText(cleanTurkish);
  const englishKey = normalizeEnglishResearchTerm(cleanEnglish);

  if (!cleanTurkish || !cleanEnglish || !turkishKey || !englishKey) return;

  const candidates = RESEARCH_SEARCH_STATE.reverseTurkishToEnglish.get(turkishKey) || [];
  const existing = candidates.find(
    (candidate) => normalizeEnglishResearchTerm(candidate.english) === englishKey
  );

  const next = {
    english: cleanEnglish,
    source: meta.source || 'dictionary',
    confidence: meta.confidence || '',
    priority: Number(meta.priority) || 0
  };

  if (existing) {
    if (next.priority > existing.priority) {
      Object.assign(existing, next);
    }
  } else {
    candidates.push(next);
  }

  candidates.sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.english.localeCompare(right.english, 'en');
  });

  RESEARCH_SEARCH_STATE.reverseTurkishToEnglish.set(turkishKey, candidates);
}

function buildResearchReverseDictionaryIndex() {
  const manualSource = STATE.data.dictionary;
  const contextualSource = STATE.data.contextualDictionary;

  if (
    RESEARCH_SEARCH_STATE.manualSource === manualSource &&
    RESEARCH_SEARCH_STATE.contextualSource === contextualSource &&
    (RESEARCH_SEARCH_STATE.reverseTurkishToEnglish.size > 0 ||
      RESEARCH_SEARCH_STATE.englishTerms.size > 0)
  ) {
    return;
  }

  RESEARCH_SEARCH_STATE.manualSource = manualSource || null;
  RESEARCH_SEARCH_STATE.contextualSource = contextualSource || null;
  RESEARCH_SEARCH_STATE.reverseTurkishToEnglish = new Map();
  RESEARCH_SEARCH_STATE.englishTerms = new Map();

  if (manualSource && typeof manualSource === 'object') {
    Object.entries(manualSource).forEach(([english, meaning]) => {
      const cleanEnglish = String(english || '').trim();
      if (!cleanEnglish) return;

      registerResearchEnglishTerm(cleanEnglish, {
        source: 'manual-dictionary',
        priority: 220
      });

      String(meaning || '')
        .split(/\s*,\s*/)
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((translation) => {
          registerResearchReverseTranslation(translation, cleanEnglish, {
            source: 'manual-dictionary',
            priority: 220
          });
        });
    });
  }

  const entries = contextualSource?.entries;

  if (entries && typeof entries === 'object') {
    Object.entries(entries).forEach(([canonicalKey, entry]) => {
      const cleanEnglish = String(canonicalKey || '').trim();
      if (!cleanEnglish) return;

      const confidence = String(entry?.confidence || '').toLowerCase();
      const confidencePriority = getResearchConfidencePriority(confidence);

      registerResearchEnglishTerm(cleanEnglish, {
        source: 'contextual-dictionary',
        priority: 360 + confidencePriority
      });

      if (Array.isArray(entry?.aliases)) {
        entry.aliases.forEach((alias) => {
          registerResearchEnglishTerm(alias, {
            source: 'contextual-alias',
            priority: 350 + confidencePriority
          });
        });
      }

      const defaultTranslation = String(entry?.default_translation || '').trim();
      if (defaultTranslation) {
        registerResearchReverseTranslation(defaultTranslation, cleanEnglish, {
          source: 'contextual-default',
          confidence,
          priority: 350 + confidencePriority
        });
      }

      if (Array.isArray(entry?.translations)) {
        entry.translations
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .forEach((translation) => {
            registerResearchReverseTranslation(translation, cleanEnglish, {
              source: 'contextual-alternative',
              confidence,
              priority: 320 + confidencePriority
            });
          });
      }

      const verseOverrides = entry?.verse_overrides;
      if (verseOverrides && typeof verseOverrides === 'object') {
        Object.values(verseOverrides)
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .forEach((translation) => {
            registerResearchReverseTranslation(translation, cleanEnglish, {
              source: 'contextual-verse',
              confidence,
              priority: 245 + confidencePriority
            });
          });
      }
    });
  }

  console.log(
    'Araştırma ters sözlük indeksi hazır:',
    RESEARCH_SEARCH_STATE.reverseTurkishToEnglish.size,
    'Türkçe karşılık /',
    RESEARCH_SEARCH_STATE.englishTerms.size,
    'İngilizce terim'
  );
}

async function ensureResearchDictionaryReady() {
  try {
    await ensureFeatureLoaded('dictionary');
  } catch (error) {
    console.warn(
      'Araştırma için sözlükler tam yüklenemedi; mevcut arama yedek olarak kullanılacak:',
      error
    );
  }

  buildResearchReverseDictionaryIndex();

  return (
    RESEARCH_SEARCH_STATE.reverseTurkishToEnglish.size > 0 ||
    RESEARCH_SEARCH_STATE.englishTerms.size > 0
  );
}

function parseResearchSearchInput(rawQuery) {
  const raw = String(rawQuery || '').trim();
  const normalizedQuotes = raw.replace(/[“”„‟]/g, '"');

  const wholeQuotedMatch = normalizedQuotes.match(/^"([\s\S]*)"$/);
  if (wholeQuotedMatch) {
    const phrase = String(wholeQuotedMatch[1] || '').trim();
    return {
      raw,
      forceLegacy: true,
      legacyQuery: phrase,
      terms: phrase ? [phrase] : [],
      isMulti: false,
      truncated: false
    };
  }

  const terms = [];
  let buffer = '';
  let inQuotes = false;
  let hadSeparator = false;

  for (const character of normalizedQuotes) {
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === ',' && !inQuotes) {
      hadSeparator = true;
      const value = buffer.trim();
      if (value) terms.push(value);
      buffer = '';
      continue;
    }

    buffer += character;
  }

  const lastValue = buffer.trim();
  if (lastValue) terms.push(lastValue);

  const uniqueTerms = [];
  const seen = new Set();

  terms.forEach((term) => {
    const key = normalizeResearchLookupText(term);
    if (!key || seen.has(key)) return;
    seen.add(key);
    uniqueTerms.push(term);
  });

  const truncated = uniqueTerms.length > RESEARCH_SEARCH_LIMITS.maxTerms;
  const limitedTerms = uniqueTerms.slice(0, RESEARCH_SEARCH_LIMITS.maxTerms);

  return {
    raw,
    forceLegacy: false,
    legacyQuery: raw,
    terms: limitedTerms,
    isMulti: hadSeparator && limitedTerms.length > 1,
    truncated
  };
}

function isSimpleResearchTerm(term) {
  const value = String(term || '').trim();
  if (!value || /\s/.test(value)) return false;

  return /^[\p{L}\p{N}.'’\-]+$/u.test(value);
}

function normalizeEnglishResearchPhrase(value) {
  return normalizeSearchText(String(value || ''))
    .replace(/[’‘`´ʼʻ＇]/g, "'")
    .replace(/\b([\p{L}\p{N}]+)'s\b/gu, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasExactEnglishResearchMatch(text, query) {
  const normalizedText = normalizeEnglishResearchPhrase(text);
  const normalizedQuery = normalizeEnglishResearchPhrase(query);

  if (!normalizedText || !normalizedQuery) return false;

  return ` ${normalizedText} `.includes(` ${normalizedQuery} `);
}

function searchEnglishResearchTerm(query) {
  const q = String(query || '').trim();
  if (!q || !SEARCH_INDEX.ready) return [];

  const results = [];
  const seen = new Set();
  const candidates = getIndexedSearchCandidates(
    SEARCH_INDEX.quran,
    SEARCH_INDEX.quranTokenMap,
    q
  );

  candidates.forEach((item) => {
    if (item?.source !== 'en') return;
    if (!hasExactEnglishResearchMatch(item.text, q)) return;

    const verseId = `${item.suraNum}:${item.verseNum}`;
    if (seen.has(verseId)) return;
    seen.add(verseId);

    results.push({
      type: 'quran',
      source: 'en',
      page: item.page || getVersePage(item.suraNum, item.verseNum),
      suraNum: String(item.suraNum),
      verseNum: String(item.verseNum),
      text: String(item.text || ''),
      query: q,
      score: 100,
      fuzzy: false
    });
  });

  return results.sort((left, right) => {
    const suraDifference = Number(left.suraNum) - Number(right.suraNum);
    if (suraDifference !== 0) return suraDifference;

    return Number(left.verseNum) - Number(right.verseNum);
  });
}

function normalizeTurkishResearchPhrase(value) {
  return normalizeTurkishText(String(value || ''))
    .replace(/[’‘`´ʼʻ＇]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasExactTurkishResearchMatch(text, query) {
  const normalizedText = normalizeTurkishResearchPhrase(text);
  const normalizedQuery = normalizeTurkishResearchPhrase(query);

  if (!normalizedText || !normalizedQuery) return false;

  return ` ${normalizedText} `.includes(` ${normalizedQuery} `);
}

function searchTurkishResearchTerm(query) {
  const q = String(query || '').trim();
  if (!q || !SEARCH_INDEX.ready) return [];

  const resultsByVerse = new Map();

  const addResult = (result, fallbackScore = 90) => {
    if (!result || result.source !== 'tr') return;

    const verseId = `${result.suraNum}:${result.verseNum}`;
    const next = {
      type: 'quran',
      source: 'tr',
      page: result.page || getVersePage(result.suraNum, result.verseNum),
      suraNum: String(result.suraNum),
      verseNum: String(result.verseNum),
      text: String(result.text || ''),
      query: q,
      score: Number(result.score) || fallbackScore,
      fuzzy: result.fuzzy === true
    };

    const current = resultsByVerse.get(verseId);
    if (!current || next.score > current.score) {
      resultsByVerse.set(verseId, next);
    }
  };

  // 1) Tam kelime / tam ifade eşleşmesini her zaman koru.
  for (const item of SEARCH_INDEX.quran) {
    if (item?.source !== 'tr') continue;
    if (!hasExactTurkishResearchMatch(item.text, q)) continue;

    addResult({
      ...item,
      source: 'tr',
      score: 100,
      fuzzy: false
    }, 100);
  }

  // 2) Mevcut arama motorunun Türkçe ana metinde kabul ettiği güçlü yakın
  //    biçimleri de kullan. Böylece "hizip"; "hizipler", "hiziplere" gibi
  //    Türkçe çekimli biçimlerde kaybolmaz. Meal/okunuş/İngilizce sonuçları
  //    burada özellikle alınmaz; yalnız quran_tr.json kaynaklı TR alanı eklenir.
  const existingSearchResults = searchKeywordInData(q, 10000, false);
  existingSearchResults.forEach((result) => {
    if (result?.type !== 'quran' || result?.source !== 'tr') return;
    addResult(result, 85);
  });

  return Array.from(resultsByVerse.values()).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;

    const suraDifference = Number(left.suraNum) - Number(right.suraNum);
    if (suraDifference !== 0) return suraDifference;

    return Number(left.verseNum) - Number(right.verseNum);
  });
}

function addResearchCandidate(candidateMap, candidate, meta = {}) {
  const cleanEnglish = String(candidate || '').trim();
  const key = normalizeEnglishResearchTerm(cleanEnglish);
  if (!cleanEnglish || !key) return;

  const next = {
    english: cleanEnglish,
    source: meta.source || 'dictionary',
    confidence: meta.confidence || '',
    priority: Number(meta.priority) || 0
  };

  const current = candidateMap.get(key);
  if (!current || next.priority > current.priority) {
    candidateMap.set(key, next);
  }
}

function isStrongResearchConfidence(candidate) {
  const confidence = String(candidate?.confidence || '').toLowerCase();
  return confidence === 'high' || confidence === 'medium';
}

function isUsableResearchCandidate(candidate) {
  const normalized = normalizeEnglishResearchPhrase(candidate?.english || '');
  if (!normalized) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && RESEARCH_ENGLISH_STOPWORDS.has(tokens[0])) {
    return false;
  }

  return true;
}

function getResearchCandidateGroups(allCandidates) {
  const groups = [
    allCandidates.filter((candidate) => candidate.source === 'direct-english'),
    allCandidates.filter((candidate) =>
      candidate.source === 'contextual-default' && isStrongResearchConfidence(candidate)
    ),
    allCandidates.filter((candidate) => candidate.source === 'contextual-default'),
    allCandidates.filter((candidate) =>
      candidate.source === 'contextual-alternative' && isStrongResearchConfidence(candidate)
    ),
    allCandidates.filter((candidate) => candidate.source === 'contextual-alternative'),
    allCandidates.filter((candidate) => candidate.source === 'manual-dictionary'),
    allCandidates.filter((candidate) =>
      !['direct-english', 'contextual-default', 'contextual-alternative', 'contextual-verse', 'manual-dictionary']
        .includes(candidate.source)
    )
  ];

  const seenGroupSignatures = new Set();

  return groups.filter((group) => {
    if (!group.length) return false;
    const signature = group
      .map((candidate) => normalizeEnglishResearchTerm(candidate.english))
      .sort()
      .join('|');
    if (!signature || seenGroupSignatures.has(signature)) return false;
    seenGroupSignatures.add(signature);
    return true;
  });
}

function selectResearchActiveCandidates(allCandidates) {
  const groups = getResearchCandidateGroups(allCandidates);

  for (const group of groups) {
    const candidatesWithMatches = group
      .filter(isUsableResearchCandidate)
      .map((candidate) => ({
        ...candidate,
        researchResults: searchEnglishResearchTerm(candidate.english)
      }))
      .filter((candidate) => candidate.researchResults.length > 0)
      .sort((left, right) => {
        if (right.priority !== left.priority) return right.priority - left.priority;
        if (right.researchResults.length !== left.researchResults.length) {
          return right.researchResults.length - left.researchResults.length;
        }
        return left.english.localeCompare(right.english, 'en');
      });

    if (!candidatesWithMatches.length) continue;

    const topPriority = candidatesWithMatches[0].priority;
    return candidatesWithMatches
      .filter((candidate) =>
        candidate.priority >= topPriority - RESEARCH_SEARCH_LIMITS.candidatePriorityWindow
      )
      .slice(0, RESEARCH_SEARCH_LIMITS.maxActiveCandidatesPerConcept);
  }

  return [];
}

function resolveResearchConcept(term) {
  const input = String(term || '').trim();
  const lookupKey = normalizeResearchLookupText(input);
  const englishKey = normalizeEnglishResearchTerm(input);
  const candidateMap = new Map();

  const directEnglish = RESEARCH_SEARCH_STATE.englishTerms.get(englishKey);
  if (directEnglish) {
    addResearchCandidate(candidateMap, directEnglish.english, {
      source: 'direct-english',
      priority: 520
    });
  }

  const reverseCandidates =
    RESEARCH_SEARCH_STATE.reverseTurkishToEnglish.get(lookupKey) || [];

  reverseCandidates.forEach((candidate) => {
    addResearchCandidate(candidateMap, candidate.english, candidate);
  });

  if (candidateMap.size === 0) {
    const directResults = searchEnglishResearchTerm(input);
    if (directResults.length > 0) {
      addResearchCandidate(candidateMap, input, {
        source: 'english-corpus',
        priority: 480
      });
    }
  }

  const allCandidates = Array.from(candidateMap.values())
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      return left.english.localeCompare(right.english, 'en');
    });

  const selectedCandidates = selectResearchActiveCandidates(allCandidates);
  const selectedKeys = new Set(
    selectedCandidates.map((candidate) => normalizeEnglishResearchTerm(candidate.english))
  );
  const alternativeCandidates = allCandidates.filter(
    (candidate) => !selectedKeys.has(normalizeEnglishResearchTerm(candidate.english))
  );

  const matches = new Map();

  selectedCandidates.forEach((candidate) => {
    const candidateResults = Array.isArray(candidate.researchResults)
      ? candidate.researchResults
      : searchEnglishResearchTerm(candidate.english);

    candidateResults.forEach((result) => {
      const verseId = `${result.suraNum}:${result.verseNum}`;
      const current = matches.get(verseId) || {
        verseId,
        suraNum: result.suraNum,
        verseNum: result.verseNum,
        page: result.page,
        score: 0,
        matchedEnglishTerms: new Set(),
        matchedTurkishTerms: new Set(),
        highlightTerms: new Set(),
        sources: new Set()
      };

      current.score = Math.max(current.score, Number(result.score) || 0);
      current.matchedEnglishTerms.add(candidate.english);
      current.highlightTerms.add(candidate.english);
      current.sources.add('en');
      matches.set(verseId, current);
    });
  });

  // İngilizce araştırma ana kaynak olarak kalır; ancak kullanıcının yazdığı
  // Türkçe terim de Türkçe ana metinde mevcut aramanın güçlü kelime/çekim eşleşmeleriyle aranır. Böylece örn. "hizip"
  // İngilizce karşılıkları üzerinden araştırılırken Türkçe "hizip" ayetleri kaybolmaz.
  const turkishDirectResults = searchTurkishResearchTerm(input);

  turkishDirectResults.forEach((result) => {
    const verseId = `${result.suraNum}:${result.verseNum}`;
    const current = matches.get(verseId) || {
      verseId,
      suraNum: result.suraNum,
      verseNum: result.verseNum,
      page: result.page,
      score: 0,
      matchedEnglishTerms: new Set(),
      matchedTurkishTerms: new Set(),
      highlightTerms: new Set(),
      sources: new Set()
    };

    current.score = Math.max(current.score, Number(result.score) || 0);
    current.matchedTurkishTerms.add(input);
    current.highlightTerms.add(input);
    current.sources.add('tr');
    matches.set(verseId, current);
  });

  if (matches.size > 0) {
    return {
      input,
      mode: selectedCandidates.length > 0 ? 'english' : 'turkish',
      englishCandidates: selectedCandidates,
      alternativeCandidates,
      allCandidateCount: allCandidates.length,
      turkishDirectCount: turkishDirectResults.length,
      matches,
      totalMatches: matches.size
    };
  }

  const legacyResults = searchKeywordInData(input, 10000, false);
  legacyResults.forEach((result) => {
    const verseId = `${result.suraNum}:${result.verseNum}`;
    const current = matches.get(verseId) || {
      verseId,
      suraNum: result.suraNum,
      verseNum: result.verseNum,
      page: result.page,
      score: 0,
      matchedEnglishTerms: new Set(),
      matchedTurkishTerms: new Set(),
      highlightTerms: new Set(),
      sources: new Set()
    };

    current.score = Math.max(current.score, Number(result.score) || 0);
    current.highlightTerms.add(input);
    current.sources.add(result.source || result.type || 'legacy');
    matches.set(verseId, current);
  });

  return {
    input,
    mode: 'legacy',
    englishCandidates: [],
    alternativeCandidates: allCandidates,
    allCandidateCount: allCandidates.length,
    turkishDirectCount: 0,
    matches,
    totalMatches: matches.size
  };
}
function aggregateResearchConceptMatches(concepts) {
  const aggregates = new Map();

  concepts.forEach((concept, conceptIndex) => {
    concept.matches.forEach((match, verseId) => {
      const current = aggregates.get(verseId) || {
        key: verseId,
        suraNum: String(match.suraNum),
        verseNum: String(match.verseNum),
        page: match.page,
        score: 0,
        matchedConcepts: new Set(),
        conceptMatches: new Map(),
        highlightTerms: new Set()
      };

      current.score = Math.max(current.score, Number(match.score) || 0);
      current.matchedConcepts.add(conceptIndex);
      current.conceptMatches.set(conceptIndex, match);
      match.highlightTerms.forEach((term) => current.highlightTerms.add(term));
      aggregates.set(verseId, current);
    });
  });

  return Array.from(aggregates.values())
    .map((aggregate) => {
      let englishCoverage = 0;
      let turkishCoverage = 0;

      aggregate.conceptMatches.forEach((match) => {
        if (match?.sources?.has('en')) englishCoverage += 1;
        if (match?.sources?.has('tr')) turkishCoverage += 1;
      });

      return {
        ...aggregate,
        coverage: aggregate.matchedConcepts.size,
        englishCoverage,
        turkishCoverage
      };
    })
    .sort((left, right) => {
      if (right.coverage !== left.coverage) return right.coverage - left.coverage;
      // Aynı kavram kapsamındaki sonuçlarda İngilizce ana metin eşleşmeleri önce gelir.
      if (right.englishCoverage !== left.englishCoverage) {
        return right.englishCoverage - left.englishCoverage;
      }
      if (right.score !== left.score) return right.score - left.score;
      if (right.turkishCoverage !== left.turkishCoverage) {
        return right.turkishCoverage - left.turkishCoverage;
      }

      const suraDifference = Number(left.suraNum) - Number(right.suraNum);
      if (suraDifference !== 0) return suraDifference;

      return Number(left.verseNum) - Number(right.verseNum);
    });
}
function getResearchPairStats(concepts) {
  const stats = [];

  for (let leftIndex = 0; leftIndex < concepts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < concepts.length; rightIndex += 1) {
      const leftMatches = concepts[leftIndex].matches;
      const rightMatches = concepts[rightIndex].matches;
      const smaller = leftMatches.size <= rightMatches.size ? leftMatches : rightMatches;
      const larger = smaller === leftMatches ? rightMatches : leftMatches;
      let count = 0;

      smaller.forEach((_, verseId) => {
        if (larger.has(verseId)) count += 1;
      });

      stats.push({
        leftIndex,
        rightIndex,
        count
      });
    }
  }

  return stats.sort((left, right) => right.count - left.count);
}

function highlightSearchResultTerms(text, terms) {
  const rawText = String(text || '');
  const cleanTerms = Array.from(
    new Set(
      (Array.isArray(terms) ? terms : [])
        .map((term) => String(term || '').trim())
        .filter(Boolean)
    )
  )
    .sort((left, right) => right.length - left.length)
    .slice(0, 24);

  if (!rawText || cleanTerms.length === 0) {
    return escapeHtml(rawText);
  }

  const regex = new RegExp(
    `(${cleanTerms.map((term) => escapeRegExp(term)).join('|')})`,
    'gi'
  );

  return rawText
    .split(regex)
    .map((part, index) => {
      if (index % 2 === 1) {
        return `<mark class="search-panel-highlight">${escapeHtml(part)}</mark>`;
      }

      return escapeHtml(part);
    })
    .join('');
}

function getResearchCandidateDisplay(concept) {
  const turkishDirectCount = Math.max(0, Number(concept?.turkishDirectCount) || 0);

  if (concept.mode === 'turkish') {
    return `
      <div class="research-term-active-candidates">
        <span class="research-term-candidate-label">Türkçe ana metinde birebir kullanılıyor:</span>
        <div class="research-term-candidates">
          <span class="research-term-chip research-term-chip-active">${escapeHtml(concept.input)} · ${turkishDirectCount} ayet</span>
        </div>
      </div>
      <span class="research-term-fallback">Güvenilir İngilizce karşılık bulunamadı; Türkçe ana metin sonuçları korundu.</span>
    `;
  }

  if (concept.mode !== 'english' || concept.englishCandidates.length === 0) {
    return '<span class="research-term-fallback">İngilizce/Türkçe birebir karşılık bulunamadı — mevcut arama kullanıldı</span>';
  }

  const activeHtml = concept.englishCandidates
    .map((candidate) => `
      <span class="research-term-chip research-term-chip-active" title="Ortaklık hesabında İngilizce ana karşılık olarak kullanılıyor">
        ${escapeHtml(candidate.english)}
      </span>
    `)
    .join('');

  const turkishSupportHtml = turkishDirectCount > 0
    ? `
      <div class="research-term-active-candidates">
        <span class="research-term-candidate-label">Türkçe metin desteği:</span>
        <div class="research-term-candidates">
          <span class="research-term-chip research-term-chip-active" title="Türkçe ana metindeki birebir eşleşmeler de sonuçlara eklenir">
            ${escapeHtml(concept.input)} · ${turkishDirectCount} ayet
          </span>
        </div>
      </div>
    `
    : '';

  const alternatives = Array.isArray(concept.alternativeCandidates)
    ? concept.alternativeCandidates
    : [];
  const visibleAlternatives = alternatives.slice(
    0,
    RESEARCH_SEARCH_LIMITS.maxVisibleAlternativeCandidates
  );
  const hiddenAlternativeCount = Math.max(0, alternatives.length - visibleAlternatives.length);

  const alternativesHtml = alternatives.length
    ? `
      <div class="research-term-alternatives">
        <span class="research-term-candidate-label">Diğer sözlük adayları — hesaba katılmaz:</span>
        <div class="research-term-candidates">
          ${visibleAlternatives.map((candidate) => `
            <span class="research-term-chip research-term-chip-muted">${escapeHtml(candidate.english)}</span>
          `).join('')}
          ${hiddenAlternativeCount > 0
            ? `<span class="research-term-chip research-term-chip-muted">+${hiddenAlternativeCount} aday</span>`
            : ''}
        </div>
      </div>
    `
    : '';

  return `
    <div class="research-term-active-candidates">
      <span class="research-term-candidate-label">Ana araştırmada kullanılan (EN):</span>
      <div class="research-term-candidates">${activeHtml}</div>
    </div>
    ${turkishSupportHtml}
    ${alternativesHtml}
  `;
}
function createResearchVerseCard(aggregate, concepts, totalConcepts) {
  const verseData = findVerseData(aggregate.suraNum, aggregate.verseNum);
  const matchedConceptIndexes = Array.from(aggregate.matchedConcepts).sort((a, b) => a - b);
  const englishTerms = new Set();
  const turkishTerms = new Set();
  let hasLegacyMatch = false;
  let hasEnglishMatch = false;
  let hasTurkishDirectMatch = false;

  const matchChipHtml = matchedConceptIndexes.map((conceptIndex) => {
    const concept = concepts[conceptIndex];
    const match = aggregate.conceptMatches.get(conceptIndex);
    const matchedEnglishTerms = Array.from(match?.matchedEnglishTerms || []);
    const matchedTurkishTerms = Array.from(match?.matchedTurkishTerms || []);

    matchedEnglishTerms.forEach((term) => englishTerms.add(term));
    matchedTurkishTerms.forEach((term) => turkishTerms.add(term));

    if (match?.sources?.has('en')) hasEnglishMatch = true;
    if (match?.sources?.has('tr')) hasTurkishDirectMatch = true;
    if (concept.mode === 'legacy') hasLegacyMatch = true;

    const englishLabel = matchedEnglishTerms.length
      ? ` → ${matchedEnglishTerms.slice(0, 3).join(' / ')}`
      : '';
    const turkishLabel = matchedTurkishTerms.length
      ? `${matchedEnglishTerms.length ? ' · ' : ' → '}TR:${matchedTurkishTerms.slice(0, 2).join(' / ')}`
      : '';

    return `
      <span class="research-match-chip">
        ✓ ${escapeHtml(concept.input)}${escapeHtml(englishLabel)}${escapeHtml(turkishLabel)}
      </span>
    `;
  }).join('');

  // Türkçe satırda kullanıcı sorgusunu vurgulamaya devam et; doğrudan TR eşleşmesi
  // varsa zaten matchedTurkishTerms içinde bulunur.
  matchedConceptIndexes.forEach((conceptIndex) => {
    const concept = concepts[conceptIndex];
    if (concept?.input) turkishTerms.add(concept.input);
  });

  const highlightTerms = Array.from(aggregate.highlightTerms || []);
  const primaryHighlight =
    Array.from(englishTerms)[0] ||
    Array.from(turkishTerms)[0] ||
    highlightTerms[0] ||
    '';

  const sourceLabel = hasEnglishMatch && hasTurkishDirectMatch
    ? 'İngilizce ana + Türkçe doğrudan eşleşme'
    : hasEnglishMatch
      ? 'Ana eşleşme: İngilizce metin'
      : hasTurkishDirectMatch
        ? 'Destek eşleşmesi: Türkçe ana metin'
        : hasLegacyMatch
          ? 'Mevcut arama desteği'
          : 'Araştırma eşleşmesi';

  const suraName = STATE.metadata.sureNames[aggregate.suraNum] || `Sure ${aggregate.suraNum}`;
  const allMatched = aggregate.coverage === totalConcepts;

  return `
    <article class="search-result-card research-result-card ${allMatched ? 'research-result-card-all' : ''}">
      <div class="search-result-card-header">
        <div class="search-result-card-heading-line">
          <strong class="search-result-reference">${escapeHtml(aggregate.key)}</strong>
          <span class="search-result-sura-name">${escapeHtml(suraName)}</span>
          <span class="search-result-source">${sourceLabel}</span>
        </div>
        <span class="research-coverage-badge">${aggregate.coverage}/${totalConcepts}</span>
      </div>

      <div class="research-match-chips">${matchChipHtml}</div>

      ${verseData.english
        ? `<div class="search-result-language search-result-language-en research-result-primary"><strong>EN:</strong><span>${highlightSearchResultTerms(verseData.english, Array.from(englishTerms).length ? Array.from(englishTerms) : highlightTerms)}</span></div>`
        : ''}

      ${verseData.turkish
        ? `<div class="search-result-language search-result-language-tr"><strong>TR:</strong><span>${highlightSearchResultTerms(verseData.turkish, Array.from(turkishTerms))}</span></div>`
        : ''}

      <div class="search-result-actions">
        <button type="button" class="search-result-action" data-search-action="verse" data-highlight-query="${escapeHtml(primaryHighlight)}" data-sura="${escapeHtml(aggregate.suraNum)}" data-verse="${escapeHtml(aggregate.verseNum)}">📖 Ayete Git</button>
        <button type="button" class="search-result-action" data-search-action="meal" data-highlight-query="${escapeHtml(primaryHighlight)}" data-sura="${escapeHtml(aggregate.suraNum)}" data-verse="${escapeHtml(aggregate.verseNum)}">📚 Mealler</button>
        <button type="button" class="search-result-action" data-search-action="analysis" data-highlight-query="${escapeHtml(primaryHighlight)}" data-sura="${escapeHtml(aggregate.suraNum)}" data-verse="${escapeHtml(aggregate.verseNum)}">🔎 Analiz</button>
      </div>
    </article>
  `;
}
function createResearchConceptDetail(concept) {
  const sortedMatches = Array.from(concept.matches.values())
    .sort((left, right) => {
      const leftEnglish = left?.sources?.has('en') ? 1 : 0;
      const rightEnglish = right?.sources?.has('en') ? 1 : 0;
      if (rightEnglish !== leftEnglish) return rightEnglish - leftEnglish;
      if (right.score !== left.score) return right.score - left.score;
      const suraDifference = Number(left.suraNum) - Number(right.suraNum);
      if (suraDifference !== 0) return suraDifference;
      return Number(left.verseNum) - Number(right.verseNum);
    });

  const visibleMatches = sortedMatches.slice(0, RESEARCH_SEARCH_LIMITS.maxConceptCards);
  const cards = visibleMatches.map((match) => {
    const aggregate = {
      key: match.verseId,
      suraNum: match.suraNum,
      verseNum: match.verseNum,
      page: match.page,
      score: match.score,
      coverage: 1,
      matchedConcepts: new Set([0]),
      conceptMatches: new Map([[0, match]]),
      highlightTerms: new Set(match.highlightTerms)
    };

    return createResearchVerseCard(aggregate, [concept], 1);
  }).join('');

  const hiddenCount = Math.max(0, sortedMatches.length - visibleMatches.length);

  return `
    <details class="research-concept-details">
      <summary>
        <span><strong>${escapeHtml(concept.input)}</strong> — ${concept.totalMatches} ayet</span>
        <span class="research-concept-summary-secondary">
          ${concept.mode === 'english'
            ? 'English-first + TR destek'
            : concept.mode === 'turkish'
              ? 'Türkçe metin desteği'
              : 'Mevcut arama'}
        </span>
      </summary>

      <div class="research-concept-detail-toolbar">
        ${getResearchCandidateDisplay(concept)}
        <button
          type="button"
          class="research-legacy-btn"
          data-research-legacy-query="${escapeHtml(concept.input)}"
        >Mevcut aramada aç</button>
      </div>

      <div class="search-results-list">${cards}</div>
      ${hiddenCount > 0
        ? `<div class="research-results-limit-note">İlk ${visibleMatches.length} sonuç gösteriliyor. ${hiddenCount} sonuç daha var.</div>`
        : ''}
    </details>
  `;
}

function getSearchWordSuggestions(
  query,
  limit = 5
) {
  const normalizedQuery =
    normalizeTurkishText(query).trim();

  if (
    !normalizedQuery ||
    normalizedQuery.length < 2 ||
    !SEARCH_INDEX.ready
  ) {
    return [];
  }

  const candidates = new Map();

  for (const item of SEARCH_INDEX.quran) {
    const words =
      String(item.text || '')
        .match(/[\p{L}\p{N}'’-]+/gu) || [];

    for (const word of words) {
      const normalizedWord =
        normalizeTurkishText(word)
          .replace(/[^\p{L}\p{N}]/gu, '')
          .trim();

      if (
        !normalizedWord ||
        normalizedWord.length <=
          normalizedQuery.length ||
        !normalizedWord.startsWith(
          normalizedQuery
        )
      ) {
        continue;
      }

      const current =
        candidates.get(normalizedWord);

      if (current) {
        current.count++;
      } else {
        candidates.set(
          normalizedWord,
          {
            text: word,
            normalized: normalizedWord,
            count: 1
          }
        );
      }
    }
  }

  return Array
    .from(candidates.values())
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return (
        a.normalized.length -
        b.normalized.length
      );
    })
    .slice(0, limit);
}

function highlightSearchResultText(
  text,
  query
) {
  const safeText =
    escapeHtml(text || '');

  const cleanQuery =
    String(query || '').trim();

  if (!cleanQuery) {
    return safeText;
  }

  const regex = new RegExp(
    escapeRegExp(cleanQuery),
    'gi'
  );

  return safeText.replace(
    regex,
    '<mark class="search-panel-highlight">$&</mark>'
  );
}

function getSearchSourceLabel(source) {
  const labels = {
    tr: 'Türkçe',
    en: 'İngilizce',
    translit: 'Okunuş',
    ai: 'AI Çeviri'
  };

  return labels[source] || source || 'Ayet';
}


function cloneSearchParentRoute(route) {
  if (!route || typeof route !== 'object' || !route.view) return null;

  try {
    return JSON.parse(JSON.stringify(route));
  } catch (error) {
    return { ...route };
  }
}

function normalizeSearchReturnState(returnState) {
  const query = String(returnState?.query || '').trim();
  if (!query) return null;

  return {
    query,
    mode: String(returnState?.mode || 'auto'),
    scrollTop: Math.max(0, Number(returnState?.scrollTop) || 0),
    englishExpanded: returnState?.englishExpanded === true,
    sharedVisibleCount: Math.max(0, Number(returnState?.sharedVisibleCount) || 0),
    parentRoute: cloneSearchParentRoute(returnState?.parentRoute),
    parentPageScrollTop: Math.max(0, Number(returnState?.parentPageScrollTop) || 0)
  };
}

function captureSearchReturnState(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return null;

  const panel = document.getElementById('searchResultsPanel');
  const body = panel?.querySelector('#searchResultsPanelBody');
  const englishToggle = panel?.querySelector('[data-search-english-toggle]');

  return normalizeSearchReturnState({
    query: cleanQuery,
    mode: panel?.dataset.searchMode || 'auto',
    scrollTop: Number(body?.scrollTop) || 0,
    englishExpanded: englishToggle?.getAttribute('aria-pressed') === 'true',
    sharedVisibleCount: Number(panel?.dataset.sharedVisibleCount) || 0,
    parentRoute: history.state?.route || null,
    parentPageScrollTop: window.scrollY
  });
}

function attachSearchReturnToCurrentHistory(returnState) {
  const normalized = normalizeSearchReturnState(returnState);
  if (!normalized) return;

  SEARCH_RETURN_STATE.active = normalized;

  if (history.state?.route?.view === 'verse') {
    history.replaceState(
      {
        ...history.state,
        searchReturn: normalized
      },
      '',
      window.location.href
    );
  }

  updatePreviousButtonState();
}

async function reopenSearchResultsFromReturnState(returnState) {
  const normalized = normalizeSearchReturnState(returnState);
  if (!normalized) return false;

  const query = normalized.query;
  activeSearchQuery = query;

  if (DOM.searchInput) {
    DOM.searchInput.value = query;
  }

  if (normalized.mode === 'research') {
    await openResearchSearchResultsPanel(
      query,
      parseResearchSearchInput(query),
      { initialSharedVisibleCount: normalized.sharedVisibleCount }
    );
  } else if (normalized.mode === 'legacy') {
    await openLegacySearchResultsPanel(query);
  } else {
    await openSearchResultsPanel(query);
  }

  const panel = document.getElementById('searchResultsPanel');
  const body = panel?.querySelector('#searchResultsPanelBody');

  if (!panel || !body) return false;

  const englishToggle = panel.querySelector('[data-search-english-toggle]');

  if (
    normalized.englishExpanded === true &&
    englishToggle &&
    englishToggle.getAttribute('aria-pressed') !== 'true'
  ) {
    englishToggle.click();
  }

  const targetScrollTop = normalized.scrollTop;

  requestAnimationFrame(() => {
    body.scrollTop = targetScrollTop;
  });

  return true;
}

async function restoreSearchParentRouteAndReopen(returnState) {
  const normalized = normalizeSearchReturnState(returnState);
  if (!normalized) return false;

  const parentRoute = normalized.parentRoute;

  if (parentRoute?.view) {
    await applyRoute(parentRoute, {
      historyMode: 'replace',
      restoreScroll: false
    });

    requestAnimationFrame(() => {
      window.scrollTo({
        top: normalized.parentPageScrollTop,
        behavior: 'auto'
      });
    });
  } else if (history.state?.searchReturn) {
    const nextState = { ...history.state };
    delete nextState.searchReturn;
    history.replaceState(nextState, '', window.location.href);
  }

  SEARCH_RETURN_STATE.pending = null;
  SEARCH_RETURN_STATE.active = null;
  updatePreviousButtonState();

  return reopenSearchResultsFromReturnState(normalized);
}

function restoreSearchResultsFromHistory() {
  const returnState = normalizeSearchReturnState(
    history.state?.searchReturn || SEARCH_RETURN_STATE.active
  );

  if (
    history.state?.route?.view !== 'verse' ||
    !returnState
  ) {
    return false;
  }

  // Uygulamanın sol üst geri düğmesinde browser history zincirine güvenme.
  // Aramanın açıldığı ana rotayı doğrudan geri yükleyip aynı sonuç panelini
  // yeniden açmak, PWA/WebView ve normal tarayıcıda daha deterministiktir.
  if (SEARCH_RETURN_STATE.fallbackTimer) {
    clearTimeout(SEARCH_RETURN_STATE.fallbackTimer);
    SEARCH_RETURN_STATE.fallbackTimer = null;
  }

  SEARCH_RETURN_STATE.pending = null;
  SEARCH_RETURN_STATE.active = null;

  restoreSearchParentRouteAndReopen(returnState).catch((error) => {
    console.error('Arama sonuçlarına geri dönüş tamamlanamadı:', error);
    showNotification('Arama sonuçlarına geri dönülemedi.', 'warning');
  });

  return true;
}

function groupDetailedSearchResults(results) {
  const groups = new Map();

  results.forEach((result) => {
    const key =
      `${result.suraNum}:${result.verseNum}`;

    if (!groups.has(key)) {
      const verseData = findVerseData(
        String(result.suraNum),
        String(result.verseNum)
      );

      groups.set(key, {
        key,
        suraNum: String(result.suraNum),
        verseNum: String(result.verseNum),
        page: result.page || verseData.page,
        verseData,
        sources: new Set(),
        meals: new Set(),
        score: 0,
        fuzzy: false
      });
    }

    const group = groups.get(key);

    if (result.type === 'meal') {
      group.meals.add(
        result.mealName || 'Meal'
      );
    } else {
      group.sources.add(
        getSearchSourceLabel(result.source)
      );
    }

    group.score = Math.max(
      group.score,
      Number(result.score) || 0
    );

    group.fuzzy =
      group.score < 100;
  });

  return Array
    .from(groups.values())
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      const suraDifference =
        Number(a.suraNum) -
        Number(b.suraNum);

      if (suraDifference !== 0) {
        return suraDifference;
      }

      return (
        Number(a.verseNum) -
        Number(b.verseNum)
      );
    });
}

function createSearchPanelShell(query, options = {}) {
  const panelTitle = String(options.title || '🔎 Arama Sonuçları');
  closeSearchResultsPanel({ restoreFocus: false });

  if (document.getElementById('analysisPanel')) {
    const fallbackRoute = history.state?.parentRoute || {
      view: 'page',
      page: STATE.currentPage
    };

    closeAnalysisPanel({ updateHistory: false, restoreFocus: false });
    updateHistoryRoute(fallbackRoute, 'replace');
  }
  lastDialogTrigger = DOM.searchInput instanceof HTMLElement
    ? DOM.searchInput
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  const panel = document.createElement('section');
  panel.id = 'searchResultsPanel';
  panel.className = 'search-results-panel';
  panel.dataset.searchMode = String(options.mode || 'legacy');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'searchResultsTitle');

  panel.innerHTML = `
    <header class="search-results-header">
      <div>
        <h2 id="searchResultsTitle">${escapeHtml(panelTitle)}</h2>
        <div class="search-results-query">“${escapeHtml(query)}”</div>
      </div>

      <button
        type="button"
        class="search-results-close"
        aria-label="Arama sonuçlarını kapat"
        title="Kapat"
      >✕</button>
    </header>

    <div id="searchResultsPanelBody" class="search-results-body" aria-live="polite">
      <div class="search-panel-loading">Arama sonuçları hazırlanıyor...</div>
    </div>
  `;

  panel.querySelector('.search-results-close')?.addEventListener('click', () => {
    closeSearchResultsPanel();
  });

  panel.addEventListener('keydown', (event) => trapDialogFocus(panel, event));
  document.body.appendChild(panel);
  document.body.classList.add('search-results-open');

  requestAnimationFrame(() => panel.querySelector('.search-results-close')?.focus());
  return panel;
}

function openLegacySearchFromResearchQuery(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return;

  const parsed = parseResearchSearchInput(cleanQuery);
  const terms = Array.from(
    new Set(
      (parsed.terms || [])
        .map((term) => String(term || '').trim())
        .filter(Boolean)
    )
  );

  if (terms.length <= 1) {
    const legacyQuery = terms[0] || parsed.legacyQuery || cleanQuery;
    if (DOM.searchInput) DOM.searchInput.value = legacyQuery;
    return openLegacySearchResultsPanel(legacyQuery);
  }

  return openLegacySearchTermPicker(cleanQuery, terms);
}

function openLegacySearchTermPicker(query, terms) {
  const cleanQuery = String(query || '').trim();
  const cleanTerms = Array.from(
    new Set(
      (Array.isArray(terms) ? terms : [])
        .map((term) => String(term || '').trim())
        .filter(Boolean)
    )
  );

  if (!cleanQuery || cleanTerms.length === 0) return;
  if (cleanTerms.length === 1) {
    if (DOM.searchInput) DOM.searchInput.value = cleanTerms[0];
    return openLegacySearchResultsPanel(cleanTerms[0]);
  }

  const panel = createSearchPanelShell(cleanQuery, {
    title: '🔎 Mevcut Aramada Aç',
    mode: 'legacy-picker'
  });
  const body = panel.querySelector('#searchResultsPanelBody');
  if (!body) return;

  body.innerHTML = `
    <section class="research-search-intro">
      <div class="research-search-title-row">
        <div>
          <strong>Eski arama motorunda terim seçin</strong>
          <p>
            Mevcut arama virgüllü sorguyu tek bir ifade olarak arar. Bu yüzden
            <strong>${escapeHtml(cleanQuery)}</strong> sorgusunu doğrudan göndermek yerine,
            hangi terimi mevcut aramada açmak istediğinizi seçebilirsiniz.
          </p>
        </div>
      </div>

      <div class="search-panel-suggestions">
        <strong>Mevcut aramada açılacak terim:</strong>
        <div class="search-panel-suggestion-list">
          ${cleanTerms.map((term) => `
            <button
              type="button"
              class="search-word-suggestion"
              data-legacy-picker-term="${escapeHtml(term)}"
            >${escapeHtml(term)}</button>
          `).join('')}
        </div>
      </div>

      <div class="research-concept-detail-toolbar">
        <button
          type="button"
          class="research-legacy-btn"
          data-return-to-research="true"
        >← İngilizce öncelikli araştırmaya dön</button>
      </div>
    </section>
  `;

  body.addEventListener('click', (event) => {
    const termButton = event.target.closest('[data-legacy-picker-term]');
    if (termButton) {
      const term = String(termButton.dataset.legacyPickerTerm || '').trim();
      if (!term) return;
      if (DOM.searchInput) DOM.searchInput.value = term;
      openLegacySearchResultsPanel(term);
      return;
    }

    const returnButton = event.target.closest('[data-return-to-research]');
    if (returnButton) {
      if (DOM.searchInput) DOM.searchInput.value = cleanQuery;
      openResearchSearchResultsPanel(cleanQuery, parseResearchSearchInput(cleanQuery));
    }
  });
}

async function openResearchSearchResultsPanel(query, parsedInput, options = {}) {
  const cleanQuery = String(query || '').trim();
  const parsed = parsedInput || parseResearchSearchInput(cleanQuery);
  if (!cleanQuery || parsed.terms.length === 0) return;

  const panel = createSearchPanelShell(cleanQuery, {
    title: '🧭 İngilizce Öncelikli Araştırma',
    mode: 'research'
  });
  const requestId = ++activeSearchRequestId;
  const body = panel.querySelector('#searchResultsPanelBody');
  if (!body) return;

  if (!SEARCH_INDEX.ready) {
    body.innerHTML = `
      <div class="search-panel-empty">
        Arama dizini henüz hazırlanıyor. Birkaç saniye sonra tekrar deneyin.
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div class="search-panel-loading">
      <strong>İngilizce öncelikli araştırma hazırlanıyor.</strong>
      <div class="search-panel-wait-message">
        Mevcut Kuran Teyit sözlüğü Türkçe → İngilizce yönünde okunuyor...
      </div>
    </div>
  `;

  await ensureResearchDictionaryReady();

  if (
    requestId !== activeSearchRequestId ||
    !panel.isConnected ||
    document.getElementById('searchResultsPanel') !== panel
  ) {
    return;
  }

  const concepts = parsed.terms.map((term) => resolveResearchConcept(term));

  if (
    concepts.length === 1 &&
    concepts[0].mode !== 'english'
  ) {
    return openLegacySearchResultsPanel(concepts[0].input);
  }

  const aggregates = aggregateResearchConceptMatches(concepts);
  const totalConcepts = concepts.length;
  const allMatchedCount = aggregates.filter(
    (aggregate) => aggregate.coverage === totalConcepts
  ).length;
  const sharedResults = totalConcepts === 1
    ? aggregates
    : aggregates.filter((aggregate) => aggregate.coverage >= 2);

  const requestedSharedVisibleCount = Math.max(
    RESEARCH_SEARCH_LIMITS.maxAggregateCards,
    Number(options.initialSharedVisibleCount) || 0
  );
  let sharedVisibleCount = Math.min(
    sharedResults.length,
    requestedSharedVisibleCount
  );
  let visibleSharedResults = sharedResults.slice(0, sharedVisibleCount);
  panel.dataset.sharedVisibleCount = String(sharedVisibleCount);

  const pairStats = totalConcepts >= 2 ? getResearchPairStats(concepts) : [];

  const mappingHtml = concepts.map((concept) => `
    <div class="research-term-card ${concept.mode === 'legacy' ? 'is-fallback' : ''}">
      <div class="research-term-input">${escapeHtml(concept.input)}</div>
      <div class="research-term-arrow" aria-hidden="true">→</div>
      <div class="research-term-resolution">
        ${getResearchCandidateDisplay(concept)}
        <small>${concept.totalMatches} ayet</small>
      </div>
    </div>
  `).join('');

  const pairHtml = pairStats.length > 0
    ? `
      <section class="research-section">
        <div class="research-section-header">
          <h3>İkili ortaklıklar</h3>
          <span>Aynı ayette birlikte bulunan kavram grupları</span>
        </div>
        <div class="research-pair-grid">
          ${pairStats.map((pair) => `
            <div class="research-pair-chip">
              <span>${escapeHtml(concepts[pair.leftIndex].input)} + ${escapeHtml(concepts[pair.rightIndex].input)}</span>
              <strong>${pair.count}</strong>
            </div>
          `).join('')}
        </div>
      </section>
    `
    : '';

  const getSharedLimitHtml = () => {
    const totalCount = sharedResults.length;
    const remainingCount = Math.max(0, totalCount - sharedVisibleCount);
    if (remainingCount <= 0) return '';

    const shownLabel = totalConcepts === 1 ? 'sonuç' : 'ortak sonuç';
    return `
      <div class="research-results-limit-note" data-research-shared-limit>
        <span>İlk ${sharedVisibleCount} ${shownLabel} gösteriliyor. Toplam ${totalCount} ayet bulundu.</span>
        <button
          type="button"
          class="research-load-more-btn"
          data-research-load-more
        >Devamını göster (${remainingCount})</button>
      </div>
    `;
  };

  const sharedHtml = totalConcepts === 1
    ? `
      <section class="research-section">
        <div class="research-section-header">
          <h3>İngilizce öncelikli + Türkçe destek sonuçları</h3>
          <span>${aggregates.length} birleşik ayet</span>
        </div>
        <div class="search-results-list" data-research-shared-list>
          ${visibleSharedResults.map((aggregate) =>
            createResearchVerseCard(aggregate, concepts, totalConcepts)
          ).join('')}
        </div>
        ${getSharedLimitHtml()}
      </section>
    `
    : `
      <section class="research-section">
        <div class="research-section-header">
          <h3>Bütünsel ve kısmi ortak sonuçlar</h3>
          <span>Önce ${totalConcepts}/${totalConcepts}, sonra daha düşük ortaklıklar</span>
        </div>
        ${sharedResults.length
          ? `
            <div class="search-results-list" data-research-shared-list>
              ${visibleSharedResults.map((aggregate) =>
                createResearchVerseCard(aggregate, concepts, totalConcepts)
              ).join('')}
            </div>
            ${getSharedLimitHtml()}
          `
          : `
            <div class="research-fallback-notice">
              İki veya daha fazla kavramın aynı ayette buluştuğu sonuç bulunamadı.
              Tek tek sonuçlar aşağıda yine gösteriliyor.
            </div>
          `}
      </section>
    `;

  const conceptDetailsHtml = concepts
    .map((concept) => createResearchConceptDetail(concept))
    .join('');

  const turkishOnlyConceptCount = concepts.filter(
    (concept) => concept.mode === 'turkish'
  ).length;
  const fallbackConceptCount = concepts.filter(
    (concept) => concept.mode === 'legacy'
  ).length;

  body.innerHTML = `
    <section class="research-search-intro">
      <div class="research-search-title-row">
        <div>
          <strong>Ana araştırma dili: English</strong>
          <p>
            Türkçe terimler, Kuran Teyit'te İngilizce kelimelerin üzerinde gösterilen
            mevcut Türkçe karşılıklardan ters yönde çözümlenir. İngilizce ana metin önceliklidir;
            ancak kullanıcının yazdığı Türkçe terim Türkçe ana metinde de birebir aranır ve bu
            ayetler sonuçlara eklenir. İngilizce eşleşmeler sıralamada önce gelir; diğer sözlük
            adayları yalnız bilgi amacıyla gösterilir.
          </p>
        </div>
        <button
          type="button"
          class="research-legacy-btn"
          data-research-legacy-query="${escapeHtml(cleanQuery)}"
        >Mevcut aramada aç</button>
      </div>

      ${parsed.truncated
        ? `<div class="research-fallback-notice">En fazla ${RESEARCH_SEARCH_LIMITS.maxTerms} benzersiz terim aynı araştırmada işlenir; sonraki terimler bu çalışmada kullanılmadı.</div>`
        : ''}

      ${turkishOnlyConceptCount > 0
        ? `<div class="research-fallback-notice">${turkishOnlyConceptCount} terim için güvenilir İngilizce karşılık bulunamadı; Türkçe ana metindeki birebir eşleşmeler korunarak kullanıldı.</div>`
        : ''}

      ${fallbackConceptCount > 0
        ? `<div class="research-fallback-notice">${fallbackConceptCount} terim için İngilizce veya Türkçe birebir eşleşme bulunamadı. Bu terimlerde mevcut arama motoru yedek olarak kullanıldı.</div>`
        : ''}

      <div class="research-term-grid">${mappingHtml}</div>
    </section>

    <div class="research-summary-grid">
      <div class="research-summary-stat">
        <strong>${totalConcepts}</strong>
        <span>Kavram</span>
      </div>
      <div class="research-summary-stat">
        <strong>${allMatchedCount}</strong>
        <span>${totalConcepts > 1 ? `${totalConcepts}/${totalConcepts} ortak ayet` : 'Birleşik sonuç'}</span>
      </div>
      <div class="research-summary-stat">
        <strong>${aggregates.length}</strong>
        <span>Benzersiz ayet</span>
      </div>
    </div>

    ${pairHtml}
    ${sharedHtml}

    <section class="research-section">
      <div class="research-section-header">
        <h3>Terimleri ayrı ayrı incele</h3>
        <span>Her kavramın kendi sonuçları</span>
      </div>
      <div class="research-concept-list">${conceptDetailsHtml}</div>
    </section>
  `;

  body.addEventListener('click', (event) => {
    const loadMoreButton = event.target.closest('[data-research-load-more]');
    if (loadMoreButton) {
      const list = body.querySelector('[data-research-shared-list]');
      const limitBox = body.querySelector('[data-research-shared-limit]');
      if (!list || !limitBox) return;

      const previousCount = sharedVisibleCount;
      sharedVisibleCount = Math.min(
        sharedResults.length,
        previousCount + RESEARCH_SEARCH_LIMITS.maxAggregateCards
      );
      visibleSharedResults = sharedResults.slice(0, sharedVisibleCount);
      panel.dataset.sharedVisibleCount = String(sharedVisibleCount);

      const nextCards = sharedResults
        .slice(previousCount, sharedVisibleCount)
        .map((aggregate) => createResearchVerseCard(aggregate, concepts, totalConcepts))
        .join('');

      if (nextCards) {
        list.insertAdjacentHTML('beforeend', nextCards);
      }

      const nextLimitHtml = getSharedLimitHtml();
      if (nextLimitHtml) {
        limitBox.outerHTML = nextLimitHtml;
      } else {
        limitBox.remove();
      }
      return;
    }

    const legacyButton = event.target.closest('[data-research-legacy-query]');
    if (legacyButton) {
      const legacyQuery = String(legacyButton.dataset.researchLegacyQuery || '').trim();
      if (legacyQuery) openLegacySearchFromResearchQuery(legacyQuery);
      return;
    }

    const button = event.target.closest('[data-search-action]');
    if (!button) return;

    const action = button.dataset.searchAction;
    const suraNum = button.dataset.sura;
    const verseNum = button.dataset.verse;
    const highlightQuery = String(button.dataset.highlightQuery || '').trim();
    const searchReturn = captureSearchReturnState(cleanQuery);

    closeSearchResultsPanel({ restoreFocus: false });

    if (action === 'analysis') {
      openAnalysisPanel(suraNum, verseNum, { trigger: DOM.searchInput });
      return;
    }

    activeSearchQuery = highlightQuery || cleanQuery;
    DOM.searchInput.value = '';
    DOM.autocomplete.innerHTML = '';
    DOM.autocomplete.style.display = 'none';

    const didNavigate = goToVerse(suraNum, verseNum, {
      source: 'research-search',
      query: highlightQuery || '',
      openMeal: action === 'meal'
    });

    if (didNavigate) {
      attachSearchReturnToCurrentHistory(searchReturn);
    }
  });
}

async function openSearchResultsPanel(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return;

  const parsed = parseResearchSearchInput(cleanQuery);

  if (parsed.forceLegacy) {
    return openLegacySearchResultsPanel(parsed.legacyQuery || cleanQuery);
  }

  if (parsed.isMulti) {
    return openResearchSearchResultsPanel(cleanQuery, parsed);
  }

  const singleTerm = parsed.terms[0] || cleanQuery;

  if (isSimpleResearchTerm(singleTerm)) {
    return openResearchSearchResultsPanel(cleanQuery, parsed);
  }

  return openLegacySearchResultsPanel(cleanQuery);
}

async function openLegacySearchResultsPanel(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return;

  const panel = createSearchPanelShell(cleanQuery, { mode: 'legacy' });
  const requestId = ++activeSearchRequestId;
  const body = panel.querySelector('#searchResultsPanelBody');
  if (!body) return;

  if (!SEARCH_INDEX.ready) {
    body.innerHTML = `
      <div class="search-panel-empty">
        Arama dizini henüz hazırlanıyor. Birkaç saniye sonra tekrar deneyin.
      </div>
    `;
    return;
  }

  let results = searchKeywordInData(cleanQuery, 200, false);

  if (!areMealsReady()) {
    body.innerHTML = `
      <div class="search-panel-loading">
        <strong>Kuran sonuçları bulundu, mealler aranıyor.</strong>
        <div class="search-panel-wait-message">Detaylı arama hazırlanıyor...</div>
      </div>
    `;

    try {
      await loadMeals();
    } catch (error) {
      // Kuran sonuçları yine gösterilir.
    }

    if (
      requestId !== activeSearchRequestId ||
      !panel.isConnected ||
      document.getElementById('searchResultsPanel') !== panel
    ) {
      return;
    }

    results = searchKeywordInData(cleanQuery, 1000, areMealsReady());
  }

  if (requestId !== activeSearchRequestId || !panel.isConnected) return;

  const groupedResults = groupDetailedSearchResults(results);
  const wordSuggestions = getSearchWordSuggestions(cleanQuery, 5);

  if (!groupedResults.length && !wordSuggestions.length) {
    body.innerHTML = `
      <div class="search-panel-empty">
        <strong>“${escapeHtml(cleanQuery)}”</strong> için sonuç bulunamadı.
      </div>
    `;
    return;
  }

  const suggestionHtml = wordSuggestions.length
    ? `
      <div class="search-panel-suggestions">
        <strong>Şunlardan birini mi demek istediniz?</strong>
        <div class="search-panel-suggestion-list">
          ${wordSuggestions.map((suggestion) => `
            <button
              type="button"
              class="search-word-suggestion"
              data-search-word="${escapeHtml(suggestion.text)}"
            >${escapeHtml(suggestion.text)}</button>
          `).join('')}
        </div>
      </div>
    `
    : '';

  const hasEnglishResults = groupedResults.some((group) => Boolean(group.verseData.english));

  const resultCards = groupedResults.map((group) => {
    const suraName = STATE.metadata.sureNames[group.suraNum] || `Sure ${group.suraNum}`;
    const sources = [...group.sources];
    if (group.meals.size) sources.push(`${group.meals.size} meal`);
    const sourceText = sources.length ? sources.join(', ') : 'Ayet';
    const scoreClass = group.score === 100 ? 'search-result-exact' : '';

    return `
      <article class="search-result-card">
        <div class="search-result-card-header">
          <div class="search-result-card-heading-line">
            <strong class="search-result-reference">${escapeHtml(group.key)}</strong>
            <span class="search-result-sura-name">${escapeHtml(suraName)}</span>
            <span class="search-result-source">Eşleşen alan: ${escapeHtml(sourceText)}</span>
          </div>
          <span class="search-result-fuzzy ${scoreClass}">%${group.score} eşleşme</span>
        </div>

        ${group.verseData.turkish
          ? `<div class="search-result-language search-result-language-tr"><strong>TR:</strong><span>${highlightSearchResultText(group.verseData.turkish, cleanQuery)}</span></div>`
          : ''}

        ${group.verseData.english
          ? `<div class="search-result-language search-result-language-en" data-search-english-row hidden><strong>EN:</strong><span>${highlightSearchResultText(group.verseData.english, cleanQuery)}</span></div>`
          : ''}

        <div class="search-result-actions">
          <button type="button" class="search-result-action" data-search-action="verse" data-sura="${escapeHtml(group.suraNum)}" data-verse="${escapeHtml(group.verseNum)}">📖 Ayete Git</button>
          <button type="button" class="search-result-action" data-search-action="meal" data-sura="${escapeHtml(group.suraNum)}" data-verse="${escapeHtml(group.verseNum)}">📚 Mealler</button>
          <button type="button" class="search-result-action" data-search-action="analysis" data-sura="${escapeHtml(group.suraNum)}" data-verse="${escapeHtml(group.verseNum)}">🔎 Analiz</button>
        </div>
      </article>
    `;
  }).join('');

  const englishToggleHtml = hasEnglishResults
    ? `
      <button
        type="button"
        class="search-results-english-toggle"
        data-search-english-toggle
        aria-pressed="false"
      >Tüm İngilizce alanları göster</button>
    `
    : '';

  body.innerHTML = `
    ${suggestionHtml}
    <div class="search-results-summary">
      <span class="search-results-count"><strong>${groupedResults.length}</strong> ayet sonucu bulundu.</span>
      ${englishToggleHtml}
    </div>
    <div class="search-results-list">${resultCards}</div>
  `;

  const englishToggle = body.querySelector('[data-search-english-toggle]');
  englishToggle?.addEventListener('click', () => {
    const englishRows = body.querySelectorAll('[data-search-english-row]');
    const willShow = englishToggle.getAttribute('aria-pressed') !== 'true';

    englishRows.forEach((row) => {
      row.hidden = !willShow;
    });

    englishToggle.setAttribute('aria-pressed', String(willShow));
    englishToggle.textContent = willShow
      ? 'Tüm İngilizce alanları gizle'
      : 'Tüm İngilizce alanları göster';
  });

  body.querySelectorAll('.search-word-suggestion').forEach((button) => {
    button.addEventListener('click', () => {
      const nextQuery = button.dataset.searchWord || '';
      DOM.searchInput.value = nextQuery;
      openSearchResultsPanel(nextQuery);
    });
  });

  body.addEventListener('click', (event) => {
    const button = event.target.closest('[data-search-action]');
    if (!button) return;

    const action = button.dataset.searchAction;
    const suraNum = button.dataset.sura;
    const verseNum = button.dataset.verse;
    const searchReturn = captureSearchReturnState(cleanQuery);

    closeSearchResultsPanel({ restoreFocus: false });

    if (action === 'analysis') {
      openAnalysisPanel(suraNum, verseNum, { trigger: DOM.searchInput });
      return;
    }

    activeSearchQuery = cleanQuery;
    DOM.searchInput.value = '';
    DOM.autocomplete.innerHTML = '';
    DOM.autocomplete.style.display = 'none';

    const didNavigate = goToVerse(suraNum, verseNum, {
      source: 'search',
      query: cleanQuery,
      openMeal: action === 'meal'
    });

    if (didNavigate) {
      attachSearchReturnToCurrentHistory(searchReturn);
    }
  });
}

function closeSearchResultsPanel(options = {}) {
  const { restoreFocus = true } = options;
  activeSearchRequestId += 1;

  const panel = document.getElementById('searchResultsPanel');
  document.body.classList.remove('search-results-open');
  if (!panel) return;

  panel.remove();

  if (restoreFocus && lastDialogTrigger?.isConnected) {
    lastDialogTrigger.focus();
  }

  lastDialogTrigger = null;
}

function makeSnippet(text, query) {
  if (!text || typeof text !== 'string') return '';
  if (!query || typeof query !== 'string') {
    return text.length > 140 ? `${text.slice(0, 140)}...` : text;
  }

  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);

  if (idx === -1) {
    return text.length > 140 ? `${text.slice(0, 140)}...` : text;
  }

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + q.length + 40);
  let snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');

  const regex = new RegExp(escapeRegExp(query), 'gi');
  snippet = snippet.replace(regex, '<strong class="search-result-highlight">$&</strong>');
  return snippet;
}




function searchKeywordInData(
  query,
  maxResults = 16,
  includeMeals = true
) {
  const q = String(query || '').trim();

  if (!q || !SEARCH_INDEX.ready) return [];

  const allResults = [];
  const seen = new Set();

  function addResult(item, type) {
    const score = getSearchMatchScore(q, item.text, item.normalized);
    if (score < 75) return;

    const key = type === 'meal'
      ? `meal:${item.mealName}:${item.suraNum}:${item.verseNum}`
      : `quran:${item.source}:${item.suraNum}:${item.verseNum}`;

    if (seen.has(key)) return;
    seen.add(key);

    allResults.push({
      type,
      source: item.source || '',
      mealName: item.mealName || '',
      page: item.page || getVersePage(item.suraNum, item.verseNum),
      suraNum: String(item.suraNum),
      verseNum: String(item.verseNum),
      text: String(item.text || ''),
      snippet: makeSnippet(String(item.text || ''), q),
      query: q,
      score,
      fuzzy: score < 100
    });
  }

  const quranCandidates = getIndexedSearchCandidates(
    SEARCH_INDEX.quran,
    SEARCH_INDEX.quranTokenMap,
    q
  );

  quranCandidates.forEach((item) => addResult(item, 'quran'));

  if (includeMeals && areMealsReady()) {
    const mealCandidates = getIndexedSearchCandidates(
      SEARCH_INDEX.meals,
      SEARCH_INDEX.mealTokenMap,
      q
    );

    mealCandidates.forEach((item) => addResult(item, 'meal'));
  }

  allResults.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;

    const suraDifference = Number(left.suraNum) - Number(right.suraNum);
    if (suraDifference !== 0) return suraDifference;

    return Number(left.verseNum) - Number(right.verseNum);
  });

  return allResults.slice(0, maxResults);
}

function setupSearch() {
  const searchInput = DOM.searchInput;
  const autocomplete = DOM.autocomplete;

  if (!searchInput || !autocomplete) return;

  let debounceTimer = null;
  let activeIndex = -1;
  const DEBOUNCE_MS = 180;

  function getOptions() {
    return [...autocomplete.querySelectorAll('[role="option"][data-selectable="true"]')];
  }

  function updateActiveOption(nextIndex) {
    const options = getOptions();
    if (!options.length) return;

    activeIndex = (nextIndex + options.length) % options.length;

    options.forEach((option, index) => {
      const isActive = index === activeIndex;
      option.classList.toggle('autocomplete-active', isActive);
      option.setAttribute('aria-selected', String(isActive));
    });

    const activeOption = options[activeIndex];
    searchInput.setAttribute('aria-activedescendant', activeOption.id);
    activeOption.scrollIntoView({ block: 'nearest' });
  }

  function hideAutocomplete() {
    autocomplete.innerHTML = '';
    autocomplete.style.display = 'none';
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function showAutocomplete() {
    autocomplete.style.display = 'block';
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function addAutocompleteItem({ html, className = '', onClick = null, selectable = true }) {
    const item = document.createElement('div');
    item.id = `autocomplete-option-${Date.now()}-${autocomplete.children.length}`;
    item.className = className;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.dataset.selectable = String(selectable);
    item.innerHTML = html;

    if (selectable && typeof onClick === 'function') {
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', onClick);
    }

    autocomplete.appendChild(item);
    return item;
  }

  function showReferenceWarning(reference) {
    autocomplete.innerHTML = '';

    addAutocompleteItem({
      className: 'autocomplete-warning',
      selectable: false,
      html: `<strong>${escapeHtml(reference.suraNum)}:${escapeHtml(reference.verseNum)} ayeti bulunamadı.</strong>`
    });

    showAutocomplete();
  }

  function goDirectlyToReference(reference) {
    activeSearchQuery = '';
    searchInput.value = '';
    hideAutocomplete();

    goToVerse(reference.suraNum, reference.verseNum, {
      source: 'search-reference',
      query: ''
    });
  }

  function goDirectlyToSura(sura) {
    searchInput.value = '';
    hideAutocomplete();
    goToSura(sura.suraNum, { source: 'search-sura' });
  }

  function runLightSearch(rawValue) {
    const value = String(rawValue || '').trim();
    autocomplete.innerHTML = '';
    activeIndex = -1;

    if (!value) {
      hideAutocomplete();
      return;
    }

    const verseReference = parseVerseReference(value);

    if (verseReference) {
      if (!verseReference.exists) {
        showReferenceWarning(verseReference);
        return;
      }

      const verseData = findVerseData(verseReference.suraNum, verseReference.verseNum);

      addAutocompleteItem({
        className: 'autocomplete-verse-reference',
        html: `
          <strong>${escapeHtml(verseReference.suraNum)}:${escapeHtml(verseReference.verseNum)} ayetine git</strong>
          <br>
          <small>${escapeHtml(String(verseData.turkish || '').slice(0, 130))}</small>
        `,
        onClick: () => goDirectlyToReference(verseReference)
      });

      showAutocomplete();
      return;
    }

    const researchPreview = parseResearchSearchInput(value);

    if (researchPreview.isMulti) {
      addAutocompleteItem({
        className: 'autocomplete-all-results autocomplete-research-results',
        html: `
          <strong>${researchPreview.terms.length} terimli İngilizce öncelikli araştırmayı başlat</strong>
          <br>
          <small>Virgülle ayrılan kavramlar birlikte ve ayrı ayrı incelenecek.</small>
        `,
        onClick: () => {
          hideAutocomplete();
          openSearchResultsPanel(value);
        }
      });

      showAutocomplete();
      return;
    }

    getFastSuraSuggestions(value, 5).forEach((suggestion) => {
      addAutocompleteItem({
        className: 'autocomplete-sura-result',
        html: `<strong>${escapeHtml(suggestion.suraNum)}:</strong> ${escapeHtml(suggestion.suraName)}`,
        onClick: () => goDirectlyToSura(suggestion)
      });
    });

    addAutocompleteItem({
      className: 'autocomplete-all-results',
      html: `
        <strong>“${escapeHtml(value)}” için akıllı aramayı ve tüm sonuçları göster</strong>
        <br>
        <small>Tek kelimede İngilizce öncelikli eşleştirme denenir; bulunamazsa mevcut arama kullanılır.</small>
      `,
      onClick: () => {
        hideAutocomplete();
        openSearchResultsPanel(value);
      }
    });

    showAutocomplete();
  }

  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-controls', 'autocomplete');
  searchInput.setAttribute('aria-expanded', 'false');

  searchInput.addEventListener('input', (event) => {
    const value = event.target.value.trim();
    clearTimeout(debounceTimer);

    if (!value) {
      hideAutocomplete();
      return;
    }

    debounceTimer = setTimeout(() => runLightSearch(value), DEBOUNCE_MS);
  });

  searchInput.addEventListener('keydown', (event) => {
    const options = getOptions();

    if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      updateActiveOption(activeIndex + 1);
      return;
    }

    if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault();
      updateActiveOption(activeIndex - 1);
      return;
    }

    if (event.key === 'Escape') {
      hideAutocomplete();
      return;
    }

    if (event.key !== 'Enter') return;
    event.preventDefault();
    clearTimeout(debounceTimer);

    if (activeIndex >= 0 && options[activeIndex]) {
      options[activeIndex].click();
      return;
    }

    const value = searchInput.value.trim();
    if (!value) return;

    const verseReference = parseVerseReference(value);
    if (verseReference) {
      if (!verseReference.exists) {
        showReferenceWarning(verseReference);
        return;
      }

      goDirectlyToReference(verseReference);
      return;
    }

    const exactSura = findExactSura(value);
    if (exactSura) {
      goDirectlyToSura(exactSura);
      return;
    }

    openSearchResultsPanel(value);
    hideAutocomplete();
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (!autocomplete.matches(':hover')) hideAutocomplete();
    }, 180);
  });

  searchInput.addEventListener('focus', () => {
    const value = searchInput.value.trim();
    if (value) runLightSearch(value);
  });
}

/* =========================
   Kuran Oku
========================= */
function setQuranReaderNavigationMode(isReader) {
  const previousButton = document.getElementById('prevPage');
  const nextButton = document.getElementById('nextPage');

  if (previousButton) {
    previousButton.title = isReader
      ? 'Önceki ekrana dön'
      : 'Önceki sayfa';

    previousButton.setAttribute(
      'aria-label',
      isReader ? 'Önceki ekrana dön' : 'Önceki sayfa'
    );
  }

  if (nextButton) {
    nextButton.hidden = Boolean(isReader);
    nextButton.setAttribute('aria-hidden', isReader ? 'true' : 'false');
  }
}

function getQuranReaderSuras() {
  if (QURAN_READER_STATE.suras.length > 0) {
    return QURAN_READER_STATE.suras;
  }

  const suraMap = new Map();
  const pageNumbers = Object.keys(STATE.data.tr || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  pageNumbers.forEach((pageNumber) => {
    const pageData = STATE.data.tr?.[pageNumber];
    if (!pageData?.sura) return;

    Object.keys(pageData.sura)
      .sort((left, right) => Number(left) - Number(right))
      .forEach((suraNum) => {
        const sourceSura = pageData.sura[suraNum] || {};

        if (!suraMap.has(suraNum)) {
          suraMap.set(suraNum, {
            number: String(suraNum),
            title: getQuranReaderSuraTitle(suraNum),
            verses: new Map()
          });
        }

        const targetSura = suraMap.get(suraNum);

        Object.keys(sourceSura.verses || {})
          .sort((left, right) => Number(left) - Number(right))
          .forEach((verseNum) => {
            if (targetSura.verses.has(String(verseNum))) return;

            targetSura.verses.set(String(verseNum), {
              number: String(verseNum),
              text: String(sourceSura.verses?.[verseNum] || ''),
              passageTitle: String(sourceSura.titles?.[verseNum] || '').trim()
            });
          });
      });
  });

  QURAN_READER_STATE.suras = [...suraMap.values()]
    .sort((left, right) => Number(left.number) - Number(right.number))
    .map((sura) => ({
      ...sura,
      verses: [...sura.verses.values()]
        .sort((left, right) => Number(left.number) - Number(right.number))
    }));

  return QURAN_READER_STATE.suras;
}

function getQuranReaderSuraTitle(suraNum) {
  const rawTitle = String(
    STATE.metadata.sureNames?.[String(suraNum)] || `${suraNum}. Sure`
  ).trim();

  return /^\d+\s*:/.test(rawTitle)
    ? rawTitle
    : `${suraNum}: ${rawTitle}`;
}

function getStoredQuranReaderFontLevel() {
  try {
    const stored = Number(localStorage.getItem(QURAN_READER_FONT_STORAGE_KEY));
    if (!Number.isFinite(stored)) return 0;

    return Math.max(
      QURAN_READER_FONT_MIN_LEVEL,
      Math.min(QURAN_READER_FONT_MAX_LEVEL, Math.trunc(stored))
    );
  } catch (error) {
    console.warn('Kuran okuma yaz\u0131 boyutu okunamad\u0131:', error);
    return 0;
  }
}

function getQuranReaderFontPercent(level = QURAN_READER_STATE.fontLevel) {
  const normalized = Number(level) || 0;
  return 100 + (normalized * 12);
}

function setQuranReaderFontLevel(level, options = {}) {
  const { persist = true } = options;
  const numericLevel = Number(level);
  const nextLevel = Math.max(
    QURAN_READER_FONT_MIN_LEVEL,
    Math.min(
      QURAN_READER_FONT_MAX_LEVEL,
      Number.isFinite(numericLevel) ? Math.trunc(numericLevel) : 0
    )
  );

  QURAN_READER_STATE.fontLevel = nextLevel;

  const page = DOM.content.querySelector('.quran-reader-page');
  if (page) {
    page.dataset.fontLevel = String(nextLevel);
  }

  const status = document.getElementById('quranReaderFontStatus');
  if (status) {
    status.textContent = `Yaz\u0131 ${getQuranReaderFontPercent(nextLevel)}%`;
  }

  const decreaseButton = DOM.content.querySelector(
    '[data-action="reader-font-decrease"]'
  );
  const increaseButton = DOM.content.querySelector(
    '[data-action="reader-font-increase"]'
  );

  if (decreaseButton) {
    decreaseButton.disabled = nextLevel <= QURAN_READER_FONT_MIN_LEVEL;
  }

  if (increaseButton) {
    increaseButton.disabled = nextLevel >= QURAN_READER_FONT_MAX_LEVEL;
  }

  if (persist) {
    try {
      localStorage.setItem(QURAN_READER_FONT_STORAGE_KEY, String(nextLevel));
    } catch (error) {
      console.warn('Kuran okuma yaz\u0131 boyutu kaydedilemedi:', error);
    }
  }

  return nextLevel;
}

function changeQuranReaderFontLevel(delta) {
  return setQuranReaderFontLevel(
    QURAN_READER_STATE.fontLevel + Number(delta || 0)
  );
}

function buildQuranReaderHtml() {
  if (QURAN_READER_STATE.html) {
    return QURAN_READER_STATE.html;
  }

  const suras = getQuranReaderSuras();

  if (suras.length === 0) {
    return `
      <div class="quran-reader-page">
        <div class="page-header">
          <h1>📖 Kuran Oku</h1>
        </div>
        <div class="analysis-card quran-reader-empty">
          Kuran metni henüz yüklenemedi.
        </div>
      </div>
    `;
  }

  const suraOptions = suras
    .map((sura) => `
      <option value="${escapeHtml(sura.number)}">
        ${escapeHtml(sura.title)}
      </option>
    `)
    .join('');

  const suraSections = suras
    .map((sura) => {
      const versesHtml = sura.verses
        .map((verse) => {
          const verseId = `${sura.number}:${verse.number}`;
          const passageTitle = verse.passageTitle
            ? `<div class="quran-reader-passage-title">${escapeHtml(verse.passageTitle)}</div>`
            : '';

          return `
            ${passageTitle}
            <button
              id="reader-verse-${escapeHtml(sura.number)}-${escapeHtml(verse.number)}"
              type="button"
              class="quran-reader-verse"
              data-action="reader-open-verse"
              data-sura="${escapeHtml(sura.number)}"
              data-verse="${escapeHtml(verse.number)}"
              aria-label="${escapeHtml(verseId)} ayetinin ayrıntılarını aç"
            >
              <span class="quran-reader-verse-ref">
                ${escapeHtml(verseId)}
              </span>

              <span class="quran-reader-verse-text">
                ${escapeHtml(verse.text)}
              </span>
            </button>
          `;
        })
        .join('');

      return `
        <section
          id="reader-sura-${escapeHtml(sura.number)}"
          class="analysis-card quran-reader-sura"
          aria-labelledby="reader-sura-title-${escapeHtml(sura.number)}"
        >
          <h2
            id="reader-sura-title-${escapeHtml(sura.number)}"
            class="quran-reader-sura-title"
          >
            ${escapeHtml(sura.title)}
          </h2>

          <div class="quran-reader-verses">
            ${versesHtml}
          </div>
        </section>
      `;
    })
    .join('');

  QURAN_READER_STATE.html = `
    <div class="quran-reader-page">
      <div class="page-header">
        <h1>📖 Kuran Oku</h1>
      </div>

      <div class="analysis-card quran-reader-intro">
        Ayet ayrıntılarını ana sayfadaki görünümle açmak için ayetin üzerine tıklayın.
        Geri düğmesiyle aynı okuma konumuna dönersiniz.
      </div>

      <div class="quran-reader-toolbar">
        <label for="quranReaderSuraSelect">Sureye git</label>

        <select
          id="quranReaderSuraSelect"
          class="quran-reader-sura-select"
        >
          ${suraOptions}
        </select>

        <div
          class="appendix-reader-font-controls quran-reader-font-controls"
          role="group"
          aria-label="Kuran okuma yazı boyutu"
        >
          <button
            type="button"
            class="appendix-reader-font-btn quran-reader-font-btn"
            data-action="reader-font-decrease"
            aria-label="Kuran okuma yazısını küçült"
            title="Yazıyı küçült"
          >
            A−
          </button>

          <button
            type="button"
            id="quranReaderFontStatus"
            class="appendix-reader-font-status quran-reader-font-status"
            data-action="reader-font-reset"
            title="Varsayılan yazı boyutuna dön"
          >
            Yazı 100%
          </button>

          <button
            type="button"
            class="appendix-reader-font-btn quran-reader-font-btn"
            data-action="reader-font-increase"
            aria-label="Kuran okuma yazısını büyüt"
            title="Yazıyı büyüt"
          >
            A+
          </button>
        </div>

        <button
          type="button"
          class="quran-reader-top-btn"
          data-action="reader-top"
        >
          Başa Dön
        </button>
      </div>

      <div class="quran-reader-list">
        ${suraSections}
      </div>
    </div>
  `;

  return QURAN_READER_STATE.html;
}

function updateQuranReaderHistory(mode = 'push', scrollTop = 0, verseId = '') {
  if (mode === 'none' || NAVIGATION_STATE.applyingHistory) return;

  const method = mode === 'replace' ? 'replaceState' : 'pushState';
  const cleanUrl = `${window.location.pathname}${window.location.search}#reader`;

  history[method](
    {
      route: { view: 'reader' },
      pageScrollTop: Number(scrollTop) || 0,
      readerVerseId: String(verseId || '')
    },
    '',
    cleanUrl
  );

  NAVIGATION_STATE.lastRoute = { view: 'reader' };
}

function saveQuranReaderPosition(verseId = '') {
  if (history.state?.route?.view !== 'reader') return;

  history.replaceState(
    {
      ...history.state,
      route: { view: 'reader' },
      pageScrollTop: window.scrollY,
      readerVerseId: String(verseId || history.state?.readerVerseId || '')
    },
    '',
    `${window.location.pathname}${window.location.search}#reader`
  );
}

function openVerseFromQuranReader(suraNum, verseNum) {
  const sura = String(suraNum || '');
  const verse = String(verseNum || '');

  if (!verseExists(sura, verse)) {
    showNotification(`${sura}:${verse} ayeti bulunamadı.`, 'warning');
    return false;
  }

  return goToVerse(sura, verse, {
    source: 'reader',
    historyMode: 'push',
    query: ''
  });
}

function setupQuranReaderControls() {
  const select = document.getElementById('quranReaderSuraSelect');

  setQuranReaderFontLevel(getStoredQuranReaderFontLevel(), { persist: false });

  select?.addEventListener('change', () => {
    const suraNum = String(select.value || '');
    const target = document.getElementById(`reader-sura-${suraNum}`);

    target?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'
    });
  });
}

function displayQuranReaderPage(options = {}) {
  const {
    historyMode = 'none',
    scrollTop = 0,
    focusVerseId = ''
  } = options;

  ensureQuranView();
  closeAnalysisPanel({ updateHistory: false, restoreFocus: false });
  closeSearchResultsPanel({ restoreFocus: false });
  clearAnalysisReturnState();

  STATE.currentView = 'reader';
  setQuranReaderNavigationMode(true);
  DOM.content.innerHTML = buildQuranReaderHtml();
  applySettings();
  setupQuranReaderControls();

  updateQuranReaderHistory(historyMode, scrollTop, focusVerseId);

  requestAnimationFrame(() => {
    const restoredScroll = Number(scrollTop);

    if (Number.isFinite(restoredScroll) && restoredScroll > 0) {
      window.scrollTo({ top: restoredScroll, behavior: 'auto' });
      return;
    }

    if (focusVerseId) {
      const [sura, verse] = String(focusVerseId).split(':');
      document
        .getElementById(`reader-verse-${sura}-${verse}`)
        ?.scrollIntoView({ block: 'center', behavior: 'auto' });
      return;
    }

    window.scrollTo({ top: 0, behavior: 'auto' });
  });
}


const APPENDIX_IMAGE_ROOT = './assets/images/appendices';

function getAppendixImageSource(fileName) {
  const safeFileName = String(fileName || '').trim();
  if (!safeFileName) return '';
  return `${APPENDIX_IMAGE_ROOT}/${encodeURIComponent(safeFileName)}`;
}

function setupAppendixImageFallback() {
  if (setupAppendixImageFallback.ready) return;
  setupAppendixImageFallback.ready = true;

  document.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      if (!image.classList.contains('appendix-reader-picture-image')) return;

      image.hidden = true;

      const media = image.closest('.appendix-reader-picture-media');
      media?.classList.add('is-image-missing');

      const missing = media?.querySelector('.appendix-reader-picture-missing');
      if (missing) missing.hidden = false;
    },
    true
  );
}

/* =========================
   Ekler Oku
========================= */
async function ensureAppendicesReaderLoaded() {
  if (APPENDIX_READER_STATE.status === 'ready') return true;
  if (APPENDIX_READER_STATE.status === 'loading') return APPENDIX_READER_STATE.promise;

  APPENDIX_READER_STATE.status = 'loading';

  APPENDIX_READER_STATE.promise = (async () => {
    try {
      const response = await fetch(CONFIG.dataPaths.appendicesTr, { cache: 'no-cache' });

      if (!response.ok) {
        throw new Error(`Ekler verisi yüklenemedi (${response.status}).`);
      }

      APPENDIX_READER_STATE.data = await response.json();
      APPENDIX_READER_STATE.appendices = buildAppendicesReaderData(
        APPENDIX_READER_STATE.data
      );
      APPENDIX_READER_STATE.html = '';
      APPENDIX_READER_STATE.status = 'ready';
      return true;
    } catch (error) {
      APPENDIX_READER_STATE.status = 'error';
      APPENDIX_READER_STATE.promise = null;
      throw error;
    }
  })();

  return APPENDIX_READER_STATE.promise;
}

function getAppendixEventPriority(type) {
  const priorities = {
    title: 0,
    text: 1,
    evidence: 2,
    table: 3,
    picture: 4
  };

  return priorities[type] ?? 9;
}

function buildAppendicesReaderData(rawData) {
  const pages = (Array.isArray(rawData) ? rawData : Object.values(rawData || {}))
    .filter((page) => page && Number.isFinite(Number(page.page)))
    .sort((left, right) => Number(left.page) - Number(right.page));

  const appendices = [];
  let currentAppendix = null;

  pages.forEach((page) => {
    const events = [];

    const pushEvents = (type, source) => {
      Object.entries(source || {}).forEach(([position, value]) => {
        events.push({
          type,
          position: Number(position),
          value,
          page: Number(page.page)
        });
      });
    };

    pushEvents('title', page.titles);
    pushEvents('text', page.text);
    pushEvents('evidence', page.evidence);
    pushEvents('table', page.table);
    pushEvents('picture', page.picture);

    events
      .sort((left, right) => {
        if (left.position !== right.position) return left.position - right.position;
        return getAppendixEventPriority(left.type) - getAppendixEventPriority(right.type);
      })
      .forEach((event) => {
        if (event.type === 'title') {
          const titleText = String(event.value || '').trim();
          const appendixMatch = titleText.match(/^Ek\s+(\d+)\s*$/i);

          if (appendixMatch) {
            const appendixNumber = Number(appendixMatch[1]);
            currentAppendix = {
              number: appendixNumber,
              title: '',
              startPage: event.page,
              endPage: event.page,
              blocks: []
            };
            appendices.push(currentAppendix);
            return;
          }
        }

        if (!currentAppendix) return;

        currentAppendix.endPage = Math.max(currentAppendix.endPage, event.page);

        if (
          event.type === 'title' &&
          !currentAppendix.title &&
          String(event.value || '').trim()
        ) {
          currentAppendix.title = String(event.value).trim();
          return;
        }

        currentAppendix.blocks.push(event);
      });
  });

  return appendices
    .filter((appendix) => appendix.number >= 1 && appendix.number <= 38)
    .sort((left, right) => left.number - right.number);
}


function extractAppendixVerseRefs(textValue) {
  const text = String(textValue || '');
  if (!text) return [];

  const refs = [];
  const versePattern = /\b(\d{1,3}:\d{1,3}(?:\s*-\s*(?:(?:\d{1,3}:)?\d{1,3}))?)\b/g;

  for (const match of text.matchAll(versePattern)) {
    const rawRef = String(match[1] || '')
      .replace(/\s+/g, '')
      .trim();

    if (!rawRef) continue;

    expandVerseRefs(rawRef).forEach((verseId) => {
      if (!refs.includes(verseId)) refs.push(verseId);
    });
  }

  return refs;
}

function getStoredAppendixFontLevel() {
  try {
    const stored = Number(localStorage.getItem(APPENDIX_FONT_STORAGE_KEY));
    if (!Number.isFinite(stored)) return 0;
    return Math.max(
      APPENDIX_FONT_MIN_LEVEL,
      Math.min(APPENDIX_FONT_MAX_LEVEL, Math.trunc(stored))
    );
  } catch (error) {
    console.warn('Ekler yazı boyutu okunamadı:', error);
    return 0;
  }
}

function getAppendixFontPercent(level = APPENDIX_READER_STATE.fontLevel) {
  const normalized = Number(level) || 0;
  return 100 + (normalized * 12);
}

function setAppendixFontLevel(level, options = {}) {
  const { persist = true } = options;
  const numericLevel = Number(level);
  const nextLevel = Math.max(
    APPENDIX_FONT_MIN_LEVEL,
    Math.min(
      APPENDIX_FONT_MAX_LEVEL,
      Number.isFinite(numericLevel) ? Math.trunc(numericLevel) : 0
    )
  );

  APPENDIX_READER_STATE.fontLevel = nextLevel;

  const page = DOM.content.querySelector('.appendix-reader-page');
  if (page) {
    page.dataset.fontLevel = String(nextLevel);
  }

  const status = document.getElementById('appendixReaderFontStatus');
  if (status) {
    status.textContent = `Yazı ${getAppendixFontPercent(nextLevel)}%`;
  }

  const decreaseButton = DOM.content.querySelector(
    '[data-action="appendices-font-decrease"]'
  );
  const increaseButton = DOM.content.querySelector(
    '[data-action="appendices-font-increase"]'
  );

  if (decreaseButton) {
    decreaseButton.disabled = nextLevel <= APPENDIX_FONT_MIN_LEVEL;
  }

  if (increaseButton) {
    increaseButton.disabled = nextLevel >= APPENDIX_FONT_MAX_LEVEL;
  }

  if (persist) {
    try {
      localStorage.setItem(APPENDIX_FONT_STORAGE_KEY, String(nextLevel));
    } catch (error) {
      console.warn('Ekler yazı boyutu kaydedilemedi:', error);
    }
  }

  return nextLevel;
}

function changeAppendixFontLevel(delta) {
  return setAppendixFontLevel(
    APPENDIX_READER_STATE.fontLevel + Number(delta || 0)
  );
}

function createAppendixReferenceHtml(refValues, appendixNumber) {
  const rawRefs = Array.isArray(refValues) ? refValues : [];
  if (rawRefs.length === 0) return '';

  const quranRefs = [];
  const staticRefs = [];

  rawRefs.forEach((rawRef) => {
    const label = String(rawRef || '').trim();
    if (!label) return;

    const expanded = expandVerseRefs(label);

    if (expanded.length > 0) {
      expanded.forEach((verseId) => {
        if (!quranRefs.includes(verseId)) quranRefs.push(verseId);
      });
      return;
    }

    staticRefs.push(label);
  });

  if (quranRefs.length === 0 && staticRefs.length === 0) return '';

  return `
    <div class="appendix-reader-refs" aria-label="Kaynak referansları">
      ${quranRefs.map((verseId) => {
        const [sura, verse] = verseId.split(':');
        return `
          <button
            type="button"
            class="appendix-reader-ref"
            data-action="appendices-toggle-verse-preview"
            data-sura="${escapeHtml(sura)}"
            data-verse="${escapeHtml(verse)}"
            data-appendix="${escapeHtml(String(appendixNumber))}"
            aria-expanded="false"
            title="${escapeHtml(`${verseId} ayetini önizle`)}"
          >
            ${escapeHtml(verseId)}
          </button>
        `;
      }).join('')}
      ${staticRefs.map((ref) => `
        <span class="appendix-reader-ref-static">${escapeHtml(ref)}</span>
      `).join('')}
    </div>
  `;
}

function createAppendixEvidenceHtml(block, appendixNumber) {
  const lines = Object.entries(block?.lines || {})
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([, line]) => String(line || '').trim())
    .filter(Boolean);

  const inlineRefs = extractAppendixVerseRefs(lines.join(' '));
  const combinedRefs = [
    ...(Array.isArray(block?.ref) ? block.ref : []),
    ...inlineRefs
  ];

  if (lines.length === 0 && combinedRefs.length === 0) return '';

  return `
    <div class="appendix-reader-evidence">
      ${lines.map((line) => `
        <div class="appendix-reader-evidence-line">${escapeHtml(line)}</div>
      `).join('')}
      ${createAppendixReferenceHtml(combinedRefs, appendixNumber)}
    </div>
  `;
}

function createAppendixTableHtml(tableData) {
  if (!tableData || typeof tableData !== 'object') return '';

  const headers = Array.isArray(tableData.title)
    ? tableData.title.map((value) => String(value ?? ''))
    : [];
  const values = Array.isArray(tableData.values)
    ? tableData.values.map((value) => String(value ?? ''))
    : [];
  const columnCount = Math.max(1, headers.length || 1);
  const rows = [];

  for (let index = 0; index < values.length; index += columnCount) {
    const row = values.slice(index, index + columnCount);
    while (row.length < columnCount) row.push('');
    rows.push(row);
  }

  const title = String(tableData.ref || '').trim();

  return `
    <div class="appendix-reader-table-card">
      ${title ? `<div class="appendix-reader-table-title">${escapeHtml(title)}</div>` : ''}
      <div class="appendix-reader-table-wrap">
        <table class="appendix-reader-table">
          ${headers.length > 0 ? `
            <thead>
              <tr>
                ${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}
              </tr>
            </thead>
          ` : ''}
          <tbody>
            ${rows.map((row) => `
              <tr>
                ${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function createAppendixPictureMediaHtml(fileName, altText) {
  const source = getAppendixImageSource(fileName);

  return `
    <div class="appendix-reader-picture-media">
      <img
        class="appendix-reader-picture-image"
        src="${escapeHtml(source)}"
        alt="${escapeHtml(altText || fileName)}"
        loading="lazy"
        decoding="async"
        data-picture-file="${escapeHtml(fileName)}"
      >
      <div class="appendix-reader-picture-missing" hidden>
        Görsel dosyası bulunamadı: <code>${escapeHtml(fileName)}</code>
      </div>
    </div>
  `;
}

function createAppendixPictureHtml(pictureData) {
  if (!pictureData || typeof pictureData !== 'object') return '';

  const number = String(pictureData.no ?? '').trim();
  const rawText = pictureData.text;
  const data = Array.isArray(pictureData.data)
    ? pictureData.data.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];

  if (!number && !rawText && data.length === 0) return '';

  const textMap = rawText && typeof rawText === 'object' && !Array.isArray(rawText)
    ? Object.entries(rawText)
      .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
      .filter(([key]) => key)
    : [];

  if (number && textMap.length > 0) {
    const mainFileName = `${number}.jpg`;

    return `
      <figure class="appendix-reader-picture-card appendix-reader-picture-card--group">
        ${createAppendixPictureMediaHtml(mainFileName, `Görsel ${number}`)}
        <figcaption class="appendix-reader-picture-caption">
          <strong>Görsel ${escapeHtml(number)}</strong> — birleşik görünüm
        </figcaption>

        <details class="appendix-reader-picture-details">
          <summary>Ayrıntılı parçaları göster (${textMap.length.toLocaleString('tr-TR')})</summary>
          <div class="appendix-reader-picture-gallery">
            ${textMap.map(([key, caption]) => {
              const fileName = `${key}.jpg`;
              return `
                <figure class="appendix-reader-picture-item">
                  ${createAppendixPictureMediaHtml(fileName, caption || key)}
                  <figcaption class="appendix-reader-picture-caption">
                    <strong>${escapeHtml(key)}</strong>${caption ? ` — ${escapeHtml(caption)}` : ''}
                  </figcaption>
                </figure>
              `;
            }).join('')}
          </div>
        </details>
      </figure>
    `;
  }

  const text = typeof rawText === 'string' ? rawText.trim() : '';
  const heading = number ? `Görsel ${number}` : 'Görsel kaydı';
  const fileName = number ? `${number}.jpg` : '';

  return `
    <figure class="appendix-reader-picture-card${fileName ? '' : ' is-image-missing'}">
      ${fileName ? createAppendixPictureMediaHtml(fileName, text || heading) : ''}
      <figcaption class="appendix-reader-picture-caption">
        <strong>${escapeHtml(heading)}</strong>${text ? ` — ${escapeHtml(text)}` : ''}
        ${data.length > 0 ? `
          <ul class="appendix-reader-picture-data">
            ${data.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        ` : ''}
      </figcaption>
    </figure>
  `;
}

function createAppendixBlocksHtml(appendix) {
  let previousPage = null;

  return appendix.blocks.map((block) => {
    const pageMarker = previousPage !== block.page
      ? `<div class="appendix-reader-page-marker">Kaynak sayfa ${escapeHtml(String(block.page))}</div>`
      : '';

    previousPage = block.page;
    let content = '';

    if (block.type === 'title') {
      const title = String(block.value || '').trim();
      if (title) {
        const titleRefs = extractAppendixVerseRefs(title);
        content = `
          <div class="appendix-reader-text-block appendix-reader-text-block--title">
            <h3 class="appendix-reader-subtitle">${escapeHtml(title)}</h3>
            ${createAppendixReferenceHtml(titleRefs, appendix.number)}
          </div>
        `;
      }
    } else if (block.type === 'text') {
      const text = String(block.value || '').trim();
      if (text) {
        const inlineRefs = extractAppendixVerseRefs(text);
        content = `
          <div class="appendix-reader-text-block">
            <p class="appendix-reader-paragraph">${escapeHtml(text)}</p>
            ${createAppendixReferenceHtml(inlineRefs, appendix.number)}
          </div>
        `;
      }
    } else if (block.type === 'evidence') {
      content = createAppendixEvidenceHtml(block.value, appendix.number);
    } else if (block.type === 'table') {
      content = createAppendixTableHtml(block.value);
    } else if (block.type === 'picture') {
      content = createAppendixPictureHtml(block.value);
    }

    return content ? `${pageMarker}${content}` : '';
  }).join('');
}

function buildAppendicesReaderHtml() {
  if (APPENDIX_READER_STATE.html) return APPENDIX_READER_STATE.html;

  const appendices = APPENDIX_READER_STATE.appendices;

  if (appendices.length === 0) {
    return `
      <div class="appendix-reader-page">
        <div class="page-header">
          <h1>📚 Ekler Oku</h1>
        </div>
        <div class="analysis-card appendix-reader-empty">
          Ekler verisi henüz yüklenemedi.
        </div>
      </div>
    `;
  }

  const options = appendices.map((appendix) => `
    <option value="${escapeHtml(String(appendix.number))}">
      ${escapeHtml(`Ek ${appendix.number}: ${appendix.title || 'Başlıksız Ek'}`)}
    </option>
  `).join('');

  const sections = appendices.map((appendix) => `
    <section
      id="appendix-reader-${escapeHtml(String(appendix.number))}"
      class="analysis-card appendix-reader-section"
      aria-labelledby="appendix-reader-title-${escapeHtml(String(appendix.number))}"
    >
      <h2
        id="appendix-reader-title-${escapeHtml(String(appendix.number))}"
        class="appendix-reader-title"
      >
        ${escapeHtml(`Ek ${appendix.number}: ${appendix.title || 'Başlıksız Ek'}`)}
      </h2>

      <div class="appendix-reader-body">
        ${createAppendixReferenceHtml(
          extractAppendixVerseRefs(appendix.title),
          appendix.number
        )}
        ${createAppendixBlocksHtml(appendix)}
      </div>
    </section>
  `).join('');

  APPENDIX_READER_STATE.html = `
    <div class="appendix-reader-page">
      <div class="page-header">
        <h1>📚 Ekler Oku</h1>
      </div>

      <div class="analysis-card appendix-reader-intro">
        Türkçe Ekler metni <code>appendices_tr.json</code> dosyasından gösterilir.
        Görseller, orijinal quran-tft dosya adları korunarak <code>assets/images/appendices/</code> klasöründen yüklenir.
        Ayet numaralarının üzerine gelerek önizleyebilir; tıklayarak ayet kartını açıp kapatabilirsiniz.
      </div>

      <div class="appendix-reader-toolbar">
        <label for="appendixReaderSelect">Eke git</label>

        <select
          id="appendixReaderSelect"
          class="appendix-reader-select"
        >
          ${options}
        </select>

        <div
          class="appendix-reader-font-controls"
          role="group"
          aria-label="Ekler yazı boyutu"
        >
          <button
            type="button"
            class="appendix-reader-font-btn"
            data-action="appendices-font-decrease"
            aria-label="Ekler yazısını küçült"
            title="Yazıyı küçült"
          >
            A−
          </button>

          <button
            type="button"
            id="appendixReaderFontStatus"
            class="appendix-reader-font-status"
            data-action="appendices-font-reset"
            title="Varsayılan yazı boyutuna dön"
          >
            Yazı 100%
          </button>

          <button
            type="button"
            class="appendix-reader-font-btn"
            data-action="appendices-font-increase"
            aria-label="Ekler yazısını büyüt"
            title="Yazıyı büyüt"
          >
            A+
          </button>
        </div>

        <button
          type="button"
          class="quran-reader-top-btn"
          data-action="appendices-top"
        >
          Başa Dön
        </button>
      </div>

      <div class="appendix-reader-list">
        ${sections}
      </div>
    </div>
  `;

  return APPENDIX_READER_STATE.html;
}

function updateAppendicesReaderHistory(mode = 'push', scrollTop = 0, appendixNumber = '') {
  if (mode === 'none' || NAVIGATION_STATE.applyingHistory) return;

  const method = mode === 'replace' ? 'replaceState' : 'pushState';
  const cleanUrl = `${window.location.pathname}${window.location.search}#appendices`;

  history[method](
    {
      route: { view: 'appendices' },
      pageScrollTop: Number(scrollTop) || 0,
      appendixNumber: String(appendixNumber || '')
    },
    '',
    cleanUrl
  );

  NAVIGATION_STATE.lastRoute = { view: 'appendices' };
}

function saveAppendicesReaderPosition(appendixNumber = '') {
  if (history.state?.route?.view !== 'appendices') return;

  history.replaceState(
    {
      ...history.state,
      route: { view: 'appendices' },
      pageScrollTop: window.scrollY,
      appendixNumber: String(appendixNumber || history.state?.appendixNumber || '')
    },
    '',
    `${window.location.pathname}${window.location.search}#appendices`
  );
}

function setupAppendicesReaderControls() {
  const select = document.getElementById('appendixReaderSelect');

  setupAppendixVersePreviewHover();
  setAppendixFontLevel(getStoredAppendixFontLevel(), { persist: false });

  select?.addEventListener('change', () => {
    const appendixNumber = String(select.value || '');
    const target = document.getElementById(`appendix-reader-${appendixNumber}`);

    if (!target) return;

    saveAppendicesReaderPosition(appendixNumber);

    target.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'
    });
  });
}

function createAppendixVersePreviewHtml(suraNum, verseNum) {
  const sura = String(suraNum || '');
  const verse = String(verseNum || '');
  const verseId = `${sura}:${verse}`;

  if (!verseExists(sura, verse)) {
    return `
      <div class="appendix-reader-verse-preview-error">
        ${escapeHtml(`${verseId} ayeti bulunamadı.`)}
      </div>
    `;
  }

  const verseData = findVerseData(sura, verse);

  return `
    <div class="appendix-reader-verse-preview-heading">
      <strong>${escapeHtml(verseId)}</strong>
      <span>Ayet önizleme</span>
    </div>

    <div class="appendix-reader-verse-preview-tr">
      <strong>Türkçe</strong>
      <div>${escapeHtml(verseData.turkish || '')}</div>
    </div>

    <div class="appendix-reader-verse-preview-en">
      <strong>Rashad Khalifa — English</strong>
      <div>${escapeHtml(verseData.english || '')}</div>
    </div>
  `;
}

function closeAppendixVersePreviews(options = {}) {
  const { exceptButton = null, temporaryOnly = false } = options;

  document
    .querySelectorAll('.appendix-reader-verse-preview')
    .forEach((preview) => {
      const owner = preview._appendixOwnerButton || null;

      if (owner === exceptButton) return;
      if (temporaryOnly && preview.dataset.pinned === 'true') return;

      preview.remove();

      if (owner) {
        owner.setAttribute('aria-expanded', 'false');
        owner.classList.remove('is-preview-open', 'is-preview-pinned');
      }
    });
}

function toggleAppendixVersePreview(button, options = {}) {
  if (!(button instanceof HTMLElement)) return false;

  const { pinned = false, forceOpen = false } = options;
  const sura = String(button.dataset.sura || '');
  const verse = String(button.dataset.verse || '');
  const refs = button.closest('.appendix-reader-refs');

  if (!sura || !verse || !refs) return false;

  const existing = refs.querySelector('.appendix-reader-verse-preview');
  const sameOwner = existing?._appendixOwnerButton === button;
  const existingPinned = existing?.dataset.pinned === 'true';

  if (sameOwner && pinned && existingPinned && !forceOpen) {
    existing.remove();
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('is-preview-open', 'is-preview-pinned');
    return true;
  }

  closeAppendixVersePreviews({ exceptButton: button });

  let preview = sameOwner ? existing : null;

  if (!preview) {
    existing?.remove();

    preview = document.createElement('div');
    preview.className = 'appendix-reader-verse-preview';
    preview.setAttribute('role', 'region');
    preview.setAttribute('aria-live', 'polite');
    preview.innerHTML = createAppendixVersePreviewHtml(sura, verse);
    preview._appendixOwnerButton = button;
    refs.appendChild(preview);
  }

  const shouldPin = pinned || existingPinned;
  preview.dataset.pinned = shouldPin ? 'true' : 'false';
  button.setAttribute('aria-expanded', 'true');
  button.classList.add('is-preview-open');
  button.classList.toggle('is-preview-pinned', shouldPin);

  return true;
}

function setupAppendixVersePreviewHover() {
  if (APPENDIX_READER_STATE.previewHoverReady) return;

  const supportsHover = window.matchMedia(
    '(hover: hover) and (pointer: fine)'
  ).matches;

  if (!supportsHover) return;
  APPENDIX_READER_STATE.previewHoverReady = true;

  DOM.content.addEventListener('pointerover', (event) => {
    if (STATE.currentView !== 'appendices') return;

    const button = event.target.closest(
      '.appendix-reader-ref[data-action="appendices-toggle-verse-preview"]'
    );

    if (!button || !DOM.content.contains(button)) return;

    if (
      event.relatedTarget &&
      button.contains(event.relatedTarget)
    ) {
      return;
    }

    const currentPreview = button
      .closest('.appendix-reader-refs')
      ?.querySelector('.appendix-reader-verse-preview');

    if (
      currentPreview?._appendixOwnerButton === button &&
      currentPreview.dataset.pinned === 'true'
    ) {
      return;
    }

    const pinnedPreview = DOM.content.querySelector(
      '.appendix-reader-verse-preview[data-pinned="true"]'
    );

    if (
      pinnedPreview &&
      pinnedPreview._appendixOwnerButton !== button
    ) {
      return;
    }

    toggleAppendixVersePreview(button, {
      pinned: false,
      forceOpen: true
    });
  });

  DOM.content.addEventListener('pointerout', (event) => {
    if (STATE.currentView !== 'appendices') return;

    const button = event.target.closest(
      '.appendix-reader-ref[data-action="appendices-toggle-verse-preview"]'
    );

    if (!button || !DOM.content.contains(button)) return;

    const refs = button.closest('.appendix-reader-refs');
    const preview = refs?.querySelector('.appendix-reader-verse-preview');

    if (
      preview?._appendixOwnerButton !== button ||
      preview.dataset.pinned === 'true'
    ) {
      return;
    }

    requestAnimationFrame(() => {
      const latestPreview = refs?.querySelector('.appendix-reader-verse-preview');

      if (
        latestPreview?._appendixOwnerButton === button &&
        latestPreview.dataset.pinned !== 'true' &&
        !button.matches(':hover')
      ) {
        latestPreview.remove();
        button.setAttribute('aria-expanded', 'false');
        button.classList.remove('is-preview-open', 'is-preview-pinned');
      }
    });
  });
}

async function displayAppendicesReaderPage(options = {}) {
  const {
    historyMode = 'none',
    scrollTop = 0,
    focusAppendix = ''
  } = options;

  ensureQuranView();
  closeAnalysisPanel({ updateHistory: false, restoreFocus: false });
  closeSearchResultsPanel({ restoreFocus: false });
  clearAnalysisReturnState();

  STATE.currentView = 'appendices';
  setQuranReaderNavigationMode(true);

  DOM.content.innerHTML = `
    <div class="appendix-reader-page">
      <div class="page-header">
        <h1>📚 Ekler Oku</h1>
      </div>
      <div class="analysis-card appendix-reader-empty">
        Ekler yükleniyor...
      </div>
    </div>
  `;

  try {
    await ensureAppendicesReaderLoaded();
  } catch (error) {
    console.error('Ekler yüklenemedi:', error);
    DOM.content.innerHTML = `
      <div class="appendix-reader-page">
        <div class="page-header">
          <h1>📚 Ekler Oku</h1>
        </div>
        <div class="analysis-card appendix-reader-empty error-message">
          ${escapeHtml(error.message || 'Ekler verisi yüklenemedi.')}
        </div>
      </div>
    `;
    return false;
  }

  try {
    DOM.content.innerHTML = buildAppendicesReaderHtml();
    applySettings();
    setupAppendicesReaderControls();
  } catch (error) {
    console.error('Ekler görünümü oluşturulamadı:', error);
    DOM.content.innerHTML = `
      <div class="appendix-reader-page">
        <div class="page-header">
          <h1>📚 Ekler Oku</h1>
        </div>
        <div class="analysis-card appendix-reader-empty error-message">
          Ekler görünümü oluşturulamadı: ${escapeHtml(error.message || 'Bilinmeyen görüntüleme hatası.')}
        </div>
      </div>
    `;
    return false;
  }

  const appendixNumber = String(
    focusAppendix || history.state?.appendixNumber || ''
  );

  updateAppendicesReaderHistory(historyMode, scrollTop, appendixNumber);

  requestAnimationFrame(() => {
    const restoredScroll = Number(scrollTop);

    if (Number.isFinite(restoredScroll) && restoredScroll > 0) {
      window.scrollTo({ top: restoredScroll, behavior: 'auto' });
      return;
    }

    if (appendixNumber) {
      const target = document.getElementById(`appendix-reader-${appendixNumber}`);
      const select = document.getElementById('appendixReaderSelect');
      if (select) select.value = appendixNumber;
      target?.scrollIntoView({ block: 'start', behavior: 'auto' });
      return;
    }

    window.scrollTo({ top: 0, behavior: 'auto' });
  });

  return true;
}

/* =========================
   Sayfalar
========================= */
function displaySettingsPage() {
  ensureQuranView();

  const themes = [
    { name: 'light', label: 'Açık' },
    { name: 'dark', label: 'Koyu' },
    { name: 'green', label: 'Yeşil' },
    { name: 'indigo', label: 'Çivit' },
    { name: 'brown', label: 'Kahverengi' },
    { name: 'sky', label: 'Açık Mavi' },
    { name: 'blackyellow', label: 'Siyah' },
    { name: 'bluemaize', label: 'Mavi' },
    { name: 'redpeach', label: 'Kırmızı' },
    { name: 'greenolive', label: 'Zeytin' }
  ];

  const html = `
    <div class="page-header">
      <h1>⚙️ Ayarlar</h1>
    </div>
    <div class="sura">
      <div class="settings-section">
        <h2>Tema Ayarları</h2>
        <div class="theme-picker">
          ${themes
            .map(
              (theme) => `
            <label class="theme-option">
              <input type="radio" name="theme" value="${theme.name}" ${
                STATE.settings.theme === theme.name ? 'checked' : ''
              }>
              <div class="theme-preview ${theme.name}-theme">
                ${escapeHtml(theme.label)}
                ${STATE.settings.theme === theme.name ? '✓' : ''}
              </div>
            </label>
          `
            )
            .join('')}
        </div>

        <div class="setting-item">
          <label for="fontSizeSelect">Yazı Boyutu:</label>
          <select id="fontSizeSelect">
            <option value="small" ${
              STATE.settings.fontSize === 'small' ? 'selected' : ''
            }>Küçük</option>
            <option value="medium" ${
              STATE.settings.fontSize === 'medium' ? 'selected' : ''
            }>Orta</option>
            <option value="large" ${
              STATE.settings.fontSize === 'large' ? 'selected' : ''
            }>Büyük</option>
          </select>
        </div>

        <div class="setting-item">
          <label>
            <input type="checkbox" id="showMeals" ${
              STATE.settings.showMeals ? 'checked' : ''
            }>
            Mealler'i Göster
          </label>
        </div>

        <label>
          <input type="checkbox" id="showTransliteration" ${
            STATE.settings.showTransliteration ? 'checked' : ''
          }>
          Arapça-Türkçe Göster
        </label>

        <label>
          <input type="checkbox" id="showAiTranslation" ${
            STATE.settings.showAiTranslation ? 'checked' : ''
          }>
          AI Çeviriyi Göster
        </label>
      </div>

        <div class="settings-section">
          <h2>Yerel Not Sistemi</h2>

          <div class="local-storage-status">
            <p>
              <strong>Durum:</strong>
              🟢 Yerel kayıt aktif
            </p>

            <p>
              Notlarınız bu tarayıcıda ve bu cihazda saklanır.
            </p>

            <p>
              Tarayıcı verilerini silmeden önce notlarınızı
              JSON dosyası olarak yedeklemeniz önerilir.
            </p>
          </div>
        </div>

      <div class="settings-section">
        <h2>Yazılım Hakkında</h2>

        <div class="about-section">
          <p>
            <strong>Kuran Teyit</strong>, Android için geliştirilmiş bağımsız
            bir Kuran araştırma uygulamasıdır.
          </p>

          <p class="independence-notice">
            Kuran Teyit bağımsız bir araştırma uygulamasıdır. QuranTFT,
            SubmitterTech, International Community of Submitters,
            Masjid Tucson veya uygulamada adı geçen diğer kaynak
            sağlayıcılarının resmî uygulaması değildir ve bu kuruluşlar
            tarafından yayımlanmamaktadır.
          </p>

          <ul>
            <li><strong>Geliştirme ve tasarım:</strong>
  Berk KÖKSAL —
  <a
    href="https://www.berkkoksal.com/"
    target="_blank"
    rel="noopener noreferrer"
  >
    www.berkkoksal.com
  </a>
</li>
            <li><strong>Destek:</strong> berkgitarist@gmail.com</li>
            <li><strong>Yerel notlar:</strong> Notlar cihazda saklanır.</li>
            <li><strong>Arapça ses:</strong> İnternet üzerinden Islamic Network CDN'den oynatılır.</li>
          </ul>
        </div>

        <div class="legal-action-row">
          <button
            type="button"
            class="toggle-btn"
            data-action="show-privacy"
          >
            Gizlilik Politikası
          </button>

          <button
            type="button"
            class="toggle-btn"
            data-action="show-licenses"
          >
            Lisanslar ve Kaynaklar
          </button>
        </div>
      </div>

      <button class="toggle-btn" id="saveSettingsBtn">💾 Ayarları Kaydet</button>
      <button type="button" class="toggle-btn" data-action="return-quran">🔙 Kuran'a Dön</button>
    </div>
  `;

  DOM.content.innerHTML = html;

  document.querySelectorAll('.theme-option input').forEach((input) => {
    input.addEventListener('change', (e) => {
      STATE.settings.theme = e.target.value;
      applySettings();
    });
  });

  document.getElementById('fontSizeSelect')?.addEventListener('change', (e) => {
    STATE.settings.fontSize = e.target.value;
    applySettings();
  });

  document.getElementById('showMeals')?.addEventListener('change', (e) => {
    STATE.settings.showMeals = e.target.checked;
    saveSettings({ refreshPage: false });
  });

  document.getElementById('showTransliteration')?.addEventListener('change', (e) => {
    STATE.settings.showTransliteration = e.target.checked;
    saveSettings({ refreshPage: false });
  });

  document.getElementById('showAiTranslation')?.addEventListener('change', (e) => {
    STATE.settings.showAiTranslation = e.target.checked;
    saveSettings({ refreshPage: false });
  });

  document.getElementById('saveSettingsBtn')?.addEventListener('click', async () => {
    const saved = await saveSettings({ refreshPage: false });
    if (saved) showNotification('Ayarlar kaydedildi.', 'success');
  });
}

function displayNotesPage() {
  ensureQuranView();

  DOM.content.innerHTML = `
    <div class="page-header">
      <h1>📝 Notlarım</h1>
    </div>

    <div class="sura">
      <div class="notes-section notes-section--modern">
        <div class="notes-page-intro">
          <div>
            <strong>Ayetlerinize bağlı kişisel araştırma notları</strong>
            <p>
              Notlarınız yalnızca bu tarayıcıda / cihazda saklanır. Yeni düzenleyici;
              başlık, kalın, italik, liste, alıntı, hizalama ve bağlantı gibi temel
              HTML biçimlendirmelerini destekler.
            </p>
          </div>
        </div>

        <div class="notes-page-toolbar">
          <button
            type="button"
            class="toggle-btn"
            data-action="export-notes"
          >💾 JSON Yedekle</button>

          <button
            type="button"
            class="toggle-btn"
            data-action="import-notes"
          >📂 JSON Yükle</button>

          <button
            id="toggleNotesVisibilityBtn"
            class="toggle-btn"
            type="button"
            data-action="toggle-notes"
            aria-expanded="true"
            aria-controls="notesList"
          >🙈 Notları Gizle</button>
        </div>

        <div id="notesList" class="notes-list">
          Notlar yükleniyor...
        </div>

        <div class="notes-page-bottom-actions">
          <button
            type="button"
            class="toggle-btn"
            data-action="return-quran"
          >🔙 Kuran'a Dön</button>
        </div>
      </div>
    </div>
  `;

  loadAndDisplayAllNotes();
}

function toggleNotesVisibility() {
  const notesList =
    document.getElementById('notesList');

  const button =
    document.getElementById(
      'toggleNotesVisibilityBtn'
    );

  if (!notesList || !button) return;

  const willHide =
    !notesList.classList.contains('hidden');

  notesList.classList.toggle(
    'hidden',
    willHide
  );

  button.textContent = willHide
    ? '👁️ Notları Göster'
    : '🙈 Notları Gizle';

  button.setAttribute(
    'aria-expanded',
    String(!willHide)
  );
}

const INDEPENDENCE_NOTICE = `
  <p class="independence-notice">
    <strong>Bağımsızlık bildirimi:</strong>
    Kuran Teyit bağımsız bir araştırma uygulamasıdır. QuranTFT,
    SubmitterTech, International Community of Submitters, Masjid Tucson
    veya uygulamada adı geçen diğer kaynak sağlayıcılarının resmî
    uygulaması değildir ve bu kuruluşlar tarafından yayımlanmamaktadır.
  </p>
`;

const PRIVACY_CONTENT = `
  <h1>Gizlilik Politikası</h1>

  <p><strong>Son güncelleme:</strong> 20 Temmuz 2026</p>

  ${INDEPENDENCE_NOTICE}

  <h2>1. Uygulama ve geliştirici</h2>
  <p>
    Bu politika, <strong>Kuran Teyit</strong> Android ve PWA uygulaması için
    geçerlidir. Geliştirici ve gizlilik iletişimi:
    <strong>Berk KÖKSAL</strong> —
    <a
      href="https://www.berkkoksal.com/"
      target="_blank"
      rel="noopener noreferrer"
    >
      www.berkkoksal.com
    </a>
    — berkgitarist@gmail.com.
  </p>

  <h2>2. Hesap, reklam ve analiz</h2>
  <p>
    Uygulama kullanıcı hesabı oluşturmaz. Mevcut sürümde reklam,
    reklam kimliği kullanan reklam SDK'sı veya geliştiriciye ait kullanıcı
    davranışı analiz sistemi bulunmaz.
  </p>

  <h2>3. Yerel olarak saklanan bilgiler</h2>
  <ul>
    <li>Tema, yazı boyutu ve görünüm tercihleri cihazda yerel olarak saklanır.</li>
    <li>Kullanıcının yazdığı ayet notları cihazın uygulama depolama alanında saklanır.</li>
    <li>Notlar en fazla 10.000 karakter olarak doğrulanır ve ayet numarasıyla ilişkilendirilir.</li>
    <li>Bu veriler geliştiriciye ait bir sunucuya gönderilmez.</li>
    <li>Notların JSON olarak dışa aktarılması veya içe alınması yalnızca kullanıcının başlattığı işlemle gerçekleşir.</li>
  </ul>

  <h2>4. Çevrimdışı önbellek</h2>
  <p>
    Web/PWA sürümünde Service Worker, uygulamanın daha hızlı ve çevrimdışı
    açılabilmesi için uygulama dosyalarını ve kullanıcı tarafından erişilen
    yerel JSON veri dosyalarını cihaz önbelleğinde saklayabilir. Bu önbellek
    geliştirici sunucusuna kullanıcı notu veya tercih göndermez.
  </p>

  <h2>5. Paket içindeki metin ve kaynak verileri</h2>
  <p>
    Kuran metinleri, çeviri dosyaları, konu haritaları, ekler, sözlük,
    deneysel AI çevirisi ve kelime verileri uygulama paketinde yerel dosyalar
    olarak bulunur. Kullanıcının bu içerikleri okuması sırasında kaynak
    sağlayıcıların sitelerine otomatik bir istek gönderilmez.
  </p>

  <h2>6. AI çeviri alanı</h2>
  <p>
    AI Çeviri alanı canlı sohbet veya kullanıcı istemiyle çalışan üretken AI
    hizmeti değildir. Uygulama paketinde önceden hazırlanmış statik deneysel
    metni gösterir. Kullanıcının ayet araması, notu veya başka bir girdisi AI
    hizmetine gönderilmez.
  </p>

  <h2>7. Ses hizmetleri ve ağ bağlantısı</h2>
  <p>
    İngilizce sesli okuma, cihazın metinden sese altyapısı üzerinden çalışır.
    Arapça kıraat düğmesine basıldığında ses dosyası doğrudan
    <strong>cdn.islamic.network</strong> adresinden HTTPS bağlantısıyla yüklenir.
    Ses isteği yalnızca kullanıcı oynat düğmesine dokunduğunda başlar.
  </p>

  <p>
    Bir internet isteğinin iletilebilmesi için IP adresi, tarayıcı/cihaz
    bilgisi, istek zamanı ve istenen dosya gibi teknik bağlantı bilgileri
    üçüncü taraf hizmet sağlayıcı tarafından işlenebilir. Bu hizmetin sunucu
    kayıtları geliştiricinin kontrolünde değildir ve geliştiriciye aktarılmaz.
  </p>


  <h2>8. Üçüncü taraf kaynak bağlantıları</h2>
  <p>
    Uygulamadaki GitHub, QuranTFT, Açık Kuran ve diğer kaynak bağlantıları
    yalnızca kullanıcı bağlantıya dokunduğunda açılır. Açılan sitelerin kendi
    gizlilik politikaları ve kullanım koşulları geçerlidir.
  </p>

  <h2>9. Saklama ve silme</h2>
  <p>
    Yerel notlar ve ayarlar kullanıcı silene, uygulama verileri temizlenene
    veya uygulama kaldırılana kadar cihazda kalabilir. Kullanıcı notları
    uygulama içinden tek tek silebilir. Android ayarlarından uygulama
    verilerinin temizlenmesi tüm yerel kayıtları kaldırır. Web/PWA önbelleği
    tarayıcı veya uygulama depolama ayarlarından temizlenebilir.
  </p>

  <h2>10. Çocukların gizliliği</h2>
  <p>
    Uygulama özellikle çocuklara yönelik olarak tasarlanmamıştır ve bilerek
    çocuklardan kişisel bilgi toplamayı amaçlamaz.
  </p>

  <h2>11. Güvenlik</h2>
  <p>
    Harici ses bağlantısı HTTPS üzerinden kurulur. Not içe aktarma dosyaları
    biçim, ayet ve içerik uzunluğu bakımından doğrulanır. Kullanıcıların JSON
    not yedeklerini güvenli bir yerde saklaması ve herkese açık alanlarda
    paylaşmaması önerilir.
  </p>

  <h2>12. Google Play Veri Güvenliği beyanı</h2>
  <p>
    Google Play mağaza sayfasındaki Veri Güvenliği beyanı, uygulamanın gerçek
    veri işleme davranışıyla ve bu Gizlilik Politikasıyla aynı bilgileri
    açıklamalıdır. Uygulamaya ileride reklam, analiz, hesap veya yeni bir ağ
    hizmeti eklenirse hem bu politika hem de Play Console beyanı güncellenir.
  </p>

  <h2>13. Politika değişiklikleri</h2>
  <p>
    Uygulamanın veri işleme biçimi değişirse bu politika güncellenir ve son
    güncelleme tarihi değiştirilir.
  </p>

  <h2>14. İletişim</h2>
  <p>
    <strong>Geliştirme, tasarım ve kodlama:</strong><br>
    Berk KÖKSAL —
    <a
      href="https://www.berkkoksal.com/"
      target="_blank"
      rel="noopener noreferrer"
    >
      www.berkkoksal.com
    </a>
    <br>
    Destek: berkgitarist@gmail.com
  </p>
`;

const LICENSES_CONTENT = `
  <h1>Lisanslar, Kaynaklar ve Veri Kökeni</h1>

  <p><strong>Son güncelleme:</strong> 20 Temmuz 2026</p>

  ${INDEPENDENCE_NOTICE}

  <p class="independence-notice">
    <strong>Önemli hak notu:</strong>
    Bu sayfa kullanılan içeriklerin kaynak kökenini ve atıflarını belgeler.
    Bir kaynağın herkese açık bir GitHub deposunda bulunması veya burada
    bağlantısının verilmesi, tek başına yeniden dağıtım lisansı ya da yazılı
    kullanım izni anlamına gelmez. Çeviri, dipnot, sözlük, ses ve veri
    düzenlemelerinin hakları ilgili çevirmen, yazar, yayıncı, okuyucu ve veri
    sağlayıcılarına ait olabilir.
  </p>

  <h2>1. QuranTFT / SubmitterTech</h2>
  <p>
    Uygulamadaki ana İngilizce ve Türkçe çeviri verileri, Arapça
    karşılaştırma verilerinin bir bölümü, konu haritaları ve ek içeriklerde
    QuranTFT / SubmitterTech proje yapısından yararlanılmıştır.
  </p>
  <ul>
    <li>
      <a href="https://github.com/SubmitterTech/quran-tft/tree/main/app/src/assets/translations/tr" target="_blank" rel="noopener noreferrer">
        Türkçe çeviri veri klasörü
      </a>
    </li>
    <li>
      <a href="https://github.com/SubmitterTech/quran-tft/tree/main/app/src" target="_blank" rel="noopener noreferrer">
        QuranTFT uygulama kaynak klasörü
      </a>
    </li>
    <li>
      <a href="https://qurantft.com/" target="_blank" rel="noopener noreferrer">
        qurantft.com
      </a>
    </li>
  </ul>
  <p><strong>Uygulamadaki ilgili dosya grupları:</strong></p>
  <ul>
    <li><code>data/qurantft.json</code></li>
    <li><code>data/quran_tr.json</code></li>
    <li><code>data/mealler/quran_arapca2.json</code></li>
    <li><code>data/map.json</code> ve <code>data/map_tr.json</code></li>
    <li><code>data/appendices.json</code> ve <code>data/appendices_tr.json</code></li>
  </ul>

  <h2>2. Authorized English Translation</h2>
  <p>
    İngilizce ana referans ve ilişkili dipnotlarda Rashad Khalifa'nın
    <strong>Authorized English Translation</strong> çalışması temel
    referanslardan biridir. Eser adı, yazar/çevirmen bilgisi ve kaynak
    bağlantıları atıf amacıyla belirtilmektedir; eserin yayın ve yeniden
    dağıtım koşulları ayrıca doğrulanmalıdır.
  </p>

  <h2>3. Açık Kuran</h2>
  <p>
    Erhan Aktaş Türkçe/Arapça çeviri verileri ile kelime çevirisi ve kök
    verilerinde Açık Kuran çalışmalarından yararlanılmıştır.
  </p>
  <ul>
    <li>
      <a href="https://github.com/acik-kuran" target="_blank" rel="noopener noreferrer">
        Açık Kuran GitHub organizasyonu
      </a>
    </li>
    <li>
      <a href="https://acikkuran.com/" target="_blank" rel="noopener noreferrer">
        acikkuran.com
      </a>
    </li>
  </ul>
  <p><strong>Uygulamadaki ilgili dosya grupları:</strong></p>
  <ul>
    <li><code>data/mealler/kuran_erhan_aktas.json</code></li>
    <li><code>data/word-translations.json</code></li>
  </ul>

  <h2>4. Kuran Rehberi çeviri koleksiyonu</h2>
  <p>
    Uygulamada karşılaştırma amacıyla gösterilen çeşitli meal dosyaları
    aşağıdaki çeviri veri koleksiyonundan alınmış veya bu koleksiyon
    üzerinden düzenlenmiştir:
  </p>
  <p>
    <a href="https://github.com/eyupipler/Kuran-Rehberi/tree/main/data/translations" target="_blank" rel="noopener noreferrer">
      eyupipler/Kuran-Rehberi — data/translations
    </a>
  </p>
  <p>
    Kaynak deponun proje kodu için belirttiği lisans ile deponun içerdiği
    üçüncü taraf çeviri metinlerinin hakları aynı olmayabilir. Her mealin
    çevirmen/yayıncı hakkı ve yeniden dağıtım izni ayrı değerlendirilmelidir.
  </p>
  <p><strong>Uygulamadaki ilgili dosya grubu:</strong></p>
  <ul>
    <li><code>data/mealler/*.json</code> içindeki karşılaştırmalı meal dosyaları</li>
  </ul>

  <h2>5. Yapay zekâ destekli çeviri alanı</h2>
  <p>
    <code>data/yapayzekaceviri.json</code> içeriği önceden hazırlanmış, statik
    ve deneysel bir yapay zekâ destekli çalışma alanıdır. Canlı bir chatbot
    veya kullanıcı istemiyle çalışan üretken AI hizmeti değildir. Resmî meal,
    dinî hüküm veya fetva olarak sunulmaz. Kullanıcıların ana metni ve güvenilir
    çeviri kaynaklarını ayrıca karşılaştırması önerilir.
  </p>

  <h2>6. Mealler ve çevirmen hakları</h2>
  <p>
    Uygulamada görüntülenen meal metinlerinin hakları ilgili çevirmenlere,
    mirasçılarına ve/veya yayıncılara ait olabilir. Uygulama paketine bir
    meal eklenmeden önce yeniden dağıtım lisansı, açık lisans koşulları veya
    yazılı kullanım izni proje kayıtlarında doğrulanmalıdır. Kaynak
    gösterimi, gerekli iznin yerine geçmez.
  </p>

  <h2>7. Arapça kıraat</h2>
  <ul>
    <li><strong>Okuyucu:</strong> Mishary Rashid Alafasy</li>
    <li><strong>Hizmet:</strong> Al Quran Cloud / Islamic Network CDN</li>
    <li><strong>İstek adresi:</strong> <code>https://cdn.islamic.network/</code></li>
    <li>Ses kayıtlarının hakları ilgili okuyucu, yayıncı ve hak sahiplerine aittir.</li>
  </ul>

  <h2>8. Sürüm kayıtlarında tutulması önerilen bilgiler</h2>
  <ul>
    <li>Kaynak depo ve tam dosya yolu</li>
    <li>İndirilen commit kimliği veya sürüm etiketi</li>
    <li>İndirme tarihi</li>
    <li>Kaynak LICENSE, NOTICE ve README dosyalarının kopyası</li>
    <li>Uygulamada yapılan değişikliklerin kısa açıklaması</li>
    <li>Gerekliyse çevirmen veya yayıncıdan alınan yazılı izin</li>
  </ul>

  <h2>9. Bağımsızlık ve marka kullanımı</h2>
  <p>
    Kuran Teyit; QuranTFT, SubmitterTech, Açık Kuran, Kuran Rehberi,
    International Community of Submitters, Masjid Tucson veya adı geçen
    başka bir kaynak sağlayıcısının resmî uygulaması değildir. Kaynak ve
    eser adları yalnızca açıklama ve atıf amacıyla kullanılmaktadır.
  </p>

  <h2>10. Yazı tipleri ve uygulama kodu</h2>
  <p>
    Uygulama uzak Google Fonts bağlantısı kullanmaz. Arayüz ve Arapça
    metinler cihazda bulunan sistem yazı tipleriyle gösterilir.
  </p>
  <p>
    Kuran Teyit uygulamasının özgün arayüz, yerel not sistemi, arama,
    analiz ve uygulama kodu geliştirmeleri: <strong>Berk KÖKSAL</strong>.
  </p>

  <h2>11. Hak ve lisans iletişimi</h2>
  <p>
    Bir hak, kaynak düzeltmesi veya lisans bildirimi için:
    <strong>berkgitarist@gmail.com</strong> —

  <a
    href="https://www.berkkoksal.com/"
    target="_blank"
    rel="noopener noreferrer"
  >
    www.berkkoksal.com
  </a>
</p>
`;

function displayGuidePage() {
  try {
    sessionStorage.setItem(
      'kuranTeyitGuideReturnUrl',
      window.location.href
    );
  } catch (error) {
    console.warn('Kılavuz dönüş adresi saklanamadı:', error);
  }

  window.location.assign('./guide.html');
}

function displayLegalContent(title, content) {
  ensureQuranView();

  DOM.content.innerHTML = `
    <div class="page-header legal-page-header">
      <img
        src="assets/images/logo-main.png"
        alt="Kuran Teyit logosu"
        class="guide-page-logo"
        width="1024"
        height="1024"
      >

      <h1>${escapeHtml(title)}</h1>
    </div>

    <div class="sura">
      <div class="settings-section legal-page-content">
        <div class="about-section">
          ${content}
        </div>

        <button
          type="button"
          class="toggle-btn"
          data-action="return-quran"
        >
          ← Kuran'a Dön
        </button>
      </div>
    </div>
  `;

  window.scrollTo({
    top: 0,
    behavior: 'auto'
  });
}

function displayPrivacyPage() {
  displayLegalContent(
    'Gizlilik Politikası',
    PRIVACY_CONTENT
  );
}

function displayLicensesPage() {
  displayLegalContent(
    'Lisanslar ve Kaynaklar',
    LICENSES_CONTENT
  );
}

/**
 * ライブ視聴ページ(live.nicovideo.jp/watch/*)で動作するcontent script。
 * 毎日無料の「デイリー福引」(全ページ)と、開催中イベントの福引(イベント時のみ)について、
 * 福引ウィジェットとバナーを配信ページ内に挿入する。福引ごとに1行(ウィジェット左+バナー右)。
 */

const LOG = '[ニコ生ギフト]';
const log = (...a) => console.log(LOG, ...a);
const warn = (...a) => console.warn(LOG, ...a);

// イベント欄(CSSモジュールのハッシュ付きクラスに部分一致)
const EVENT_SECTION_XPATH =
    "//section[contains(@class, 'planning-event-participation-program-list-section')]";
const NICONEWS_PREFIX = 'https://blog.nicovideo.jp/niconews/';
const BANNER_WIDTH = '720';
const BANNER_HEIGHT = '135';

// 毎日無料のデイリー福引を含むキャンペーン一覧API(JSON)。福引一覧ページ(SPA)のデータソース。
// 生HTMLには項目が無い(JS描画)ため、ページではなくこのAPIから取得する。
const CONDUCTORS_API_URL =
    'https://api.koken.nicovideo.jp/v1/conductors?conductorFrameId=7&limit=100';
// デイリー福引バナーの画像ファイル名パターン。
// 例: conductors_free_202605_eiki_20260525.png (free_<年月>_<テーマ>_<日付8桁>)。
// 末尾の日付はバナーが日替わりである印で、イベント系バナーには無いため識別に使える。
const DAILY_BANNER_RE = /free_\d{6}_.+_\d{8}\.png/;
// 福引コンテナを入れる全幅のホスト要素(末尾に追加)。イベント有無に関係なく存在し、
// ウィジェット+バナーの横並び(約1236px)が収まる幅がある。上から順に最初に見つかったものを使う。
const CONTAINER_HOST_SELECTORS = ['inner-content-area', 'ga-ns-watch-page'];

const params = new URLSearchParams(location.search);

// ページを開いた直後は裏で重い処理が走るため、処理開始を遅らせる。
// loadイベント後、最低この時間待ってから、さらにブラウザがアイドルになるのを待って実行する。
// 重さに応じてこの値(ミリ秒)を調整する。
const START_DELAY_MS = 5000;

scheduleMain();

// load完了 → START_DELAY_MS待機 → アイドル時にmain()を実行
function scheduleMain() {
    const begin = () => setTimeout(() => runWhenIdle(main), START_DELAY_MS);
    if (document.readyState === 'complete') begin();
    else window.addEventListener('load', begin, { once: true });
}

// ブラウザがアイドルになったら実行(非対応環境では即実行)。timeoutで最終的には必ず実行
function runWhenIdle(fn) {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => fn(), { timeout: 5000 });
    } else {
        fn();
    }
}

async function main() {
    // 別窓くん(別窓)で開かれた場合は何もしない
    if (params.get('popup') === 'on') return;

    try {
        const host = await waitForHost();
        if (!host) return warn('福引の挿入位置が見つかりませんでした');

        const container = ensureContainer(host);

        // デイリー福引(全ページ・毎日)→ イベント福引(開催時のみ)の順に行を追加。
        // 片方が失敗しても他方は表示されるよう、各処理は内部でエラーを握る。
        await addDailyFukubiki(container);
        await addEventFukubiki(container);
    } catch (error) {
        warn('処理中に予期しないエラー:', error);
    }
}

// 福引コンテナのホスト要素が描画されるまで待つ
function waitForHost(options) {
    return pollFor(queryHost, options);
}

function queryHost() {
    for (const sel of CONTAINER_HOST_SELECTORS) {
        const el = document.querySelector(`[class*="${sel}"]`);
        if (el) return el;
    }
    return null;
}

// ホスト内のフッター手前(無ければ末尾)に福引コンテナを作る(既にあれば再利用)
function ensureContainer(host) {
    const existing = document.querySelector('.nicogift-container');
    if (existing) return existing;

    const container = document.createElement('div');
    container.className = 'nicogift-container';

    // フッターは直下の子から探す(insertBeforeは直下の子である必要があるため)
    const footer = Array.from(host.children).find((c) => /footer-area/.test(c.className));
    if (footer) host.insertBefore(container, footer);
    else host.appendChild(container);
    return container;
}

// デイリー福引(毎日無料)の行を追加
async function addDailyFukubiki(container) {
    try {
        const conductor = await getDailyConductor();
        if (!conductor) return warn('デイリー福引が見つかりませんでした');

        const fukubikiURL = stripQuery(conductor.url);
        if (!fukubikiURL) return warn('デイリー福引ページURLを取得できませんでした');

        const info = await getFukubikiInfo(fukubikiURL);
        if (!info) return;

        log(await isAvailable(info.apiURL) ? 'デイリー福引: 未取得' : 'デイリー福引: 取得済み');

        const banner = makeBannerElem(conductor.bannerImageUrl, conductor.url, conductor.text);
        appendRow(container, 'nicogift-daily', info.widgetSrc, banner, fukubikiURL);
    } catch (error) {
        warn('デイリー福引の処理に失敗:', error);
    }
}

// イベント福引(イベント開催時のみ)の行を追加
async function addEventFukubiki(container) {
    try {
        const eventSection = await waitForEventSection();
        if (!eventSection) return log('イベント欄なし(イベント未開催)');

        const eventURL = getEventURL(eventSection);
        if (!eventURL) return warn('イベントページURLを取得できませんでした');

        const elem = await getFukubikiElem(eventURL);
        if (!elem) return warn('イベント福引バナーが見つかりませんでした');

        const fukubikiURL = stripQuery(elem.getAttribute('href'));
        if (!fukubikiURL) return warn('福引ページURLを取得できませんでした');

        const info = await getFukubikiInfo(fukubikiURL);
        if (!info) return;

        log(await isAvailable(info.apiURL) ? 'イベント福引: 未取得' : 'イベント福引: 取得済み');
        appendRow(container, 'nicogift-event', info.widgetSrc, elem, eventURL);
    } catch (error) {
        warn('イベント福引の処理に失敗:', error);
    }
}

// 福引一覧APIからデイリー福引のconductor({url, bannerImageUrl, text})を特定
async function getDailyConductor() {
    try {
        const res = await bgFetch(CONDUCTORS_API_URL);
        if (!res?.ok) throw new Error(res?.error ?? `HTTP ${res?.status}`);

        const conductors = JSON.parse(res.body)?.data?.conductors ?? [];
        return conductors.find((c) => DAILY_BANNER_RE.test(c.bannerImageUrl || '')) ?? null;
    } catch (error) {
        warn('福引一覧の取得に失敗:', error);
        return null;
    }
}

// 画像URL・リンクURLからバナーのアンカー要素を生成(イベント福引のスクレイピング要素と同形)
function makeBannerElem(imageUrl, linkUrl, alt) {
    const anchor = document.createElement('a');
    anchor.href = linkUrl;
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = alt || '';
    anchor.appendChild(img);
    return anchor;
}

// 条件を満たす要素が現れるまでポーリング(Reactの遅延描画対策)。timeoutでnull
function pollFor(query, { timeout = 15000, interval = 500 } = {}) {
    return new Promise((resolve) => {
        const first = query();
        if (first) return resolve(first);

        const start = Date.now();
        const timer = setInterval(() => {
            const el = query();
            if (el || Date.now() - start >= timeout) {
                clearInterval(timer);
                resolve(el || null);
            }
        }, interval);
    });
}

// イベント欄が描画されるまで待つ
function waitForEventSection(options) {
    return pollFor(queryEventSection, options);
}

function queryEventSection() {
    return document.evaluate(
        EVENT_SECTION_XPATH, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null,
    ).singleNodeValue;
}

// イベント欄ヘッダーのバナーリンクからイベントページURLを取得
function getEventURL(eventSection) {
    const anchor = eventSection.querySelector('header a');
    return anchor?.href ? stripQuery(anchor.href) : null;
}

// イベントページのHTMLから福引バナー要素(720x135画像のniconewsリンク)を特定
async function getFukubikiElem(eventURL) {
    try {
        // background経由で取得(CORS非対象)。パースはDOMParserが使えるcontent script側で行う。
        const html = await fetchText(eventURL);
        const dom = new DOMParser().parseFromString(html, 'text/html');

        return Array.from(dom.getElementsByTagName('a')).find((anchor) => {
            const href = anchor.getAttribute('href');
            if (!href || !href.includes(NICONEWS_PREFIX)) return false;
            const img = anchor.querySelector('img');
            if (!img) return false;
            return img.getAttribute('width') === BANNER_WIDTH
                && img.getAttribute('height') === BANNER_HEIGHT;
        }) ?? null;
    } catch (error) {
        warn('福引バナー取得に失敗:', error);
        return null;
    }
}

// 福引ページのkokenウィジェットiframeから、埋め込み用src と ステータスAPI URL を得る
async function getFukubikiInfo(fukubikiURL) {
    try {
        // background経由で取得(理由はgetFukubikiElem参照)
        const html = await fetchText(fukubikiURL);
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const iframe = doc.querySelector('[class*="contents"] iframe');
        const src = iframe?.getAttribute('src');
        if (!src) return warn('福引iframeが見つかりませんでした'), null;

        const keyword = new URL(src).pathname.split('/').filter(Boolean).pop();
        if (!keyword) return warn('福引キーワードを抽出できませんでした'), null;

        return {
            widgetSrc: src,
            apiURL: `https://api.koken.nicovideo.jp/v1/lottery/${keyword}/setup`,
        };
    } catch (error) {
        warn('福引情報の特定に失敗:', error);
        return null;
    }
}

// 福引が未取得かどうかをAPIで確認(要ログイン)
async function isAvailable(apiURL) {
    try {
        const res = await bgFetch(apiURL);
        if (!res?.ok) throw new Error(res?.error ?? `HTTP ${res?.status}`);
        const json = JSON.parse(res.body);
        return json?.data?.unavailableStatus !== 'AlreadyUsed';
    } catch (error) {
        warn('福引ステータス確認に失敗:', error);
        return false;
    }
}

// 福引の1行(ウィジェット左+バナー右)をコンテナに追加。
// live と koken は同一サイト(nicovideo.jp)なのでログインCookieが効き、ポップアップ不要。
function appendRow(container, rowClass, widgetSrc, bannerElem, baseURL) {
    if (container.querySelector(`.${rowClass}`)) return; // 二重挿入防止

    const row = document.createElement('div');
    row.className = `nicogift-row ${rowClass}`;
    row.style.cssText =
        'display:flex;justify-content:center;align-items:flex-start;gap:16px;flex-wrap:wrap;margin:8px 0;';

    row.appendChild(buildWidget(widgetSrc)); // 左: ウィジェット
    const banner = buildBanner(bannerElem, baseURL);
    if (banner) row.appendChild(banner); // 右: バナー

    container.appendChild(row);
}

// 福引ウィジェットのiframe要素を生成
function buildWidget(widgetSrc) {
    const iframe = document.createElement('iframe');
    iframe.src = widgetSrc;
    iframe.title = '福引';
    // ウィジェットの実コンテンツ高さ(約634px)に合わせ、内部スクロールを避ける
    iframe.style.cssText = 'width:500px;height:640px;border:0;flex:none;';
    return iframe;
}

// 挿入用に福引バナーの画像URLを実サイズに補正する
function buildBanner(bannerElem, baseURL) {
    const img = bannerElem.querySelector('img');
    if (!img) return null;

    const path = (img.getAttribute('src') || '').replace('-150x135', '');
    // 画像が絶対URLならそのまま、相対パスならページのドメインを前置
    const imgURL = /^https?:\/\//.test(path) ? path : new URL(baseURL).origin + path;

    img.src = imgURL;
    img.srcset = imgURL;
    bannerElem.setAttribute('target', '_blank');
    bannerElem.style.display = 'block';
    bannerElem.style.textAlign = 'center';
    return bannerElem;
}

// background経由のfetch。ページのCORS制約を受けず、ログインCookieも確実に送られる。
function bgFetch(url) {
    return chrome.runtime.sendMessage({ type: 'fetch', url });
}

// background経由fetch + 1回リトライ(一時的なネットワーク失敗対策)。本文テキストを返す
async function fetchText(url) {
    let lastError;
    for (let attempt = 0; attempt <= 1; attempt++) {
        try {
            const res = await bgFetch(url);
            if (!res?.ok) throw new Error(res?.error ?? `HTTP ${res?.status}`);
            return res.body;
        } catch (error) {
            lastError = error;
            if (attempt === 0) await delay(600);
        }
    }
    throw lastError;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// URLからクエリ・ハッシュを除去。無効なURLはnull
function stripQuery(url) {
    try {
        const u = new URL(url, location.href);
        return u.origin + u.pathname;
    } catch {
        return null;
    }
}

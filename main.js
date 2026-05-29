/**
 * ライブ視聴ページ(live.nicovideo.jp/watch/*)で動作するcontent script。
 * 開催中イベントの福引が未取得なら福引ポップアップを開き、福引バナーを画面下に挿入する。
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
        const eventSection = await waitForEventSection();
        if (!eventSection) return log('イベント欄なし(イベント未開催)');

        const eventURL = getEventURL(eventSection);
        if (!eventURL) return warn('イベントページURLを取得できませんでした');

        const fukubikiElem = await getFukubikiElem(eventURL);
        if (!fukubikiElem) return warn('福引バナーが見つかりませんでした');

        const fukubikiURL = stripQuery(fukubikiElem.getAttribute('href'));
        if (!fukubikiURL) return warn('福引ページURLを取得できませんでした');

        const fukubikiInfo = await getFukubikiInfo(fukubikiURL);
        if (!fukubikiInfo) return warn('福引情報を特定できませんでした');

        log(await isAvailable(fukubikiInfo.apiURL) ? '福引が未取得' : '福引は取得済み');

        // 取得・未取得に関わらず、福引ウィジェット(左)とバナー(右)を横並びで表示する。
        insertFukubiki(eventSection, fukubikiInfo.widgetSrc, fukubikiElem, eventURL);
    } catch (error) {
        warn('処理中に予期しないエラー:', error);
    }
}

// イベント欄が描画されるまで待つ(Reactによる遅延描画対策)
function waitForEventSection({ timeout = 15000, interval = 500 } = {}) {
    return new Promise((resolve) => {
        const first = queryEventSection();
        if (first) return resolve(first);

        const start = Date.now();
        const timer = setInterval(() => {
            const el = queryEventSection();
            if (el || Date.now() - start >= timeout) {
                clearInterval(timer);
                resolve(el || null);
            }
        }, interval);
    });
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

// 福引ウィジェット(左)とバナー(右)を横並びで、ライブ画面の下(イベント欄の直後)に挿入。
// live と koken は同一サイト(nicovideo.jp)なのでログインCookieが効き、ポップアップ不要。
function insertFukubiki(eventSection, widgetSrc, fukubikiElem, eventURL) {
    if (document.querySelector('.nicogift-row')) return; // 二重挿入防止

    const row = document.createElement('div');
    row.className = 'nicogift-row';
    row.style.cssText = 'display:flex;justify-content:center;align-items:flex-start;gap:16px;flex-wrap:wrap;';

    row.appendChild(buildWidget(widgetSrc)); // 左: ウィジェット
    const banner = buildBanner(fukubikiElem, eventURL);
    if (banner) row.appendChild(banner); // 右: バナー

    eventSection.parentNode.insertBefore(row, eventSection.nextSibling);
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
function buildBanner(fukubikiElem, eventURL) {
    const img = fukubikiElem.querySelector('img');
    if (!img) return null;

    const path = (img.getAttribute('src') || '').replace('-150x135', '');
    // 画像が外部ドメインの絶対URLならそのまま、相対パスならイベントページのドメインを前置
    const imgURL = /^https?:\/\//.test(path) ? path : new URL(eventURL).origin + path;

    img.src = imgURL;
    img.srcset = imgURL;
    fukubikiElem.setAttribute('target', '_blank');
    fukubikiElem.style.display = 'block';
    fukubikiElem.style.textAlign = 'center';
    return fukubikiElem;
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

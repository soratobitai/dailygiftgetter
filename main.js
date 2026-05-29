/**
 * ライブ視聴ページ(live.nicovideo.jp/watch/*)で動作するcontent script。
 * 毎日無料の「デイリー福引」(全ページ)と、開催中イベントの福引(イベント時のみ)について、
 * 縮小した福引ウィジェットと、その下のテキストリンクを、配信ページ内に横並びで挿入する。
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
// 常設デイリー福引バナーの画像ファイル名パターン(複数種を識別)。一致するconductorを全て表示する。
// - free_<年月>_<テーマ>_<日付8桁>: 毎日無料デイリー福引(例 conductors_free_202605_eiki_20260525.png)
// - reward_<年月>: ニコニコプラスデイリー福引/動画広告を見ると無料(例 reward_202412.png)
// イベント専用バナーには無い構造で、常設のデイリー福引だけを識別できる。
const DAILY_BANNER_PATTERNS = [
    /free_\d{6}_.+_\d{8}\.png/,
    /reward_\d{6}\.png/,
];
// 福引コンテナの挿入位置。この要素の直後にコンテナを挿入する。
// ~= はクラストークン完全一致(-panel等の別要素を誤って拾わないため)。
const ANCHOR_SELECTOR = '[class~="ga-ns-program-information"]';

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
        const container = await prepareContainer();
        if (!container) return warn('福引の挿入位置が見つかりませんでした');

        // デイリー福引(全ページ・毎日)→ イベント福引(開催時のみ)の順に列を追加。
        // 片方が失敗しても他方は表示されるよう、各処理は内部でエラーを握る。
        await addDailyFukubiki(container);
        await addEventFukubiki(container);
    } catch (error) {
        warn('処理中に予期しないエラー:', error);
    }
}

// アンカー要素の描画を待ち、その直後に福引コンテナ(横並び1行)を作る(既にあれば再利用)
async function prepareContainer() {
    const existing = document.querySelector('.nicogift-container');
    if (existing) return existing;

    const anchor = await pollFor(() => document.querySelector(ANCHOR_SELECTOR));
    if (!anchor) return null;

    const container = document.createElement('div');
    container.className = 'nicogift-container';
    // 複数の福引を横並び(1行)に。各福引は[ウィジェット+下にテキストリンク]の縦カラム。
    container.style.cssText =
        'display:flex;flex-direction:row;flex-wrap:wrap;gap:16px;align-items:flex-start;margin:12px 0;';

    anchor.parentNode.insertBefore(container, anchor.nextSibling);
    return container;
}

// 常設デイリー福引(該当する全種)を列として追加
async function addDailyFukubiki(container) {
    const conductors = await getDailyConductors();
    if (!conductors.length) return warn('デイリー福引が見つかりませんでした');

    for (const conductor of conductors) {
        try {
            const fukubikiURL = stripQuery(conductor.url);
            if (!fukubikiURL) continue;

            const info = await getFukubikiInfo(fukubikiURL);
            if (!info) continue;

            const status = await getStatus(info.apiURL);
            log(`デイリー福引(${conductor.id}): ${status.available ? '未取得' : '取得済み'}`);
            appendColumn(container, `nicogift-daily-${conductor.id}`, {
                widgetSrc: info.widgetSrc,
                linkUrl: conductor.url,
                label: cleanLabel(conductor.text),
                needsRewardAd: status.needsRewardAd,
                gateImageUrl: status.gateImageUrl,
            });
        } catch (error) {
            warn(`デイリー福引(${conductor.id})の処理に失敗:`, error);
        }
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

        const status = await getStatus(info.apiURL);
        log(`イベント福引: ${status.available ? '未取得' : '取得済み'}`);
        appendColumn(container, 'nicogift-event', {
            widgetSrc: info.widgetSrc,
            linkUrl: elem.getAttribute('href'),
            label: cleanLabel(elem.querySelector('img')?.getAttribute('alt')),
            needsRewardAd: status.needsRewardAd,
            gateImageUrl: status.gateImageUrl,
        });
    } catch (error) {
        warn('イベント福引の処理に失敗:', error);
    }
}

// 福引一覧APIから常設デイリー福引のconductor({id, url, bannerImageUrl, text})を全て特定
async function getDailyConductors() {
    try {
        const res = await bgFetch(CONDUCTORS_API_URL);
        if (!res?.ok) throw new Error(res?.error ?? `HTTP ${res?.status}`);

        const conductors = JSON.parse(res.body)?.data?.conductors ?? [];
        return conductors.filter((c) =>
            DAILY_BANNER_PATTERNS.some((re) => re.test(c.bannerImageUrl || '')));
    } catch (error) {
        warn('福引一覧の取得に失敗:', error);
        return [];
    }
}

// ラベル文字列を1行に整形(改行・連続空白をまとめる)
function cleanLabel(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
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

// 福引のステータスをAPIで取得(要ログイン)。
// available: 未取得か / needsRewardAd: 動画広告視聴が必要か / gateImageUrl: ゲート画像
async function getStatus(apiURL) {
    try {
        const res = await bgFetch(apiURL);
        if (!res?.ok) throw new Error(res?.error ?? `HTTP ${res?.status}`);
        const data = JSON.parse(res.body)?.data ?? {};
        return {
            available: data.unavailableStatus !== 'AlreadyUsed',
            needsRewardAd: data.needsRewardAd === true,
            gateImageUrl: data.gateImageUrl || null,
        };
    } catch (error) {
        warn('福引ステータス確認に失敗:', error);
        return { available: false, needsRewardAd: false, gateImageUrl: null };
    }
}

// 福引1件分の縦カラム(上:ウィジェット / 下:テキストリンク)をコンテナに追加。
// live と koken は同一サイト(nicovideo.jp)なのでログインCookieが効き、通常はポップアップ不要。
// ただし動画広告型(needsRewardAd)は埋め込みiframe内で広告枠が埋まらず回せないため、
// ウィジェットの代わりにポップアップで公式ページを開くゲートを表示する。
function appendColumn(container, colClass, { widgetSrc, linkUrl, label, needsRewardAd, gateImageUrl }) {
    if (container.querySelector(`.${colClass}`)) return; // 二重挿入防止

    const col = document.createElement('div');
    col.className = `nicogift-col ${colClass}`;
    col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;flex:none;';

    if (needsRewardAd) {
        // 動画広告型は埋め込み不可。ゲート画像・テキストとも、クリックでポップアップを開く。
        const gate = buildGateLink(gateImageUrl);
        const text = buildTextLink(linkUrl, `▶ ${label}（ポップアップで開く）`);
        for (const el of [gate, text]) bindPopup(el, linkUrl);
        col.appendChild(gate);
        col.appendChild(text);
    } else {
        col.appendChild(buildWidget(widgetSrc));            // 上: ウィジェット(縮小)
        col.appendChild(buildTextLink(linkUrl, label));     // 下: テキストリンク
    }

    container.appendChild(col);
}

// クリックで福引ページをポップアップ表示する(別タブ遷移を抑止)。
// getgift=on を付けると event.js がローディング表示と福引へのスクロールを行う。
// ポップアップはトップレベル文脈なので動画広告も再生できる。
function bindPopup(anchor, url) {
    anchor.removeAttribute('target');
    anchor.addEventListener('click', (event) => {
        event.preventDefault();
        const popupURL = new URL(url);
        popupURL.searchParams.set('getgift', 'on');
        window.open(popupURL.href, 'nicogiftFukubiki',
            'width=520,height=720,resizable=yes,scrollbars=yes');
    });
}

// 動画広告型福引用: ウィジェット枠と同サイズのゲート(クリックはbindPopupで付与)
function buildGateLink(gateImageUrl) {
    const a = document.createElement('a');
    a.href = '#';
    a.title = '動画広告は配信ページ内で再生できないため、ポップアップで開きます';
    a.style.cssText =
        'display:flex;align-items:center;justify-content:center;width:250px;height:320px;'
        + 'box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:8px;'
        + 'background:#f7f7f7;text-align:center;font-size:13px;color:#107fc9;text-decoration:none;cursor:pointer;';

    if (gateImageUrl) {
        const img = document.createElement('img');
        img.src = gateImageUrl;
        img.alt = '福引を開く';
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
        a.appendChild(img);
    } else {
        a.textContent = '動画広告を見て福引（ポップアップで開く）';
    }
    return a;
}

// 福引ウィジェットを標準サイズ(500x640)の半分に縮小して表示する要素を生成。
// transformは描画のみ縮小しレイアウト枠は元のままなので、wrapperで縮小後の実寸を確保する。
function buildWidget(widgetSrc) {
    const W = 500, H = 640, SCALE = 0.5;

    const wrap = document.createElement('div');
    wrap.style.cssText = `width:${W * SCALE}px;height:${H * SCALE}px;overflow:hidden;`;

    const iframe = document.createElement('iframe');
    iframe.src = widgetSrc;
    iframe.title = '福引';
    iframe.style.cssText =
        `width:${W}px;height:${H}px;border:0;transform:scale(${SCALE});transform-origin:top left;`;

    wrap.appendChild(iframe);
    return wrap;
}

// 福引ページへのテキストリンクを生成
function buildTextLink(url, label) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label || '福引ページを開く';
    a.style.cssText =
        'display:block;max-width:250px;text-align:center;font-size:12px;line-height:1.3;color:#107fc9;text-decoration:underline;word-break:break-word;';
    return a;
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

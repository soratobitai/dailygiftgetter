/**
 * メモ：
 * 以下のページはCORS制限あり？
 * 'https://koken.nicovideo.jp/campaigns'
**/

// クエリを取得
const url = new URL(window.location.href);
const params = url.searchParams;

let eventSection;
let eventURL;
let fukubikiElem;
let fukubikiURL;
let fukubikiApi;
let fukubikiLists = [];

window.addEventListener('load', async function () {

    // 別窓くん（別窓）の場合はスルー
    if (params.get('popup') === 'on') return;

    // イベントバナー要素を取得
    eventSection = document.evaluate(
        '//section[contains(@class, \'planning-event-participation-program-list-section\')]',
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
    ).snapshotItem(0);

    if (!eventSection) return;

    // イベントページURLを取得
    eventURL = getEventURL();
    if (!eventURL) return;

    // 福引バナー要素を取得
    fukubikiElem = await getFukubikiElem();
    if (!fukubikiElem) return;

    // 福引ページURLを取得
    fukubikiURL = fukubikiElem.getAttribute('href');
    if (!fukubikiURL) return;

    // 福引ステータスAPIを取得
    fukubikiApi = await getFukubikiApi();
    if (!fukubikiApi) return;

    // 福引が未取得なら福引ポップアップを開く
    if (await isAvailable()) {
        window.open(`${fukubikiURL}?&getgift=on`, null, `width=500,height=380,resizable=yes,location=no,toolbar=no,menubar=no`);
    }

    // 福引バナーをライブ画面の下に挿入
    await insertBanner();
});

// 福引バナー要素を取得
async function getFukubikiElem() {

    try {
        // イベントページを取得
        const response = await fetch(eventURL, { credentials: 'include' });
        if (!response.ok) throw new Error('リクエストに失敗しました。ステータスコード: ' + response.status);
        const eventPageHtml = await response.text();

        // DOMオブジェクトを作成
        const parser = new DOMParser();
        const dom = parser.parseFromString(eventPageHtml, 'text/html');

        const anchorTags = dom.getElementsByTagName('a');

        //////////////////////// イベントページから福引バナー要素を特定する
        let href;
        let imageTags;
        let width;
        let height;
        let fukubikiElems = [];

        for (let i = 0; i < anchorTags.length; i++) {

            // 特定のURLを含むAタグかどうか
            href = anchorTags[i].getAttribute('href');
            if (!href || !href.includes('https://blog.nicovideo.jp/niconews/')) continue;

            // 画像を含むかどうか
            imageTags = anchorTags[i].getElementsByTagName('img');
            if (!imageTags.length > 0) continue;

            // 画像サイズ
            width = imageTags[0].getAttribute('width');
            height = imageTags[0].getAttribute('height');
            if (!(width == '720' && height == '135')) continue;

            fukubikiElems.push(anchorTags[i]);
        }

        if (fukubikiElems.length === 0) {
            return null;
        } else {
            return fukubikiElems[0];
        }

    } catch (error) {
        console.error('エラーが発生しました:', error);
        return null;
    }
}

// イベントページURLを取得
function getEventURL() {
    
    const eventHeader = eventSection.querySelector('header');
    const eventElem = eventHeader.querySelector('a');

    // 要素が存在しない場合やリンク要素でない場合はnullを返す
    if (!eventElem || eventElem.tagName !== 'A') return null;

    // リンクURLを返す
    return removeAllParameters(eventElem.href);
}

// 福引ステータスAPIを取得
async function getFukubikiApi() {

    try {
        // Fetchリクエストを送信
        const response = await fetch(fukubikiURL, { credentials: 'include' });
        if (!response.ok) throw new Error('リクエストに失敗しました。ステータスコード: ' + response.status);

        // レスポンスからHTMLを取得
        const html = await response.text();

        // HTMLをパースしてDOMオブジェクトを作成
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const contents = doc.querySelector('[class*="contents"]');
        const iframe = contents.querySelector('iframe');

        if (!iframe) throw new Error('iframeが見つかりません。');

        let srcURL = iframe.getAttribute('src');

        if (srcURL) {
            // const keywords = srcURL.match(/(free_.+?_giftevent_.+?)\?/);

            // パラメーター削除
            const urlParts = srcURL.split('?');
            if (urlParts.length >= 2) {
                srcURL = urlParts[0];
            }

            // キーワード抽出
            const keyword = srcURL.replace('https://koken.nicovideo.jp/campaigns/', '');

            return `https://api.koken.nicovideo.jp/v1/lottery/${keyword}/setup`;

        } else {
            throw new Error('API URL がありません。');
        }

    } catch (error) {
        console.error('エラーが発生しました:', error);
        return null;
    }
}

// 福引が未取得かどうかチェックする
async function isAvailable() {

    try {
        const response = await fetch(fukubikiApi, { credentials: 'include' });
        if (!response.ok) throw new Error('リクエストに失敗しました。ステータスコード: ' + response.status);
        const res = await response.json();

        return res.data.isAvailable;

    } catch (error) {
        console.error('エラーが発生しました:', error);
        return false;
    }
}

/**
 * 福引バナーをライブ画面の下に挿入
 */
async function insertBanner() {

    const fukubikiBanner = await remakeFukubikiBanner(fukubikiElem);

    // 新しいDIV要素を作成する
    const newDiv = document.createElement('div');
    newDiv.appendChild(fukubikiBanner);
    newDiv.style.display = 'flex';
    newDiv.style.justifyContent = 'center';

    // 福引バナーを挿入
    const parentElement = eventSection.parentNode;
    parentElement.insertBefore(newDiv, eventSection.nextSibling);
}

// 挿入用に福引バナーをリメイク
async function remakeFukubikiBanner(fukubikiElem_) {

    try {
        // URL置き換え
        const relativePath = fukubikiElem_.querySelector('img').getAttribute('src'); // 相対パス

        // ページのベースURLを取得する
        //let baseURL = eventURL.substring(0, eventURL.lastIndexOf("/") + 1);
        const baseURL = getDomainFromURL(eventURL);

        fukubikiElem_.querySelector('img').src = baseURL + relativePath;
        fukubikiElem_.querySelector('img').srcset = baseURL + relativePath;
        fukubikiElem_.setAttribute('target', '_blank');

        fukubikiElem_.style.display = "block";
        fukubikiElem_.style.textAlign = "center";

        return fukubikiElem_;

    } catch (error) {
        console.error('エラーが発生しました:', error);
        return null;
    }
}


function getDomainFromURL(url) {

    // "https://" または "http://" の部分を削除する
    url = url.replace("https://", "").replace("http://", "");

    // パス部分を削除する
    let pathStartIndex = url.indexOf("/");
    if (pathStartIndex !== -1) {
        url = url.substr(0, pathStartIndex);
    }

    // クエリ文字列部分を削除する
    let queryStartIndex = url.indexOf("?");
    if (queryStartIndex !== -1) {
        url = url.substr(0, queryStartIndex);
    }

    // ポート番号を削除する
    let portStartIndex = url.indexOf(":");
    if (portStartIndex !== -1) {
        url = url.substr(0, portStartIndex);
    }

    return "https://" + url;
}

function removeAllParameters(url) {
    // クエリ文字列の位置を取得
    let queryStart = url.indexOf('?');

    // クエリ文字列が存在する場合はそれを削除し、残りの部分を返す
    if (queryStart !== -1) {
        return url.substring(0, queryStart);
    }

    // クエリ文字列が存在しない場合は元のURLを返す
    return url;
}
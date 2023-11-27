// クエリを取得
const url = new URL(window.location.href);
const params = url.searchParams;

window.addEventListener('load', async function () {

    // 別窓くん（別窓）の場合はスルー
    if (params.get('popup') === 'on') return;

    const eventSection = document.evaluate(
        '//section[contains(@class, \'planning-event-participation-program-list-section\')]',
        document, // 開始する要素
        null, // 名前空間の接頭辞
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, // 戻り値の種類
        null, //既に存在するXPathResult
    ).snapshotItem(0);

    if (!eventSection) return null;

    // イベントページURLを取得
    let eventURL = getEventURL(eventSection);
    if (!eventURL) return;
    
    eventURL = removeAllParameters(eventURL);

    // 福引ページURLを取得
    let fukubikiURL = await getFukubikiURL(eventURL);
    if (!fukubikiURL) return;

    // 福引ステータスAPIを取得
    const fukubikiApi = await getFukubikiApi(fukubikiURL);
    if (!fukubikiApi) return;

    // 福引が未取得ならウィンドウを開く
    const res = await isAvailable(fukubikiApi);
    if (res) {
        window.open(`${fukubikiURL}?&getgift=on`, null, `width=500,height=380,resizable=yes,location=no,toolbar=no,menubar=no`);
    }

    // 福引バナーを取得
    const fukubikiBanner = await getFukubikiBanner(eventURL);

    const parentElement = eventSection.parentNode;

    // 新しいDIV要素を作成する
    const newDiv = document.createElement('div');
    newDiv.appendChild(fukubikiBanner);
    newDiv.style.display = 'flex';
    newDiv.style.justifyContent = 'center';

    // 福引バナーを挿入
    parentElement.insertBefore(newDiv, eventSection.nextSibling);

});

// 福引が未取得かどうかチェックする
async function isAvailable(apiURL) {

    try {
        const response = await fetch(apiURL, { credentials: 'include' });
        if (!response.ok) throw new Error('リクエストに失敗しました。ステータスコード: ' + response.status);
        const res = await response.json();

        return res.data.isAvailable;

    } catch (error) {
        console.log('エラーが発生しました:', error);
        return false;
    }
}

// イベントページURLを取得
function getEventURL(eventSection) {
    
    const eventHeader = eventSection.querySelector('header');
    const eventElem = eventHeader.querySelector('a');

    // 要素が存在しない場合やリンク要素でない場合はnullを返す
    if (!eventElem || eventElem.tagName !== 'A') return null;

    // リンクURLを返す
    return eventElem.href;
}

// 福引ステータスAPIを取得
async function getFukubikiApi(linkUrl) {

    try {
        // Fetchリクエストを送信
        const response = await fetch(linkUrl, { credentials: 'include' });
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
            keyword = srcURL.replace('https://koken.nicovideo.jp/campaigns/', '');

            return `https://api.koken.nicovideo.jp/v1/lottery/${keyword}/setup`;
        } else {
            throw new Error('API URL がありません。');
        }

    } catch (error) {
        console.log('try内エラー:', error);
        return null;
    }
}

// 福引ページURLを取得
async function getFukubikiURL(linkUrl) {

    try {
        // Fetchリクエストを送信
        const response = await fetch(linkUrl, { credentials: 'include' });
        if (!response.ok) throw new Error('リクエストに失敗しました。ステータスコード: ' + response.status);

        // レスポンスからHTMLを取得
        const html = await response.text();

        // HTMLをパースしてDOMオブジェクトを作成
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // "イベント専用ギフト福引"を検索
        const url = 'https://blog.nicovideo.jp/niconews/';
        const fukubikiElems = searchGiftLink(doc, url);

        if (fukubikiElems.length && fukubikiElems.length > 0) {

            const fukubikiURLs = fukubikiElems.map(function (elem) {
                return elem.getAttribute('href');
            });

            if (fukubikiURLs.length && fukubikiURLs.length > 0) {
                return fukubikiURLs[0];
            } else {
                throw new Error('URLが見つかりません。');
            }

        } else {
            throw new Error('「イベント専用ギフト福引」が見つかりません。');
        }

    } catch (error) {
        console.log('エラーが発生しました:', error);
        return null;
    }
}

// 指定のURLを含む要素を検索（aタグの中にimgを含むもの）
function searchGiftLink(doc, url) {
    const anchorTags = doc.getElementsByTagName('a');
    const result = [];

    for (let i = 0; i < anchorTags.length; i++) {
        const anchorTag = anchorTags[i];
        const href = anchorTag.getAttribute('href');

        // 特定のURLを含むAタグかどうかを確認
        if (href && href.includes(url)) {
            const imageTags = anchorTag.getElementsByTagName('img');

            // IMGタグを持つ要素を配列に追加
            if (imageTags.length > 0) {
                result.push(anchorTag);
            }
        }
    }

    return result;
}


// 福引バナーを取得
async function getFukubikiBanner(linkUrl) {

    try {
        // Fetchリクエストを送信
        const response = await fetch(linkUrl, { credentials: 'include' });
        if (!response.ok) throw new Error('リクエストに失敗しました。ステータスコード: ' + response.status);

        // レスポンスからHTMLを取得
        const html = await response.text();

        // HTMLをパースしてDOMオブジェクトを作成
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // "イベント専用ギフト福引"を検索
        const url = 'https://blog.nicovideo.jp/niconews/';
        const fukubikiElems = searchGiftLink(doc, url);

        if (fukubikiElems.length && fukubikiElems.length > 0) {

            const banner = fukubikiElems[0];

            // URL置き換え
            let relativePath = banner.querySelector('img').getAttribute('src'); // 相対パス

            // ページのベースURLを取得する
            //let baseURL = linkUrl.substring(0, linkUrl.lastIndexOf("/") + 1);
            let baseURL = getDomainFromURL(linkUrl);

            banner.querySelector('img').src = baseURL + relativePath;
            banner.querySelector('img').srcset = baseURL + relativePath;
            banner.setAttribute('target', '_blank');

            banner.style.display = "block";
            banner.style.textAlign = "center";

            return banner;

        } else {
            throw new Error('福引バナーが見つかりません');
        }

    } catch (error) {
        console.log('エラーが発生しました:', error);
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
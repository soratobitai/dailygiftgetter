/**
 * background service worker。
 * content scriptからのfetch依頼を、ページのCORS制約を受けない特権コンテキストで代行する。
 * host_permissions(manifest参照)により blog.nicovideo.jp / koken.nicovideo.jp への
 * credentials付きリクエストがCORSで弾かれず、ログインCookieも確実に送られる。
 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'fetch') return;
    proxyFetch(msg.url).then(sendResponse);
    return true; // 非同期応答を維持
});

async function proxyFetch(url) {
    try {
        const res = await fetch(url, { credentials: 'include' });
        return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (error) {
        return { ok: false, status: 0, body: '', error: String(error?.message ?? error) };
    }
}

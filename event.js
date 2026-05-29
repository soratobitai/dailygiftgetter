/**
 * 福引ページ(blog.nicovideo.jp/niconews/*)で動作するcontent script。
 * getgift=on で開かれたポップアップ時はローディング表示と自動スクロールを行い、
 * 通常閲覧時はevent.cssで隠したヘッダーを元に戻す。
 */

const params = new URLSearchParams(location.search);
const isGetGift = params.get('getgift') === 'on';

const LOADING_HTML = `<div class="loading"><div class="circle"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;

document.addEventListener('DOMContentLoaded', () => {
    if (isGetGift) {
        document.body.insertAdjacentHTML('beforeend', LOADING_HTML);
    }
});

window.addEventListener('load', () => {
    // CSSで付けた余白を戻す
    const contents = document.querySelector('[class*="contents"]');
    if (contents) contents.style.cssText = 'margin-top: 0 !important;';

    if (!isGetGift) {
        // 通常閲覧時: event.cssで隠したヘッダーを表示に戻す
        const commonHeader = document.getElementById('CommonHeader');
        if (commonHeader) commonHeader.style.cssText = 'display: block !important;';
        const header = document.querySelector('header');
        if (header) header.style.cssText = 'display: flex !important;';
        return;
    }

    // ポップアップ時: 福引iframeまでスクロールしてローディングを消す
    const iframe = document.querySelector('iframe');
    if (iframe) iframe.scrollIntoView();

    const loading = document.querySelector('.loading');
    if (loading) loading.style.display = 'none';
});

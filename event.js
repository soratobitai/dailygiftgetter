// クエリを取得
const url = new URL(window.location.href);
const params = url.searchParams;
const loading = `<div class="loading"><div class="circle"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;

document.addEventListener('DOMContentLoaded', function () {

    if (params.get('getgift') !== 'on') return;

    // ローディングを挿入
    if (params.get('getgift') === 'on') {
        document.body.insertAdjacentHTML("beforeend", loading);
    };
});

window.addEventListener('load', function () {

    // CSSを戻す
    const contents = document.querySelector('[class*="contents"]');
    contents.style.cssText = "margin-top: 0 !important;";

    if (params.get('getgift') !== 'on') {
        // 表示戻す
        CommonHeader.style.cssText = "display: block !important;";
        document.querySelector('header').style.cssText = "display: flex !important;";
        return;
    };

    // 自動スクロール
    const iframe = document.querySelector('iframe');
    if (iframe) {
        iframe.scrollIntoView();
    }

    // ローディングを終了
    document.querySelector('.loading').style.display = 'none';
});

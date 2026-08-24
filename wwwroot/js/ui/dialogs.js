import { enforceSystemModeUI } from './layout.js';
import { changeLanguage } from './navigation.js';
import { appState } from '../store.js';
import { t } from '../config.js';


﻿// === ui/dialogs.js - 同步按鈕、自訂 Alert/Confirm、語系更新 ===
export function generateIconHtml(iconVal, colorCls, extraCls, isFolder = false) {
    if (!iconVal) return `<i class="fas ${isFolder ? 'fa-folder text-warning' : 'fa-file-alt text-muted'} ${extraCls}"></i>`;
    // 圖片來源 = data: URI 或任何含 '/' 的路徑（/images/icons/... 實體檔、舊 icon/...）；FA class 永不含 '/'
    const cleanIcon = typeof window.resolveIconUrl === 'function' ? window.resolveIconUrl(iconVal) : iconVal;
    if (cleanIcon && (cleanIcon.startsWith('data:') || cleanIcon.includes('/'))) return `<img src="${window.escapeHTML(cleanIcon)}" class="custom-icon ${extraCls}" alt="icon" onerror="this.onerror=null;this.replaceWith(document.createElement('i'));this.className='fas fa-file-alt text-muted ${extraCls}';">`;
    // ⚠️ iconVal 是未轉義的 DB 值（Menus.Icon / Apps.IconBase64，管理者可自由填）→ 進 class 屬性前必須轉義。
    //    上一行的 <img> 分支與 render/sidebar-item.js:22 的等價程式碼都有轉義，只有這行漏掉（L4）。
    return `<i class="${window.escapeHTML(iconVal)} ${colorCls} ${extraCls}"></i>`;
}

// （2026-08-13 移除 updateSyncButtonUI / appState.hasUnsavedChanges：
//   `#btn-sync-excel` 這顆按鈕在 index.html 中並不存在，而 hasUnsavedChanges 全專案
//   只被賦值 false、從未設為 true → 整組機制是永遠 no-op 的死碼。CRUD 現已全走 RESTful
//   即時寫入，沒有「未儲存變更」這個狀態，故直接移除而非修復。）

// === Alert 防重複 ===
window.__alertState = window.__alertState || {
    lastHtml: null,
    lastAt: 0
};

export function customAlert(msg, isHtml = false) {
    const msgEl = document.getElementById('systemAlertMsg');

    // 轉成字串
    let rawStr = (typeof msg === 'object' && msg !== null)
        ? (msg.message || JSON.stringify(msg))
        : String(msg ?? '');

    const safeHtml = isHtml ? rawStr : (window.escapeHtml ? window.escapeHtml(rawStr) : rawStr.replace(/</g, "&lt;").replace(/>/g, "&gt;"));

    // 防止同一訊息短時間內重複彈出
    const now = Date.now();
    if (window.__alertState.lastHtml === safeHtml && (now - window.__alertState.lastAt) < 1500) {
        return;
    }
    window.__alertState.lastHtml = safeHtml;
    window.__alertState.lastAt = now;

    if (msgEl) msgEl.innerHTML = safeHtml;
    if (typeof appState.systemAlertModalObj !== 'undefined' && appState.systemAlertModalObj) appState.systemAlertModalObj.show();
}

// =========================================================================
// ⭐️ 非阻斷式 Toast — 「成功/資訊」類回饋專用。
//    錯誤訊息與需要使用者決策的情境仍走 customAlert / customConfirm。
// =========================================================================
const TOAST_STYLES = {
    success: { bg: 'text-bg-success', icon: 'fa-check-circle' },
    info:    { bg: 'text-bg-primary', icon: 'fa-info-circle' },
    warning: { bg: 'text-bg-warning', icon: 'fa-exclamation-triangle' },
    error:   { bg: 'text-bg-danger',  icon: 'fa-times-circle' }
};

export function showToast(msg, type = 'success', delay = 3200, isHtml = false) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container position-fixed top-0 end-0 p-3';
        // 需高於 modal(1060) / offcanvas(2050)，Toast 才不會被遮住
        container.style.zIndex = '20000';
        document.body.appendChild(container);
    }

    const MAX_TOASTS = 5;
    const existingToasts = container.querySelectorAll('.toast');
    if (existingToasts.length >= MAX_TOASTS) {
        existingToasts[0].remove(); // remove oldest
    }

    const style = TOAST_STYLES[type] || TOAST_STYLES.success;
    const rawStr = (typeof msg === 'object' && msg !== null) ? (msg.message || JSON.stringify(msg)) : String(msg ?? '');
    const safeHtml = isHtml ? rawStr : (window.escapeHtml ? window.escapeHtml(rawStr) : rawStr.replace(/</g, "&lt;").replace(/>/g, "&gt;"));

    const el = document.createElement('div');
    // 加入 toast-${type} class 以便對應 progress 顏色
    el.className = `toast align-items-center border-0 shadow ${style.bg} toast-${type}`;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    // aria-label 走 t()：toast 是 JS 動態產生的，掛不了 data-i18n-aria-label（changeLanguage 掃不到還沒建立的節點）。
    const closeLabel = window.escapeHtml ? window.escapeHtml(t('btn_close', '關閉')) : t('btn_close', '關閉');
    el.innerHTML = `<div class="d-flex position-relative pb-1"><div class="toast-body fw-bold position-relative z-1"><i class="fas ${style.icon} me-2" aria-hidden="true"></i>${safeHtml}</div><button type="button" class="btn-close btn-close-white me-2 m-auto position-relative z-1" data-bs-dismiss="toast" aria-label="${closeLabel}"></button><div class="toast-progress" style="animation-duration: ${delay}ms;"></div></div>`;
    container.appendChild(el);

    if (typeof bootstrap !== 'undefined' && bootstrap.Toast) {
        el.addEventListener('hidden.bs.toast', () => el.remove());
        new bootstrap.Toast(el, { delay }).show();
    } else {
        // Bootstrap 尚未載入時的退路：直接顯示並定時移除
        el.classList.add('show');
        setTimeout(() => el.remove(), delay);
    }
}

// =========================================================================
// ⭐️ 表格載入骨架屏 (Bootstrap placeholder-glow)：
//    取代「spinner + 查詢中...」文字列，載入時維持表格版面高度、減少跳動感。
// =========================================================================
export function skeletonRows(colCount, rowCount = 6) {
    const widths = ['col-8', 'col-6', 'col-7', 'col-5', 'col-9', 'col-4'];
    let rows = '';
    for (let r = 0; r < rowCount; r++) {
        let tds = '';
        for (let c = 0; c < colCount; c++) {
            tds += `<td><span class="placeholder placeholder-sm ${widths[(r + c) % widths.length]}"></span></td>`;
        }
        rows += `<tr class="placeholder-glow" aria-hidden="true">${tds}</tr>`;
    }
    return rows;
}

// variant（F12，2026-08-16）：確認鈕的樣式。
//   舊版一律 btn-danger —— 連「放棄這次的拖曳變更？」這種可反悔的操作也是紅色，
//   紅色代表「不可逆／會刪資料」的訊號被稀釋掉，真正的刪除confirm 反而不顯眼。
//   'danger'（預設，維持既有呼叫端行為不變）＝ 刪除／不可復原；'primary' ＝ 一般確認。
//   ⚠️ 每次都要顯式設 class：這顆按鈕是共用的，不重設會殘留上一次的樣式。
const CONFIRM_BTN_CLASS = {
    danger: 'btn btn-danger btn-sm px-3 fw-bold',
    primary: 'btn btn-primary btn-sm px-3 fw-bold'
};

export function customConfirm(msg, callback, isHtml = false, variant = 'danger') {
    const msgEl = document.getElementById('systemConfirmMsg');
    if (msgEl) {
        let rawStr = (typeof msg === 'object' && msg !== null) ? (msg.message || JSON.stringify(msg)) : String(msg ?? '');
        msgEl.innerHTML = isHtml ? rawStr : (window.escapeHtml ? window.escapeHtml(rawStr) : rawStr.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    }
    const okBtn = document.getElementById('systemConfirmBtn');
    if (okBtn) okBtn.className = CONFIRM_BTN_CLASS[variant] || CONFIRM_BTN_CLASS.danger;
    // 標題圖示同步：非破壞性確認不用驚嘆號三角形，避免每個確認都像出事了
    const iconEl = document.querySelector('#systemConfirmModal .modal-body > i');
    if (iconEl) {
        iconEl.className = (variant === 'primary')
            ? 'fas fa-circle-question text-primary mb-3'
            : 'fas fa-exclamation-triangle text-warning mb-3';
    }
    appState.confirmActionCallback = callback;
    if (appState.systemConfirmModalObj) appState.systemConfirmModalObj.show();
}

// 4. 綁定 MutationObserver 監視器
// 限縮在 #dynamic-sidebar-menus，避免在 DataTable/Modal 渲染時被全域觸發造成效能瓶頸
if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const target = document.getElementById('dynamic-sidebar-menus');
        if (!target) return;
        const observer = new MutationObserver(() => {
            requestAnimationFrame(() => enforceSystemModeUI());
        });
        observer.observe(target, { childList: true, subtree: true });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // （2026-08-16 移除 renderLangSwitcher() 呼叫：它渲染的目標 #lang-dropdown-menu 在 index.html /
    //   modals.html 中都不存在，函式一進去就 early return —— 與 A5「撤掉搜尋框卻留著 JS」同一類死碼。
    //   語言下拉是 index.html 內的靜態 <ul>，打勾狀態由 changeLanguage() 的 .lang-check 邏輯維護。）
    // ✅ 初始化：同步釘選圖示（避免 icon 空白）
    if (typeof syncPinButtonUI === 'function') syncPinButtonUI();
    const contentZone = document.getElementById('main-content');
    const triggerTop = document.getElementById('trigger-top');
    const triggerLeft = document.getElementById('trigger-left');
    const topNavbar = document.getElementById('top-navbar');
    const sidebar = document.getElementById('sidebar');

    if (contentZone) {
        contentZone.addEventListener('mouseenter', () => {
            if (!appState.isPinned) document.body.classList.add('nav-hidden', 'sidebar-hidden');
        });
    }

    if (topNavbar) {
        topNavbar.addEventListener('mouseleave', () => {
            if (!appState.isPinned) document.body.classList.add('nav-hidden');
        });
    }

    if (sidebar) {
        sidebar.addEventListener('mouseleave', () => {
            if (!appState.isPinned) document.body.classList.add('sidebar-hidden');
        });
    }

    if (triggerTop) {
        triggerTop.addEventListener('mouseenter', () => {
            if (!appState.isPinned) document.body.classList.remove('nav-hidden');
        });
    }

    if (triggerLeft) {
        triggerLeft.addEventListener('mouseenter', () => {
            if (!appState.isPinned) document.body.classList.remove('sidebar-hidden');
        });
    }
});


export function syncPinButtonUI() {
    const btnPin = document.getElementById('btn-pin');
    if (!btnPin) return;

    const pinned = (typeof appState.isPinned !== 'undefined') ? appState.isPinned : (appState.isPinned ?? true);

    btnPin.innerHTML = pinned
        ? '<i class="fa-solid fa-thumbtack text-danger" style="font-size: 0.9rem;" aria-hidden="true"></i>'
        : '<i class="fa-solid fa-unlock text-white-50" style="font-size: 0.9rem;" aria-hidden="true"></i>';
    // is-pinned class 也要一起同步：釘選狀態自 2026-08-16 起會從 localStorage 還原（layout.js PIN_PREF_KEY），
    //   只設 icon 不設 class 會讓「上次取消釘選」的使用者重整後看到不一致的樣式。
    btnPin.classList.toggle('is-pinned', !!pinned);
}

// =========================================================================
// ⭐️ 新增：語言切換 Dropdown UI 更新與聯動邏輯
// =========================================================================
window.updateLangUI = function (langCode) {
    // 直接呼叫核心語言切換函式（所有 UI 更新邏輯已集中在 changeLanguage 裡）
    if (typeof changeLanguage === 'function') {
        changeLanguage(langCode);
    }

    // 自動滑順收合 Bootstrap 下拉選單
    const dropdownBtn = document.getElementById('langDropdown');
    if (dropdownBtn && typeof bootstrap !== 'undefined') {
        const bsDropdown = bootstrap.Dropdown.getInstance(dropdownBtn) || new bootstrap.Dropdown(dropdownBtn);
        if (bsDropdown) bsDropdown.hide();
    }
};

// Expose for HTML inline handlers
window.generateIconHtml = generateIconHtml;
window.customAlert = customAlert;
window.customConfirm = customConfirm;
window.showToast = showToast;
window.skeletonRows = skeletonRows;

// =========================================================================
// ⭐️ UI UX 工具函數
// =========================================================================

export function setButtonLoading(btnId, isLoading) {
    let btn = typeof btnId === 'string' ? document.getElementById(btnId) : btnId;
    if (!btn) return;
    if (btn.tagName && btn.tagName.toUpperCase() === 'FORM') {
        btn = btn.querySelector('button[type="submit"], input[type="submit"]');
        if (!btn) return;
    }
    if (isLoading) {
        btn.classList.add('btn-loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('btn-loading');
        btn.disabled = false;
    }
}
window.setButtonLoading = setButtonLoading;

export function shakeInput(elementId) {
    const el = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
    if (!el) return;
    el.classList.remove('shake-animation');
    // 強制重繪以重置動畫
    void el.offsetWidth;
    el.classList.add('shake-animation', 'is-invalid');
    
    // 短暫延遲後可選擇性移除 shake class
    setTimeout(() => {
        el.classList.remove('shake-animation');
    }, 500);
}
window.shakeInput = shakeInput;
window.syncPinButtonUI = syncPinButtonUI;

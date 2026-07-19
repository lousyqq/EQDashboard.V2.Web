import { enforceSystemModeUI } from './layout.js?v=20260719c';
import { changeLanguage, renderLangSwitcher } from './navigation.js?v=20260719c';
import { appState } from '../store.js?v=20260719c';


﻿// === ui/dialogs.js - 同步按鈕、自訂 Alert/Confirm、語系更新 ===
export function generateIconHtml(iconVal, colorCls, extraCls, isFolder = false) {
    if (!iconVal) return `<i class="fas ${isFolder ? 'fa-folder text-warning' : 'fa-file-alt text-muted'} ${extraCls}"></i>`;
    // 圖片來源 = data: URI 或任何含 '/' 的路徑（/images/icons/... 實體檔、舊 icon/...）；FA class 永不含 '/'
    if (iconVal.startsWith('data:') || iconVal.includes('/')) return `<img src="${iconVal}" class="custom-icon ${extraCls}" alt="icon">`;
    return `<i class="${iconVal} ${colorCls} ${extraCls}"></i>`;
}

// 更新同步按鈕狀態 UI
export function updateSyncButtonUI() {
    const btn = document.getElementById('btn-sync-excel');
    if (btn) {
        if (appState.hasUnsavedChanges) { btn.classList.remove('d-none'); btn.classList.add('d-inline-flex'); }
        else { btn.classList.add('d-none'); btn.classList.remove('d-inline-flex'); }
    }
}

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

    const style = TOAST_STYLES[type] || TOAST_STYLES.success;
    const rawStr = (typeof msg === 'object' && msg !== null) ? (msg.message || JSON.stringify(msg)) : String(msg ?? '');
    const safeHtml = isHtml ? rawStr : (window.escapeHtml ? window.escapeHtml(rawStr) : rawStr.replace(/</g, "&lt;").replace(/>/g, "&gt;"));

    const el = document.createElement('div');
    el.className = `toast align-items-center border-0 shadow ${style.bg}`;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `<div class="d-flex"><div class="toast-body fw-bold"><i class="fas ${style.icon} me-2"></i>${safeHtml}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="關閉"></button></div>`;
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

export function customConfirm(msg, callback, isHtml = false) {
    const msgEl = document.getElementById('systemConfirmMsg');
    if (msgEl) {
        let rawStr = (typeof msg === 'object' && msg !== null) ? (msg.message || JSON.stringify(msg)) : String(msg ?? '');
        msgEl.innerHTML = isHtml ? rawStr : (window.escapeHtml ? window.escapeHtml(rawStr) : rawStr.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
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
    // ✅ 初始化：先渲染語言下拉（active + 打勾）
    if (typeof renderLangSwitcher === 'function') renderLangSwitcher();
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
        ? '<i class="fa-solid fa-thumbtack text-danger" style="font-size: 0.9rem;"></i>'
        : '<i class="fa-solid fa-unlock text-white-50" style="font-size: 0.9rem;"></i>';
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
window.updateSyncButtonUI = updateSyncButtonUI;
window.customAlert = customAlert;
window.customConfirm = customConfirm;
window.showToast = showToast;
window.skeletonRows = skeletonRows;
window.syncPinButtonUI = syncPinButtonUI;


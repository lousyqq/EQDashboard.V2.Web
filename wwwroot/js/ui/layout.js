import { getCustomMenus, t } from '../config.js';


import { renderSidebarMenus } from '../render/sidebar.js';
import { goDefaultHome, navTo } from './navigation.js';
import { appState } from '../store.js';


﻿// === ui/layout.js - 版面切換、側邊欄、全螢幕、釘選 ===

// 佈景主題切換邏輯
//   ⭐️ 2026-08-13：套用主題時「同時」設 data-theme 與 **data-bs-theme**。
//      本專案原本只有自訂的 data-theme，Bootstrap 5.3 的原生元件（modal / dropdown /
//      form-control / table / btn-close / tooltip / popover / DataTables 分頁）都認的是
//      data-bs-theme，所以過去只能靠 components.css 裡 30+ 條 `!important` 逐個補丁硬扛。
//      兩者一起設 → 原生元件自己就正確，補丁只是保險，未來可逐步移除。
//   ⚠️ 一律走 applyTheme()，不要在別處各自 setAttribute，否則兩個屬性會不同步。
function applyTheme(isDark) {
    const root = document.documentElement;
    if (isDark) {
        root.setAttribute('data-theme', 'dark');
        root.setAttribute('data-bs-theme', 'dark');
    } else {
        root.removeAttribute('data-theme');
        root.setAttribute('data-bs-theme', 'light');
    }
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.classList.toggle('fa-sun', isDark);
        icon.classList.toggle('fa-moon', !isDark);
    }
}

export function initTheme() {
    const stored = localStorage.getItem('umc_theme_preference');
    // 首次造訪（尚無偏好）→ 跟隨作業系統的淺/深色設定；使用者手動切過之後就以其選擇為準。
    const isDark = stored ? (stored === 'dark')
        : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(isDark);
}

export function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'dark';
    applyTheme(isDark);
    localStorage.setItem('umc_theme_preference', isDark ? 'dark' : 'light');
}
window.initTheme = initTheme;
window.toggleTheme = toggleTheme;

// 切換側邊欄
export function toggleSidebar() {
    let hasChildren = false;
    if (appState.currentActiveTopMenuId === 'system_settings') {
        hasChildren = true;
    } else if (appState.currentActiveTopMenuId) {
        const cTargetId = window.cleanId(appState.currentActiveTopMenuId);
        const menus = getCustomMenus();
        const children = menus.filter(m => window.cleanId(m.parentId) === cTargetId || (m.parentIds || []).map(window.cleanId).includes(cTargetId));
        if (children.length > 0) hasChildren = true;
    }

    if (!hasChildren) {
        document.body.classList.add('sidebar-hidden');
        return;
    }
    document.body.classList.toggle('sidebar-hidden');
}

// 全域釘選狀態（預設固定）。
//   F12（2026-08-16）：改為持久化 —— 主題（umc_theme_preference）記得住、釘選卻每次重整就跳回固定，
//   對「習慣把版面放開來看看板」的使用者是每天都要重按一次的摩擦。與主題同一套鍵值命名。
const PIN_PREF_KEY = 'umc_pin_preference';
function readPinPreference() {
    try {
        const v = localStorage.getItem(PIN_PREF_KEY);
        if (v === 'true') return true;
        if (v === 'false') return false;
    } catch (e) { /* 隱私模式等限制 */ }
    return true;   // 無偏好 → 維持原本的「預設固定」
}
appState.isPinned = readPinPreference();

export function togglePin() {
    appState.isPinned = !appState.isPinned;
    try { localStorage.setItem(PIN_PREF_KEY, String(appState.isPinned)); } catch (e) { /* 靜默忽略 */ }

    const btnPin = document.getElementById('btn-pin');

    if (appState.isPinned) {
        // 固定模式：nav 一定顯示
        document.body.classList.remove('nav-hidden');

        // 只有「有子選單 / 系統設定」才展開 sidebar（對齊 TEST）
        let hasChildren = false;
        try {
            if (appState.currentActiveTopMenuId === 'system_settings') {
                hasChildren = true;
            } else if (appState.currentActiveTopMenuId && typeof getCustomMenus === 'function') {
                const cTargetId = window.cleanId(appState.currentActiveTopMenuId);
                const menus = getCustomMenus() || [];
                const children = menus.filter(m =>
                    window.cleanId(m.parentId) === cTargetId ||
                    (m.parentIds || []).map(window.cleanId).includes(cTargetId)
                );
                if (children.length > 0) hasChildren = true;
            } else {
                hasChildren = true; // 無資料可判斷時保守展開
            }
        } catch (e) {
            hasChildren = true;
        }

        if (hasChildren) document.body.classList.remove('sidebar-hidden');
        else document.body.classList.add('sidebar-hidden');

        if (btnPin) {
            btnPin.classList.add('is-pinned');
            btnPin.innerHTML = '<i class="fa-solid fa-thumbtack text-danger" style="font-size: 0.9rem;"></i>';
            btnPin.style.background = 'transparent';
            btnPin.style.color = 'inherit';
        }
    } else {
        // 對齊舊版：取消釘選後不立即隱藏，等滑鼠移出 navbar/sidebar 才由 mouseleave 監聽器接手
        if (btnPin) {
            btnPin.classList.remove('is-pinned');
            btnPin.innerHTML = '<i class="fa-solid fa-unlock text-white-50" style="font-size: 0.9rem;"></i>';
            btnPin.style.background = 'transparent';
            btnPin.style.color = 'inherit';
        }
    }
}

// 讓 index.html 的 onclick="togglePin()" 一定能呼叫到
window.togglePin = togglePin;

// 切換全螢幕（沉浸／FOCUS 模式）
export function toggleFullscreen() {
    document.body.classList.toggle('fullscreen-mode');
    if (document.body.classList.contains('fullscreen-mode')) {
        if (document.documentElement.requestFullscreen) { document.documentElement.requestFullscreen().catch(err => console.log(err)); }
    } else {
        if (document.fullscreenElement) { document.exitFullscreen().catch(err => console.log(err)); }
    }
}

// ⭐️ F6（2026-08-16）：瀏覽器全螢幕狀態 → body.fullscreen-mode 的單向同步。
//   舊行為：`fullscreen-mode` 這個 class 只有 toggleFullscreen() 會動，但使用者按 **ESC / F11**
//   離開瀏覽器全螢幕時瀏覽器不會通知我們 → class 殘留 → 導覽列與側欄維持 display:none，
//   使用者卡在沉浸模式，只剩右上角那顆小小的 FOCUS 浮層能脫困（實測 #top-navbar 仍為 display:none）。
//   fullscreenchange 是「離開」與「進入」都會觸發的官方事件，以它為準回寫 class 即可。
//   ⚠️ 只在「瀏覽器已不在全螢幕、但 class 還在」時移除；不要反過來自動加 class ——
//      看板可以用 iframe_fullscreen 進沉浸模式而不要求瀏覽器全螢幕，那是合法狀態。
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('fullscreen-mode')) {
        document.body.classList.remove('fullscreen-mode');
    }
});

// ============================================================================
// ⭐️ 重構：安全、精準補獲側邊欄「個人頁面管理」按鈕 (絕不影響主畫面 Table 內容)
// ============================================================================
let enforceTimer = null;
export function enforceSystemModeUI() {
    if (typeof appState.currentLayoutMode === 'undefined') return;

    if (enforceTimer) clearTimeout(enforceTimer);
    enforceTimer = setTimeout(() => {
        // ⭐️ 精準且安全地尋找「個人頁面管理」按鈕，避開 querySelectorAll('*') 對主畫面表格的干擾
        const personalBtn = document.querySelector('[data-bs-target="#personalMenuModal"]');
        if (personalBtn) {
            // 尋找其外層包裝容器 (如 border-top 分隔線或是 sidebar-footer 底部區塊)
            const wrapper = personalBtn.closest('li, .nav-item, .sidebar-footer, .mt-auto, .border-top') || personalBtn;

            if (appState.currentLayoutMode === 'system') {
                // 系統模式下：隱藏按鈕與其外層容器
                wrapper.style.setProperty('display', 'none', 'important');
            } else {
                // 自訂模式下：還原顯示狀態
                wrapper.style.removeProperty('display');
            }
        }
    }, 20); // 確保畫面渲染完成後再隱藏
}

// ⭐️ 核心修復：切換系統/自訂版面
// ===== 單一真實來源：切換系統/自訂版面（對齊 TEST_20260429.html，統一使用 'personal'）=====
//   navigate=false：只同步「模式狀態 + slider UI + 側邊欄重繪」，**不重設當前位置、不導航**。
//     ⚠️ 供 initDashboardUI() 使用 —— 它自己會依 stayOnCurrentPage 決定要不要 goDefaultHome()。
//        舊版在本函式內也無條件呼叫一次 goDefaultHome()，造成兩個問題（2026-08-12 修）：
//          ① 每次進站 activateMenu 跑兩遍 → POST MenuClick 被記兩次 → Popular 看板統計膨脹一倍
//             （實測網路紀錄確認；與 ES module 雙載那條是各自獨立的兩個成因）。
//          ② initDashboardUI(true) 的 stayOnCurrentPage 被架空 → Excel 匯入後仍被踢回預設首頁
//             （misc-manage.js:872 / :1004 兩處呼叫的原意就是「留在原頁」）。
export function switchLayoutMode(mode, navigate = true) {
    // normalize to: system / personal （與 TEST_20260429.html:2147 appState.currentLayoutMode='system' 一致）
    const m = String(mode ?? 'system').toLowerCase();
    const finalMode = (m.includes('custom') || m.includes('personal') || m.includes('自訂')) ? 'personal' : 'system';

    appState.currentLayoutMode = finalMode;

    // 同步 slider UI
    const wrapper = document.getElementById('layout-toggle-wrapper');
    const sysText = document.getElementById('btn-layout-system');
    const perText = document.getElementById('btn-layout-personal');
    if (wrapper) {
        if (finalMode === 'system') {
            wrapper.classList.remove('personal-active');
            sysText?.classList.add('active');
            perText?.classList.remove('active');
        } else {
            wrapper.classList.add('personal-active');
            sysText?.classList.remove('active');
            perText?.classList.add('active');
        }
    }

    try {
        const isInSystemSettings = (appState.currentActiveTopMenuId === 'system_settings');

        // ⭐️ 2026-08-13：先記住使用者「目前正在看哪個看板」，切換後若它在新版面仍可見就留在原處。
        //   舊行為是一律 goDefaultHome() → 使用者正在看某張報表時誤觸切換鈕就丟失位置，
        //   而系統/自訂版面的看板集合其實大多重疊，多數情況根本不需要跳頁。
        const _prevMenuId = appState.currentActiveSidebarMenuId;

        if (navigate && !isInSystemSettings) {
            appState.currentActiveTopMenuId = null;
            appState.currentActiveSidebarMenuId = null;
        }

        // 頂部頁籤已由 renderSidebarMenus 一併渲染，無需另外呼叫 renderTopMenus
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

        if (navigate) {
            if (isInSystemSettings) {
                // 留在系統設定，不要踢回首頁
                const personalPage = document.getElementById('page-personal-manage');
                if (finalMode === 'system' && personalPage && personalPage.classList.contains('active')) {
                    if (typeof navTo === 'function') {
                        // 麵包屑名稱走 t()：舊版硬編中文，英/日文使用者切到這裡會看到中文標題。
                        // 第 4 參數 subTitleKey：這兩處傳的是 t() 翻出來的字串而非 DB 名稱，
                        // 且沒有對應的側欄節點可供 refreshBreadcrumb 取名 → 必須帶 key 才譯得回來（L1）。
                        if (typeof appState.currentUser !== 'undefined' && appState.currentUser?.roleLevel === 'admin') navTo('page-account-manage', null, t('menu_account_manage', '帳號管理'), 'menu_account_manage');
                        else navTo('page-apply', null, t('menu_apply', '需求申請'), 'menu_apply');
                    }
                }
            } else {
                // 切換後優先「留在原本的看板」：只有當它在新版面的可視清單裡不存在
                //   （例如自訂版面把它隱藏了、或權限不同）才退回預設首頁。
                const stillVisible = _prevMenuId && Array.isArray(appState._currentValidMenus)
                    && appState._currentValidMenus.some(m => window.cleanId(m.id || m.MenuId) === window.cleanId(_prevMenuId));
                if (stillVisible && typeof window.activateMenu === 'function') {
                    window.activateMenu(_prevMenuId);
                } else if (typeof goDefaultHome === 'function') {
                    goDefaultHome();
                }
            }
        }
    } catch (e) {
        console.error("🚨 切換模式錯誤:", e);
    }

    if (typeof enforceSystemModeUI === 'function') enforceSystemModeUI();
}

// 讓 index.html 的 onclick="switchLayoutMode(...)" 一定能呼叫到
window.switchLayoutMode = switchLayoutMode;


// ============================================================================
// ⭐️ RWD (≤992px)：側欄改為浮層 (responsive.css)，此處補上對應行為
//    - 初載 / 縮放至窄幅時自動收合側欄，避免浮層蓋住內容
//    - 點擊背景遮罩 (#sidebar-backdrop) 收合
//    - 點選側欄「連結項」(非資料夾) 導頁後自動收合
// ============================================================================
const RWD_SIDEBAR_BREAKPOINT = 992;
function isNarrowViewport() { return window.innerWidth <= RWD_SIDEBAR_BREAKPOINT; }

const initLayout = () => {
    if (isNarrowViewport()) document.body.classList.add('sidebar-hidden');

    // 跨越斷點時同步：縮窄 → 收合；放寬 → 還原顯示（桌機預設側欄可見）
    let wasNarrow = isNarrowViewport();
    window.addEventListener('resize', () => {
        const narrow = isNarrowViewport();
        if (narrow === wasNarrow) return;
        wasNarrow = narrow;
        if (narrow) document.body.classList.add('sidebar-hidden');
        else document.body.classList.remove('sidebar-hidden');
    });

    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => document.body.classList.add('sidebar-hidden'));

    const sideMenus = document.getElementById('dynamic-sidebar-menus');
    if (sideMenus) sideMenus.addEventListener('click', (e) => {
        if (!isNarrowViewport()) return;
        const item = e.target.closest('.menu-item');
        // 資料夾（有展開箭頭）點了是展開/收合子層，不關閉浮層；連結項導頁後才收合
        if (item && !item.querySelector('.dropdown-arrow')) {
            document.body.classList.add('sidebar-hidden');
        }
    });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLayout);
else initLayout();

// Expose for HTML inline handlers
window.toggleSidebar = toggleSidebar;
window.togglePin = togglePin;
window.toggleFullscreen = toggleFullscreen;
window.enforceSystemModeUI = enforceSystemModeUI;
window.switchLayoutMode = switchLayoutMode;


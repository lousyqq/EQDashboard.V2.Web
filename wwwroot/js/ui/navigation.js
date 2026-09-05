// === ui/navigation.js - 語系切換、選單導航、路由、iframe ===
import { getCustomMenus, getFabs, getRoles, t } from '../config.js';
import { loadActivityLogs } from '../admin/activity-log.js';
import { openAppGridPage } from '../admin/misc-manage.js';
import { renderSidebarMenus } from '../render/sidebar.js';
import { renderAccountTable, renderApplyTable, renderAuditTable, renderFabTable, renderMenuConfigTable, renderPersonalMenuManage, renderRoleTable, renderWebpageTable } from '../render/tables.js';
import { appState } from '../store.js';


// 語系代碼 → BCP 47 標籤（供 <html lang> 用）。
//   影響螢幕閱讀器選用的發音語系、瀏覽器的「要翻譯這一頁嗎」判定、以及 :lang() 樣式。
const HTML_LANG_TAG = { zh: 'zh-TW', en: 'en', ja: 'ja' };

// 使用者手動選過的語系（F3）。
//   ⚠️ 這是「使用者偏好」的唯一事實來源，優先於 fab.defaultLang ——
//      main.js 的 initDashboardUI() 每次進站都會套用廠區預設語言，
//      沒有這一層的話，英/日文使用者每重整一次就被打回中文（2026-08-16 實測確認）。
//      與主題偏好（umc_theme_preference）同一套「首訪跟預設、之後跟使用者」的邏輯。
export const LANG_PREF_KEY = 'umc_lang_preference';

export function getStoredLangPreference() {
    try {
        const v = localStorage.getItem(LANG_PREF_KEY);
        return (v && HTML_LANG_TAG[v]) ? v : null;   // 只接受已知語系，防呆髒值
    } catch (e) { return null; }
}
window.getStoredLangPreference = getStoredLangPreference;

// persist=false 供「套用廠區預設語言」使用 —— 那不是使用者的選擇，不該覆寫他的偏好。
export function changeLanguage(lang, persist = true) {
    if (!HTML_LANG_TAG[lang]) lang = 'zh';
    appState.currentLang = lang;

    if (persist) {
        try { localStorage.setItem(LANG_PREF_KEY, lang); } catch (e) { /* 隱私模式等限制，靜默忽略 */ }
    }

    // 0. 文件層級語系與標題（F4）：兩者都不在 data-i18n 的掃描範圍內，必須手動同步。
    document.documentElement.setAttribute('lang', HTML_LANG_TAG[lang]);
    document.title = t('page_title', '主系統儀表板 - EQ Performance Dashboard');

    // 1. 全面掃描 data-i18n 屬性，替換靜態 HTML 文字
    if (typeof i18n !== 'undefined') {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (i18n[lang] && i18n[lang][key] !== undefined && i18n[lang][key] !== null) el.innerHTML = i18n[lang][key];
        });
        // 1b. data-i18n-placeholder：input/textarea 的 placeholder 也要跟著翻譯
        //     （目前使用者：操作紀錄的工號欄、流量統計的部門/關鍵字欄）
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (i18n[lang] && i18n[lang][key] !== undefined && i18n[lang][key] !== null) el.setAttribute('placeholder', i18n[lang][key]);
        });
        // 1c. data-i18n-aria-label / data-i18n-title：純圖示按鈕的無障礙名稱與 tooltip
        //     （2026-08-16 新增。在此之前 aria-label / title 只能寫死中文，
        //      對讀螢幕的英日文使用者等同沒有翻譯。新增 aria-label/title 時請一併掛這兩個屬性。）
        document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria-label');
            if (i18n[lang] && i18n[lang][key] !== undefined && i18n[lang][key] !== null) el.setAttribute('aria-label', i18n[lang][key]);
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (i18n[lang] && i18n[lang][key] !== undefined && i18n[lang][key] !== null) el.setAttribute('title', i18n[lang][key]);
        });
    }

    // 2. 更新語言按鈕顯示文字（用當前語言的名稱）
    const langDisplayEl = document.getElementById('current-lang-display');
    if (langDisplayEl) langDisplayEl.innerText = t('lang_' + lang, lang.toUpperCase());

    // 3. ✅ 更新語言下拉選單的打勾圖示 (同步 check icon)
    document.querySelectorAll('.lang-check').forEach(el => el.classList.add('d-none'));
    const checkIcon = document.getElementById('check-' + lang);
    if (checkIcon) checkIcon.classList.remove('d-none');

    // 4. 更新版面切換按鈕文字 (系統/自訂 → System/Custom → システム/カスタム)
    const sysText = document.getElementById('btn-layout-system');
    const perText = document.getElementById('btn-layout-personal');
    if (sysText) sysText.innerText = t('nav_sys', '系統');
    if (perText) perText.innerText = t('nav_personal', '自訂');

    // 5. ✅ 重繪首頁儀表板與右上角使用者資訊
    if (typeof renderHomeDashboard === 'function') renderHomeDashboard();

    // 6. 重繪側邊欄（含系統設定子選單翻譯）
    if (appState.currentUser && typeof renderSidebarMenus === 'function') renderSidebarMenus();

    // 6b. 麵包屑（L1）：#bc-name / #bc-path 是 navTo 動態填的、刻意沒有 data-i18n，
    //     所以步驟 1 的掃描不會（也不該）碰它們 —— 必須在這裡以新語系重畫。
    //     ⚠️ 順序不可調動：① 要在步驟 6 之後（refreshBreadcrumb 讀的是重繪後側欄的文字）
    //                     ② 要在步驟 7 之前（page-under-construction 分支會讀 #bc-name 的 innerText）。
    refreshBreadcrumb();

    // 6c. 其餘「JS 動態填值、因此不掛 data-i18n」的元素（L5）：圖示預覽的兩行說明、Excel 檔名格。
    //     兩者都是「有狀態」的顯示，不能靠 data-i18n 掃描重置，只能依當前狀態重新套字。
    if (typeof window.refreshIconPreviewTexts === 'function') window.refreshIconPreviewTexts();
    if (typeof window.syncConfigFileName === 'function') window.syncConfigFileName();

    // 7. ✅ 核心修復：重新渲染當前正在顯示的頁面，讓動態產生的按鈕與表格文字也一併翻譯
    const activePage = document.querySelector('.page-section.active');
    if (activePage) {
        const pageId = activePage.id;
        if (pageId === 'page-personal-manage' && typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
        if (pageId === 'page-webpage-manage' && typeof renderWebpageTable === 'function') renderWebpageTable();
        if (pageId === 'page-menu-manage' && typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
        if (pageId === 'page-fab-manage' && typeof renderFabTable === 'function') renderFabTable();
        if (pageId === 'page-role-manage' && typeof renderRoleTable === 'function') renderRoleTable();
        if (pageId === 'page-account-manage' && typeof renderAccountTable === 'function') renderAccountTable();
        if (pageId === 'page-apply' && typeof renderApplyTable === 'function') renderApplyTable();
        if (pageId === 'page-audit-manage' && typeof renderAuditTable === 'function') renderAuditTable();
        if (pageId === 'page-activity-log' && typeof loadActivityLogs === 'function') loadActivityLogs();
        if (pageId === 'page-traffic-stats' && typeof loadTrafficStats === 'function') loadTrafficStats();
        if (pageId === 'page-app-grid' && typeof renderAppGrid === 'function') renderAppGrid();
        if (pageId === 'page-under-construction') {
            const textEl = document.getElementById('under-construction-text');
            const dName = document.getElementById('bc-name')?.innerText;
            if (textEl) textEl.innerText = t('under_construction_fmt', '{0} 內容建置中').replace('{0}', dName || '');
        }
        // 「已另開分頁」提示卡的標題/說明/按鈕都含動態值（看板名稱、分頁 vs 視窗），
        //   同樣不掛 data-i18n，必須在這裡以新語系重組。
        if (pageId === 'page-external-opened') refreshExternalOpenedPage();
        // 最近瀏覽頁的卡片與空狀態文字也是動態產生的，需一併重繪才會跟著換語系
        if (pageId === 'page-recent') openRecentPage();
    }
}
window.changeLanguage = changeLanguage;


// （2026-08-16 移除 renderLangSwitcher()：它渲染的 #lang-dropdown-menu 在 index.html / modals.html
//   中都不存在 —— 語言下拉是 index.html 內寫死的靜態 <ul>（三個 <a onclick="updateLangUI(...)">），
//   打勾狀態由 changeLanguage() 的 .lang-check / #check-{lang} 邏輯維護。
//   此函式一進去就 `if (!container) return;`，是與 A5「撤掉搜尋框卻留著 JS」同一類的死碼，
//   且 window.renderLangSwitcher 還被重複匯出兩次。整組移除，不要再加回來。）

// 取得上方導覽列名稱
export function getTopMenuName() {
    if (appState.currentActiveTopMenuId === 'system_settings') return t('nav_sys_settings', '系統設定');
    if (!appState.currentActiveTopMenuId) return '';
    const menus = getCustomMenus();
    const cTargetId = window.cleanId(appState.currentActiveTopMenuId);
    const topMenu = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === cTargetId);
    if (topMenu) {
        let mId = topMenu.id || topMenu.MenuId || topMenu.menuId;
        let dName = topMenu.displayName || topMenu.DisplayName || topMenu.sysName || topMenu.SysName;
        let isEdited = topMenu.isEdited || topMenu.IsEdited;

        if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + mId] && !isEdited) {
            dName = i18n[appState.currentLang]['dyn_' + mId];
        }
        return dName;
    }
    return '';
}

// 取得麵包屑路徑
export function getMenuPath(element) {
    let path = []; let current = element;
    while (current) {
        let container = current.closest('.collapse');
        if (!container) break;
        let targetId = container.id;
        let parentItem = document.querySelector(`[data-bs-target="#${targetId}"]`);
        if (parentItem) {
            let textSpan = parentItem.querySelector('span');
            if (textSpan) path.unshift(textSpan.innerText.trim());
            else path.unshift(parentItem.innerText.trim());
            current = parentItem;
        } else break;
    }
    return path.join(' / ');
}

// 取得完整路徑字串
export function getFullMenuPathStr(menuId, allMenus) {
    let path = [];
    let cTargetId = window.cleanId(menuId);
    let curr = allMenus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === cTargetId);

    while (curr) {
        let mId = curr.id || curr.MenuId || curr.menuId;
        let dName = curr.displayName || curr.DisplayName || curr.sysName || curr.SysName;
        let isEdited = curr.isEdited || curr.IsEdited;

        if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + mId] && !isEdited) {
            dName = i18n[appState.currentLang]['dyn_' + mId];
        }
        path.unshift(dName);

        let pId = curr.parentId || curr.ParentMenuId || curr.parentMenuId || (curr.parentIds && curr.parentIds.length > 0 ? curr.parentIds[0] : null);
        let cPId = window.cleanId(pId);

        if (cPId && cPId !== 'null') {
            curr = allMenus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === cPId);
        } else {
            curr = null;
        }
    }
    return path.join(' / ');
}

// 判斷是否為子節點
window.isMenuDescendant = function (folderId, targetId, allMenus) {
    let cFolderId = window.cleanId(folderId);
    let cTargetId = window.cleanId(targetId);
    if (cFolderId === cTargetId) return true;

    let queue = [cFolderId];
    while (queue.length > 0) {
        let curr = queue.shift();
        let children = allMenus.filter(m => {
            let pId = m.parentId || m.ParentMenuId || m.parentMenuId;
            return window.cleanId(pId) === curr || (m.parentIds || []).map(window.cleanId).includes(curr);
        });
        for (let child of children) {
            let cId = window.cleanId(child.id || child.MenuId || child.menuId);
            if (cId === cTargetId) return true;
            queue.push(cId);
        }
    }
    return false;
};

// ⭐️ 智慧點擊主選單連動：直接依照繪製好的側邊欄判斷是否為網頁
export function selectTopMenu(menuId) {
    appState.currentActiveTopMenuId = menuId;
    if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

    if (menuId === 'system_settings') {
        setTimeout(() => {
            const firstLeafEl = document.querySelector('#dynamic-sidebar-menus .menu-item:not([aria-expanded])');
            if (firstLeafEl) firstLeafEl.click();
        }, 50);
        return;
    }

    setTimeout(() => {
        // 直接檢查側邊欄是否有成功畫出任何項目 (代表有子選單)
        const hasSidebarItems = document.querySelectorAll('#dynamic-sidebar-menus .menu-item').length > 0;
        const firstLeafEl = document.querySelector('#dynamic-sidebar-menus .menu-item:not([aria-expanded])');

        if (!hasSidebarItems) {
            // 側邊欄沒有東西，代表這是一個獨立的主選單網頁，交給 activateMenu 處理以留下瀏覽紀錄
            const menus = getCustomMenus();
            const activeRoot = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === window.cleanId(menuId));

            if (activeRoot) {
                const mId = activeRoot.id || activeRoot.MenuId || activeRoot.menuId;
                if (typeof window.activateMenu === 'function') {
                    window.activateMenu(mId);
                }
            }
        } else if (firstLeafEl) {
            // 側邊欄有東西，代表這是一個群組，自動點擊群組內的第一個網頁
            firstLeafEl.click();
        }
    }, 50);
}

// 「不會渲染在畫面內、而是另開分頁/視窗」的開啟方式。
//   唯一事實來源：activateMenu 的外開分支、goDefaultHome 的 _rendersInPage、
//   showExternalOpenedPage 的提示文案三處都吃這一份，新增開啟方式時只要改這裡。
const EXTERNAL_TARGETS = ['blank', 'ie', 'fullscreen', 'popup'];

// ⭐️ 核心修復：點擊啟動特定看板 (加入對 DB 欄位大寫的全面支援)
export function activateMenu(menuId) {
    try {
        if (!menuId) {
            // ⭐️ 徹底封殺 page-home 迴圈，不顯示多餘的總覽
            return;
        }

        const menus = getCustomMenus();
        const targetMenu = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === window.cleanId(menuId));

        if (!targetMenu) {
            console.warn("🚨 無法在資料庫找到對應的選單 ID:", menuId);
            // ⭐️ 徹底封殺 page-home 迴圈
            return;
        }

        let rootId = targetMenu.id || targetMenu.MenuId || targetMenu.menuId;
        const validList = appState._currentValidMenus || menus;
        const getParentCandidates = (node) => {
            const list = new Set();
            if (node.parentId || node.ParentMenuId || node.parentMenuId) list.add(window.cleanId(node.parentId || node.ParentMenuId || node.parentMenuId));
            if (Array.isArray(node.parentIds)) node.parentIds.forEach(p => { if (p) list.add(window.cleanId(p)); });
            return Array.from(list).filter(id => id && id !== 'null' && id !== window.cleanId(node.id || node.MenuId || node.menuId));
        };

        // ⭐️ 廣度優先 (BFS) 往上找尋最上層 Root (無父節點者)，優先匹配存在於 validList 中的合法根群組，確保對位正確
        let queue = [[targetMenu]];
        let bestRoot = null;
        let bestValidRoot = null;
        let visited = new Set([window.cleanId(targetMenu.id || targetMenu.MenuId || targetMenu.menuId)]);

        while (queue.length > 0) {
            const path = queue.shift();
            const curr = path[path.length - 1];
            const pIds = getParentCandidates(curr);
            if (pIds.length === 0) {
                const rId = curr.id || curr.MenuId || curr.menuId;
                bestRoot = bestRoot || rId;
                if (validList.some(v => window.cleanId(v.id || v.MenuId) === window.cleanId(rId))) {
                    bestValidRoot = rId;
                    break;
                }
            } else {
                pIds.forEach(pid => {
                    if (!visited.has(pid)) {
                        visited.add(pid);
                        const parentNode = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === pid);
                        if (parentNode) queue.push([...path, parentNode]);
                    }
                });
            }
        }
        rootId = bestValidRoot || bestRoot || rootId;

        appState.currentActiveTopMenuId = rootId;
        appState.currentActiveSidebarMenuId = menuId;

        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

        let mId = targetMenu.id || targetMenu.MenuId || targetMenu.menuId;
        let dName = targetMenu.displayName || targetMenu.DisplayName || targetMenu.sysName || targetMenu.SysName;
        let mMode = targetMenu.menuMode || targetMenu.MenuMode;
        let mUrl = targetMenu.url || targetMenu.Url;
        let mTarget = targetMenu.target || targetMenu.Target || targetMenu.openTarget || targetMenu.OpenTarget;
        let mTargetPage = targetMenu.targetPage || targetMenu.TargetPage;
        let isEdited = targetMenu.isEdited || targetMenu.IsEdited;

        if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + mId] && !isEdited) {
            dName = i18n[appState.currentLang]['dyn_' + mId];
        }

        const elList = document.querySelectorAll('.menu-item');
        let targetEl = null;
        elList.forEach(el => { 
            const onclickAttr = el.getAttribute('onclick');
            const dataIdAttr = el.getAttribute('data-id');
            if (onclickAttr && onclickAttr.includes(mId)) targetEl = el; 
            else if (dataIdAttr && dataIdAttr === mId) targetEl = el;
        });

        // ⭐️ 記錄到最近瀏覽，並背景同步到資料庫 (Preferences)
        if (appState && appState.currentUser) {
            const hKey = `recent_menus_${appState.currentUser.empId}`;
            let hist = [];
            try { hist = JSON.parse(localStorage.getItem(hKey)) || []; } catch(e){}
            if (!Array.isArray(hist)) hist = [];
            hist = hist.filter(id => window.cleanId(id) !== window.cleanId(mId));
            hist.unshift(mId);
            hist = hist.slice(0, 15);
            localStorage.setItem(hKey, JSON.stringify(hist));

            if (window._syncPreferencesTimeout) clearTimeout(window._syncPreferencesTimeout);
            window._syncPreferencesTimeout = setTimeout(() => {
                let currentPrefs = {};
                if (window._currentServerProfile && window._currentServerProfile.preferences) {
                    try { currentPrefs = JSON.parse(window._currentServerProfile.preferences) || {}; } catch(e){}
                }
                currentPrefs.recent_menus = hist;
                const newPrefsStr = JSON.stringify(currentPrefs);

                if (window._currentServerProfile) window._currentServerProfile.preferences = newPrefsStr;

                // CSRF 標頭（X-Requested-With + X-CSRF-TOKEN）與 400 auto-retry 一律由 api.js 的
                //   全域 fetch 攔截器統一補上，此處不要自己帶。
                //   （舊版帶的 'RequestVerificationToken' 標頭是死碼：後端 HeaderName 設定為 X-CSRF-TOKEN，
                //     且頁面上根本沒有 input[name="__RequestVerificationToken"]，永遠送空字串。）
                fetch(window.normalizeTargetUrl('/api/PersonalSettings/Preferences'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preferences: newPrefsStr })
                }).catch(e => console.error('Failed to sync preferences', e));
            }, 500);
        }

        // ⭐️ 呼叫後端 API 紀錄點擊統計 (Popular/Zombie 看板資料來源)
        //   CSRF 標頭由 api.js 全域攔截器補上（同上）；此處是頁面生命週期中最早發生的寫入請求，
        //   所以 main.js 必須在 initDashboardUI() 之前就把 window._csrfToken 準備好，否則這支會 400。
        if (mId) {
            fetch(window.normalizeTargetUrl(`/api/Tracking/MenuClick?menuId=${encodeURIComponent(mId)}`), {
                method: 'POST'
            }).catch(e => console.error('Failed to record menu click', e));
        }

        if (mMode === 'app_grid') openAppGridPage(mId, dName, targetEl);
        else if (mUrl) {
            // 依 OpenTarget 區分：blank=另開分頁 / fullscreen=全螢幕 / 其他=畫面內嵌
            // ⚠️ XSS 防護：先過 safeExternalUrl
            let safeUrl = (typeof window.safeExternalUrl === 'function') ? window.safeExternalUrl(mUrl) : mUrl;
            safeUrl = normalizeTargetUrl(safeUrl);
            if (safeUrl !== '#') {
                if (EXTERNAL_TARGETS.includes(String(mTarget || '').toLowerCase())) {
                    // 🔴 外開的同時**一定要換掉內嵌區**（2026-09-05）：舊版這裡只 window.open，
                    //   完全不動 .page-section → 內嵌區原封不動留著**上一個**看板的畫面。
                    //   使用者從新分頁切回本頁時會以為那就是剛點的看板 ——
                    //   點上方導覽列（selectTopMenu 自動點第一個側欄項目）時最容易中招，
                    //   因為那個舊看板根本不是他自己選的。改為導到 page-external-opened 提示卡。
                    openExternalTarget(safeUrl, mTarget);
                    showExternalOpenedPage(safeUrl, dName, mTarget, targetEl);
                } else if (mTarget === 'iframe_fullscreen') {
                    openDynamicIframe(safeUrl, dName, targetEl, true);
                } else {
                    openDynamicIframe(safeUrl, dName, targetEl, false);
                }
            }
        }
        else if (mTargetPage) {
            navTo(mTargetPage, targetEl, dName);
        } else {
            let underConstructionPage = document.getElementById('page-under-construction');
            const mainContent = document.getElementById('main-content');
            if (!underConstructionPage) {
                underConstructionPage = document.createElement('div');
                underConstructionPage.id = 'page-under-construction';
                underConstructionPage.className = 'page-section';
                underConstructionPage.innerHTML = `<div class="manage-alert" id="under-construction-text"></div>`;
                if (mainContent) mainContent.appendChild(underConstructionPage);
            } else if (underConstructionPage.parentElement && underConstructionPage.parentElement.id !== 'main-content') {
                if (mainContent) mainContent.appendChild(underConstructionPage);
            }
            const textEl = document.getElementById('under-construction-text');
            if (textEl) textEl.innerText = t('under_construction_fmt', '{0} 內容建置中').replace('{0}', dName || '');
            navTo('page-under-construction', targetEl, dName);
        }
    } catch (error) {
        console.error("🚨 啟動看板時發生錯誤:", error);
    }
}

// ⭐ 依開啟方式把網址開到「本頁之外」（blank / ie / fullscreen / popup）。
//   ⚠️ 呼叫端必須先過 safeExternalUrl + normalizeTargetUrl（與舊版 activateMenu 內嵌時同層防護），
//     本函式不重複驗證。抽出來是為了讓 reopenExternalMenu()（提示卡上的「重新開啟」）
//     與 activateMenu 走**同一份**開窗參數 —— 兩套實作遲早會漂移。
function openExternalTarget(safeUrl, target) {
    if (!safeUrl || safeUrl === '#') return;
    const tg = String(target || '').toLowerCase();
    if (tg === 'ie') { openInIE(safeUrl); return; }
    if (tg === 'fullscreen') {
        const w = screen.availWidth || window.screen.width || 1920;
        const h = screen.availHeight || window.screen.height || 1080;
        window.open(safeUrl, '_blank', `width=${w},height=${h},top=0,left=0,resizable=yes,scrollbars=yes,status=yes`);
        return;
    }
    if (tg === 'popup') {
        const w = Math.min(1024, (screen.availWidth || 1280) - 100);
        const h = Math.min(768, (screen.availHeight || 800) - 100);
        const left = Math.round(((screen.availWidth || 1280) - w) / 2);
        const top = Math.round(((screen.availHeight || 800) - h) / 2);
        window.open(safeUrl, '_blank', `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=yes,status=yes`);
        return;
    }
    window.open(safeUrl, '_blank', 'noopener,noreferrer');
}

// === 「已另開分頁/視窗」佔位提示（2026-09-05）===
// 記的是「輸入」而不是渲染結果 —— 切語言時要能用新語系重新組字（同 _lastBc 的作法）。
let _lastExternalOpen = null;   // { url, name, target }

/**
 * 把內嵌區換成「XXX 已在新分頁開啟」的提示卡。
 * navTo 會順手把 #main-iframe 的 src 設回 about:blank（pageId !== 'page-iframe' 分支），
 * 所以舊看板畫面一定會被清掉 —— 這正是本功能的重點，不要為了「保留上一頁」而繞過 navTo。
 */
export function showExternalOpenedPage(url, name, target, element) {
    _lastExternalOpen = { url, name: name || '', target };
    navTo('page-external-opened', element, name || '');
    refreshExternalOpenedPage();
}

/**
 * 依 _lastExternalOpen 重畫提示卡文字（切語言時由 changeLanguage 步驟 7 呼叫）。
 * ⚠️ #external-opened-title / -desc / -btn-text 都是 JS 動態填值，**不可掛 data-i18n**
 *    （會被 changeLanguage 步驟 1 的 innerHTML 掃描洗掉，見 CLAUDE.md §4-前端-9）。
 */
export function refreshExternalOpenedPage() {
    if (!_lastExternalOpen) return;
    const isTab = String(_lastExternalOpen.target || '').toLowerCase() === 'blank';
    const name = _lastExternalOpen.name || t('iframe_content', '看板內容');

    const titleEl = document.getElementById('external-opened-title');
    const descEl = document.getElementById('external-opened-desc');
    const btnEl = document.getElementById('external-opened-btn-text');

    if (titleEl) {
        const fmt = isTab
            ? t('ext_opened_title_tab_fmt', '「{0}」已在新分頁開啟')
            : t('ext_opened_title_win_fmt', '「{0}」已在新視窗開啟');
        titleEl.innerText = fmt.replace('{0}', name);
    }
    if (descEl) descEl.innerText = t('ext_opened_desc', '此看板設定為在本頁之外開啟，內容不會顯示在這個區域。若沒有看到，請確認瀏覽器是否封鎖了快顯視窗。');
    if (btnEl) btnEl.innerText = isTab ? t('btn_reopen_tab', '重新開啟分頁') : t('btn_reopen_window', '重新開啟視窗');
}
window.refreshExternalOpenedPage = refreshExternalOpenedPage;

// 提示卡上的「重新開啟」：使用者不小心關掉新分頁、或被快顯封鎖時可再開一次。
export function reopenExternalMenu() {
    if (!_lastExternalOpen || !_lastExternalOpen.url) return;
    openExternalTarget(_lastExternalOpen.url, _lastExternalOpen.target);
}
window.reopenExternalMenu = reopenExternalMenu;

// ⭐ 以 IE 開啟網址（開啟方式 target === 'ie'）：供含 ActiveX 等舊元件、Edge/Chrome 無法正常顯示的老網頁。
//   實作：導向自訂協定「ie:<完整URL>」交給本機協定處理器啟動 iexplore ——
//   客戶端需「一次性」匯入 /tools/install-ie-protocol.reg 註冊協定（企業可用 GPO 派送整批安裝）。
//   未註冊協定時瀏覽器會靜默忽略（不導航、不報錯），頁面停在原地不受影響。
//   ⚠️ 呼叫端必須先過 safeExternalUrl（與 blank 分支同層防護），本函式不重複驗證。
export function openInIE(url) {
    try {
        // 相對路徑／無 scheme 網址先絕對化（協定處理器收到的必須是完整 URL；
        //   解析行為與 blank 分支的 window.open 相對解析一致）
        let abs = url;
        try { abs = new URL(url, window.location.href).href; } catch (e) { /* 解析失敗保留原值 */ }
        window.location.href = 'ie:' + abs;
    } catch (e) {
        console.error('IE 協定呼叫失敗:', e);
    }
}
window.openInIE = openInIE;

// ⭐️ 對齊 TEST_20260429.html:3496 的預設首頁跳轉（含廠區過濾、folder 自動取第一個子節點）
export function goDefaultHome() {
    try {
        if (!appState.currentUser) return;

        let defPage = null;

        // 1. 優先使用該帳號在目前廠區設定的專屬首頁
        if (appState.currentUser.defaultPages && appState.currentUser.defaultPages[appState.currentFab]) {
            defPage = appState.currentUser.defaultPages[appState.currentFab];
        } else if (appState.currentUser.defaultPage) {
            defPage = appState.currentUser.defaultPage; // 向下相容舊資料
        }

        const menus = getCustomMenus() || [];
        const validList = appState._currentValidMenus || [];

        const _isFolder = (m) => !!m && String(m.menuMode || m.MenuMode || '').toLowerCase() === 'folder';
        const _isOpenable = (m) => !!m && !!(m.url || m.Url || m.targetPage || m.TargetPage || (m.menuMode || m.MenuMode) === 'app_grid');

        // ⭐️ 自動挑首頁時還要再多一層條件：**必須是會在畫面內呈現的看板**。
        //   activateMenu 對 blank / ie / fullscreen / popup 是 window.open 到外部、內嵌區只留一張
        //   「已另開分頁」的提示卡（2026-09-05 起）→ 拿它當「開站落點」的話，使用者一進站看到的
        //   就是那張提示卡而不是內容。使用者「主動點擊」時外開＋提示卡是正確行為，這裡只限制自動挑選。
        //   ⚠️ 只作用在步驟 2/3 的自動挑選；步驟 1（admin 明確指定的預設首頁）是明示意圖，不覆寫。
        const _rendersInPage = (m) => {
            if (!m) return false;
            if (String(m.menuMode || m.MenuMode || '').toLowerCase() === 'app_grid') return true; // → page-app-grid
            const url = m.url || m.Url;
            if (url) return !EXTERNAL_TARGETS.includes(String(m.target || m.Target || '').toLowerCase());
            return !!(m.targetPage || m.TargetPage);                                              // → navTo(targetPage)
        };
        const _isAutoHomeCandidate = (m) => _isOpenable(m) && !_isFolder(m) && _rendersInPage(m);
        // ⭐ 預設頁若指向「資料夾」（管理者在挑選器把整個群組指定為預設）→ 遞迴展開到底下第一個可直接開啟的葉節點
        const _resolveFolderToFirstLeaf = (folderId) => {
            let curId = window.cleanId(folderId);
            const searchList = (validList && validList.length > 0) ? validList : menus.filter(m => m.enabled !== false);
            let queue = [curId];
            let visited = new Set([curId]);
            let guard = 0;
            while (queue.length > 0 && guard++ < 500) {
                const cid = queue.shift();
                const node = searchList.find(m => window.cleanId(m.id || m.MenuId) === cid) || menus.find(m => window.cleanId(m.id || m.MenuId) === cid);
                if (node && _isOpenable(node) && !_isFolder(node)) {
                    return cid;
                }
                let children = searchList.filter(m => {
                    const pid = window.cleanId(m.parentId || m.ParentMenuId);
                    const pids = (m.parentIds || []).map(window.cleanId);
                    return pid === cid || pids.includes(cid);
                });
                if (children.length === 0 && searchList !== menus) {
                    children = menus.filter(m => m.enabled !== false && (window.cleanId(m.parentId || m.ParentMenuId) === cid || (m.parentIds || []).map(window.cleanId).includes(cid)));
                }
                children.sort((a, b) => {
                    const oa = (a.parentOrders && a.parentOrders[cid] != null) ? a.parentOrders[cid] : (a.order || a.GlobalOrder || 0);
                    const ob = (b.parentOrders && b.parentOrders[cid] != null) ? b.parentOrders[cid] : (b.order || b.GlobalOrder || 0);
                    return oa - ob;
                });
                children.forEach(ch => {
                    const chId = window.cleanId(ch.id || ch.MenuId);
                    if (chId && !visited.has(chId)) {
                        visited.add(chId);
                        if (_isOpenable(ch) && !_isFolder(ch)) queue.unshift(chId);
                        else queue.push(chId);
                    }
                });
            }
            return curId;
        };

        // 2. 未設定 → 依目前廠區 fab.assignedRoles 與帳號 assignedRoles 的交集，找出該帳號可看的第一個 root
        if (!defPage) {
            const currentFabObj = getFabs().find(f => window.cleanId(f.fabName || f.FabName) === window.cleanId(appState.currentFab));
            if (currentFabObj) {
                const fabRoleIds = currentFabObj.assignedRoles || currentFabObj.AssignedRoles || [];
                const userRoleIds = appState.currentUser.assignedRoles || appState.currentUser.AssignedRoles || [];
                const isOpenAccess = appState.openAccessMode === true || (window._authConfig && window._authConfig.openAccessMode === true);
                const isAdmin = appState.currentUser && appState.currentUser.roleLevel === 'admin';
                const activeRoleIds = (isAdmin || isOpenAccess) ? fabRoleIds : fabRoleIds.filter(id => userRoleIds.some(uId => window.cleanId(uId) === window.cleanId(id)));

                const roles = getRoles();
                let initialMenuIds = [];
                activeRoleIds.forEach(roleId => {
                    const role = roles.find(r => window.cleanId(r.id || r.RoleId) === window.cleanId(roleId));
                    if (role && (role.allowedMenuIds || role.AllowedMenuIds)) {
                        initialMenuIds.push(...(role.allowedMenuIds || role.AllowedMenuIds));
                    }
                });

                let allowedIds = typeof window.getAllowedIdsWithHierarchy === 'function'
                    ? window.getAllowedIdsWithHierarchy(menus, initialMenuIds)
                    : new Set(initialMenuIds);
                if (allowedIds.size === 0 && (isAdmin || isOpenAccess)) {
                    allowedIds = new Set(menus.map(m => m.id));
                }

                // 找出第一層 root（非 pool、無父節點、啟用、且在 allowedIds 中）
                let validRoots = menus.filter(m =>
                    m.isPoolItem === false &&
                    !m.parentId &&
                    (!m.parentIds || m.parentIds.length === 0) &&
                    m.enabled !== false &&
                    allowedIds.has(m.id)
                );

                // 依群組權限指定的順序排序
                validRoots.sort((a, b) => {
                    let idxA = initialMenuIds.indexOf(a.id);
                    let idxB = initialMenuIds.indexOf(b.id);
                    return (idxA === -1 ? 9999 : idxA) - (idxB === -1 ? 9999 : idxB);
                });

                // ⭐️ 依序找「第一個真的打得開的」root（2026-08-24 第七輪 J4 修正）。
                //   舊版只取 validRoots[0] 且只判斷是不是 folder —— 但本站多數 root 是
                //   menuMode='link' 且 url/targetPage 皆空的「群組佔位節點」，直接當預設首頁的結果是
                //   activateMenu 走到 page-under-construction → 沒設過預設首頁的使用者（尤其新進人員）
                //   第一眼就是「XXX 內容建置中」，即使底下還有一堆打得開的看板。
                //   ⚠️ 不能靠下方步驟 3 的防呆補救：它的條件是「defPage 不在 validList」，
                //      而佔位 root 就在清單裡 → 永遠不會觸發（這是當時漏掉的關鍵）。
                for (const root of validRoots) {
                    let candidate = null;
                    if (_isFolder(root)) {
                        const leafId = _resolveFolderToFirstLeaf(root.id);
                        const leafObj = menus.find(m => window.cleanId(m.id || m.MenuId) === window.cleanId(leafId));
                        if (_isAutoHomeCandidate(leafObj)) candidate = leafId;
                    } else if (_isAutoHomeCandidate(root)) {
                        candidate = root.id;
                    }
                    if (candidate) { defPage = candidate; break; }
                }
            }
        }

        // 2.5 預設頁本身開不出東西 → 展開到第一個可開啟子看板（管理者可把整個群組設為預設首頁）
        //
        // ⭐️ 2026-08-24 第八輪 K1：條件由「只看 `_isFolder`」放寬為「**folder 或任何 `!_isOpenable` 的節點**」。
        //    成因：本站多數 root 是 menuMode='link' 但 url / targetPage **皆為空字串**的「群組佔位節點」，
        //    它不是 folder，舊條件完全不攔 → admin 在帳號管理的挑選器選到它，使用者每次登入就停在
        //    「XXX 內容建置中」（實測 admin 00058897 的 12A 預設首頁 m_1777125587023 正是這種節點）。
        //    而且死頁落點照樣會 activateMenu → POST MenuClick，把該節點的點擊統計灌到 397 次。
        // ⚠️ 這不牴觸「步驟 1 是 admin 的明示意圖、不覆寫」——被覆寫的只有「證明沒有任何內容可呈現」的節點
        //    （非 app_grid、無 url、無 targetPage）。明確指定 blank / ie / popup 等外開目標仍完全尊重。
        // ⚠️ `_resolveFolderToFirstLeaf` 找不到可開啟子節點時會**原樣回傳輸入的 id**，
        //    所以複驗一定要連 `_isOpenable` 一起檢查——只檢查 `!_isFolder` 的話，佔位節點會原封不動被放行。
        if (defPage) {
            const _defObj = menus.find(m => window.cleanId(m.id || m.MenuId) === window.cleanId(defPage));
            if (_isFolder(_defObj) || !_isOpenable(_defObj)) {
                const _resolved = _resolveFolderToFirstLeaf(defPage);
                const _resObj = menus.find(m => window.cleanId(m.id || m.MenuId) === window.cleanId(_resolved));
                defPage = (_resObj && _isOpenable(_resObj) && !_isFolder(_resObj)) ? _resolved : null;
            }
        }

        // 3. 終極防呆：仍找不到或合法權限已被拔除/在個人設定中被隱藏 → 從安全過濾後的清單尋找第一個可直接開啟的看板
        if (!defPage || !validList.find(m => window.cleanId(m.id) === window.cleanId(defPage))) {
            // 優先找「會在畫面內呈現」的；真的一個都沒有，才退回任何可開啟的（至少有反應勝過空白）。
            let firstVisible = validList.find(m => _isAutoHomeCandidate(m))
                || validList.find(m => _isOpenable(m) && !_isFolder(m));
            if (firstVisible) defPage = firstVisible.id;
            else defPage = null; // ⭐️ 安全防護：無可用看板時寧可空白，避免越權顯示
        }

        if (defPage) activateMenu(defPage);
        else navTo('page-unauthorized'); // ⭐️ 此廠區無任何可視看板 → 導向中性「空狀態」頁（非「無權限」警示）。
        //    上方導覽列本就因 renderSidebarMenus 沒有 root 而自然留空；此處只是讓內容區顯示中性提示而非空白/警示，
        //    避免使用者誤以為系統出錯或資料遺失（廠區能被切到＝已有可存取角色，零看板＝尚未配置看板而非權限問題）。

    } catch (error) {
        console.error("🚨 導向預設首頁時發生錯誤:", error);
    }
}

// === 麵包屑（L1）===
// #bc-name / #bc-path 是這裡動態填的，**刻意不掛 data-i18n**（掛了會被 changeLanguage 步驟 1 洗掉，
//   見 index.html 該行註解與 CLAUDE.md §4-前端-9）。切語言時改由 refreshBreadcrumb() 用同一組輸入重畫。
// _lastBc 記的是「上一次 navTo 的輸入」，不是渲染結果 —— 重畫時才能拿到新語系的名稱。
let _lastBc = { pageId: 'page-home', hadElement: false, subTitle: '', subTitleKey: null };

function updateBreadcrumb(pageId, element, subTitle) {
    const bcPath = document.getElementById('bc-path');
    const bcName = document.getElementById('bc-name');
    if (!bcPath || !bcName) return;

    if (pageId === 'page-home') {
        bcPath.style.display = 'none';
        bcName.innerText = t('nav_breadcrumb_home', '首頁總覽');
        return;
    }
    if (pageId === 'page-recent') {
        bcPath.style.display = 'none';
        bcName.innerText = t('lbl_recent', '最近瀏覽');
        return;
    }

    let topName = getTopMenuName();
    let folderPath = element ? getMenuPath(element) : '';

    let elName = element ? (element.querySelector('span')?.innerText || element.innerText.trim()) : '';
    const leafName = subTitle || elName || '';

    let finalPathArr = [];
    // 根層看板直接開啟時上層名稱與頁面同名 → 不重複顯示（避免「ZE / ZE」）
    if (topName && !(topName === leafName && !folderPath)) finalPathArr.push(topName);
    if (folderPath) finalPathArr.push(folderPath);

    if (finalPathArr.length > 0) {
        bcPath.style.display = 'inline';
        bcPath.innerText = finalPathArr.join(' / ') + ' / ';
    } else {
        bcPath.style.display = 'none';
    }

    bcName.innerText = leafName;
}

/**
 * 以「上一次 navTo 的輸入」重畫麵包屑（切語言時呼叫）。
 * ⚠️ 只有當初真的是從側欄項目進來的（`hadElement`）才可以讀 `.menu-item.active` —— renderSidebarMenus()
 *    會依 `appState.currentActiveSidebarMenuId` 還原 active，而 layout.js 那兩處
 *    `navTo('page-account-manage', null, …)` 根本沒有對應的側欄項目，貿然取用會拿到別頁的名稱。
 */
export function refreshBreadcrumb() {
    const activePage = document.querySelector('.page-section.active');
    if (!activePage) return;
    const pageId = activePage.id;

    const el = (_lastBc.hadElement && _lastBc.pageId === pageId)
        ? document.querySelector('.menu-item.active')
        : null;

    // 有 subTitleKey → 重譯；否則有側欄節點就交給它（側欄已於步驟 6 以新語系重繪，含 dyn_ 覆寫）。
    const subTitle = _lastBc.subTitleKey
        ? t(_lastBc.subTitleKey, _lastBc.subTitle)
        : (el ? '' : _lastBc.subTitle);

    updateBreadcrumb(pageId, el, subTitle);
}
window.refreshBreadcrumb = refreshBreadcrumb;

// 導航到指定區域塊
// subTitleKey：呼叫端若傳的是 t() 翻出來的字串（而非 DB 名稱），請一併帶上 key，切語言時才重譯得回來。
export function navTo(pageId, element, subTitle = '', subTitleKey = null) {
    // 離開最近瀏覽頁時，移除 viewing-recent class 讓側邊欄恢復
    if (pageId !== 'page-recent') {
        document.body.classList.remove('viewing-recent');
    }
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');
    document.body.classList.remove('fullscreen-mode');

    if (pageId === 'page-iframe') {
        document.body.classList.add('iframe-mode');
    } else {
        document.body.classList.remove('iframe-mode');
        // 離開看板頁時收掉載入/失敗覆蓋層並取消逾時計時，避免下次進來殘留舊狀態
        if (_iframeTimeoutId) { clearTimeout(_iframeTimeoutId); _iframeTimeoutId = null; }
        setIframeStatus('none');
        const iframe = document.getElementById('main-iframe');
        if (iframe) iframe.src = 'about:blank';
    }

    _lastBc = { pageId, hadElement: !!element, subTitle, subTitleKey };
    updateBreadcrumb(pageId, element, subTitle);

    if (pageId === 'page-personal-manage' && typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
    if (pageId === 'page-webpage-manage' && typeof renderWebpageTable === 'function') renderWebpageTable();
    if (pageId === 'page-menu-manage' && typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
    if (pageId === 'page-fab-manage' && typeof renderFabTable === 'function') renderFabTable();
    if (pageId === 'page-role-manage' && typeof renderRoleTable === 'function') renderRoleTable();
    if (pageId === 'page-account-manage' && typeof renderAccountTable === 'function') renderAccountTable();
    if (pageId === 'page-apply' && typeof renderApplyTable === 'function') renderApplyTable();
    if (pageId === 'page-audit-manage' && typeof renderAuditTable === 'function') renderAuditTable();
    if (pageId === 'page-activity-log' && typeof loadActivityLogs === 'function') loadActivityLogs();
    if (pageId === 'page-traffic-stats' && typeof loadTrafficStats === 'function') loadTrafficStats();
    if (pageId !== 'page-app-grid') appState.currentAppGridMenuId = null;
}

export function normalizeTargetUrl(url) {
    if (!url || url === '#' || url.startsWith('page-')) return url;
    let u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('/') || u.startsWith('./') || u.startsWith('../')) return u;
    if (/^(localhost|127\.0\.0\.1|(\d{1,3}\.){3}\d{1,3}|www\.|[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z]{2,})(:\d+)?(\/|$)/i.test(u)) {
        return 'http://' + u;
    }
    return u;
}
window.normalizeTargetUrl = normalizeTargetUrl;

// ⭐️ 看板載入狀態控制（2026-08-13 新增）
//   舊行為：iframe.src 一設就結束，載入期間與失敗時畫面都是全白，使用者無法分辨
//   「還在載」「網站掛了」「權限不足」。現在補上 loading 指示 + 逾時失敗回饋。
//   ⚠️ 跨來源 iframe 讀不到內部狀態（同源政策），所以：
//     - onload 觸發 → 視為成功（跨來源也會觸發 onload）
//     - 逾時（預設 20s）仍未 onload → 顯示失敗卡片，提供「重新載入 / 另開視窗」
//   兩者都只操作我們自己的覆蓋層，不碰 iframe 內部。
const IFRAME_LOAD_TIMEOUT_MS = 20000;
let _iframeTimeoutId = null;
let _iframeCurrentUrl = '';

function setIframeStatus(state) {
    const load = document.getElementById('iframe-loading');
    const err = document.getElementById('iframe-error');
    if (load) load.style.display = (state === 'loading') ? 'flex' : 'none';
    if (err) err.style.display = (state === 'error') ? 'flex' : 'none';
}

export function retryCurrentIframe() {
    if (_iframeCurrentUrl) openDynamicIframe(_iframeCurrentUrl, document.getElementById('bc-name')?.innerText || '', null, document.body.classList.contains('fullscreen-mode'));
}
window.retryCurrentIframe = retryCurrentIframe;

export function openCurrentIframeInNewTab() {
    if (_iframeCurrentUrl) window.open(_iframeCurrentUrl, '_blank', 'noopener,noreferrer');
}
window.openCurrentIframeInNewTab = openCurrentIframeInNewTab;

export function openDynamicIframe(url, title, element, isFullscreen = false) {
    if (!url) return;
    navTo('page-iframe', element, title);
    const iframe = document.getElementById('main-iframe');
    iframe.removeAttribute('srcdoc');
    // 螢幕閱讀器可辨識當前載入的是哪個看板。沒有名稱時退回三語的通用字串
    //   （index.html 上刻意沒掛 data-i18n-title，避免切語言把看板名稱洗掉，見該行註解）。
    iframe.setAttribute('title', String(title || t('iframe_content', '看板內容')));

    let finalUrl = normalizeTargetUrl(url);
    if (!finalUrl.startsWith('page-') && !finalUrl.includes('fab=')) {
        finalUrl = finalUrl.includes('?') ? `${finalUrl}&fab=${appState.currentFab}` : `${finalUrl}?fab=${appState.currentFab}`;
    }

    // 🔴 sandbox 一律含 allow-same-origin，**不可**再依 same/cross-origin 分流（2026-08-25 修）
    //   舊行為（MOD_0603 起）：cross-origin 時拿掉 allow-same-origin，理由寫「避免外部頁面透過
    //   parent.document 操作本站 DOM」。**這個威脅模型是錯的** —— 跨來源 iframe 本來就被同源政策
    //   擋在 parent.document 之外，拿掉 allow-same-origin 對該攻擊「零防護增益」，卻會把被嵌入的
    //   頁面丟進 opaque origin（不透明來源），代價是它自己整個壞掉：
    //     ① Windows 整合驗證（Negotiate/NTLM）不再自動帶身分 → 看板顯示「未識別」
    //     ② 它自己的 session cookie 送不出去、收不回來 → 後端 API 一律 401
    //     ③ localStorage / sessionStorage 直接丟 SecurityError
    //   實測就是 UMC 內網看板（如 MSD 需求管控表）在 iframe 內抓不到 Windows 帳號、
    //   表格空白並顯示「無法讀取需求資料」，但同一個 URL 另開分頁完全正常。
    //   ⚠️ 這個 bug 在「儀表板與看板同主機」時會被掩蓋（那時判定為 same-origin、走對的分支），
    //     只有 localhost 開發機或看板部署在別台時才會現形 —— 不要因為正式站看起來好好的就把它改回去。
    //   本設定＝專案初版（026ee47）index.html 上那組固定 sandbox，是已知可運作的組合；
    //   仍保留 sandbox 屬性本身，因為未授予 allow-top-navigation，被嵌入的頁面依然無法劫持整個分頁。
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads');

    // 載入狀態：先顯示 loading，onload 收掉、逾時則顯示失敗卡片。
    //   監聽器每次都重新掛（用 onload/onerror 賦值而非 addEventListener，天然不累積）。
    _iframeCurrentUrl = finalUrl;
    if (_iframeTimeoutId) clearTimeout(_iframeTimeoutId);
    setIframeStatus('loading');
    iframe.onload = () => {
        if (_iframeTimeoutId) clearTimeout(_iframeTimeoutId);
        setIframeStatus('none');
    };
    iframe.onerror = () => {
        if (_iframeTimeoutId) clearTimeout(_iframeTimeoutId);
        setIframeStatus('error');
    };
    _iframeTimeoutId = setTimeout(() => setIframeStatus('error'), IFRAME_LOAD_TIMEOUT_MS);

    iframe.src = finalUrl;
    if (isFullscreen) document.body.classList.add('fullscreen-mode');
    else document.body.classList.remove('fullscreen-mode');
}

// 產生 Icon 的 HTML (共用)

// Expose for HTML inline handlers
window.changeLanguage = changeLanguage;
// 意見箱：導向既有的「需求申請」頁（使用者提交意見/需求，管理員於申請審核管理回覆）
export function openFeedbackPage() {
    selectTopMenu('system_settings');
    // selectTopMenu('system_settings') 會在 50ms 後自動點擊第一個設定項，
    // 故延後切至需求申請頁；側欄有該項（非 admin）時用點擊同步 active 樣式，否則直接 navTo。
    setTimeout(() => {
        const el = document.querySelector('#dynamic-sidebar-menus .menu-item[onclick*="page-apply"]');
        if (el) el.click();
        else navTo('page-apply', null, t('menu_apply', '需求申請'), 'menu_apply');
    }, 120);
}
window.openFeedbackPage = openFeedbackPage;

window.getTopMenuName = getTopMenuName;
window.getMenuPath = getMenuPath;
window.getFullMenuPathStr = getFullMenuPathStr;
window.selectTopMenu = selectTopMenu;
window.activateMenu = activateMenu;
window.goDefaultHome = goDefaultHome;
window.navTo = navTo;
window.openDynamicIframe = openDynamicIframe;

export function openRecentPage() {
    const listEl = document.getElementById('page-recent-list');
    const badgeEl = document.getElementById('recent-count-badge');

    // ⭐️ 加上 viewing-recent class → CSS 直接 display:none 側邊欄，不受 JS 時序影響
    appState.currentActiveTopMenuId = null;
    document.body.classList.add('viewing-recent');
    document.querySelectorAll('.top-menu-link').forEach(el => el.classList.remove('active'));

    if (!listEl) { navTo('page-home'); return; }

    if (!appState.currentUser || !appState.currentUser.empId) {
        listEl.innerHTML = `<div class="col-12"><div class="text-center text-muted py-5"><i class="fas fa-user-slash fa-2x mb-3 opacity-25"></i><div>${window.escapeHTML(t('recent_login_required', '請先登入'))}</div></div></div>`;
        navTo('page-recent', null, t('lbl_recent', '最近瀏覽'));
        return;
    }

    const historyKey = `recent_menus_${appState.currentUser.empId}`;
    let history = [];
    try { history = JSON.parse(localStorage.getItem(historyKey)) || []; } catch(e){}
    if (!Array.isArray(history)) history = [];

    let menus = appState._currentValidMenus;
    if (!Array.isArray(menus) || menus.length === 0) menus = typeof getCustomMenus === 'function' ? getCustomMenus() : [];
    if (!Array.isArray(menus)) menus = [];

    const validHistory = history
        .map(id => menus.find(m => window.cleanId(m.id || m.MenuId) === window.cleanId(id)))
        .filter(Boolean)
        .slice(0, 15);

    if (badgeEl) badgeEl.textContent = validHistory.length > 0 ? t('recent_count_fmt', '{0} 項').replace('{0}', validHistory.length) : '';

    if (validHistory.length === 0) {
        listEl.innerHTML = `
            <div class="col-12">
                <div class="text-center py-5 text-muted">
                    <i class="fas fa-folder-open fa-3x mb-3 opacity-25"></i>
                    <div class="fw-bold">${window.escapeHTML(t('recent_empty_title', '尚無最近瀏覽紀錄'))}</div>
                    <div class="small mt-1">${window.escapeHTML(t('recent_empty_desc', '點擊左側選單進入看板後，即可記錄瀏覽歷程。'))}</div>
                </div>
            </div>`;
    } else {
        listEl.innerHTML = validHistory.map((m, idx) => {
            const mId = m.id || m.MenuId || '';
            const mName = window.escapeHTML(m.displayName || m.DisplayName || m.sysName || m.SysName || t('menu_unnamed', '未命名'));
            const mPath = window.getFullMenuPathStr(mId, menus);

            // 路徑最後一段就是名稱，只顯示前面的父層路徑
            const pathParts = mPath ? mPath.split(' / ') : [];
            const parentPath = pathParts.length > 1 ? pathParts.slice(0, -1).join(' / ') : '';

            const icon = typeof window.resolveIconUrl === 'function' ? window.resolveIconUrl(m.icon || m.Icon) : (m.icon || '');
            const hasImgIcon = icon && (String(icon).startsWith('data:') || String(icon).includes('/'));
            const iconHtml = hasImgIcon
                ? `<img src="${window.escapeHTML(icon)}" alt="" style="width:36px;height:36px;object-fit:contain;" class="rounded-2">`
                : `<div class="rounded-2 d-flex align-items-center justify-content-center" style="width:36px;height:36px;background:rgba(var(--bs-primary-rgb),0.1)"><i class="${window.escapeHTML(icon || 'far fa-file-alt')} text-primary" style="font-size:1rem;"></i></div>`;

            return `
                <div class="col-sm-6 col-md-4 col-xl-3">
                    <a href="#" class="text-decoration-none" onclick="event.preventDefault(); activateMenu('${window._jsArg(mId)}')">
                        <!-- hover 效果改由 CSS 的 .recent-menu-card:hover 處理（原本寫在 inline
                             onmouseenter/onmouseleave，既不利維護、也擋住未來收緊 CSP 的 unsafe-inline） -->
                        <div class="card h-100 border shadow-sm recent-menu-card">
                            <div class="card-body d-flex align-items-start gap-3 p-3">
                                <div class="flex-shrink-0 mt-1">${iconHtml}</div>
                                <div class="overflow-hidden">
                                    <div class="fw-bold text-truncate" style="font-size:.9rem; color: var(--text-main);">${mName}</div>
                                    ${parentPath ? `<div class="text-truncate mt-1" style="font-size:.75rem; color: var(--text-muted);"><i class="fas fa-sitemap opacity-40 me-1"></i>${window.escapeHTML(parentPath)}</div>` : ''}
                                </div>
                            </div>
                        </div>
                    </a>
                </div>`;
        }).join('');
    }

    navTo('page-recent', null, t('lbl_recent', '最近瀏覽'));
}
window.openRecentOffcanvas = openRecentPage; // 保持向下相容
window.openRecentPage = openRecentPage;


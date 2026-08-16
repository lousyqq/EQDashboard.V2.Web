// === render/tables.js - 管理表格渲染 (Fab, Role, Account, Webpage, MenuConfig, Apply, Audit, AppGrid) ===

import { getCustomMenus, getDataTableLang, getFabs, getPersonalSettings, getRequests, getRoles, savePersonalSettings, t } from '../config.js';


import { deleteAccount, editAccount } from '../admin/account-manage.js';
import { deleteFab, editFab } from '../admin/fab-manage.js';
import { deleteMenuNodeItem, deleteWebpageItem, editPersonalMenu, openAddMenuNodeModal, openAddWebpageModal } from '../admin/menu-manage.js';
import { handleDragLeave, handleDragOver, handleDragStart, handleDrop, openAuditModal, withdrawApply } from '../admin/misc-manage.js';
import { deleteRole, editRole } from '../admin/role-manage.js';
import { applyPinnedNewFirst, getDtPageLen, initDataTable, rememberDtPageLen, renderSidebarMenus, safeDestroyDataTable } from './sidebar.js';
import { generateIconHtml } from '../ui/dialogs.js';
import { getFullMenuPathStr } from '../ui/navigation.js';
import { appState } from '../store.js';


// ⚠️ Stored XSS 防護：判斷 URL 是否安全到可以放進 href 或 window.open。
//   escapeHTML 只擋 HTML entity、不擋 URL scheme — `javascript:alert(...)` 通過 escapeHTML 後仍會在點擊時執行。
//   後端 DTO 已加 RegularExpression 把關（http(s)://、/），這裡是 defense-in-depth：
//     - 萬一 DB 內有歷史 dirty data (上線前就存進去的)
//     - 萬一前端從別處取得 URL 沒先過後端
//   一律只放行：http(s)://、/、空字串；其他 (javascript:/data:/vbscript:/file:/...) 轉成 '#' 阻斷。
//   trim/lowercase + 把不可見字元 (\t \n \r \0 空白) 全部去掉再比，避免 `java\tscript:` 之類繞過。
window.safeExternalUrl = function(url) {
    if (!url) return '#';
    const cleaned = String(url).replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
    if (cleaned === '') return '#';
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://') || cleaned.startsWith('/') || cleaned.startsWith('./') || cleaned.startsWith('../') || cleaned.startsWith('page-')) {
        return String(url);
    }
    if (cleaned.startsWith('localhost') || cleaned.startsWith('127.0.0.1') || /^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\.|^192\.168\./.test(cleaned)) {
        return String(url);
    }
    const colonIdx = cleaned.indexOf(':');
    const slashIdx = cleaned.indexOf('/');
    if (colonIdx === -1 || (slashIdx !== -1 && colonIdx > slashIdx)) {
        return String(url);
    }
    return '#';
};
export function renderPersonalMenuManage() {
    try {
        if (typeof $ !== 'undefined' && $.fn && $.fn.DataTable && $.fn.DataTable.isDataTable('#dtPersonalMenu')) {
            rememberDtPageLen('dtPersonalMenu');   // 拖曳/隱藏切換 destroy+rebuild 前先記住筆數
            $('#dtPersonalMenu').DataTable().destroy();
        }

        const tbody = document.getElementById('personalMenuTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!appState.currentUser) return;

        const fabs = getFabs();
        const currentFabObj = fabs.find(f => window.cleanId(f.fabName || f.FabName) === window.cleanId(appState.currentFab));
        if (!currentFabObj) return;

        const roles = getRoles();
        const menusData = getCustomMenus();
        const fabRoleIds = currentFabObj.assignedRoles || currentFabObj.AssignedRoles || [];
        const userRoleIds = appState.currentUser.assignedRoles || appState.currentUser.AssignedRoles || [];
        const isOpenAccess = appState.openAccessMode === true || (window._authConfig && window._authConfig.openAccessMode === true);
        const isAdmin = appState.currentUser && appState.currentUser.roleLevel === 'admin';
        const activeRoleIds = (isAdmin || isOpenAccess) ? fabRoleIds : fabRoleIds.filter(id => userRoleIds.some(uId => window.cleanId(uId) === window.cleanId(id)));

        let initialMenuIds = [];
        activeRoleIds.forEach(roleId => {
            const role = roles.find(r => window.cleanId(r.id || r.RoleId) === window.cleanId(roleId));
            if (role && (role.allowedMenuIds || role.AllowedMenuIds)) {
                initialMenuIds.push(...(role.allowedMenuIds || role.AllowedMenuIds));
            }
        });

        let allowedIds = window.getAllowedIdsWithHierarchy(menusData, initialMenuIds);
        let menus = JSON.parse(JSON.stringify(menusData)).filter(m => allowedIds.has(m.id) && m.enabled !== false);
        
        // 取得有效設定 (包含 pending) 或從 localStorage 取回
        let pSets = (typeof window.getEffectivePersonalSettings === 'function')
            ? window.getEffectivePersonalSettings(appState.currentUser.id)
            : getPersonalSettings(appState.currentUser.id);
            
        // 為了讓「還原預設版面」的順序能和「系統版面」的上方導覽列順序一模一樣，需要算出系統版面的預設排序
        const dedupedInitIds = [...new Set(initialMenuIds.map(id => window.cleanId(id)))];
        
        menus.forEach(m => {
            if (pSets[m.id] && pSets[m.id].order != null) {
                m.order = pSets[m.id].order;
            } else {
                // 若無個人排序，則 fallback 到系統版面的邏輯
                let hasValidParent = menus.some(pNode => pNode.id !== m.id && (window.isParentMatch(m.parentId, pNode) || (m.parentIds || []).some(pid => window.isParentMatch(pid, pNode))));
                if (!hasValidParent) {
                    // Root menu (上方導覽列)：依照角色權限陣列中的出現順序 (dedupedInitIds)
                    const idx = dedupedInitIds.indexOf(window.cleanId(m.id));
                    m.order = idx === -1 ? 9999 : idx;
                } else {
                    // 子選單：依照其掛載父節點時所給予的 parentOrders
                    let defaultChildOrder = m.order || 999;
                    if (m.parentId && m.parentOrders && m.parentOrders[m.parentId] != null) {
                        defaultChildOrder = m.parentOrders[m.parentId];
                    } else if (m.parentIds && m.parentIds.length > 0 && m.parentOrders) {
                        const firstValidParent = m.parentIds.find(pid => menus.some(pNode => window.cleanId(pNode.id) === window.cleanId(pid)));
                        if (firstValidParent && m.parentOrders[firstValidParent] != null) {
                            defaultChildOrder = m.parentOrders[firstValidParent];
                        }
                    }
                    m.order = defaultChildOrder;
                }
            }
        });
        menus.sort((a, b) => a.order - b.order);

        const noDrag = `onmouseenter="this.closest('tr').setAttribute('draggable', false)" onmouseleave="this.closest('tr').setAttribute('draggable', true)"`;

        // 將一個主選單列渲染成完整 TR HTML 字串
        const buildRowHtml = (menu, level, parentId) => {
            const pSet = pSets[menu.id] || {};
            const isHidden = pSet.hidden === true;
            const currentTarget = pSet.target || menu.target || 'iframe';
            const pad = level === 0 ? 'ps-3' : (level === 1 ? 'ps-5' : 'ps-5 ms-3');
            const children = menus.filter(m => m.parentId === menu.id || (m.parentIds && m.parentIds.includes(menu.id)));
            const hasChildren = children.length > 0;
            const isExpanded = appState.expandedPerMenuIds.has(menu.id);
            // ⚠️ ID 進 JS onclick / ondragstart / ondrop 一律 _jsArg()（CLAUDE.md §4-前端-5）
            const menuJsId = window._jsArg(menu.id);
            const parentJsId = window._jsArg(parentId || '');

            const expandBtn = (level === 0 && hasChildren)
                ? `<span ${noDrag}><button type="button" onclick="togglePerMenuRow('${menuJsId}')" class="chevron-btn text-secondary me-2 border-0 bg-transparent"><i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}"></i></button></span>`
                : `<span class="chevron-btn text-muted me-2" style="cursor:default; opacity:0.3; padding:0 10px;"><i class="fas fa-minus"></i></span>`;

            const iconHtml = generateIconHtml(menu.icon, isHidden ? 'text-muted' : 'text-primary', 'me-2 fs-6', menu.menuMode === 'folder');
            const toggleHtml = `<div class="form-check form-switch m-0 d-flex justify-content-center" ${noDrag}><input class="form-check-input cursor-pointer" type="checkbox" onchange="togglePersonalProp('${menuJsId}', 'hidden', !this.checked)" ${!isHidden ? 'checked' : ''} title="顯示/隱藏"></div>`;

            // 開啟方式：folder/有子選單者顯示「-」；leaf 顯示彩色文字（與 TEST_20260429.html:3709 對齊）
            // 實際變更走右側「編輯」按鈕 → 個人選單設定 Modal 內的「開啟偏好」下拉
            const targetTextMap = {
                'iframe': '<span class="text-primary fw-bold small">畫面內嵌</span>',
                'iframe_fullscreen': '<span class="text-purple fw-bold small">內嵌全螢幕</span>',
                'blank': '<span class="text-info fw-bold small">另開新分頁</span>',
                'ie': '<span class="text-info fw-bold small">另開分頁 (IE)</span>',
                'fullscreen': '<span class="text-success fw-bold small">新視窗開啟(全螢幕)</span>',
                'popup': '<span class="text-warning fw-bold small">彈出小視窗</span>'
            };
            const targetSelectHtml = hasChildren
                ? '<span class="text-muted">-</span>'
                : (targetTextMap[currentTarget] || targetTextMap['iframe']);

            const trAttr = `draggable="true" ondragstart="handleDragStart(event, '${menuJsId}', '${parentJsId}')" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${menuJsId}', '${parentJsId}', 'personal')"`;
            const levelMap = { 0: '主選單', 1: '子選單', 2: '次子選單' };

            let dName = menu.displayName || menu.name || '未命名選單';
            if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + menu.id] && !menu.isEdited) {
                dName = i18n[appState.currentLang]['dyn_' + menu.id];
            }
            dName = window.escapeHTML(dName);

            const col1Html = `
                <div class="d-flex align-items-center">
                    <i class="fas fa-grip-vertical text-muted me-2" style="cursor: grab;" title="拖曳排序"></i>
                    ${expandBtn}
                    <div style="width:24px; text-align:center;">${iconHtml}</div>
                    <div class="ms-2 text-start lh-sm">
                        <div class="fw-bold text-dark ${isHidden ? 'text-decoration-line-through text-muted' : ''}">${dName}</div>
                    </div>
                </div>
            `;

            return `<tr ${trAttr} class="draggable-row ${isHidden ? 'opacity-50' : ''}" data-menu-id="${window.escapeHTML(String(menu.id ?? ''))}" data-level="${level}">
                <td class="text-start ${pad} align-middle">${col1Html}</td>
                <td class="align-middle"><span class="badge badge-pill-outline px-3 text-secondary">${levelMap[level]}</span></td>
                <td class="align-middle">${toggleHtml}</td>
                <td class="text-start align-middle">${targetSelectHtml}</td>
                <td class="text-center align-middle" ${noDrag}><button class="action-btn edit btn btn-sm btn-outline-primary" onclick="editPersonalMenu('${menuJsId}')"><i class="fas fa-edit"></i></button></td>
            </tr>`;
        };

        // 取得根層子選單（含遞迴的孫層）的展開 HTML（作為 row.child() 的內容）
        const buildSubtreeHtml = (rootId) => {
            const subRows = [];
            const walkChildren = (parentMenuId, level) => {
                const children = menus.filter(m => m.parentId === parentMenuId || (m.parentIds && m.parentIds.includes(parentMenuId)));
                children.sort((a, b) =>
                    ((a.parentOrders && a.parentOrders[parentMenuId] != null) ? a.parentOrders[parentMenuId] : (a.order || 0)) -
                    ((b.parentOrders && b.parentOrders[parentMenuId] != null) ? b.parentOrders[parentMenuId] : (b.order || 0))
                );
                children.forEach(c => {
                    subRows.push(buildRowHtml(c, level, parentMenuId));
                    walkChildren(c.id, level + 1);
                });
            };
            walkChildren(rootId, 1);
            if (subRows.length === 0) return '';
            return `<table class="table table-sm mb-0 bg-light"><tbody>${subRows.join('')}</tbody></table>`;
        };

        // 1) 先把主選單（level 0）寫入 tbody
        let htmlBuffer = [];
        const rootMenus = menus.filter(m => m.isPoolItem === false && !m.parentId && (!m.parentIds || m.parentIds.length === 0));
        rootMenus.forEach(root => {
            htmlBuffer.push(buildRowHtml(root, 0, ''));
        });
        tbody.innerHTML = htmlBuffer.join('');

        // 同步右上角「儲存變更 / 放棄」按鈕的顯示狀態
        if (typeof window.updatePersonalSaveButton === 'function') window.updatePersonalSaveButton();

        // 2) 初始化 DataTable（分頁筆數只算主選單）
        if (typeof $ === 'undefined' || !$.fn || !$.fn.DataTable) return;
        setTimeout(() => {
            try {
                const dt = $('#dtPersonalMenu').DataTable({
                    language: (typeof getDataTableLang === 'function') ? getDataTableLang() : {},
                    pageLength: getDtPageLen('dtPersonalMenu'), lengthMenu: [10, 25, 50, 100],
                    ordering: false, autoWidth: false, stateSave: false
                });
                appState.dtInstances['dtPersonalMenu'] = dt;

                // 3) 為已展開的主選單附加 child rows
                appState.expandedPerMenuIds.forEach(id => {
                    const tr = tbody.querySelector(`tr[data-menu-id="${id}"][data-level="0"]`);
                    if (!tr) return;
                    const row = dt.row(tr);
                    const html = buildSubtreeHtml(id);
                    if (html) row.child(html, 'personal-sub-row').show();
                });
            } catch (e) { console.error('[dtPersonalMenu] init error', e); }
        }, 50);
    } catch (err) {
        console.error("renderPersonalMenuManage error", err);
    }
}

// 顯示/隱藏：寫 LocalStorage + 自動同步至 DB
// ⚠️ 若此時有 pending 拖曳變更未儲存，這次的 hidden 切換也會合進 pending，
//    避免使用者按下「儲存變更」時 pending 蓋回 localStorage、把剛切的 hidden 洗掉。
window.togglePersonalProp = async function (menuId, prop, value) {
    let pSets = getPersonalSettings(appState.currentUser.id);
    if (!pSets[menuId]) pSets[menuId] = {};
    pSets[menuId][prop] = value;

    // 同步進 pending (若存在)
    if (window._personalPendingDirty && window._personalPendingPSets) {
        if (!window._personalPendingPSets[menuId]) window._personalPendingPSets[menuId] = {};
        window._personalPendingPSets[menuId][prop] = value;
    }

    // ⭐️ H2 修復：偵測 DB 寫入失敗，避免假報成功；失敗則重抓 DB 還原。
    const ok = await savePersonalSettings(appState.currentUser.id, pSets);
    if (!ok) {
        if (typeof window.customAlert === 'function') window.customAlert('儲存個人設定失敗，已還原為伺服器最新狀態');
        if (typeof window.fetchInitialDataFromDB === 'function') await window.fetchInitialDataFromDB();
        if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
        return;
    }
    if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
    if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
};

// 個人模式下變更開啟方式（直接在表格的下拉變動即可）
window.setPersonalTarget = async function (menuId, target) {
    let pSets = getPersonalSettings(appState.currentUser.id);
    if (!pSets[menuId]) pSets[menuId] = {};
    pSets[menuId].target = target;
    // ⭐️ H2 修復：偵測 DB 寫入失敗，避免假報成功；失敗則重抓 DB 還原。
    const ok = await savePersonalSettings(appState.currentUser.id, pSets);
    if (!ok) {
        if (typeof window.customAlert === 'function') window.customAlert('儲存個人設定失敗，已還原為伺服器最新狀態');
        if (typeof window.fetchInitialDataFromDB === 'function') await window.fetchInitialDataFromDB();
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
        return;
    }
    if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
};

// 列展開/收合（對齊舊版 togglePerMenuRow）
window.togglePerMenuRow = function (menuId) {
    if (appState.expandedPerMenuIds.has(menuId)) appState.expandedPerMenuIds.delete(menuId);
    else appState.expandedPerMenuIds.add(menuId);
    appState.isPerAllExpanded = false;
    if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
};

export function renderFabTable() {
    safeDestroyDataTable('dtFab'); const tbody = document.getElementById('fabTableBody'); if (!tbody) return; tbody.innerHTML = '';
    const fabs = getFabs(); const roles = getRoles();
    let htmlBuffer = [];
    fabs.forEach(f => {
        const fId = f.id || f.fabId || f.FabId || ''; const fName = window.escapeHTML(f.fabName || f.FabName || fId);
        const dName = window.escapeHTML(f.displayName || f.DisplayName || fName); const dLang = window.escapeHTML(f.defaultLang || f.DefaultLang || 'zh');
        const aRoles = f.assignedRoles || f.AssignedRoles || [];
        let roleBadges = (aRoles).map(rId => {
            let r = roles.find(x => window.cleanId(x.id || x.roleId || x.RoleId) === window.cleanId(rId));
            let rName = r ? (r.groupName || r.GroupName || rId) : rId;
            return r ? `<span class="badge badge-flat-list me-1">${window.escapeHTML(rName)}</span>` : '';
        }).join('');
        if (!roleBadges) roleBadges = '<span class="text-muted small">未綁定</span>';

        // ⚠️ ID 進 JS onclick 一律 _jsArg()（CLAUDE.md §4-前端-5）：廠區 ID 是管理者自由輸入，
        //   含 `'` 會直接讓 handler 語法錯誤、惡意內容則是注入。
        const fJsId = window._jsArg(fId);
        let actionBtns = `<div class="d-flex flex-nowrap justify-content-center gap-2"><button type="button" class="btn btn-sm btn-outline-primary btn-action-icon" onclick="event.stopPropagation(); editFab('${fJsId}');" title="編輯"><i class="fas fa-edit"></i></button><button type="button" class="btn btn-sm btn-outline-danger btn-action-icon" onclick="event.stopPropagation(); deleteFab('${fJsId}')" title="刪除"><i class="fas fa-trash-alt"></i></button></div>`;
        htmlBuffer.push(`<tr><td class="text-start ps-3 fw-bold align-middle">${fName}</td><td class="align-middle">${dName}</td><td class="align-middle">${dLang === 'en' ? 'English' : (dLang === 'ja' ? '日本語' : '繁體中文')}</td><td class="text-start align-middle">${roleBadges}</td><td class="text-center align-middle" style="white-space: nowrap; width: 1%;">${actionBtns}</td></tr>`);
    });
    tbody.innerHTML = htmlBuffer.join('');
    initDataTable('dtFab');
}

export function renderRoleTable() {
    safeDestroyDataTable('dtRole'); const tbody = document.getElementById('roleTableBody'); if (!tbody) return; tbody.innerHTML = '';
    const roles = getRoles(); const menus = getCustomMenus();
    let htmlBuffer = [];
    roles.forEach(r => {
        let menuBadges = (r.allowedMenuIds || r.AllowedMenuIds || []).map(mId => {
            let m = menus.find(x => window.cleanId(x.id || x.MenuId || x.menuId) === window.cleanId(mId));
            let mName = m ? (m.displayName || m.DisplayName || mId) : mId;
            return m ? `<span class="badge badge-flat-list me-1 mb-1">${window.escapeHTML(mName)}</span>` : '';
        }).join('');
        if (!menuBadges) menuBadges = '<span class="text-muted small">無綁定看板</span>';
        const rId = r.id || r.roleId || r.RoleId || ''; const rName = window.escapeHTML(r.groupName || r.GroupName || rId);
        const rJsId = window._jsArg(rId);
        let actionBtns = `<div class="d-flex flex-nowrap justify-content-center gap-2"><button type="button" class="btn btn-sm btn-outline-primary btn-action-icon" onclick="event.stopPropagation(); editRole('${rJsId}');" title="編輯"><i class="fas fa-edit"></i></button><button type="button" class="btn btn-sm btn-outline-danger btn-action-icon" onclick="event.stopPropagation(); deleteRole('${rJsId}')" title="刪除"><i class="fas fa-trash-alt"></i></button></div>`;
        htmlBuffer.push(`<tr><td class="text-start ps-3 fw-bold text-primary align-middle">${rName}</td><td class="text-start align-middle" style="max-width: 400px; white-space: normal;">${menuBadges}</td><td class="text-center align-middle" style="white-space: nowrap; width: 1%;">${actionBtns}</td></tr>`);
    });
    tbody.innerHTML = htmlBuffer.join('');
    initDataTable('dtRole');
}

// ⚠️ 把 id 內嵌進 inline onclick 字串字面值前的跳脫（見 CLAUDE.md §6.4「反斜線工號」）。
//   Windows 網域工號含反斜線（SARIEL\yu-tinglin），原樣內嵌時 JS parser 會把 `\y` 當無效跳脫吞掉。
//   先做 JS 字串跳脫（\ → \\、' → \'、換行），再做 HTML 屬性跳脫（&/"/</>），順序對應「瀏覽器先 HTML-decode 屬性、再 JS-parse」。
function _jsArg(s) {
    let v = String(s == null ? '' : s)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
    return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 由帳號的 assignedRoles 推算「可視廠區」badge（fabs/roles 為全域表，admin 仍全量載入，O3 不影響）。
function _accFabBadges(assignedRoles) {
    const aRoles = assignedRoles || [];
    const fabs = getFabs();
    const visibleFabs = fabs.filter(f => {
        const fRoles = f.assignedRoles || f.AssignedRoles || [];
        return fRoles.some(fr => aRoles.some(ar => window.cleanId(fr) === window.cleanId(ar)));
    });
    const badges = visibleFabs.map(f => {
        const fName = f.displayName || f.DisplayName || f.fabName || f.FabName || f.id || f.FabId;
        return `<span class="badge badge-flat-list me-1 mb-1">${window.escapeHTML(fName)}</span>`;
    }).join('');
    return badges || '<span class="text-muted small">無可視廠區</span>';
}

// 由帳號的 defaultPages（{廠區:menuId}）渲染「登入預設首頁」欄。
function _accDefaultPagesHtml(defaultPages) {
    const dPages = defaultPages || {};
    const menus = getCustomMenus();
    if (Object.keys(dPages).length === 0) return '<span class="text-muted small">未設定 (自動抓取第一個)</span>';
    let html = '';
    for (let fab in dPages) {
        const m = menus.find(x => window.cleanId(x.id || x.MenuId) === window.cleanId(dPages[fab]));
        const pathStr = m ? getFullMenuPathStr(m.id || m.MenuId, menus) : '找不到看板';
        html += `<div class="small mb-1"><span class="badge bg-secondary me-1" style="width:40px;">${window.escapeHTML(fab)}</span><span class="text-success fw-bold">${window.escapeHTML(pathStr)}</span></div>`;
    }
    return html;
}

// 由帳號的 roleLevel、canEditOthers 與 manageableMenus 推算「管理層級與狀態」HTML。
function _accRoleAndStatusHtml(roleLevel, canEditOthers, manageableMenus) {
    const isAdm = String(roleLevel || '').toLowerCase() === 'admin';
    if (isAdm) {
        return `<div class="d-inline-block"><span class="badge bg-danger px-2 py-1 shadow-sm" style="font-size: 0.82rem;"><i class="fas fa-crown me-1 text-warning"></i>全域管理員 (Admin)</span></div>`;
    }
    const mIds = manageableMenus || [];
    const hasDelegation = mIds.length > 0 || (canEditOthers === true);
    if (!hasDelegation) {
        return `<div class="d-inline-block"><span class="badge bg-secondary px-2 py-1" style="font-size: 0.8rem;"><i class="fas fa-user me-1"></i>一般使用者</span></div>`;
    }
    if (canEditOthers === true) {
        return `<div class="d-flex flex-column align-items-center gap-1">
            <span class="badge bg-primary px-2 py-1 shadow-sm" style="font-size: 0.78rem;"><i class="fas fa-user-check me-1"></i>委派管理員</span>
            <span class="badge bg-info text-dark border px-2 py-1 shadow-sm" style="font-size: 0.72rem;" title="允許變更他人建立的內容"><i class="fas fa-user-cog me-1"></i>含變更他人權限</span>
        </div>`;
    } else {
        return `<div class="d-flex flex-column align-items-center gap-1">
            <span class="badge bg-primary px-2 py-1 shadow-sm" style="font-size: 0.78rem;"><i class="fas fa-user-check me-1"></i>委派管理員</span>
            <span class="badge bg-light text-secondary border px-2 py-1" style="font-size: 0.72rem;" title="僅允許編輯自己建立的內容"><i class="fas fa-lock me-1"></i>限改自己建立</span>
        </div>`;
    }
}

// 由帳號的 assignedRoles 與 manageableMenus 推算「可視與管轄範圍」HTML。
function _accScopeAndManagedHtml(assignedRoles, manageableMenus, roleLevel) {
    const isAdm = String(roleLevel || '').toLowerCase() === 'admin';
    const fabBadges = _accFabBadges(assignedRoles || []);
    
    let managedHtml = '';
    if (isAdm) {
        managedHtml = '<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 px-2 py-1 mt-1 d-inline-block"><i class="fas fa-check-double me-1"></i>全廠區/全系統所有選單</span>';
    } else {
        const mIds = manageableMenus || [];
        if (mIds.length === 0) {
            managedHtml = '<span class="text-muted small mt-1 d-inline-block">— (無特定委派目錄)</span>';
        } else {
            const menus = getCustomMenus();
            const badges = mIds.map(id => {
                const m = menus.find(x => window.cleanId(x.id || x.MenuId) === window.cleanId(id));
                const displayName = m ? (m.displayName || m.DisplayName || m.name || m.SysName || id) : id;
                return `<span class="badge bg-light text-dark border me-1 mb-1 px-2 py-1"><i class="fas fa-folder me-1 text-warning"></i>${window.escapeHTML(displayName)}</span>`;
            }).join('');
            managedHtml = `<div class="mt-1" style="white-space: normal;">${badges}</div>`;
        }
    }

    return `<div class="text-start py-1">
        <div class="mb-1 d-flex align-items-baseline flex-wrap gap-1">
            <span class="badge bg-secondary bg-opacity-10 text-secondary border px-1" style="font-size:0.7rem;"><i class="fas fa-eye me-1"></i>可視</span>
            <div class="d-inline-block" style="white-space: normal;">${fabBadges}</div>
        </div>
        <div class="d-flex align-items-baseline flex-wrap gap-1 border-top pt-1 mt-1">
            <span class="badge bg-warning bg-opacity-10 text-dark border px-1" style="font-size:0.7rem;"><i class="fas fa-tasks me-1"></i>管轄</span>
            <div class="d-inline-block" style="white-space: normal;">${managedHtml}</div>
        </div>
    </div>`;
}

// 把一筆 /api/Accounts 列轉成 DataTable 的一列陣列（對齊 index.html 6 欄 thead：方案 A 旗艦優化）。
function _accRowData(a) {
    const aId = a.empId || a.EmpId || '';
    const aName = window.escapeHTML(a.name || a.Name || '');
    // 部門可能為 null（AuthController 自動建帳查不到部門時刻意留 null，不再塞角色名稱）→
    // 用三語齊備的 dept_unknown 明示「未設定」，避免只是留一格空白讓人以為是渲染失敗。
    const aDeptRaw = a.department || a.Department || '';
    const aDept = aDeptRaw
        ? window.escapeHTML(aDeptRaw)
        : `<span class="fst-italic opacity-75">${window.escapeHTML(t('dept_unknown', '未設定部門'))}</span>`;
    const aLevel = a.roleLevel || a.RoleLevel || '';
    const defPagesHtml = _accDefaultPagesHtml(a.defaultPages || a.DefaultPages || {});
    const roleStatusHtml = _accRoleAndStatusHtml(aLevel, a.canEditOthers || a.CanEditOthers, a.manageableMenus || a.MapAccountManageMenus);
    const scopeManagedHtml = _accScopeAndManagedHtml(a.assignedRoles || a.AssignedRoles, a.manageableMenus || a.MapAccountManageMenus, aLevel);
    const jsId = _jsArg(aId);
    const idCell = window.escapeHTML(aId);
    const actionBtns = `<div class="d-flex flex-nowrap justify-content-center gap-2"><button type="button" class="btn btn-sm btn-outline-primary btn-action-icon" onclick="event.stopPropagation(); editAccount('${jsId}');" title="編輯"><i class="fas fa-edit"></i></button><button type="button" class="btn btn-sm btn-outline-danger btn-action-icon" onclick="event.stopPropagation(); deleteAccount('${jsId}')" title="刪除"><i class="fas fa-trash-alt"></i></button></div>`;
    return [
        `<span class="fw-bold">${idCell}</span>`,
        `<div class="fw-bold text-dark">${aName}</div><div class="small text-muted">${aDept}</div>`,
        roleStatusHtml,
        defPagesHtml,
        scopeManagedHtml,
        actionBtns
    ];
}

// 記住建立 serverSide DataTable 時用的語言；語言切換時須重建才能換掉 DataTable 自身 chrome 文字。
let _accTableLang = null;

// 帳號管理表（serverSide DataTable）。
//   O3 重構後 getAccounts()（appState.accounts）只回呼叫者自己一列，故清單一律走 server-side 分頁端點
//   GET /api/Accounts?page=&pageSize=&q=（admin-only），不可再用 getAccounts() 在前端組整表。
export function renderAccountTable() {
    const tbody = document.getElementById('accTableBody');
    if (!tbody) return;

    // 帳號管理為 admin-only：非 admin 不初始化 serverSide DataTable（否則會對 /api/Accounts 連發 403）。
    const isAdmin = !!(appState.currentUser && String(appState.currentUser.roleLevel || '').toLowerCase() === 'admin');
    if (!isAdmin) {
        try { if (typeof $ !== 'undefined' && $.fn && $.fn.DataTable && $.fn.DataTable.isDataTable('#dtAccount')) $('#dtAccount').DataTable().destroy(); } catch (e) { }
        tbody.innerHTML = '';
        _accTableLang = null;
        return;
    }

    const curLang = appState.currentLang || null;
    const exists = (typeof $ !== 'undefined' && $.fn && $.fn.DataTable && $.fn.DataTable.isDataTable('#dtAccount'));

    // 已存在且語言未變 → 僅重新抓取（保留當前分頁/搜尋字串），不重建。
    if (exists && _accTableLang === curLang) {
        try { $('#dtAccount').DataTable().ajax.reload(null, false); return; } catch (e) { }
    }
    // 語言已變 → 摧毀重建以套用新的 DataTable chrome 文字（重建前先記住筆數，避免換語言後跳回預設 10）。
    if (exists) { try { rememberDtPageLen('dtAccount'); $('#dtAccount').DataTable().destroy(); } catch (e) { } }

    setTimeout(() => {
        try {
            if (typeof $ === 'undefined' || !$.fn || !$.fn.DataTable) return;
            if ($.fn.DataTable.isDataTable('#dtAccount')) {
                try { $('#dtAccount').DataTable().ajax.reload(null, false); return; } catch (e) { }
            }
            const dt = $('#dtAccount').DataTable({
                language: (typeof getDataTableLang === 'function') ? getDataTableLang() : {},
                serverSide: true,
                processing: true,
                searching: true,
                pageLength: getDtPageLen('dtAccount'), lengthMenu: [10, 25, 50, 100],
                ordering: false, order: [], autoWidth: false, stateSave: false,
                columns: [{ data: 0 }, { data: 1 }, { data: 2 }, { data: 3 }, { data: 4 }, { data: 5 }],
                columnDefs: [
                    { targets: 5, className: 'text-center align-middle', width: '90px' },
                    { targets: 2, className: 'text-center align-middle', width: '150px' },
                    { targets: [3, 4], className: 'text-start align-middle' },
                    { targets: [0, 1], className: 'align-middle' }
                ],
                ajax: function (data, callback) {
                    const pageSize = data.length > 0 ? data.length : 10;
                    const page = Math.floor((data.start || 0) / pageSize) + 1;
                    const q = (data.search && data.search.value) ? data.search.value : '';
                    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
                    if (q) params.set('q', q);
                    fetch('/api/Accounts?' + params.toString(), { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                        .then(r => r.ok ? r.json() : Promise.reject(r.status))
                        .then(json => {
                            const items = (json && json.items) ? json.items : [];
                            const rows = items.map(a => _accRowData(a));
                            const total = (json && typeof json.total === 'number') ? json.total : 0;
                            callback({ draw: data.draw, recordsTotal: total, recordsFiltered: total, data: rows });
                        })
                        .catch(err => {
                            console.error('[renderAccountTable] 載入帳號清單失敗:', err);
                            callback({ draw: data.draw, recordsTotal: 0, recordsFiltered: 0, data: [] });
                        });
                }
            });
            appState.dtInstances['dtAccount'] = dt;
            _accTableLang = curLang;
        } catch (e) { console.error('[renderAccountTable] 初始化失敗:', e); }
    }, 50);
}

export function renderWebpageTable() {
    safeDestroyDataTable('dtWebpage'); const tbody = document.getElementById('webpageTableBody'); if (!tbody) return; tbody.innerHTML = '';
    // 對齊 TEST_20260429.html:3800 — 只列出「池中項目 (isPoolItem === true)」，依 order 排序
    let menus = getCustomMenus()
        .filter(m => String(m.isPoolItem || m.IsPoolItem).toLowerCase() === 'true')
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    // 剛新增的看板置頂（整頁重整後才回歸 order 排序）
    menus = applyPinnedNewFirst('dtWebpage', menus);
    let htmlBuffer = [];
    menus.forEach(m => {
        const perms = window.getMenuPermissions(m.id || m.MenuId, m.createdBy || m.CreatedBy);
        if (!perms.canView) return;
        const mEnabled = m.enabled !== undefined ? m.enabled : (m.IsEnabled !== undefined ? m.IsEnabled : true);
        const mMode = m.menuMode || m.MenuMode; const mTarget = m.target || m.OpenTarget;
        // ⚠️ 外部網址與內部頁面必須分開，不可用 `url || targetPage` 併成一個值：
        //    內部頁面（url 為空、targetPage = 'page-xxx'）不是可導覽的 URL，
        //    渲染成 <a href="page-ze-content"> 會開新分頁到 /page-ze-content → 404 空白頁。
        //    分流依據與 navigation.js 的 activateMenu 一致：有 url 走外部，否則看 targetPage。
        const mExtUrl = m.url || m.Url || '';
        const mIntPage = m.targetPage || m.TargetPage || '';
        const mIcon = m.icon || m.Icon; const mId = m.id || m.MenuId;
        const mDName = window.escapeHTML(m.displayName || m.DisplayName); const mSysName = window.escapeHTML(m.name || m.SysName);

        // 狀態欄改為可即時切換的開關（同 選單配置管理）；啟用顯示在側邊欄/上方導覽，停用則隱藏
        const canToggle = perms.canEdit; // 沒編輯權限者不能切換
        let statusBadge = canToggle
            ? `<div class="form-check form-switch d-flex justify-content-center m-0">
                   <input class="form-check-input cursor-pointer" type="checkbox" ${mEnabled ? 'checked' : ''}
                          onchange="window.toggleMenuEnable('${mId}', this.checked)" title="啟用 / 停用">
               </div>`
            : (mEnabled ? '<span class="badge bg-success">啟用</span>' : '<span class="badge bg-secondary">停用</span>');
        let typeBadge = mMode === 'app_grid'
            ? '<span class="badge bg-info text-dark border"><i class="fas fa-th-large"></i> 應用集合</span>'
            : '<span class="badge bg-light text-dark border"><i class="fas fa-link"></i> 網頁連結</span>';

        // 開啟模式（第一行）
        const targetMap = {
            'iframe': '<span class="text-secondary fw-bold small"><i class="fas fa-columns me-1"></i> 畫面內嵌</span>',
            'iframe_fullscreen': '<span class="fw-bold small text-purple"><i class="fas fa-tv me-1"></i> 內嵌全螢幕</span>',
            'blank': '<span class="text-primary fw-bold small"><i class="fas fa-external-link-alt me-1"></i> 另開新分頁</span>',
            'ie': '<span class="text-info fw-bold small"><i class="fab fa-internet-explorer me-1"></i> 另開分頁 (IE)</span>',
            'fullscreen': '<span class="text-success fw-bold small"><i class="fas fa-expand me-1"></i> 新視窗開啟(全螢幕)</span>',
            'popup': '<span class="text-warning fw-bold small"><i class="fas fa-window-restore me-1"></i> 彈出小視窗</span>'
        };
        const targetHtml = mMode === 'app_grid' ? '<span class="text-muted small">-</span>' : (targetMap[mTarget] || targetMap['iframe']);

        // 網址（第二行，完整顯示、會自動換行；word-break 避免長網址撐破版面）
        // ⚠️ href 必須先過 safeExternalUrl，否則 `javascript:` 等 payload 通過 escapeHTML 後仍可點擊執行 (Stored XSS)
        const safeUrlForHref = window.safeExternalUrl(mExtUrl);
        const safeUrl = window.escapeHTML(mExtUrl);  // 顯示文字仍用 escapeHTML
        let urlHtml;
        if (mMode === 'app_grid') {
            urlHtml = '<span class="text-success fw-bold small">內部應用集合區</span>';
        } else if (mExtUrl) {
            urlHtml = `<a href="${window.escapeHTML(safeUrlForHref)}" target="_blank" rel="noopener noreferrer" class="small text-decoration-none" style="word-break:break-all;"><i class="fas fa-info-circle text-secondary me-1"></i>${safeUrl}</a>`;
        } else if (mIntPage) {
            // 內部頁面：只顯示不可點的識別碼（點了也沒有對應路由）
            urlHtml = `<span class="text-muted small" style="word-break:break-all;"><i class="fas fa-file-code text-secondary me-1"></i>${window.escapeHTML(mIntPage)}</span>`;
        } else {
            urlHtml = '<span class="text-muted small">無設定路徑</span>';
        }

        const pathCellHtml = `
            <div class="d-flex flex-column align-items-start gap-1">
                <div>${targetHtml}</div>
                <div class="text-start" style="word-break:break-all;">${urlHtml}</div>
            </div>
        `;

        let iconHtml = typeof generateIconHtml === 'function' ? generateIconHtml(mIcon, 'text-primary', 'me-2') : '';

        // 按鈕依權限顯示：admin / 自己建立 一律 OK；委派 user 需 canEditOthers
        // ⚠️ 看板 ID 進 onclick / ondragstart / ondrop 一律 _jsArg()（CLAUDE.md §4-前端-5）
        const mJsId = window._jsArg(mId);
        let btnsHtml = '';
        if (perms.canEdit) {
            btnsHtml += `<button type="button" class="btn btn-sm btn-outline-primary btn-action-icon" onclick="event.stopPropagation(); openAddWebpageModal('${mJsId}');" title="編輯"><i class="fas fa-edit"></i></button>`;
        }
        if (perms.canDelete) {
            btnsHtml += `<button type="button" class="btn btn-sm btn-outline-danger btn-action-icon" onclick="event.stopPropagation(); deleteWebpageItem('${mJsId}')" title="刪除"><i class="fas fa-trash-alt"></i></button>`;
        }
        if (!btnsHtml) btnsHtml = '<span class="badge bg-light text-muted border">僅檢視</span>';
        let actionBtns = `<div class="d-flex flex-nowrap justify-content-center gap-2">${btnsHtml}</div>`;

        htmlBuffer.push(`<tr class="draggable-row" draggable="true" ondragstart="handleDragStart(event, '${mJsId}', null)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${mJsId}', null, 'webpage')"><td class="text-start ps-3 fw-bold text-dark align-middle"><i class="fas fa-grip-vertical text-muted me-2 opacity-50"></i>${iconHtml} ${mDName} <br><small class="text-muted fw-normal ms-4">${mSysName}</small></td><td class="align-middle">${typeBadge}</td><td class="align-middle">${statusBadge}</td><td class="text-start align-middle">${pathCellHtml}</td><td class="text-center align-middle" style="white-space: nowrap; width: 1%; vertical-align: middle;">${actionBtns}</td></tr>`);
    });
    tbody.innerHTML = htmlBuffer.join('');
    initDataTable('dtWebpage', true);
}

export function renderMenuConfigTable() {
    safeDestroyDataTable('dtMenuConfig'); const tbody = document.getElementById('menuConfigTableBody'); if (!tbody) return; tbody.innerHTML = '';
    const menus = getCustomMenus();
    let roots = menus.filter(m => {
        if (String(m.isPoolItem || m.IsPoolItem).toLowerCase() === 'true') return false;
        let hasValidParent = menus.some(pNode => pNode.id !== m.id && (window.isParentMatch(m.parentId || m.ParentMenuId, pNode) || (m.parentIds || []).some(pid => window.isParentMatch(pid, pNode))));
        return !hasValidParent;
    });
    // ⭐️ 依 getMenuPermissions().canView 過濾：admin 看全部；user 只能看自己建立 / 委派目錄 / 委派目錄的祖先
    roots = roots.filter(m => {
        const perms = window.getMenuPermissions(m.id || m.MenuId, m.createdBy || m.CreatedBy);
        return perms && perms.canView;
    });
    roots.sort((a, b) => (a.order || a.GlobalOrder || a.SortOrder || 0) - (b.order || b.GlobalOrder || b.SortOrder || 0));
    // 剛新增的主選單配置置頂（整頁重整後才回歸 order 排序）
    roots = applyPinnedNewFirst('dtMenuConfig', roots);

    // ⭐️ 遞迴取得所有子孫節點的膠囊 UI (加入 visited 防止無窮迴圈崩潰！)
    function getDescendantBadges(parentId, allMenus, visited = new Set()) {
        if (visited.has(parentId)) return '';
        visited.add(parentId);

        let badges = '';
        // ⭐️ 修正處：將最後面的 { id parentId } 補上冒號變成 { id: parentId }
        let children = allMenus.filter(x => x.id !== parentId && (window.isParentMatch(x.parentId, { id: parentId }) || (x.parentIds || []).some(pid => window.isParentMatch(pid, { id: parentId }))));
        children.sort((a, b) => (a.parentOrders?.[parentId] ?? a.order ?? 0) - (b.parentOrders?.[parentId] ?? b.order ?? 0));

        children.forEach(child => {
            let isFolder = child.menuMode === 'folder';
            let icon = isFolder ? '<i class="fas fa-folder text-warning me-1"></i>' : '';
            badges += `<span class="badge border border-secondary text-dark bg-white shadow-sm me-1 mb-1 fw-normal px-2 py-1">${icon}${window.escapeHTML(child.displayName)}</span>`;
            if (isFolder) {
                badges += getDescendantBadges(child.id, allMenus, visited);
            }
        });
        return badges;
    }

    let htmlBuffer = [];
    roots.forEach(m => {
        // ⭐️ 狀態開關互動功能：移除 disabled 並綁定 onchange 事件
        let statusSwitch = `<div class="form-check form-switch d-flex justify-content-center"><input class="form-check-input cursor-pointer" type="checkbox" ${m.enabled ? 'checked' : ''} onchange="window.toggleMenuEnable('${m.id}', this.checked)"></div>`;
        let typeBadge = m.menuMode === 'folder' ? '<span class="badge bg-warning text-dark border"><i class="fas fa-folder me-1"></i>主選單</span>' : (m.menuMode === 'app_grid' ? '<span class="badge bg-success text-white border"><i class="fas fa-th-large me-1"></i>應用集合</span>' : '<span class="badge border border-primary text-primary bg-white"><i class="fas fa-link me-1"></i>獨立網頁</span>');

        const tMap = {
            'iframe': '<span class="text-secondary fw-bold small"><i class="fas fa-columns me-1"></i> 內部嵌入</span>',
            'iframe_fullscreen': '<span class="fw-bold small text-purple"><i class="fas fa-tv me-1"></i> 內嵌全螢幕</span>',
            'blank': '<span class="text-primary fw-bold small"><i class="fas fa-external-link-alt me-1"></i> 另開分頁</span>',
            'ie': '<span class="text-info fw-bold small"><i class="fab fa-internet-explorer me-1"></i> 另開分頁 (IE)</span>',
            'fullscreen': '<span class="text-success fw-bold small"><i class="fas fa-expand me-1"></i> 新視窗開啟(全螢幕)</span>',
            'popup': '<span class="text-warning fw-bold small"><i class="fas fa-window-restore me-1"></i> 彈出小視窗</span>'
        };
        const currentT = m.target || m.Target || m.openTarget || 'iframe';
        let targetBadge = (m.menuMode === 'folder' || m.menuMode === 'app_grid') ? '<span class="text-muted small">-</span>' : (tMap[currentT] || tMap['iframe']);

        let contentTxt = '';
        if (m.menuMode === 'folder') {
            contentTxt = getDescendantBadges(m.id, menus);
            if (!contentTxt) contentTxt = '<span class="text-muted small">無內容</span>';
        } else if (m.menuMode === 'app_grid') {
            contentTxt = `<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 me-1"><i class="fas fa-th-large me-1"></i>內部應用集合區</span>`;
        } else {
            contentTxt = `<span class="text-muted small"><i class="fas fa-link me-1"></i>${window.escapeHTML(m.url || m.targetPage)}</span>`;
        }

        const perms = window.getMenuPermissions(m.id || m.MenuId, m.createdBy || m.CreatedBy);
        const nodeJsId = window._jsArg(m.id);   // ⚠️ ID 進 JS onclick 一律 _jsArg()（CLAUDE.md §4-前端-5）
        let actionBtnsHtml = '';
        // 編輯：可編輯 或 可管理結構（後者讓被委派的祖先可以調整內部組合）
        if (perms.canEdit || perms.canManageStructure) {
            actionBtnsHtml += `<button type="button" class="btn btn-sm btn-outline-primary shadow-sm btn-action-icon" onclick="event.stopPropagation(); openAddMenuNodeModal('${nodeJsId}');" title="編輯"><i class="fas fa-edit"></i></button>`;
        }
        // 刪除：必須擁有 canDelete (admin / 自己 / 委派且 canEditOthers)
        if (perms.canDelete) {
            actionBtnsHtml += `<button type="button" class="btn btn-sm btn-outline-danger shadow-sm btn-action-icon" onclick="event.stopPropagation(); deleteMenuNodeItem('${nodeJsId}')" title="刪除"><i class="fas fa-trash-alt"></i></button>`;
        }
        if (!actionBtnsHtml) actionBtnsHtml = '<span class="badge bg-light text-muted border">僅檢視</span>';
        let actionBtns = `<div class="d-flex flex-nowrap justify-content-center gap-2">${actionBtnsHtml}</div>`;

        // 此頁面的拖曳已停用：上方導覽列順序由「權限管理」拖曳允許看板組合決定，
        //  選單配置管理不再透過拖曳改變全域順序（避免管理頁的暫時排序影響其他人）
        let sysNameHtml = `
            <div class="d-flex align-items-center">
                <i class="fas fa-grip-vertical text-muted me-3" style="cursor: grab;" title="拖曳排序"></i>
                <div>
                    <div class="fw-bold text-dark fs-6">${window.escapeHTML(m.displayName)}</div>
                    <div class="text-muted small">${window.escapeHTML(m.name)}</div>
                </div>
            </div>`;

        htmlBuffer.push(`
            <tr class="draggable-row" draggable="true" ondragstart="handleDragStart(event, '${m.id}', null)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${m.id}', null, 'system')">
                <td class="text-start ps-3 align-middle">${sysNameHtml}</td>
                <td class="align-middle">${typeBadge}</td>
                <td class="align-middle">${statusSwitch}</td>
                <td class="text-start align-middle" style="max-width: 400px; white-space: normal;">
                    <div class="d-flex flex-column align-items-start gap-1">
                        <div>${targetBadge}</div>
                        <div class="text-start" style="word-break:break-all;">${contentTxt}</div>
                    </div>
                </td>
                <td class="text-center align-middle" style="white-space: nowrap; width: 1%;">${actionBtns}</td>
            </tr>`);
    });
    tbody.innerHTML = htmlBuffer.join('');
    // 初始化 DataTables
    initDataTable('dtMenuConfig', true);
}

export function renderApplyTable() {
    safeDestroyDataTable('dtApply'); const tbody = document.getElementById('applyTableBody');
    if (!tbody || !appState.currentUser) return; tbody.innerHTML = '';
    const reqs = getRequests().filter(r => (r.empId || r.EmpId) === appState.currentUser.id).sort((a, b) => (b.timestamp || b.Timestamp) - (a.timestamp || a.Timestamp));
    const statusMap = { 'pending': '<span class="badge bg-secondary">待審核</span>', 'processing': '<span class="badge bg-primary">處理中</span>', 'resolved': '<span class="badge bg-success">已完成</span>', 'rejected': '<span class="badge bg-danger">已駁回</span>', 'withdrawn': '<span class="badge bg-dark">已撤回</span>' };

    let htmlBuffer = [];
    reqs.forEach(r => {
        let dateStr = r.timestamp || r.Timestamp;
        let d = new Date(dateStr);
        if (typeof dateStr === 'string' && /^\d+$/.test(dateStr)) { d = new Date(parseInt(dateStr, 10)); }
        if (!isNaN(d.getTime())) {
            let pad = (n) => n < 10 ? '0' + n : n;
            dateStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        }
        const typeBadge = `<span class="badge border border-secondary text-secondary bg-light mb-1">${window.escapeHTML(r.reqType || r.ReqType || '系統需求')}</span>`;
        const replyTxt = r.reply || r.Reply;
        const replyMsg = replyTxt ? `<div class="small text-primary fw-bold text-truncate" style="max-width: 250px;" title="${window.escapeHTML(replyTxt)}"><i class="fas fa-comment-dots me-1"></i>${window.escapeHTML(replyTxt)}</div>` : '<span class="text-muted small"><i class="fas fa-hourglass-half me-1"></i>等待管理員處理中...</span>';

        const rStatus = r.status || r.Status || 'pending'; const rId = r.id || r.RequestId || r.Id;
        const reqJsId = window._jsArg(rId);   // ⚠️ ID 進 JS onclick 一律 _jsArg()（CLAUDE.md §4-前端-5）
        let actionBtnsHtml = '';
        if (rStatus === 'withdrawn') actionBtnsHtml = `<button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 fw-bold text-nowrap" onclick="event.stopPropagation(); deleteApplyItem('${reqJsId}')"><i class="fas fa-trash-alt me-1"></i> 刪除紀錄</button>`;
        else if (rStatus === 'pending' || !rStatus) actionBtnsHtml = `<button type="button" class="btn btn-sm btn-outline-warning text-dark py-0 px-2 fw-bold text-nowrap" onclick="event.stopPropagation(); withdrawApply('${reqJsId}');"><i class="fas fa-undo me-1"></i> 撤回</button>`;
        else actionBtnsHtml = `<span class="badge bg-light text-muted border">審核中/已鎖定</span>`;

        let actionBtns = `<div class="d-flex flex-nowrap justify-content-center gap-2">${actionBtnsHtml}</div>`;
        let wdInfo = rStatus === 'withdrawn' ? `<div class="text-danger mt-1 small fw-bold"><i class="fas fa-info-circle"></i> 撤回原因: ${window.escapeHTML(r.withdrawReason || r.WithdrawReason)}</div>` : '';

        htmlBuffer.push(`<tr><td class="small text-muted align-middle">${dateStr}</td><td class="align-middle">${typeBadge}<br><span class="fw-bold small text-dark">${window.escapeHTML(r.fab || r.FabId || '全域 (Global)')}</span></td><td class="align-middle text-start"><div class="fw-bold text-dark" style="white-space: pre-wrap; font-size:0.85rem;">${window.escapeHTML(r.reason || r.Reason)}</div>${wdInfo}</td><td class="align-middle">${statusMap[rStatus]}</td><td class="align-middle text-start">${replyMsg}</td><td class="text-center align-middle" onmouseenter="this.closest('tr').setAttribute('draggable', false)" onmouseleave="this.closest('tr').setAttribute('draggable', true)" style="white-space: nowrap; width: 1%;">${actionBtns}</td></tr>`);
    });
    tbody.innerHTML = htmlBuffer.join('');
    initDataTable('dtApply', true);
}

export function renderAuditTable() {
    safeDestroyDataTable('dtAudit'); const tbody = document.getElementById('auditTableBody'); if (!tbody) return; tbody.innerHTML = '';
    const reqs = getRequests().sort((a, b) => (b.timestamp || b.Timestamp) - (a.timestamp || a.Timestamp));
    const statusMap = { 'pending': '<span class="badge bg-secondary">待審核</span>', 'processing': '<span class="badge bg-primary">處理中</span>', 'resolved': '<span class="badge bg-success">已完成</span>', 'rejected': '<span class="badge bg-danger">已駁回</span>', 'withdrawn': '<span class="badge bg-dark">已撤回</span>' };

    let htmlBuffer = [];
    reqs.forEach(r => {
        let dateStr = r.timestamp || r.Timestamp;
        let d = new Date(dateStr);
        if (typeof dateStr === 'string' && /^\d+$/.test(dateStr)) { d = new Date(parseInt(dateStr, 10)); }
        if (!isNaN(d.getTime())) {
            let pad = (n) => n < 10 ? '0' + n : n;
            dateStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        }
        const typeBadge = `<span class="badge border border-secondary text-secondary bg-light mb-1">${window.escapeHTML(r.reqType || r.ReqType || '系統需求')}</span>`;
        const rStatus = r.status || r.Status || 'pending';
        let wdInfo = rStatus === 'withdrawn' ? `<div class="text-danger mt-1 small fw-bold"><i class="fas fa-info-circle"></i> 撤回原因: ${window.escapeHTML(r.withdrawReason || r.WithdrawReason)}</div>` : '';
        const replyTxt = r.reply || r.Reply;
        const replyMsg = replyTxt ? `<div class="small text-primary fw-bold text-truncate" style="max-width: 200px;" title="${window.escapeHTML(replyTxt)}"><i class="fas fa-comment-dots me-1"></i>${window.escapeHTML(replyTxt)}</div>` : '<span class="text-muted small">尚未回覆</span>';
        const rId = r.id || r.RequestId || r.Id;
        const auditJsId = window._jsArg(rId);   // ⚠️ ID 進 JS onclick 一律 _jsArg()（CLAUDE.md §4-前端-5）

        let actionBtns = `<div class="d-flex flex-nowrap justify-content-center gap-2"><button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 fw-bold text-nowrap" onclick="event.stopPropagation(); openAuditModal('${auditJsId}');"><i class="fas fa-reply me-1"></i>回覆</button></div>`;
        htmlBuffer.push(`<tr><td class="align-middle"><div class="fw-bold text-dark">${window.escapeHTML(r.empName || r.EmpName)}</div><div class="small text-muted fw-normal">${window.escapeHTML(r.empId || r.EmpId)}</div></td><td class="small text-muted align-middle">${dateStr}</td><td class="align-middle">${typeBadge}<br><span class="fw-bold small text-dark">${window.escapeHTML(r.fab || r.FabId || '全域')}</span></td><td class="align-middle text-start" style="max-width: 250px;"><div class="text-truncate text-dark fw-bold" title="${window.escapeHTML(r.reason || r.Reason)}">${window.escapeHTML(r.reason || r.Reason)}</div>${wdInfo}</td><td class="align-middle">${statusMap[rStatus]}</td><td class="align-middle text-start">${replyMsg}</td><td class="text-center align-middle" onmouseenter="this.closest('tr').setAttribute('draggable', false)" onmouseleave="this.closest('tr').setAttribute('draggable', true)" style="white-space: nowrap; width: 1%;">${actionBtns}</td></tr>`);
    });
    tbody.innerHTML = htmlBuffer.join('');
    initDataTable('dtAudit', true);
}

export function renderAppGrid(containerId, appList) {
    const container = document.getElementById(containerId); if (!container) return; let html = '';
    const canManage = (typeof window.canManageCurrentAppGrid === 'function')
        ? window.canManageCurrentAppGrid()
        : (appState.currentUser && String(appState.currentUser.roleLevel || '').toLowerCase() === 'admin');

    appList.forEach(app => {
        const aName = window.escapeHTML(app.name || app.AppName);
        const aUrl = window.escapeHTML(app.url || app.Url);
        const rawIcon = app.iconBase64 || app.IconBase64;
        const cleanIcon = typeof window.resolveIconUrl === 'function' ? window.resolveIconUrl(rawIcon) : rawIcon;
        let imgHtml = cleanIcon ? `<img src="${window.escapeHTML(cleanIcon)}" class="app-icon-img" alt="${aName}" onerror="this.onerror=null;this.replaceWith(document.createElement('i'));this.className='fas fa-cube text-muted';this.style.fontSize='2rem';">` : `<i class="fas fa-cube text-muted" style="font-size:2rem;"></i>`;
        let aTargetVal = (app.target || app.Target);
        let actionAttr = aTargetVal === 'iframe'
            ? `data-action="open-iframe" data-url="${aUrl}" data-name="${aName}"`
            : (aTargetVal === 'ie'
                ? `data-action="open-ie" data-url="${aUrl}"`
                : `data-action="open-url" data-url="${aUrl}"`);
        const actionsHtml = canManage
            ? `<div class="app-actions d-flex flex-nowrap justify-content-center gap-2"><button class="app-btn-action app-btn-edit" data-action="edit-app" data-id="${window.escapeHTML(app.id || app.AppId)}"><i class="fas fa-pencil-alt"></i></button><button class="app-btn-action app-btn-delete" data-action="delete-app" data-id="${window.escapeHTML(app.id || app.AppId)}"><i class="fas fa-times"></i></button></div>`
            : '';
        html += `<div class="app-card" title="${aName}">${actionsHtml}<div class="app-icon-box" ${actionAttr}>${imgHtml}</div><div class="app-name" ${actionAttr}>${aName}</div></div>`;
    });
    if (canManage) {
        html += `<div class="app-card app-add" title="新增 APP"><div class="app-icon-box app-add-box" data-action="add-app"><i class="fas fa-plus"></i></div><div class="app-name text-muted">新增 APP</div></div>`;
    }
    container.innerHTML = html;
}

// === 帳號管理專屬 Modal 繪製 ===
// === 廠區編輯時的「套用權限群組」勾選清單（對齊 TEST_20260429.html:1303）===
window.renderFabRoleCheckboxes = function (selectedIds) {
    if (!selectedIds || !Array.isArray(selectedIds)) selectedIds = [];
    const container = document.getElementById('fabRoleCheckboxes');
    if (!container) return;
    container.innerHTML = '';

    // ⭐️ 一個廠區只能指派「一個」權限群組(模組) → 改用 radio 單選（取代原本可複選 checkbox）。
    //    搭配「帳號設定 → 可視廠區」label 顯示廠區名：一廠一群組，才不會出現同名廠區重複格。
    //    保留 class `fab-role-cb` 與 value=roleId 不變；另加「無」選項允許不指派（該廠區對所有人隱藏）。
    //    舊資料若一廠掛多群組，僅取第一個顯示為已選，其餘於下次儲存時自動收斂為單一。
    const selectedId = selectedIds.length ? window.cleanId(selectedIds[0]) : '';

    let htmlBuffer = [];
    // 「無」：不指派任何群組（無人可見此廠區）
    const noneChecked = selectedId ? '' : 'checked';
    htmlBuffer.push(`
        <div class="form-check form-check-inline border rounded px-3 py-1 bg-white mb-1 shadow-sm" style="border-color:#dee2e6 !important;">
            <input class="form-check-input ms-0 me-2 fab-role-cb cursor-pointer" type="radio" name="fabRoleRadioGroup" id="fab_role_none" value="" ${noneChecked}>
            <label class="form-check-label small fw-bold text-muted cursor-pointer" for="fab_role_none">無 (不指派)</label>
        </div>
    `);

    getRoles().forEach(r => {
        const rId = r.id || r.roleId || r.RoleId || '';
        const rName = window.escapeHTML(r.groupName || r.GroupName || rId);
        const isChecked = (selectedId && window.cleanId(rId) === selectedId) ? 'checked' : '';
        const safeRId = window.escapeHTML(rId);
        htmlBuffer.push(`
            <div class="form-check form-check-inline border rounded px-3 py-1 bg-white mb-1 shadow-sm" style="border-color:#dee2e6 !important;">
                <input class="form-check-input ms-0 me-2 fab-role-cb cursor-pointer" type="radio" name="fabRoleRadioGroup" id="fr_${safeRId}" value="${safeRId}" ${isChecked}>
                <label class="form-check-label small fw-bold text-dark cursor-pointer" for="fr_${safeRId}">${rName}</label>
            </div>
        `);
    });
    container.innerHTML = htmlBuffer.join('');
};

// Expose for HTML inline handlers
window.renderPersonalMenuManage = renderPersonalMenuManage;
window.renderFabTable = renderFabTable;
window.renderRoleTable = renderRoleTable;
window.renderAccountTable = renderAccountTable;
window.renderWebpageTable = renderWebpageTable;
window.renderMenuConfigTable = renderMenuConfigTable;
window.renderApplyTable = renderApplyTable;
window.renderAuditTable = renderAuditTable;
window.renderAppGrid = renderAppGrid;



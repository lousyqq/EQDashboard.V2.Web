// === render/sidebar.js - 側邊欄選單渲染 ===
// ====== render.js 最上方的修復 ======
import { getCustomMenus, getDataTableLang, getFabs, getPersonalSettings, getRoles, t } from '../config.js?v=20260607k';
import { generateSidebarMenuItem } from './sidebar-item.js?v=20260607k';
import { navTo, selectTopMenu } from '../ui/navigation.js?v=20260607k';
import { appState } from '../store.js?v=20260607k';


window.cleanId = function (id) {
    // 檢查是否為空值 (null, undefined, NaN)
    if (id == null) return '';

    // 如果是數字，強制轉為字串
    let s = String(id);

    // 徹底防禦：如果轉完還是空的，直接回傳
    if (!s || s === 'undefined' || s === 'null') return '';

    // 執行洗淨
    return s.replace(/[\s\[\]"']/g, '').toLowerCase();
};

window.isParentMatch = function (childPId, parentNode) {
    let cp = window.cleanId(childPId);
    if (!cp || !parentNode) return false;
    return cp === window.cleanId(parentNode.id) ||
        (parentNode.name && cp === window.cleanId(parentNode.name)) ||
        (parentNode.displayName && cp === window.cleanId(parentNode.displayName));
};

window.localIsMenuDescendant = function (folderId, targetId, allMenus) {
    let folderNode = allMenus.find(m => window.cleanId(m.id) === window.cleanId(folderId));
    if (!folderNode) return false;
    if (window.cleanId(folderId) === window.cleanId(targetId)) return true;
    let q = [folderNode];
    while (q.length > 0) {
        let curr = q.shift();
        let children = allMenus.filter(m => m.id !== curr.id && (window.isParentMatch(m.parentId, curr) || (m.parentIds || []).some(pid => window.isParentMatch(pid, curr))));
        for (let child of children) {
            if (window.cleanId(child.id) === window.cleanId(targetId)) return true;
            q.push(child);
        }
    }
    return false;
};


const originalConsoleWarn = console.warn;
console.warn = function (...args) {
    const msg = args.join(' ');
    if (msg.includes('DataTables') || msg.includes('無法摧毀資料表') || msg.includes('Tracking Prevention') || msg.includes('sandbox')) return;
    originalConsoleWarn.apply(console, args);
};

window.addEventListener('error', function (event) {
    const msg = event.message || ''; const src = event.filename || '';
    if (msg.includes('toLowerCase') || msg.includes('isDataTable') || src.includes('browserLink')) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
window.addEventListener('unhandledrejection', function (event) {
    const msg = event.reason ? (event.reason.message || event.reason.toString()) : '';
    if (msg.includes('toLowerCase') || msg.includes('browserLink')) event.preventDefault();
}, true);

// === 對齊 TEST_20260429.html:2525 的階層展開工具 ===
window.getAllowedIdsWithHierarchy = function (menus, initialIds) {
    let ids = new Set(initialIds);
    let size = 0;
    while (ids.size > size) {
        size = ids.size;
        menus.forEach(m => {
            if (m.parentId && ids.has(m.parentId)) ids.add(m.id);
            if (m.parentIds) m.parentIds.forEach(p => { if (ids.has(p)) ids.add(m.id); });
        });
    }
    return ids;
};

// === 對齊 TEST_20260429.html:2565 的權限判定 ===
//  - admin → 全開
//  - user (非委派) → 都沒有
//  - user (有委派) →
//      * 自己建立 (createdBy === appState.currentUser.id) → 可編輯/刪除
//      * 被委派的節點本身或其下層子節點 → 可管理結構；若 canEditOthers=true，也能編輯/刪除別人的網頁
//      * 委派節點的祖先 → 可管理結構（為了能在 Tree Builder 點到他）
window.getMenuPermissions = function (nodeId, nodeCreatedBy) {
    let perms = { canView: false, canEdit: false, canDelete: false, canAddChild: false, canManageStructure: false };
    if (!appState.currentUser) return perms;
    if (appState.currentUser.roleLevel === 'admin') {
        return { canView: true, canEdit: true, canDelete: true, canAddChild: true, canManageStructure: true };
    }

    const isMyOwn = (nodeCreatedBy && window.cleanId(nodeCreatedBy) === window.cleanId(appState.currentUser.id));
    const manage = appState.currentUser.manageableMenus || [];
    const isDelegatedNode = manage.some(m => window.cleanId(m) === window.cleanId(nodeId));

    const menus = getCustomMenus();

    function isUnderDelegated(nId) {
        if (!manage || manage.length === 0) return false;
        let queue = [nId];
        let visited = new Set();
        while (queue.length > 0) {
            let curr = queue.shift();
            if (manage.some(m => window.cleanId(m) === window.cleanId(curr))) return true;
            visited.add(window.cleanId(curr));
            let m = menus.find(x => window.cleanId(x.id) === window.cleanId(curr));
            if (m) {
                if (m.parentId && !visited.has(window.cleanId(m.parentId))) queue.push(m.parentId);
                if (m.parentIds) m.parentIds.forEach(p => { if (!visited.has(window.cleanId(p))) queue.push(p); });
            }
        }
        return false;
    }

    function isAncestorOfDelegated(nId) {
        if (!manage || manage.length === 0) return false;
        for (let delId of manage) {
            let queue = [delId];
            let visited = new Set();
            while (queue.length > 0) {
                let curr = queue.shift();
                if (window.cleanId(curr) === window.cleanId(nId)) return true;
                visited.add(window.cleanId(curr));
                let m = menus.find(x => window.cleanId(x.id) === window.cleanId(curr));
                if (m) {
                    if (m.parentId && !visited.has(window.cleanId(m.parentId))) queue.push(m.parentId);
                    if (m.parentIds) m.parentIds.forEach(p => { if (!visited.has(window.cleanId(p))) queue.push(p); });
                }
            }
        }
        return false;
    }

    const isUnder = isUnderDelegated(nodeId);
    const isAncestor = isAncestorOfDelegated(nodeId);

    if (isMyOwn) {
        perms.canEdit = true;
        perms.canDelete = true;
        perms.canManageStructure = true;
    }
    if (isDelegatedNode || isUnder) {
        perms.canManageStructure = true;
        if (appState.currentUser.canEditOthers) {
            perms.canEdit = true;
            perms.canDelete = true;
        }
    }
    if (isAncestor) {
        // 僅允許檢視，不可管理結構
    }

    if (perms.canEdit || perms.canManageStructure || isDelegatedNode || isUnder || isAncestor) {
        perms.canView = true;
        perms.canAddChild = perms.canManageStructure;
    }
    return perms;
};

// === 對齊 TEST_20260429.html 的 toggleSubMenu，自製 collapse 開合（取代 Bootstrap data-bs-toggle 觸發器）===
window.toggleSubMenu = function (e, targetId, element) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const target = document.getElementById(targetId);
    if (!target || !element) return;
    if (target.classList.contains('show')) {
        target.classList.remove('show');
        target.style.display = 'none';
        element.classList.add('collapsed');
        element.setAttribute('aria-expanded', 'false');
    } else {
        target.classList.add('show');
        target.style.display = 'block';
        element.classList.remove('collapsed');
        element.setAttribute('aria-expanded', 'true');
    }
};

// 防呆小幫手：安全摧毀 DataTable
export function safeDestroyDataTable(tableId) {
    try {
        if (typeof $ !== 'undefined' && $.fn && $.fn.DataTable && $.fn.DataTable.isDataTable('#' + tableId)) {
            $('#' + tableId).DataTable().destroy();
        }
    } catch (e) { }
}

export function initDataTable(tableId, sortable = true) {
    setTimeout(() => {
        try {
            if (typeof $ === 'undefined' || !$.fn || !$.fn.DataTable) return;
            if ($.fn.DataTable.isDataTable('#' + tableId)) $('#' + tableId).DataTable().destroy();
            appState.dtInstances[tableId] = $('#' + tableId).DataTable({
                language: (typeof getDataTableLang === 'function') ? getDataTableLang() : {},
                pageLength: 10, lengthMenu: [10, 25, 50, 100], ordering: sortable, order: [], autoWidth: false, stateSave: false
            });
        } catch (e) { }
    }, 50);
}

// == 左側側邊欄產生邏輯 ==
export function renderSidebarMenus() {
    try {
        if (!appState.currentUser) return;

        // 切換模組 / 廠區 / 重新載入時，自動清掉看板搜尋狀態，避免目錄樹被搜尋結果蓋住。
        // （打字本身只呼叫 filterSidebarMenus，不會進到這裡，所以不影響搜尋中的即時過濾。）
        const _searchInput = document.getElementById('sidebar-search-input');
        if (_searchInput && _searchInput.value) _searchInput.value = '';
        const _searchClear = document.getElementById('sidebar-search-clear');
        if (_searchClear) _searchClear.style.display = 'none';
        const _searchResults = document.getElementById('sidebar-search-results');
        if (_searchResults) { _searchResults.style.display = 'none'; _searchResults.innerHTML = ''; }
        const _treeEl = document.getElementById('dynamic-sidebar-menus');
        if (_treeEl) _treeEl.style.display = '';

        let rawMenus = getCustomMenus();
        if (!Array.isArray(rawMenus)) rawMenus = [];
        let menus = JSON.parse(JSON.stringify(rawMenus)).filter(m => m && window.cleanId(m.id) !== '');
        let pSets = appState.currentLayoutMode === 'personal' ? getPersonalSettings(appState.currentUser.id) : {};
        const cCurrentFab = window.cleanId(appState.currentFab || appState.currentFab);
        const fabsList = getFabs();
        const currentFabObj = fabsList.find(f => window.cleanId(f.fabName || f.FabName || f.id || f.fabId || f.FabId) === cCurrentFab);

        const fabRoleIds = currentFabObj ? (currentFabObj.assignedRoles || currentFabObj.AssignedRoles || []) : [];
        const userRoleIds = appState.currentUser.assignedRoles || appState.currentUser.AssignedRoles || [];
        const activeRoleIds = fabRoleIds.filter(id => userRoleIds.some(uId => window.cleanId(uId) === window.cleanId(id)));

        const roles = getRoles();
        let initialMenuIds = [];
        
        activeRoleIds.forEach(roleId => {
            const role = roles.find(r => window.cleanId(r.id || r.RoleId || r.roleId) === window.cleanId(roleId));
            const allowed = role ? (role.allowedMenuIds || role.AllowedMenuIds || []) : [];
            if (allowed) initialMenuIds.push(...allowed);
        });

        // === 權限優先序：Menu ACL > Account extra/deny > Role-based =================
        // 預先計算 menu-level ACL 對當前使用者的效果
        const curEmpId = window.cleanId(appState.currentUser.id || appState.currentUser.empId || '');
        const menuAclDeny = new Set();        // 看板自己 deny — 絕對封鎖
        const menuAclForceAllow = new Set();  // 看板白名單命中 — 絕對開放，可蓋過帳號 deny

        menus.forEach(m => {
            const cId = window.cleanId(m.id);
            if (!cId) return;
            const allowList = (m.allowedEmpIds || []).map(window.cleanId);
            const denyList = (m.deniedEmpIds || []).map(window.cleanId);

            if (denyList.includes(curEmpId)) {
                menuAclDeny.add(cId);                         // 在黑名單 → 絕對 deny
            } else if (allowList.length > 0) {
                if (allowList.includes(curEmpId)) {
                    menuAclForceAllow.add(cId);               // 白名單命中 → 絕對 allow
                } else {
                    menuAclDeny.add(cId);                     // 白名單存在但不在 → 等同 deny
                }
            }
        });

        // 帳號層級 extra (在 Role 之外額外開放)
        const extraMenus = appState.currentUser.extraMenus || appState.currentUser.ExtraMenus || [];
        if (extraMenus.length > 0) initialMenuIds.push(...extraMenus);

        let allowedSet = new Set(initialMenuIds.map(window.cleanId).filter(id => id !== ''));

        // 帳號層級 deny — 但若該 menu 被 Menu ACL force-allow，仍視為允許 (Menu 優先)
        const accountDenySet = new Set((appState.currentUser.denyMenus || appState.currentUser.DenyMenus || []).map(window.cleanId).filter(id => id !== ''));
        accountDenySet.forEach(id => {
            if (!menuAclForceAllow.has(id)) allowedSet.delete(id);
        });

        // Menu ACL 套用 (最高優先) — force-allow 強加進來、deny 強拿掉
        menuAclForceAllow.forEach(id => allowedSet.add(id));
        menuAclDeny.forEach(id => allowedSet.delete(id));

        // 子節點展開：絕對不能展進「menu ACL deny」或「account.deny 且未被 menu force-allow」
        let added = true;
        while (added) {
            added = false;
            menus.forEach(m => {
                let cId = window.cleanId(m.id);
                if (!cId || allowedSet.has(cId)) return;
                if (menuAclDeny.has(cId)) return;                                    // menu ACL deny 絕對封鎖
                if (accountDenySet.has(cId) && !menuAclForceAllow.has(cId)) return;  // account deny (menu 沒 force-allow 才生效)
                let hasAllowedParent = menus.some(pNode => pNode.id !== m.id && allowedSet.has(window.cleanId(pNode.id)) && (window.isParentMatch(m.parentId, pNode) || (m.parentIds || []).some(pid => window.isParentMatch(pid, pNode))));
                if (hasAllowedParent) { allowedSet.add(cId); added = true; }
            });
        }

        // Removed the loop that auto-adds parent folders if child is allowed,
        // because it violates user's explicit role assignments for Top Navbar visibility.

        if (appState.currentLayoutMode === 'personal') {
            menus.forEach(m => {
                if (pSets[m.id]) {
                    if (pSets[m.id].hidden !== undefined) m.enabled = !pSets[m.id].hidden;
                    if (pSets[m.id].target !== undefined) m.target = pSets[m.id].target;
                    if (pSets[m.id].order !== undefined) m.order = pSets[m.id].order;
                }
            });
        }

        // disabled 項目對所有人（含 admin）都不顯示在側邊欄/上方導覽
        // (ACL/extra/deny 已在 allowedSet 計算階段全部處理完畢，這裡只剩 enabled 過濾)
        const inPersonalMode = (appState.currentLayoutMode === 'personal');
        let validMenus = menus.filter(m => {
            let cId = window.cleanId(m.id);
            if (!cId || !allowedSet.has(cId)) return false;
            if (m.enabled === false) return false;
            return true;
        });
        menus = validMenus;
        appState._currentValidMenus = validMenus; // ⭐️ 掛載到 window 以供 navigation.js 全域安全存取

        // 排序（對齊 TEST_20260429.html:3217）：
        //  - 系統模式下，root 依「目前可看到的群組 allowedMenuIds 串接後的順序」排（dedupedInitIds）
        //    → 在權限管理拖曳允許看板組合 → 直接決定上方導覽列順序
        //  - 子節點：當兩個項目共用同一個父節點時，優先用 parentOrders[該父節點] 排序，
        //    避免 fallback 路徑誤用舊的全域 m.order。
        const dedupedInitIds = [];
        initialMenuIds.forEach(mId => {
            const cId = window.cleanId(mId);
            if (cId && !dedupedInitIds.some(x => window.cleanId(x) === cId)) {
                dedupedInitIds.push(cId);
            }
        });

        // 共用工具：找出兩個節點是否共用同一個 root parent，回傳那個 parent 的 id
        const findSharedParentId = (a, b) => {
            const aParents = new Set([
                ...(a.parentId ? [window.cleanId(a.parentId)] : []),
                ...((a.parentIds || []).map(window.cleanId))
            ]);
            const bParentList = [
                ...(b.parentId ? [b.parentId] : []),
                ...(b.parentIds || [])
            ];
            for (const p of bParentList) {
                if (aParents.has(window.cleanId(p))) return p; // 回傳 b 端的原始 key（未清洗）
            }
            return null;
        };

        menus.sort((a, b) => {
            const aHasParent = menus.some(p => p.id !== a.id && (window.isParentMatch(a.parentId, p) || (a.parentIds || []).some(pid => window.isParentMatch(pid, p))));
            const bHasParent = menus.some(p => p.id !== b.id && (window.isParentMatch(b.parentId, p) || (b.parentIds || []).some(pid => window.isParentMatch(pid, p))));

            // 雙方都是子節點且共用同一個父節點 → 優先用 parentOrders[該父節點] 排序，
            // 這樣全域排序就能與後續 subMenus / generateSidebarMenuItem 的排序一致，
            // 避免新建 folder 因 m.order=0 被擠到最前面。
            if (aHasParent && bHasParent) {
                const sharedP = findSharedParentId(a, b);
                if (sharedP) {
                    const aKey = a.parentOrders?.[sharedP];
                    const bKey = b.parentOrders?.[sharedP];
                    if (aKey != null || bKey != null) {
                        return (aKey ?? 9999) - (bKey ?? 9999);
                    }
                }
            }
            return (a.order || 0) - (b.order || 0);
        });

        let rootMenus = menus.filter(m => {
            if (String(m.isPoolItem).toLowerCase() === 'true') return false;
            let hasValidParent = menus.some(pNode => pNode.id !== m.id && (window.isParentMatch(m.parentId, pNode) || (m.parentIds || []).some(pid => window.isParentMatch(pid, pNode))));
            return !hasValidParent;
        });

        // ⭐️ 核心修復：獨立針對 rootMenus 依 allowedMenuIds 的順序進行嚴格排序，避免與 order 混用導致非遞移性排序崩潰
        if (!inPersonalMode) {
            rootMenus.sort((a, b) => {
                const idxA = dedupedInitIds.indexOf(window.cleanId(a.id));
                const idxB = dedupedInitIds.indexOf(window.cleanId(b.id));
                return (idxA === -1 ? 9999 : idxA) - (idxB === -1 ? 9999 : idxB);
            });
        }

        if (rootMenus.length === 0 && menus.length > 0) rootMenus = menus.slice(0, 5);
        if ((!appState.currentActiveTopMenuId || appState.currentActiveTopMenuId !== 'system_settings' && !rootMenus.find(m => window.cleanId(m.id) === window.cleanId(appState.currentActiveTopMenuId))) && rootMenus.length > 0) {
            appState.currentActiveTopMenuId = rootMenus[0].id;
        }

        let topLinksHtml = '';
        if (rootMenus && rootMenus.length > 0) {
            rootMenus.forEach(root => {
                if (root.id === 'system_settings') return;
                let dName = root.displayName || root.name || '未命名選單';
                if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + root.id] && !root.isEdited) dName = i18n[appState.currentLang]['dyn_' + root.id];
                const isActive = window.cleanId(root.id) === window.cleanId(appState.currentActiveTopMenuId) ? 'active' : '';
                topLinksHtml += `<a class="top-menu-link text-truncate ${isActive}" onclick="selectTopMenu('${root.id}')" title="${window.escapeHTML(dName)}">${window.escapeHTML(dName)}</a>`;
            });
        }
        const topMenusContainer = document.getElementById('top-dynamic-menus');
        if (topMenusContainer) topMenusContainer.innerHTML = topLinksHtml;

        const sysBtn = document.getElementById('btn-system-settings');
        if (sysBtn) {
            if (appState.currentActiveTopMenuId === 'system_settings') sysBtn.classList.add('active');
            else sysBtn.classList.remove('active');
        }

        let html = '';
        const triggerLeft = document.getElementById('trigger-left');

        if (appState.currentActiveTopMenuId === 'system_settings') {
            const titleEl = document.getElementById('sidebar-module-title');
            if (titleEl) titleEl.innerText = t('nav_sys_settings', '系統設定');
            setTimeout(() => { if (triggerLeft) triggerLeft.style.display = 'block'; if (appState.isPinned) document.body.classList.remove('sidebar-hidden'); }, 10);

            const role = appState.currentUser.roleLevel;
            const canManage = role === 'admin' || (role === 'user' && appState.currentUser.manageableMenus && appState.currentUser.manageableMenus.length > 0);

            // ⭐️ 核心修復：根據目前的版面模式 (appState.currentLayoutMode) 決定是否顯示「個人頁面管理」
            const sysMenus = [
                { id: 'page-personal-manage', icon: 'fas fa-user-cog', i18nKey: 'menu_personal_manage', fallback: '個人頁面管理', display: appState.currentLayoutMode === 'personal' },
                { id: 'page-webpage-manage', icon: 'fas fa-file-code', i18nKey: 'menu_webpage_manage', fallback: '看板網頁管理', display: canManage },
                { id: 'page-menu-manage', icon: 'fas fa-sitemap', i18nKey: 'menu_menu_manage', fallback: '選單配置管理', display: canManage },
                { id: 'page-fab-manage', icon: 'fas fa-building', i18nKey: 'menu_fab_manage', fallback: '廠區管理', display: role === 'admin' },
                { id: 'page-role-manage', icon: 'fas fa-users-cog', i18nKey: 'menu_role_manage', fallback: '權限管理', display: role === 'admin' },
                { id: 'page-account-manage', icon: 'fas fa-user-shield', i18nKey: 'menu_account_manage', fallback: '帳號管理', display: role === 'admin' || (appState.currentUser && appState.currentUser.canEditOthers) },
                { id: 'page-audit-manage', icon: 'fas fa-clipboard-check', i18nKey: 'menu_audit_manage', fallback: '申請審核管理', display: role === 'admin' },
                { id: 'page-apply', icon: 'fas fa-paper-plane', i18nKey: 'menu_apply', fallback: '需求申請', display: role !== 'admin' },
                { id: 'page-activity-log', icon: 'fas fa-history', i18nKey: 'menu_activity_log', fallback: '操作紀錄', display: role === 'admin' },
                { id: 'page-config-manage', icon: 'fas fa-database', i18nKey: 'db_sync', fallback: '資料庫與同步', display: role === 'admin' }
            ];
            sysMenus.forEach(sm => {
                if (sm.display) { const smName = t(sm.i18nKey, sm.fallback); html += `<div class="menu-item" onclick="navTo('${sm.id}', this, '${smName}')"><i class="${sm.icon} menu-icon"></i> <span class="text-truncate">${smName}</span></div>`; }
            });
        } else {
            const activeRoot = rootMenus.find(m => window.cleanId(m.id) === window.cleanId(appState.currentActiveTopMenuId));
            if (activeRoot) {
                const titleEl = document.getElementById('sidebar-module-title');
                if (titleEl) titleEl.innerText = activeRoot.displayName || activeRoot.name || '未命名選單';
                const subMenus = menus.filter(m => m.id !== activeRoot.id && (window.isParentMatch(m.parentId, activeRoot) || (m.parentIds || []).some(pid => window.isParentMatch(pid, activeRoot))));

                if (subMenus.length === 0) {
                    setTimeout(() => { document.body.classList.add('sidebar-hidden'); if (triggerLeft) triggerLeft.style.display = 'none'; }, 10);
                } else {
                    setTimeout(() => { if (triggerLeft) triggerLeft.style.display = 'block'; if (appState.isPinned) document.body.classList.remove('sidebar-hidden'); }, 10);
                }
                subMenus.sort((a, b) => (a.parentOrders?.[activeRoot.id] ?? a.order ?? 0) - (b.parentOrders?.[activeRoot.id] ?? b.order ?? 0));

                subMenus.forEach(child => { html += generateSidebarMenuItem(child, menus, 1, false); });
            }
        }
        const sidebarContainer = document.getElementById('dynamic-sidebar-menus');
        if (sidebarContainer) sidebarContainer.innerHTML = html;

        // 看板搜尋：初次渲染後綁定一次事件（內部以 dataset.bound 防重複綁定）
        if (typeof window.setupSidebarSearch === 'function') window.setupSidebarSearch();

        // ⭐️ App Shell Caching：將渲染結果存入 localStorage，供 Ctrl+F5 瞬間恢復畫面使用
        if (topMenusContainer) localStorage.setItem('app_shell_top_menus', topMenusContainer.innerHTML);
        if (sidebarContainer) localStorage.setItem('app_shell_sidebar_menus', sidebarContainer.innerHTML);

    } catch (err) { console.error("renderSidebarMenus error", err); }
}

// === 看板搜尋（task a）=====================================================
//  - 跨「目前可見看板」(appState._currentValidMenus，已由 renderSidebarMenus 做完權限過濾) 即時過濾，
//    不只搜尋目前選到的模組 → 解決「看板太多、跨模組找不到」的痛點。
//  - 只列「可開啟的看板」(有 url / targetPage / app_grid)，排除純資料夾。
//  - 點結果用 window.activateMenu(id) 導航，它會自動切到正確的上方模組並開啟看板。
//  - 安全性：只讀 appState._currentValidMenus（已過濾），絕不退回未過濾的 getCustomMenus()，避免洩漏無權看板。
export function filterSidebarMenus(term) {
    const treeEl = document.getElementById('dynamic-sidebar-menus');
    const resultsEl = document.getElementById('sidebar-search-results');
    if (!resultsEl) return;

    const kw = (term || '').trim().toLowerCase();

    if (!kw) {
        resultsEl.style.display = 'none';
        resultsEl.innerHTML = '';
        if (treeEl) treeEl.style.display = '';
        return;
    }

    const all = Array.isArray(appState._currentValidMenus) ? appState._currentValidMenus : [];

    const isOpenable = (m) => !!(m.url || m.targetPage || (m.menuMode === 'app_grid'));
    const nameOf = (m) => {
        let n = m.displayName || m.name || '未命名看板';
        if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + m.id] && !m.isEdited) n = i18n[appState.currentLang]['dyn_' + m.id];
        return n;
    };

    const matches = all
        .filter(m => m && window.cleanId(m.id) !== '' && isOpenable(m) && nameOf(m).toLowerCase().includes(kw))
        .slice(0, 50);

    if (treeEl) treeEl.style.display = 'none';
    resultsEl.style.display = 'block';

    if (matches.length === 0) {
        resultsEl.innerHTML = `<div class="sidebar-search-empty">${window.escapeHTML(t('search_no_result', '找不到符合的看板'))}</div>`;
        return;
    }

    // 麵包屑：往上找父節點名稱，讓使用者知道看板所在位置
    const byId = new Map(all.map(m => [window.cleanId(m.id), m]));
    const crumbOf = (m) => {
        const parts = [];
        const seen = new Set();
        let pid = m.parentId || (m.parentIds && m.parentIds[0]);
        while (pid) {
            const cp = window.cleanId(pid);
            if (!cp || seen.has(cp)) break;
            seen.add(cp);
            const p = byId.get(cp);
            if (!p) break;
            parts.unshift(nameOf(p));
            pid = p.parentId || (p.parentIds && p.parentIds[0]);
        }
        return parts.join(' / ');
    };

    let html = '';
    matches.forEach(m => {
        const name = nameOf(m);
        let iconHtml;
        // 圖片來源 = data: URI 或任何含 '/' 的路徑（/images/icons/... 實體檔、舊 icon/...）；FA class 永不含 '/'
        if (m.icon && (String(m.icon).startsWith('data:') || String(m.icon).includes('/'))) {
            iconHtml = `<img src="${window.escapeHTML(m.icon)}" class="custom-icon menu-icon" alt="icon">`;
        } else {
            iconHtml = `<i class="${window.escapeHTML(m.icon || 'far fa-file-alt')} menu-icon"></i>`;
        }
        const crumb = crumbOf(m);
        const crumbHtml = crumb ? `<div class="sidebar-search-crumb text-truncate">${window.escapeHTML(crumb)}</div>` : '';
        html += `<div class="menu-item sidebar-search-item" data-action="search-result" data-id="${window.escapeHTML(String(m.id))}" title="${window.escapeHTML(name)}" style="cursor:pointer;">
                    ${iconHtml}<span class="sidebar-search-text"><span class="sidebar-search-name text-truncate">${window.escapeHTML(name)}</span>${crumbHtml}</span>
                 </div>`;
    });
    resultsEl.innerHTML = html;
}

// 綁定搜尋輸入框與結果點擊（idempotent：用 dataset.bound 防止重複綁定）
window.setupSidebarSearch = function () {
    const input = document.getElementById('sidebar-search-input');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';

    const clearBtn = document.getElementById('sidebar-search-clear');
    const resultsEl = document.getElementById('sidebar-search-results');

    // 語系感知的 placeholder（changeLanguage 會重繪側邊欄，再次經過這裡不會重綁但仍刷新 placeholder）
    try { input.placeholder = t('search_placeholder', '搜尋看板…'); } catch (e) { }

    const doFilter = () => {
        if (clearBtn) clearBtn.style.display = input.value ? 'flex' : 'none';
        filterSidebarMenus(input.value);
    };
    const reset = () => {
        input.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        filterSidebarMenus('');
    };

    input.addEventListener('input', doFilter);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { reset(); input.blur(); } });
    if (clearBtn) clearBtn.addEventListener('click', () => { reset(); input.focus(); });

    if (resultsEl && resultsEl.dataset.bound !== '1') {
        resultsEl.dataset.bound = '1';
        resultsEl.addEventListener('click', (e) => {
            const item = e.target.closest('[data-action="search-result"]');
            if (!item) return;
            const id = item.getAttribute('data-id');
            reset();                                   // 先清搜尋、還原樹
            if (typeof window.activateMenu === 'function') window.activateMenu(id);  // 再導航（會重繪側邊欄）
        });
    }
};


// Expose for HTML inline handlers
window.safeDestroyDataTable = safeDestroyDataTable;
window.initDataTable = initDataTable;
window.renderSidebarMenus = renderSidebarMenus;
window.filterSidebarMenus = filterSidebarMenus;


// === render/sidebar.js - 側邊欄選單渲染 ===
// ====== render.js 最上方的修復 ======
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
//      * 自己建立 (createdBy === currentUser.id) → 可編輯/刪除
//      * 被委派的節點本身或其下層子節點 → 可管理結構；若 canEditOthers=true，也能編輯/刪除別人的網頁
//      * 委派節點的祖先 → 可管理結構（為了能在 Tree Builder 點到他）
window.getMenuPermissions = function (nodeId, nodeCreatedBy) {
    let perms = { canView: false, canEdit: false, canDelete: false, canAddChild: false, canManageStructure: false };
    if (!currentUser) return perms;
    if (currentUser.roleLevel === 'admin') {
        return { canView: true, canEdit: true, canDelete: true, canAddChild: true, canManageStructure: true };
    }

    const isMyOwn = (nodeCreatedBy && window.cleanId(nodeCreatedBy) === window.cleanId(currentUser.id));
    const manage = currentUser.manageableMenus || [];
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
        if (currentUser.canEditOthers) {
            perms.canEdit = true;
            perms.canDelete = true;
        }
    }
    if (isAncestor) {
        perms.canManageStructure = true;
    }

    if (perms.canEdit || perms.canManageStructure || isDelegatedNode || isUnder || isAncestor) {
        perms.canAddChild = true;
        perms.canView = true;
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
function safeDestroyDataTable(tableId) {
    try {
        if (typeof $ !== 'undefined' && $.fn && $.fn.DataTable && $.fn.DataTable.isDataTable('#' + tableId)) {
            $('#' + tableId).DataTable().destroy();
        }
    } catch (e) { }
}

function initDataTable(tableId, sortable = true) {
    setTimeout(() => {
        try {
            if (typeof $ === 'undefined' || !$.fn || !$.fn.DataTable) return;
            if ($.fn.DataTable.isDataTable('#' + tableId)) $('#' + tableId).DataTable().destroy();
            dtInstances[tableId] = $('#' + tableId).DataTable({
                language: (typeof getDataTableLang === 'function') ? getDataTableLang() : {},
                pageLength: 10, lengthMenu: [10, 25, 50, 100], ordering: sortable, order: [], autoWidth: false, stateSave: false
            });
        } catch (e) { }
    }, 50);
}

// == 左側側邊欄產生邏輯 ==
function renderSidebarMenus() {
    try {
        if (!currentUser) return;
        let rawMenus = getCustomMenus();
        if (!Array.isArray(rawMenus)) rawMenus = [];
        let menus = JSON.parse(JSON.stringify(rawMenus)).filter(m => m && window.cleanId(m.id) !== '');
        let pSets = currentLayoutMode === 'personal' ? getPersonalSettings(currentUser.id) : {};
        const cCurrentFab = window.cleanId(window.currentFab || currentFab);
        const fabsList = getFabs();
        const currentFabObj = fabsList.find(f => window.cleanId(f.fabName || f.FabName || f.id || f.fabId || f.FabId) === cCurrentFab);

        const fabRoleIds = currentFabObj ? (currentFabObj.assignedRoles || currentFabObj.AssignedRoles || []) : [];
        const userRoleIds = currentUser.assignedRoles || currentUser.AssignedRoles || [];
        const activeRoleIds = (currentUser.roleLevel === 'admin') ? fabRoleIds : fabRoleIds.filter(id => userRoleIds.some(uId => window.cleanId(uId) === window.cleanId(id)));

        const roles = getRoles();
        let initialMenuIds = [];
        activeRoleIds.forEach(roleId => {
            const role = roles.find(r => window.cleanId(r.id || r.RoleId || r.roleId) === window.cleanId(roleId));
            const allowed = role ? (role.allowedMenuIds || role.AllowedMenuIds || []) : [];
            if (allowed) initialMenuIds.push(...allowed);
        });

        // === 權限優先序：Menu ACL > Account extra/deny > Role-based =================
        // 預先計算 menu-level ACL 對當前使用者的效果
        const curEmpId = window.cleanId(currentUser.id || currentUser.empId || '');
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
        const extraMenus = currentUser.extraMenus || currentUser.ExtraMenus || [];
        if (extraMenus.length > 0) initialMenuIds.push(...extraMenus);

        let allowedSet = new Set(initialMenuIds.map(window.cleanId).filter(id => id !== ''));

        // 帳號層級 deny — 但若該 menu 被 Menu ACL force-allow，仍視為允許 (Menu 優先)
        const accountDenySet = new Set((currentUser.denyMenus || currentUser.DenyMenus || []).map(window.cleanId).filter(id => id !== ''));
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

        added = true;
        while (added) {
            added = false;
            menus.forEach(m => {
                let cId = window.cleanId(m.id);
                if (!cId || !allowedSet.has(cId)) return;
                menus.forEach(pNode => {
                    let pId = window.cleanId(pNode.id);
                    if (!allowedSet.has(pId) && pNode.id !== m.id) {
                        if (window.isParentMatch(m.parentId, pNode) || (m.parentIds || []).some(pid => window.isParentMatch(pid, pNode))) {
                            allowedSet.add(pId); added = true;
                        }
                    }
                });
            });
        }

        if (currentLayoutMode === 'personal') {
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
        const inPersonalMode = (currentLayoutMode === 'personal');
        let validMenus = menus.filter(m => {
            let cId = window.cleanId(m.id);
            if (!cId || !allowedSet.has(cId)) return false;
            if (m.enabled === false) return false;
            return true;
        });
        menus = validMenus;
        window._currentValidMenus = validMenus; // ⭐️ 掛載到 window 以供 navigation.js 全域安全存取

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

            // 系統模式 + 雙方都是 root → 依 role.allowedMenuIds 的合成順序排
            if (!inPersonalMode && !aHasParent && !bHasParent) {
                const idxA = dedupedInitIds.indexOf(window.cleanId(a.id));
                const idxB = dedupedInitIds.indexOf(window.cleanId(b.id));
                return (idxA === -1 ? 9999 : idxA) - (idxB === -1 ? 9999 : idxB);
            }

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

        if (rootMenus.length === 0 && menus.length > 0) rootMenus = menus.slice(0, 5);
        if ((!window.currentActiveTopMenuId || window.currentActiveTopMenuId !== 'system_settings' && !rootMenus.find(m => window.cleanId(m.id) === window.cleanId(window.currentActiveTopMenuId))) && rootMenus.length > 0) {
            window.currentActiveTopMenuId = rootMenus[0].id;
        }

        let topLinksHtml = '';
        if (rootMenus && rootMenus.length > 0) {
            rootMenus.forEach(root => {
                if (root.id === 'system_settings') return;
                let dName = root.displayName || root.name || '未命名選單';
                if (typeof i18n !== 'undefined' && i18n[currentLang] && i18n[currentLang]['dyn_' + root.id] && !root.isEdited) dName = i18n[currentLang]['dyn_' + root.id];
                const isActive = window.cleanId(root.id) === window.cleanId(window.currentActiveTopMenuId) ? 'active' : '';
                topLinksHtml += `<a class="top-menu-link text-truncate ${isActive}" onclick="selectTopMenu('${root.id}')" title="${window.escapeHTML(dName)}">${window.escapeHTML(dName)}</a>`;
            });
        }
        const topMenusContainer = document.getElementById('top-dynamic-menus');
        if (topMenusContainer) topMenusContainer.innerHTML = topLinksHtml;

        const sysBtn = document.getElementById('btn-system-settings');
        if (sysBtn) {
            if (window.currentActiveTopMenuId === 'system_settings') sysBtn.classList.add('active');
            else sysBtn.classList.remove('active');
        }

        let html = '';
        const triggerLeft = document.getElementById('trigger-left');

        if (window.currentActiveTopMenuId === 'system_settings') {
            const titleEl = document.getElementById('sidebar-module-title');
            if (titleEl) titleEl.innerText = t('nav_sys_settings', '系統設定');
            setTimeout(() => { if (triggerLeft) triggerLeft.style.display = 'block'; if (isPinned) document.body.classList.remove('sidebar-hidden'); }, 10);

            const role = currentUser.roleLevel;
            const canManage = role === 'admin' || (role === 'user' && currentUser.manageableMenus && currentUser.manageableMenus.length > 0);

            // ⭐️ 核心修復：根據目前的版面模式 (currentLayoutMode) 決定是否顯示「個人頁面管理」
            const sysMenus = [
                { id: 'page-personal-manage', icon: 'fas fa-user-cog', i18nKey: 'menu_personal_manage', fallback: '個人頁面管理', display: currentLayoutMode === 'personal' },
                { id: 'page-webpage-manage', icon: 'fas fa-file-code', i18nKey: 'menu_webpage_manage', fallback: '看板網頁管理', display: canManage },
                { id: 'page-menu-manage', icon: 'fas fa-sitemap', i18nKey: 'menu_menu_manage', fallback: '選單配置管理', display: canManage },
                { id: 'page-fab-manage', icon: 'fas fa-building', i18nKey: 'menu_fab_manage', fallback: '廠區管理', display: role === 'admin' },
                { id: 'page-role-manage', icon: 'fas fa-users-cog', i18nKey: 'menu_role_manage', fallback: '權限管理', display: role === 'admin' },
                { id: 'page-account-manage', icon: 'fas fa-user-shield', i18nKey: 'menu_account_manage', fallback: '帳號管理', display: role === 'admin' || (currentUser && currentUser.canEditOthers) },
                { id: 'page-audit-manage', icon: 'fas fa-clipboard-check', i18nKey: 'menu_audit_manage', fallback: '申請審核管理', display: role === 'admin' },
                { id: 'page-apply', icon: 'fas fa-paper-plane', i18nKey: 'menu_apply', fallback: '需求申請', display: role !== 'admin' },
                { id: 'page-config-manage', icon: 'fas fa-database', i18nKey: 'db_sync', fallback: '資料庫與同步', display: role === 'admin' }
            ];
            sysMenus.forEach(sm => {
                if (sm.display) { const smName = t(sm.i18nKey, sm.fallback); html += `<div class="menu-item" onclick="navTo('${sm.id}', this, '${smName}')"><i class="${sm.icon} menu-icon"></i> <span class="text-truncate">${smName}</span></div>`; }
            });
        } else {
            const activeRoot = rootMenus.find(m => window.cleanId(m.id) === window.cleanId(window.currentActiveTopMenuId));
            if (activeRoot) {
                const titleEl = document.getElementById('sidebar-module-title');
                if (titleEl) titleEl.innerText = activeRoot.displayName || activeRoot.name || '未命名選單';
                const subMenus = menus.filter(m => m.id !== activeRoot.id && (window.isParentMatch(m.parentId, activeRoot) || (m.parentIds || []).some(pid => window.isParentMatch(pid, activeRoot))));

                if (subMenus.length === 0) {
                    setTimeout(() => { document.body.classList.add('sidebar-hidden'); if (triggerLeft) triggerLeft.style.display = 'none'; }, 10);
                } else {
                    setTimeout(() => { if (triggerLeft) triggerLeft.style.display = 'block'; if (isPinned) document.body.classList.remove('sidebar-hidden'); }, 10);
                }
                subMenus.sort((a, b) => (a.parentOrders?.[activeRoot.id] ?? a.order ?? 0) - (b.parentOrders?.[activeRoot.id] ?? b.order ?? 0));

                subMenus.forEach(child => { html += generateSidebarMenuItem(child, menus, 1, true); });
            }
        }
        const sidebarContainer = document.getElementById('dynamic-sidebar-menus');
        if (sidebarContainer) sidebarContainer.innerHTML = html;

    } catch (err) { console.error("renderSidebarMenus error", err); }
}


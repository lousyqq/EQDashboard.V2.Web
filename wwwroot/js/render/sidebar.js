// === render/sidebar.js - 側邊欄選單渲染 ===
// ====== render.js 最上方的修復 ======
import { getCustomMenus, getDataTableLang, getFabs, getPersonalSettings, getRoles, t } from '../config.js';
import { generateSidebarMenuItem } from './sidebar-item.js';
import { navTo, selectTopMenu } from '../ui/navigation.js';
import { appState } from '../store.js';


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
// canManageDescendants（2026-08-24 第八輪／第七輪 J5）：
//   「這個節點自己不可編輯，但它底下有我被委派的子樹」。用來決定**要不要給一個入口**進到樹狀編輯器，
//   而不是給編輯權 —— 樹狀編輯器內部本來就會對每個子節點各自跑 getMenuPermissions。
//   為什麼需要它：被委派**子資料夾**（例：m_ze_2）的人，在「選單配置管理」只看得到祖先 root 那一列，
//   而該列是 isAncestor → canEdit/canManageStructure 皆 false → 整頁 0 顆按鈕、只有「僅檢視」徽章
//   → **完全沒有路徑進到自己被委派的子樹**，功能對它唯一的目標族群等於是壞的。
window.getMenuPermissions = function (nodeId, nodeCreatedBy) {
    let perms = { canView: false, canEdit: false, canDelete: false, canAddChild: false, canManageStructure: false, canManageDescendants: false };
    if (!appState.currentUser) return perms;
    if (appState.currentUser.roleLevel === 'admin') {
        return { canView: true, canEdit: true, canDelete: true, canAddChild: true, canManageStructure: true, canManageDescendants: true };
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
        // 祖先節點**本身**仍然不可編輯、不可管理結構（不能改它的名稱/網址，也不能直接往它底下加東西）——
        // 但要開一個「進得去」的入口，讓委派者能走到自己真正被委派的子樹。
        // ⚠️ 這只是入口，不是權限：樹狀編輯器對每個子節點各自判定，後端 BatchUpdateMenusAsync 也會逐筆檢查。
        perms.canManageDescendants = true;
    }
    // 自己就管得動的節點，當然也管得動它的子孫（讓下游只需判斷這一個旗標）
    if (perms.canManageStructure) perms.canManageDescendants = true;

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
    
    // == Lazy-loading 攔截與即時渲染 ==
    if (target.getAttribute('data-lazy') === 'true') {
        const menuId = target.getAttribute('data-menu-id');
        const level = parseInt(target.getAttribute('data-level'), 10) || 2;
        const allMenus = (window.appState && window.appState._currentValidMenus) ? window.appState._currentValidMenus : [];
        
        const parentMenu = allMenus.find(m => window.cleanId(m.id) === window.cleanId(menuId));
        if (parentMenu) {
            const subMenus = allMenus.filter(m => m.id !== parentMenu.id && (window.isParentMatch(m.parentId, parentMenu) || (m.parentIds || []).some(pid => window.isParentMatch(pid, parentMenu))));
            subMenus.sort((a, b) => (a.parentOrders?.[parentMenu.id] ?? a.order ?? 0) - (b.parentOrders?.[parentMenu.id] ?? b.order ?? 0));
            
            let html = '';
            subMenus.forEach(child => {
                if (typeof window.generateSidebarMenuItem === 'function') {
                    html += window.generateSidebarMenuItem(child, allMenus, level, false);
                }
            });
            const container = target.querySelector('.sub-menu-container');
            if (container) container.innerHTML = html;
        }
        
        // 標記已載入，避免重複渲染
        target.removeAttribute('data-lazy');
    }

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

// 管理頁 DataTable 的「目前分頁」短期記憶：safeDestroyDataTable 摧毀前寫入、initDataTable 重建後讀回並清掉。
// 之所以要記在這裡而非各 render 函式：每個管理表都是「safeDestroyDataTable(同步摧毀) → 重建 tbody → initDataTable(50ms 後重建)」，
// 摧毀當下分頁資訊就已消失，故必須在摧毀前先擷取。集中於此一處即自動涵蓋所有分頁管理表（dtMenuConfig/dtWebpage/dtAccount/...）。
const _dtPageMemory = {};

// 管理頁 DataTable 的「每頁筆數 (pageLength)」session 記憶（存在 appState.dtPageLenMemory，整頁重整才會清空）。
//   rememberDtPageLen：摧毀前擷取使用者當下選的筆數；getDtPageLen：重建時讀回（無記錄則回預設）。
//   ⭐️ UX：使用者改筆數或整頁重整才回預設；拖曳/編輯儲存等 destroy+rebuild 應保留筆數，不可硬跳回 10。
export function rememberDtPageLen(tableId) {
    try {
        if (typeof $ !== 'undefined' && $.fn && $.fn.DataTable && $.fn.DataTable.isDataTable('#' + tableId)) {
            const len = $('#' + tableId).DataTable().page.len();
            if (typeof len === 'number' && len > 0) appState.dtPageLenMemory[tableId] = len;
        }
    } catch (e) { }
}
export function getDtPageLen(tableId, fallback = 10) {
    const len = appState.dtPageLenMemory ? appState.dtPageLenMemory[tableId] : undefined;
    return (typeof len === 'number' && len > 0) ? len : fallback;
}

// 管理頁 DataTable 的「剛新增置頂」機制（記憶體，整頁重整即消失）。
//   問題：新增一筆主選單配置/看板時，order 是接在最後面 → 新資料會掉到最後一頁，使用者按完新增後看不到成果。
//   規則：新增成功後，該筆固定顯示在第一頁最上方（多筆連續新增時最新的在最上），
//         直到使用者整頁重整才回歸原本的 order 排序。
const _dtForceFirstPage = {};

export function pinNewRow(tableId, id) {
    const cid = window.cleanId(id);
    if (!cid) return;
    if (!appState.dtPinnedNewIds) appState.dtPinnedNewIds = {};
    const list = appState.dtPinnedNewIds[tableId] || [];
    appState.dtPinnedNewIds[tableId] = [cid, ...list.filter(x => x !== cid)];
    // 光把列搬到最前面還不夠：safeDestroyDataTable 會把「使用者原本停留的頁次」記下來還原，
    // 若不一併要求回到第 1 頁，置頂的那列會在畫面外。
    _dtForceFirstPage[tableId] = true;
}

// 將被 pinNewRow 標記過的項目搬到陣列最前面，其餘維持呼叫端原本的排序。
//   rows：已排序好的資料陣列；getId：可選，取出該筆 id 的函式（預設吃 id / MenuId）。
export function applyPinnedNewFirst(tableId, rows, getId) {
    const pinned = (appState.dtPinnedNewIds && appState.dtPinnedNewIds[tableId]) || [];
    if (!pinned.length || !Array.isArray(rows) || rows.length === 0) return rows;
    const idOf = getId || (r => window.cleanId(r.id || r.MenuId));
    const head = [];
    pinned.forEach(pid => {
        const hit = rows.find(r => idOf(r) === pid);
        if (hit && !head.includes(hit)) head.push(hit);   // 已被刪除的 pinned id 找不到 → 自然略過
    });
    if (!head.length) return rows;
    return head.concat(rows.filter(r => !head.includes(r)));
}

// ⭐️ 2026-08-24 第八輪 J8：DataTables 的 destroy() **不會**清掉它塞在 <th> 上的 aria-label / aria-sort，
//    下一次 init 是直接在既有值後面「再接一段」 → 實測「廠區管理」重繪 3 次就累加到 5 段
//    「: activate to sort column ascending」，zh→en→ja→zh 往返後變 8 段；
//    而且開頭的欄名永遠停在**初次初始化時的語言**（切到英文/日文仍念中文「廠區(ID)」）。
//    所有 client-side DataTable（fab/role/webpage/menuConfig/apply/audit/personal）都中招。
//    修法：destroy() 之後、重新 init 之前把這兩個屬性移掉，讓 DataTables 用當下的語言重新產生。
//    ⚠️ 必須在 safeDestroyDataTable 與 initDataTable 內建的 destroy 分支**兩處**都做 ——
//       少數 render 路徑沒先呼叫 safeDestroyDataTable，只補一處會漏掉。
function clearDtHeaderAria(tableId) {
    try {
        document.querySelectorAll('#' + CSS.escape(tableId) + ' thead th').forEach(th => {
            th.removeAttribute('aria-label');
            th.removeAttribute('aria-sort');
        });
    } catch (e) { }
}

// 防呆小幫手：安全摧毀 DataTable（摧毀前先記住目前所在分頁＋每頁筆數，供重建後還原，避免狀態啟用/禁用、編輯、刪除後跳回第一頁/預設筆數）
export function safeDestroyDataTable(tableId) {
    try {
        if (typeof $ !== 'undefined' && $.fn && $.fn.DataTable && $.fn.DataTable.isDataTable('#' + tableId)) {
            try { _dtPageMemory[tableId] = $('#' + tableId).DataTable().page(); } catch (e) { }
            rememberDtPageLen(tableId);
            $('#' + tableId).DataTable().destroy();
            clearDtHeaderAria(tableId);
        }
    } catch (e) { }
}

export function initDataTable(tableId, sortable = true) {
    setTimeout(() => {
        try {
            if (typeof $ === 'undefined' || !$.fn || !$.fn.DataTable) return;
            if ($.fn.DataTable.isDataTable('#' + tableId)) {
                // 若 render 函式未先呼叫 safeDestroyDataTable（少數路徑），這裡補擷取一次分頁＋筆數再摧毀。
                try { _dtPageMemory[tableId] = $('#' + tableId).DataTable().page(); } catch (e) { }
                rememberDtPageLen(tableId);
                $('#' + tableId).DataTable().destroy();
            }
            clearDtHeaderAria(tableId);   // J8：無論走哪條 destroy 路徑，init 前一律清乾淨
            const dt = $('#' + tableId).DataTable({
                language: (typeof getDataTableLang === 'function') ? getDataTableLang() : {},
                pageLength: getDtPageLen(tableId), lengthMenu: [10, 25, 50, 100], ordering: sortable, order: [], autoWidth: false, stateSave: false
            });
            appState.dtInstances[tableId] = dt;
            // 還原摧毀前的分頁；資料列變少導致頁數縮減時 clamp 到最後一頁，避免落在空白頁（draw(false) 不重置分頁）。
            // ⭐️ 例外：剛按過新增（pinNewRow）時「不還原分頁」，讓畫面留在第 1 頁 —— 置頂的新資料才看得到。
            const forceFirstPage = _dtForceFirstPage[tableId] === true;
            delete _dtForceFirstPage[tableId];
            const savedPage = _dtPageMemory[tableId];
            if (!forceFirstPage && typeof savedPage === 'number' && savedPage > 0) {
                try {
                    const info = dt.page.info();
                    const targetPage = Math.min(savedPage, Math.max(0, info.pages - 1));
                    if (targetPage > 0) dt.page(targetPage).draw(false);
                } catch (e) { }
            }
            delete _dtPageMemory[tableId];
        } catch (e) { }
    }, 50);
}

// == 左側側邊欄產生邏輯 ==
export function renderSidebarMenus() {
    try {
        if (!appState.currentUser) return;

        let rawMenus = getCustomMenus();
        if (!Array.isArray(rawMenus)) rawMenus = [];
        let menus = JSON.parse(JSON.stringify(rawMenus)).filter(m => m && window.cleanId(m.id) !== '');
        let pSets = appState.currentLayoutMode === 'personal' ? getPersonalSettings(appState.currentUser.id) : {};
        const cCurrentFab = window.cleanId(appState.currentFab || appState.currentFab);
        const fabsList = getFabs();
        const currentFabObj = fabsList.find(f => window.cleanId(f.fabName || f.FabName || f.id || f.fabId || f.FabId) === cCurrentFab);

        const isOpenAccess = appState.openAccessMode === true || (window._authConfig && window._authConfig.openAccessMode === true);
        const isAdmin = appState.currentUser && appState.currentUser.roleLevel === 'admin';
        const fabRoleIds = currentFabObj ? (currentFabObj.assignedRoles || currentFabObj.AssignedRoles || []) : [];
        const userRoleIds = appState.currentUser ? (appState.currentUser.assignedRoles || appState.currentUser.AssignedRoles || []) : [];

        // ⭐️ 核心修復：如果為 Admin 或開啟了 OpenAccessMode，在當前廠區下應授權瀏覽「該廠區被指派的所有群組角色 (assignedRoles)」，從而精確呈現該廠區完整的上方導覽列選單組合 (不會混入其他廠區專門選單)；一般使用者則取交集。
        const activeRoleIds = (isAdmin || isOpenAccess) ? fabRoleIds : fabRoleIds.filter(id => userRoleIds.some(uId => window.cleanId(uId) === window.cleanId(id)));

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

        // per-fab 個別覆寫：extraMenus / denyMenus 形狀為 { fabName: [menuId,...] }，
        //   只取「當前廠區 (appState.currentFab)」的那一份，做到「在 12A 多看 X」「在 12M 禁看 Y」。
        const _ovForCurrentFab = (dict) => {
            if (!dict || typeof dict !== 'object') return [];
            if (Array.isArray(dict)) return dict;                              // 容錯：理論上不會是陣列（舊形狀）
            if (Array.isArray(dict[appState.currentFab])) return dict[appState.currentFab]; // 精準命中
            const key = Object.keys(dict).find(k => window.cleanId(k) === cCurrentFab);     // 容錯：cleanId 比對
            return key && Array.isArray(dict[key]) ? dict[key] : [];
        };

        // 帳號層級 extra (在 Role 之外、於「當前廠區」額外開放)
        const extraMenus = _ovForCurrentFab(appState.currentUser.extraMenus || appState.currentUser.ExtraMenus);
        if (extraMenus.length > 0) initialMenuIds.push(...extraMenus);

        let allowedSet = new Set(initialMenuIds.map(window.cleanId).filter(id => id !== ''));
        // ⭐️ 若該廠區完全沒有配置任何群組，且為 Admin 或 OpenAccessMode，才 fallback 展開全站選單
        if (allowedSet.size === 0 && (isAdmin || isOpenAccess)) {
            allowedSet = new Set(menus.map(m => window.cleanId(m.id)).filter(id => id !== ''));
        }

        // 帳號層級 deny — 但若該 menu 被 Menu ACL force-allow，仍視為允許 (Menu 優先)。只扣「當前廠區」這份。
        const accountDenySet = new Set(_ovForCurrentFab(appState.currentUser.denyMenus || appState.currentUser.DenyMenus).map(window.cleanId).filter(id => id !== ''));
        if (!isAdmin && !isOpenAccess) {
            accountDenySet.forEach(id => {
                if (!menuAclForceAllow.has(id)) allowedSet.delete(id);
            });
        }

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

        // ⭐️ 父選單被「禁用」(enabled===false) → 整個子樹（所有子選單/看板）都要一併移除。
        //    只過濾「自己 enabled===false」會讓子節點失去父節點 → 在後面 rootMenus 計算時被誤判成
        //    最上層而「升格」顯示在上方導覽列（曾發生：禁用「ZE 強化防禦群組」後，MNOP/WL子群組/
        //    ScalingTEST/Non Scaling/BSL 仍冒出在導覽列）。故先用 BFS 收集所有被禁用節點的後代成 killSet。
        const killSet = new Set();
        menus.filter(m => m.enabled === false).forEach(dRoot => {
            const dId = window.cleanId(dRoot.id);
            if (dId) killSet.add(dId);                                   // 禁用節點本身（descendant 收集起點）
            const queue = [dRoot];
            let guard = 0;
            while (queue.length > 0 && guard++ < 5000) {
                const cur = queue.shift();
                menus.forEach(ch => {
                    if (ch.id === cur.id) return;
                    const cId = window.cleanId(ch.id);
                    if (!cId || killSet.has(cId)) return;
                    if (window.isParentMatch(ch.parentId, cur) || (ch.parentIds || []).some(pid => window.isParentMatch(pid, cur))) {
                        killSet.add(cId);
                        queue.push(ch);
                    }
                });
            }
        });

        let validMenus = menus.filter(m => {
            let cId = window.cleanId(m.id);
            if (!cId || !allowedSet.has(cId)) return false;
            if (m.enabled === false) return false;
            if (killSet.has(cId)) return false;                         // ⭐️ 祖先被禁用 → 整個子樹一併隱藏
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

        // ⭐️ 核心修復：rootMenus（上方導覽列）一律依「allowedMenuIds 串接順序 (dedupedInitIds)」排，
        //   避免與全域 m.order 混用導致非遞移性排序崩潰。
        //   個人模式下若該 root 有「個人拖曳順序」(pSets[id].order) 則優先採用；無（如「還原預設版面」後）
        //   則 fallback 到 dedupedInitIds → 自訂版面的上方導覽列與系統版面完全相同。
        //   （此與 render/tables.js renderPersonalMenuManage 的 root order 邏輯一致，三處 nav/table/system 同序。）
        rootMenus.sort((a, b) => {
            const keyOf = (m) => {
                if (inPersonalMode) {
                    const po = pSets[m.id] ? pSets[m.id].order : undefined;
                    if (po != null) return po;                          // 個人拖曳順序優先
                }
                const idx = dedupedInitIds.indexOf(window.cleanId(m.id));
                return idx === -1 ? 9999 : idx;                         // 無個人順序 → 與系統版面同序
            };
            return keyOf(a) - keyOf(b);
        });

        if (rootMenus.length === 0 && menus.length > 0) rootMenus = menus.slice(0, 5);
        if (appState.currentActiveTopMenuId !== 'system_settings' && (!appState.currentActiveTopMenuId || !rootMenus.find(m => window.cleanId(m.id) === window.cleanId(appState.currentActiveTopMenuId)))) {
            let matchedRoot = null;
            if (appState.currentActiveSidebarMenuId) {
                const targetNode = menus.find(m => window.cleanId(m.id || m.MenuId) === window.cleanId(appState.currentActiveSidebarMenuId));
                if (targetNode) {
                    let queue = [targetNode];
                    let visited = new Set([window.cleanId(targetNode.id || targetNode.MenuId)]);
                    while (queue.length > 0 && !matchedRoot) {
                        const curr = queue.shift();
                        const currId = window.cleanId(curr.id || curr.MenuId);
                        const r = rootMenus.find(rm => window.cleanId(rm.id || rm.MenuId) === currId);
                        if (r) { matchedRoot = r.id; break; }
                        let pIds = [];
                        if (curr.parentId || curr.ParentMenuId) pIds.push(window.cleanId(curr.parentId || curr.ParentMenuId));
                        if (Array.isArray(curr.parentIds)) curr.parentIds.forEach(pid => { if (pid) pIds.push(window.cleanId(pid)); });
                        pIds.forEach(pid => {
                            if (!visited.has(pid)) {
                                visited.add(pid);
                                const parentNode = menus.find(m => window.cleanId(m.id || m.MenuId) === pid);
                                if (parentNode) queue.push(parentNode);
                            }
                        });
                    }
                }
            }
            if (matchedRoot) {
                appState.currentActiveTopMenuId = matchedRoot;
            } else if (rootMenus.length > 0) {
                appState.currentActiveTopMenuId = rootMenus[0].id;
            }
        }

        let topLinksHtml = '';
        if (rootMenus && rootMenus.length > 0) {
            rootMenus.forEach(root => {
                if (root.id === 'system_settings') return;
                let dName = root.displayName || root.name || t('menu_unnamed', '未命名選單');
                if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang]['dyn_' + root.id] && !root.isEdited) dName = i18n[appState.currentLang]['dyn_' + root.id];
                const isActive = window.cleanId(root.id) === window.cleanId(appState.currentActiveTopMenuId) ? 'active' : '';
                // ⚠️ ID 進 JS onclick 一律 _jsArg()（CLAUDE.md §4-前端-5）：看板 ID 是管理者自由輸入
                topLinksHtml += `<a class="top-menu-link text-truncate ${isActive}" onclick="selectTopMenu('${window._jsArg(root.id)}')" title="${window.escapeHTML(dName)}">${window.escapeHTML(dName)}</a>`;
            });
        }
        const topMenusContainer = document.getElementById('top-dynamic-menus');
        if (topMenusContainer) topMenusContainer.innerHTML = topLinksHtml;

        const sysBtn = document.getElementById('btn-system-settings');
        if (sysBtn) {
            if (appState.currentActiveTopMenuId === 'system_settings') sysBtn.classList.add('active');
            else sysBtn.classList.remove('active');
        }

        // === 2. 依目前上方導覽列選取項目，渲染左側目錄樹 ===
        let html = '';
        const triggerLeft = document.getElementById('trigger-left');

        if (appState.currentActiveTopMenuId === 'system_settings') {
            const titleEl = document.getElementById('sidebar-module-title');
            if (titleEl) titleEl.innerText = t('nav_sys_settings', '系統設定');
            setTimeout(() => { if (triggerLeft) triggerLeft.style.display = 'block'; if (appState.isPinned) document.body.classList.remove('sidebar-hidden'); }, 10);

            const role = appState.currentUser.roleLevel;
            const canManage = role === 'admin' || (role === 'user' && appState.currentUser.manageableMenus && appState.currentUser.manageableMenus.length > 0);

            // ⭐️ 根據目前的版面模式決定是否顯示「個人頁面管理」與系統選單
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
                { id: 'page-traffic-stats', icon: 'fas fa-chart-line', i18nKey: 'menu_traffic_stats', fallback: '流量與使用率', display: role === 'admin' },
                { id: 'page-config-manage', icon: 'fas fa-database', i18nKey: 'db_sync', fallback: '資料庫與同步', display: role === 'admin' }
            ];
            sysMenus.forEach(sm => {
                // role/tabindex 必留：這是 <div> 不是 <button>，沒有它就完全 Tab 不到、Enter 也沒反應。
                // Enter/Space 的實際啟動由 main.js 的委派 keydown 統一處理（子選單是 lazy 插入的，逐處綁定會漏）。
                // 第 4 參數傳 i18nKey（L1）：這些系統設定分頁**不會**被 renderSidebarMenus 還原 `.active`
                // （還原是靠 appState.currentActiveSidebarMenuId，而 navTo 這條路徑不會設它）→ 切語言時
                // refreshBreadcrumb 找不到節點可取名，只能靠 key 重譯，否則麵包屑會卡在進來時的語系。
                if (sm.display) { const smName = t(sm.i18nKey, sm.fallback); html += `<div class="menu-item" role="button" tabindex="0" onclick="navTo('${sm.id}', this, '${smName}', '${sm.i18nKey}')"><i class="${sm.icon} menu-icon" aria-hidden="true"></i> <span class="text-truncate">${smName}</span></div>`; }
            });
        } else {
            const activeRoot = rootMenus.find(m => window.cleanId(m.id) === window.cleanId(appState.currentActiveTopMenuId));
            // ⚠️ 2026-08-24（第七輪 J11）：#sidebar-module-title 的 data-i18n 已移除（它是 JS 動態填值的元素），
            //    所以「找不到 activeRoot」這條路徑必須自己補上預設字串，否則會殘留上一個模組的名稱。
            if (!activeRoot) {
                const fallbackTitleEl = document.getElementById('sidebar-module-title');
                if (fallbackTitleEl) fallbackTitleEl.innerText = t('sidebar_module', '模組目錄');
            }
            if (activeRoot) {
                const titleEl = document.getElementById('sidebar-module-title');
                if (titleEl) titleEl.innerText = activeRoot.displayName || activeRoot.name || t('menu_unnamed', '未命名選單');
                const isFolder = (activeRoot.menuMode || activeRoot.MenuMode) === 'folder';
                const subMenus = isFolder ? menus.filter(m => m.id !== activeRoot.id && (window.isParentMatch(m.parentId, activeRoot) || (m.parentIds || []).some(pid => window.isParentMatch(pid, activeRoot)))) : [];

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
        if (sidebarContainer) {
            sidebarContainer.innerHTML = html;
            if (appState.currentActiveSidebarMenuId) {
                const targetCleanId = window.cleanId(appState.currentActiveSidebarMenuId);
                const items = sidebarContainer.querySelectorAll('.sidebar-link, .menu-item');
                items.forEach(el => {
                    const elCleanId = window.cleanId(el.getAttribute('data-id') || el.id || '');
                    const onclickStr = el.getAttribute('onclick') || '';
                    if (elCleanId === targetCleanId || onclickStr.includes(`'${appState.currentActiveSidebarMenuId}'`) || onclickStr.includes(`"${appState.currentActiveSidebarMenuId}"`)) {
                        el.classList.add('active');
                        let parentLi = el.closest('li');
                        while (parentLi) {
                            const parentSubmenu = parentLi.closest('ul.sidebar-submenu');
                            if (parentSubmenu) {
                                parentSubmenu.classList.add('show');
                                const toggleEl = parentSubmenu.previousElementSibling;
                                if (toggleEl && toggleEl.classList.contains('menu-toggle')) {
                                    toggleEl.classList.add('open');
                                }
                                parentLi = parentSubmenu.closest('li');
                            } else {
                                break;
                            }
                        }
                    }
                });
            }
        }

        // ⭐️ App Shell Caching：將渲染結果存入 localStorage，供 Ctrl+F5 瞬間恢復畫面使用
        if (topMenusContainer) localStorage.setItem('app_shell_top_menus', topMenusContainer.innerHTML);
        if (sidebarContainer) localStorage.setItem('app_shell_sidebar_menus', sidebarContainer.innerHTML);

    } catch (err) { console.error("renderSidebarMenus error", err); }
}

// Expose for HTML inline handlers
window.safeDestroyDataTable = safeDestroyDataTable;
window.initDataTable = initDataTable;
window.renderSidebarMenus = renderSidebarMenus;


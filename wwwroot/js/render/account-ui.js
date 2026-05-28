// === render/account-ui.js - 帳號 Modal 內部 UI 渲染 ===

function renderAccRoleCheckboxes(selectedIds) {
    if (!selectedIds || !Array.isArray(selectedIds)) selectedIds = [];
    const container = document.getElementById('accRoleCheckboxes');
    if (!container) return;
    container.innerHTML = '';

    let html = [];
    getRoles().forEach(r => {
        const rId = r.id || r.roleId || r.RoleId || '';
        const rName = r.groupName || r.GroupName || rId;
        const isChecked = selectedIds.includes(rId) ? 'checked' : '';

        html.push(`
            <div class="form-check form-check-inline border rounded px-3 py-1 bg-white mb-1 shadow-sm" style="border-color: #dee2e6 !important;">
                <input class="form-check-input ms-0 me-2 acc-role-cb cursor-pointer" type="checkbox" id="acr_${rId}" value="${rId}" ${isChecked}>
                <label class="form-check-label small fw-bold text-dark cursor-pointer" for="acr_${rId}">${rName}</label>
            </div>
        `);
    });
    container.innerHTML = html.join('');

    // ⭐️ 勾選/取消勾選角色時，立刻刷新「管理目錄」清單與「各廠區預設首頁」
    if (!container.hasAttribute('data-roles-bound')) {
        container.setAttribute('data-roles-bound', '1');
        container.addEventListener('change', (e) => {
            if (!e.target.classList.contains('acc-role-cb')) return;
            // 保留目前勾選的管理目錄狀態
            const stillChecked = Array.from(document.querySelectorAll('.acc-menu-cb:checked')).map(cb => cb.value);
            if (typeof renderAccManageMenuCheckboxes === 'function') {
                renderAccManageMenuCheckboxes(stillChecked);
            }
            if (typeof renderAccDefaultPagesUI === 'function') renderAccDefaultPagesUI();
        });
    }
}

// 「管理目錄」清單：只列出「該帳號目前勾選的角色 → role.allowedMenuIds（含其下層）」中
// 屬於 folder 型的選單。沒選任何角色 / 沒對應的 folder → 顯示提示。
function renderAccManageMenuCheckboxes(selectedIds) {
    if (!selectedIds || !Array.isArray(selectedIds)) selectedIds = [];
    const container = document.getElementById('accManageMenuCheckboxes');
    if (!container) return;
    container.innerHTML = '';

    // 取當前 modal 內已勾選的角色（即時讀 DOM，避免依賴外部傳入）
    const checkedRoleIds = Array.from(document.querySelectorAll('.acc-role-cb:checked')).map(cb => cb.value);
    const allMenus = getCustomMenus();

    if (checkedRoleIds.length === 0) {
        container.innerHTML = '<div class="text-warning small px-2 py-1"><i class="fas fa-exclamation-circle me-1"></i>請先在「可視群組版面」勾選至少一個角色，才能授權管理目錄</div>';
        return;
    }

    // 1) 從勾選角色蒐集 allowedMenuIds
    const roles = getRoles();
    let initialMenuIds = [];
    checkedRoleIds.forEach(rId => {
        const role = roles.find(r => window.cleanId(r.id || r.RoleId) === window.cleanId(rId));
        if (role && (role.allowedMenuIds || role.AllowedMenuIds)) {
            initialMenuIds.push(...(role.allowedMenuIds || role.AllowedMenuIds));
        }
    });

    // 2) 展開階層（包含子節點）
    const eligibleIds = window.getAllowedIdsWithHierarchy(allMenus, initialMenuIds);

    // 3) 篩選出「啟用 + 為 folder + 在 eligibleIds 內」
    const folderMenus = allMenus.filter(m =>
        (m.menuMode || m.MenuMode || '').toLowerCase() === 'folder' &&
        (m.enabled !== false && m.IsEnabled !== false) &&
        eligibleIds.has(m.id || m.MenuId)
    );

    if (folderMenus.length === 0) {
        container.innerHTML = '<div class="text-muted small px-2 py-1"><i class="fas fa-info-circle me-1 opacity-50"></i>所選角色在可視廠區內沒有可委派的主選單目錄</div>';
        return;
    }

    let html = [];
    folderMenus.forEach(m => {
        const mId = m.id || m.MenuId || '';
        const mDName = m.displayName || m.DisplayName || '';
        const isChecked = selectedIds.some(s => window.cleanId(s) === window.cleanId(mId)) ? 'checked' : '';
        html.push(`
            <div class="form-check mb-1 ms-1 d-flex align-items-center">
                <input class="form-check-input acc-menu-cb cursor-pointer mt-0" type="checkbox" id="acm_${mId}" value="${mId}" ${isChecked}>
                <label class="form-check-label fw-bold text-dark cursor-pointer d-flex align-items-center ms-2" for="acm_${mId}">
                    <i class="fas fa-folder text-warning me-2 fs-5"></i> ${mDName}
                </label>
            </div>
        `);
    });
    container.innerHTML = html.join('');
}

function renderAccDefaultPagesUI() {
    const container = document.getElementById('accDefaultPagesContainer'); if (!container) return;
    const fabs = getFabs(); const menus = getCustomMenus(); let html = '';
    const escAttr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    fabs.forEach(f => {
        const fName = f.fabName || f.FabName || f.id || f.fabId || f.FabId || '';
        let defMenuId = tempDefaultPages[fName];
        let defMenuObj = menus.find(m => window.cleanId(m.id || m.MenuId) === window.cleanId(defMenuId));
        let displayTxt = defMenuObj ? getFullMenuPathStr(defMenuId, menus) : '系統自動抓取第一個可視看板';
        let txtColor = defMenuObj ? 'text-success fw-bold' : 'text-muted';

        // 使用 data-fab + addEventListener 取代 inline onclick，避免名稱含引號時注入
        html += `
            <div class="d-flex align-items-center mb-2 border-bottom pb-2">
                <span class="badge bg-secondary me-2" style="width: 45px;">${fName}</span>
                <span class="flex-grow-1 text-truncate small ${txtColor}" id="def_text_${escAttr(fName)}">預設：${displayTxt}</span>
                <button type="button" class="btn btn-sm btn-outline-primary py-0 px-3 fw-bold rounded-pill shadow-sm js-pick-default" data-fab="${escAttr(fName)}">指定</button>
                <button type="button" class="btn btn-sm btn-outline-danger border-0 py-0 px-2 ms-1 js-clear-default" data-fab="${escAttr(fName)}" title="清除設定"><i class="fas fa-times"></i></button>
            </div>
        `;
    });
    container.innerHTML = html;

    if (!container.hasAttribute('data-bound')) {
        container.setAttribute('data-bound', '1');
        container.addEventListener('click', function (e) {
            const pickBtn = e.target.closest('.js-pick-default');
            const clearBtn = e.target.closest('.js-clear-default');
            if (pickBtn) {
                const fab = pickBtn.getAttribute('data-fab');
                if (typeof openMenuSelector === 'function') openMenuSelector(fab);
            } else if (clearBtn) {
                const fab = clearBtn.getAttribute('data-fab');
                if (typeof clearDefaultMenu === 'function') clearDefaultMenu(fab);
            }
        });
    }
}

// ⭐️ 物理強制關閉抽屜 (解掉 blocked aria-hidden focus 的錯誤)
window.closeMenuSelector = function () {
    if (document.activeElement) document.activeElement.blur();
    const drawerEl = document.getElementById('menuSelectDrawer');
    if (drawerEl) {
        drawerEl.classList.remove('show');
        setTimeout(() => { drawerEl.style.visibility = 'hidden'; }, 300);
    }
    const backdrop = document.getElementById('offcanvas-force-backdrop');
    if (backdrop) backdrop.remove();
};

window.toggleDrawerCollapse = function (e, targetId, element) {
    e.preventDefault(); e.stopPropagation();
    const targetEl = document.getElementById(targetId);
    if (!targetEl) return;
    if (targetEl.classList.contains('show')) {
        targetEl.classList.remove('show'); element.classList.add('collapsed'); element.setAttribute('aria-expanded', 'false');
    } else {
        targetEl.classList.add('show'); element.classList.remove('collapsed'); element.setAttribute('aria-expanded', 'true');
    }
};

window.openMenuSelector = function (fabName) {
    if (document.activeElement) document.activeElement.blur();

    let pickingInput = document.getElementById('pickingForFab');
    if (!pickingInput) {
        pickingInput = document.createElement('input');
        pickingInput.type = 'hidden'; pickingInput.id = 'pickingForFab';
        document.body.appendChild(pickingInput);
    }
    pickingInput.value = fabName;

    // 此時 HTML 中已經完美具備了 Z-index 10600 的 Drawer
    const drawerEl = document.getElementById('menuSelectDrawer');
    const container = document.getElementById('menuSelectDrawerContainer');
    container.innerHTML = '';
    const searchInput = document.getElementById('menuSelectSearchInput');
    if (searchInput) searchInput.value = '';

    const roleLevel = document.getElementById('accRoleLevel').value;
    let assignedRoles = []; document.querySelectorAll('.acc-role-cb:checked').forEach(cb => assignedRoles.push(cb.value));

    const fabs = getFabs();
    const fabObj = fabs.find(f => window.cleanId(f.fabName || f.FabName || f.id || f.fabId || f.FabId) === window.cleanId(fabName));
    const fabRoleIds = fabObj ? (fabObj.assignedRoles || fabObj.AssignedRoles || []) : [];

    const activeRoleIds = (roleLevel === 'admin') ? fabRoleIds : fabRoleIds.filter(id => assignedRoles.includes(id));
    const roles = getRoles(); let initialMenuIds = [];
    activeRoleIds.forEach(roleId => {
        const role = roles.find(r => window.cleanId(r.id || r.RoleId) === window.cleanId(roleId));
        const allowed = role ? (role.allowedMenuIds || role.AllowedMenuIds || []) : [];
        if (allowed) initialMenuIds.push(...allowed);
    });

    const allMenus = getCustomMenus();
    let allowedIds = new Set(initialMenuIds.map(id => window.cleanId(id)));

    if (roleLevel === 'admin') {
        allMenus.forEach(m => allowedIds.add(window.cleanId(m.id || m.MenuId)));
    } else {
        let added = true;
        while (added) {
            added = false;
            allMenus.forEach(m => {
                let mId = window.cleanId(m.id || m.MenuId);
                if (!allowedIds.has(mId)) {
                    let pId = window.cleanId(m.parentId || m.ParentMenuId || (m.parentIds && m.parentIds[0]));
                    if (allowedIds.has(pId)) { allowedIds.add(mId); added = true; }
                }
            });
        }
    }

    const viewableMenus = allMenus.filter(m => String(m.menuMode || m.MenuMode).toLowerCase() !== 'folder' && (m.enabled !== false && m.IsEnabled !== false) && allowedIds.has(window.cleanId(m.id || m.MenuId)));

    if (viewableMenus.length === 0) {
        container.innerHTML = `<div class="text-center text-muted py-5 fw-bold"><i class="fas fa-folder-open mb-3 fs-1 opacity-50"></i><br>此帳號在該廠區沒有可觀看的看板。<br><small class="fw-normal">請先勾選下方的可視群組版面。</small></div>`;
    } else {
        let groups = {};
        viewableMenus.forEach(m => {
            let rootNode = m;
            while (rootNode && (rootNode.parentId || rootNode.ParentMenuId || (rootNode.parentIds && rootNode.parentIds.length > 0))) {
                let pId = rootNode.parentId || rootNode.ParentMenuId || rootNode.parentIds[0];
                let parent = allMenus.find(x => window.cleanId(x.id || x.MenuId) === window.cleanId(pId));
                if (parent) rootNode = parent; else break;
            }

            let rId = rootNode ? window.cleanId(rootNode.id || rootNode.MenuId) : 'other';
            let rName = rootNode ? (rootNode.displayName || rootNode.DisplayName || rootNode.name || rootNode.SysName) : '其他獨立看板';
            if (typeof i18n !== 'undefined' && i18n[currentLang] && i18n[currentLang]['dyn_' + rId] && rootNode && !rootNode.isEdited && !rootNode.IsEdited) rName = i18n[currentLang]['dyn_' + rId];

            const rOrder = rootNode ? (rootNode.order || rootNode.GlobalOrder || 999) : 999;
            const rIcon = rootNode ? (rootNode.icon || rootNode.Icon || 'fas fa-link') : 'fas fa-link';

            if (!groups[rId]) groups[rId] = { rootName: rName, rootIcon: rIcon, items: [], order: rOrder };

            const mId = window.cleanId(m.id || m.MenuId);
            let fullPathStr = typeof getFullMenuPathStr === 'function' ? getFullMenuPathStr(mId, allMenus) : (m.displayName || m.DisplayName);
            let pathArr = fullPathStr.split(' / ');
            if (pathArr.length > 1) pathArr.shift(); pathArr.pop();
            let subPath = pathArr.join(' / ');

            const mMode = m.menuMode || m.MenuMode;
            const mOrder = m.order || m.GlobalOrder || 999;
            groups[rId].items.push({ id: mId, name: m.name || m.SysName, displayName: m.displayName || m.DisplayName, subPath: subPath, type: mMode, order: mOrder });
        });

        const sortedGroupKeys = Object.keys(groups).sort((a, b) => groups[a].order - groups[b].order);
        let html = ``; let isFirst = true;

        sortedGroupKeys.forEach((rId, index) => {
            let group = groups[rId];
            group.items.sort((a, b) => a.order - b.order);

            let listHtml = `<div class="bg-white border border-top-0 rounded-bottom pt-1 pb-2 shadow-sm">`;
            group.items.forEach(item => {
                let badge = item.type === 'app_grid' ? '<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 ms-2" style="font-size:0.6rem;">應用集合</span>' : '';
                let subPathHtml = item.subPath ? `<div class="badge bg-secondary bg-opacity-10 text-secondary border mt-1 fw-normal" style="font-size:0.65rem;">位於: ${item.subPath}</div>` : '';

                listHtml += `
                    <div class="drawer-item d-flex justify-content-between align-items-center p-2 border-bottom cursor-pointer hover-bg-light" style="transition: all 0.2s;" onclick="pickDefaultMenu('${item.id}'); window.closeMenuSelector();">
                        <div class="pe-2">
                            <div class="fw-bold text-dark d-flex align-items-center mb-0" style="font-size: 0.85rem;">
                                <i class="fas ${item.type === 'app_grid' ? 'fa-th-large text-success' : 'fa-file-alt text-secondary'} item-icon me-2 opacity-75"></i> ${item.displayName} ${badge}
                            </div>
                            ${subPathHtml}
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-primary px-3 fw-bold rounded-pill shadow-sm bg-white" style="font-size: 0.75rem; flex-shrink: 0;" onclick="event.stopPropagation(); pickDefaultMenu('${item.id}'); window.closeMenuSelector();">選取</button>
                    </div>
                `;
            });
            listHtml += `</div>`;

            let iconHtml = typeof generateIconHtml === 'function' ? generateIconHtml(group.rootIcon, 'text-primary', '', true) : `<i class="${group.rootIcon} text-primary"></i>`;

            html += `
                <div class="drawer-group mb-3">
                    <div class="drawer-group-title bg-white border rounded shadow-sm p-3 d-flex justify-content-between align-items-center cursor-pointer ${isFirst ? '' : 'collapsed'}" onclick="window.toggleDrawerCollapse(event, 'drawer_col_${index}', this)" aria-expanded="${isFirst ? 'true' : 'false'}">
                        <div class="d-flex align-items-center">
                            <div style="width:24px; text-align:center;" class="me-2">${iconHtml}</div>
                            <span class="fw-bold text-dark fs-6">${group.rootName}</span>
                        </div>
                        <span class="badge bg-white text-dark border border-secondary rounded-pill shadow-sm px-2">${group.items.length}</span>
                    </div>
                    <div class="collapse ${isFirst ? 'show' : ''}" id="drawer_col_${index}">
                        ${listHtml}
                    </div>
                </div>
            `;
            isFirst = false;
        });
        container.innerHTML = html;
    }

    // ⭐️ 物理強制霸道展開：無條件將抽屜移到 body 最末端，套用突破天際的 z-index 999999
    if (drawerEl) {
        if (drawerEl.parentElement !== document.body) {
            document.body.appendChild(drawerEl);
        }
        drawerEl.style.setProperty('z-index', '999999', 'important');
        drawerEl.style.setProperty('position', 'fixed', 'important');
        drawerEl.style.visibility = 'visible';
        void drawerEl.offsetWidth;
        drawerEl.classList.add('show');

        let offBackdrop = document.getElementById('offcanvas-force-backdrop');
        if (!offBackdrop) {
            offBackdrop = document.createElement('div');
            offBackdrop.id = 'offcanvas-force-backdrop';
            offBackdrop.className = 'modal-backdrop fade show';
            offBackdrop.style.setProperty('z-index', '999998', 'important');
            offBackdrop.onclick = window.closeMenuSelector;
            document.body.appendChild(offBackdrop);
        }

        setTimeout(() => { const input = document.getElementById('menuSelectSearchInput'); if (input) input.focus(); }, 300);
    }
};

window.filterMenuSelectDrawer = function () {
    const input = document.getElementById('menuSelectSearchInput').value.toLowerCase();
    const groups = document.querySelectorAll('#menuSelectDrawerContainer .drawer-group');

    groups.forEach(grpItem => {
        const listItems = grpItem.querySelectorAll('.drawer-item');
        let hasVisibleChild = false;

        listItems.forEach(li => {
            const text = li.innerText.toLowerCase();
            if (text.includes(input)) {
                li.style.setProperty('display', 'flex', 'important');
                hasVisibleChild = true;
            } else {
                li.style.setProperty('display', 'none', 'important');
            }
        });

        if (hasVisibleChild) {
            grpItem.style.display = 'block';
            if (input.trim() !== '') {
                const collapseEl = grpItem.querySelector('.collapse');
                if (collapseEl && !collapseEl.classList.contains('show')) {
                    collapseEl.classList.add('show');
                    const titleEl = grpItem.querySelector('.drawer-group-title');
                    if (titleEl) { titleEl.classList.remove('collapsed'); titleEl.setAttribute('aria-expanded', 'true'); }
                }
            }
        } else {
            grpItem.style.display = 'none';
        }
    });
};



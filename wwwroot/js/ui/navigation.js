// === ui/navigation.js - 語系切換、選單導航、路由、iframe ===
function changeLanguage(lang) {
    currentLang = lang;

    // 1. 全面掃描 data-i18n 屬性，替換靜態 HTML 文字
    if (typeof i18n !== 'undefined') {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (i18n[lang] && i18n[lang][key] !== undefined && i18n[lang][key] !== null) el.innerHTML = i18n[lang][key];
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
    if (currentUser && typeof renderSidebarMenus === 'function') renderSidebarMenus();

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
    }
}
window.changeLanguage = changeLanguage;


function renderLangSwitcher() {
    const container = document.getElementById('lang-dropdown-menu');
    if (!container) return;

    const langs = [
        { code: 'zh', label: '繁體中文' },
        { code: 'en', label: 'English' },
        { code: 'ja', label: '日本語' }
    ];

    container.innerHTML = langs.map(l => `
        <li>
            <a class="dropdown-item py-1 fw-bold cursor-pointer d-flex justify-content-between align-items-center
                ${currentLang === l.code ? 'active bg-light text-primary' : ''}"
               onclick="changeLanguage('${l.code}')">
                ${l.label}
                ${currentLang === l.code ? '<i class="fa-solid fa-check"></i>' : ''}
            </a>
        </li>
    `).join('');
}
window.renderLangSwitcher = renderLangSwitcher;

// 取得上方導覽列名稱
function getTopMenuName() {
    if (window.currentActiveTopMenuId === 'system_settings') return t('nav_sys_settings', '系統設定');
    if (!window.currentActiveTopMenuId) return '';
    const menus = getCustomMenus();
    const cTargetId = window.cleanId(window.currentActiveTopMenuId);
    const topMenu = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === cTargetId);
    if (topMenu) {
        let mId = topMenu.id || topMenu.MenuId || topMenu.menuId;
        let dName = topMenu.displayName || topMenu.DisplayName || topMenu.sysName || topMenu.SysName;
        let isEdited = topMenu.isEdited || topMenu.IsEdited;

        if (typeof i18n !== 'undefined' && i18n[currentLang] && i18n[currentLang]['dyn_' + mId] && !isEdited) {
            dName = i18n[currentLang]['dyn_' + mId];
        }
        return dName;
    }
    return '';
}

// 取得麵包屑路徑
function getMenuPath(element) {
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
function getFullMenuPathStr(menuId, allMenus) {
    let path = [];
    let cTargetId = window.cleanId(menuId);
    let curr = allMenus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === cTargetId);

    while (curr) {
        let mId = curr.id || curr.MenuId || curr.menuId;
        let dName = curr.displayName || curr.DisplayName || curr.sysName || curr.SysName;
        let isEdited = curr.isEdited || curr.IsEdited;

        if (typeof i18n !== 'undefined' && i18n[currentLang] && i18n[currentLang]['dyn_' + mId] && !isEdited) {
            dName = i18n[currentLang]['dyn_' + mId];
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
function selectTopMenu(menuId) {
    window.currentActiveTopMenuId = menuId;
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
            // 側邊欄沒有東西，代表這是一個獨立的主選單網頁，直接執行開啟動作
            const menus = getCustomMenus();
            const activeRoot = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === window.cleanId(menuId));

            if (activeRoot) {
                let mId = activeRoot.id || activeRoot.MenuId || activeRoot.menuId;
                let dName = activeRoot.displayName || activeRoot.DisplayName || activeRoot.sysName || activeRoot.SysName;
                let mMode = activeRoot.menuMode || activeRoot.MenuMode;
                let mUrl = activeRoot.url || activeRoot.Url;
                let mTarget = activeRoot.target || activeRoot.Target || activeRoot.openTarget || activeRoot.OpenTarget;
                let mTargetPage = activeRoot.targetPage || activeRoot.TargetPage;
                let isEdited = activeRoot.isEdited || activeRoot.IsEdited;

                if (typeof i18n !== 'undefined' && i18n[currentLang] && i18n[currentLang]['dyn_' + mId] && !isEdited) {
                    dName = i18n[currentLang]['dyn_' + mId];
                }

                if (mMode === 'app_grid') openAppGridPage(mId, dName, null);
                else if (mUrl) {
                    if (mTarget === 'blank') window.open(mUrl, '_blank');
                    else if (mTarget === 'fullscreen') openDynamicIframe(mUrl, dName, null, true);
                    else openDynamicIframe(mUrl, dName, null, false);
                }
                else if (mTargetPage) navTo(mTargetPage, null, dName);
                else {
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
                    if (textEl) textEl.innerText = `${dName} 內容建置中`;
                    navTo('page-under-construction', null, dName);
                }
            }
        } else if (firstLeafEl) {
            // 側邊欄有東西，代表這是一個群組，自動點擊群組內的第一個網頁
            firstLeafEl.click();
        }
    }, 50);
}

// ⭐️ 核心修復：點擊啟動特定看板 (加入對 DB 欄位大寫的全面支援)
function activateMenu(menuId) {
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
        let currNode = targetMenu;
        while (currNode) {
            let pId = currNode.parentId || currNode.ParentMenuId || currNode.parentMenuId || (currNode.parentIds && currNode.parentIds.length > 0 ? currNode.parentIds[0] : null);
            let cPId = window.cleanId(pId);
            if (cPId && cPId !== 'null') {
                currNode = menus.find(m => window.cleanId(m.id || m.MenuId || m.menuId) === cPId);
                if (currNode) rootId = currNode.id || currNode.MenuId || currNode.menuId;
                else break;
            } else {
                break;
            }
        }

        window.currentActiveTopMenuId = rootId;
        window.currentActiveSidebarMenuId = menuId;

        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

        let mId = targetMenu.id || targetMenu.MenuId || targetMenu.menuId;
        let dName = targetMenu.displayName || targetMenu.DisplayName || targetMenu.sysName || targetMenu.SysName;
        let mMode = targetMenu.menuMode || targetMenu.MenuMode;
        let mUrl = targetMenu.url || targetMenu.Url;
        let mTarget = targetMenu.target || targetMenu.Target || targetMenu.openTarget || targetMenu.OpenTarget;
        let mTargetPage = targetMenu.targetPage || targetMenu.TargetPage;
        let isEdited = targetMenu.isEdited || targetMenu.IsEdited;

        if (typeof i18n !== 'undefined' && i18n[currentLang] && i18n[currentLang]['dyn_' + mId] && !isEdited) {
            dName = i18n[currentLang]['dyn_' + mId];
        }

        const elList = document.querySelectorAll('.menu-item');
        let targetEl = null;
        elList.forEach(el => { if (el.getAttribute('onclick') && el.getAttribute('onclick').includes(mId)) targetEl = el; });

        if (mMode === 'app_grid') openAppGridPage(mId, dName, targetEl);
        else if (mUrl) {
            // 依 OpenTarget 區分：blank=另開分頁 / fullscreen=全螢幕 / 其他=畫面內嵌
            if (mTarget === 'blank') {
                window.open(mUrl, '_blank');
            } else if (mTarget === 'fullscreen') {
                openDynamicIframe(mUrl, dName, targetEl, true);
            } else {
                openDynamicIframe(mUrl, dName, targetEl, false);
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
            if (textEl) textEl.innerText = `${dName} 內容建置中`;
            navTo('page-under-construction', targetEl, dName);
        }
    } catch (error) {
        console.error("🚨 啟動看板時發生錯誤:", error);
    }
}

// ⭐️ 對齊 TEST_20260429.html:3496 的預設首頁跳轉（含廠區過濾、folder 自動取第一個子節點）
function goDefaultHome() {
    try {
        if (!currentUser) return;

        let defPage = null;

        // 1. 優先使用該帳號在目前廠區設定的專屬首頁
        if (currentUser.defaultPages && currentUser.defaultPages[currentFab]) {
            defPage = currentUser.defaultPages[currentFab];
        } else if (currentUser.defaultPage) {
            defPage = currentUser.defaultPage; // 向下相容舊資料
        }

        const menus = getCustomMenus() || [];

        // 2. 未設定 → 依目前廠區 fab.assignedRoles 與帳號 assignedRoles 的交集，找出該帳號可看的第一個 root
        if (!defPage) {
            const currentFabObj = getFabs().find(f => window.cleanId(f.fabName || f.FabName) === window.cleanId(currentFab));
            if (currentFabObj) {
                const fabRoleIds = currentFabObj.assignedRoles || currentFabObj.AssignedRoles || [];
                const userRoleIds = currentUser.assignedRoles || currentUser.AssignedRoles || [];
                const activeRoleIds = (currentUser.roleLevel === 'admin')
                    ? fabRoleIds
                    : fabRoleIds.filter(id => userRoleIds.some(uId => window.cleanId(uId) === window.cleanId(id)));

                const roles = getRoles();
                let initialMenuIds = [];
                activeRoleIds.forEach(roleId => {
                    const role = roles.find(r => window.cleanId(r.id || r.RoleId) === window.cleanId(roleId));
                    if (role && (role.allowedMenuIds || role.AllowedMenuIds)) {
                        initialMenuIds.push(...(role.allowedMenuIds || role.AllowedMenuIds));
                    }
                });

                const allowedIds = typeof window.getAllowedIdsWithHierarchy === 'function'
                    ? window.getAllowedIdsWithHierarchy(menus, initialMenuIds)
                    : new Set(initialMenuIds);

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

                if (validRoots.length > 0) {
                    let firstRoot = validRoots[0];
                    // root 若為 folder，自動取其下第一個子看板，避免顯示空殼
                    if (firstRoot.menuMode === 'folder') {
                        let children = menus.filter(m =>
                            m.parentId === firstRoot.id ||
                            (m.parentIds && m.parentIds.includes(firstRoot.id))
                        );
                        children.sort((a, b) =>
                            (a.parentOrders && a.parentOrders[firstRoot.id] != null ? a.parentOrders[firstRoot.id] : (a.order || 0)) -
                            (b.parentOrders && b.parentOrders[firstRoot.id] != null ? b.parentOrders[firstRoot.id] : (b.order || 0))
                        );
                        defPage = children.length > 0 ? children[0].id : firstRoot.id;
                    } else {
                        defPage = firstRoot.id;
                    }
                }
            }
        }

        // 3. 終極防呆：仍找不到 → 第一個非資料夾的看板
        if (!defPage || !menus.find(m => window.cleanId(m.id) === window.cleanId(defPage))) {
            let firstVisible = menus.find(m => (m.menuMode || '').toLowerCase() !== 'folder');
            if (firstVisible) defPage = firstVisible.id;
            else if (menus.length > 0) defPage = menus[0].id;
        }

        if (defPage) activateMenu(defPage);
    } catch (error) {
        console.error("🚨 導向預設首頁時發生錯誤:", error);
    }
}

// 導航到指定區域塊
function navTo(pageId, element, subTitle = '') {
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
    }

    const bcPath = document.getElementById('bc-path');
    const bcName = document.getElementById('bc-name');
    if (bcPath && bcName) {
        if (pageId === 'page-home') {
            bcPath.style.display = 'none';
            bcName.innerText = t('nav_breadcrumb_home', '首頁總覽');
        } else {
            let topName = getTopMenuName();
            let folderPath = element ? getMenuPath(element) : '';

            let finalPathArr = [];
            if (topName) finalPathArr.push(topName);
            if (folderPath) finalPathArr.push(folderPath);

            if (finalPathArr.length > 0) {
                bcPath.style.display = 'inline';
                bcPath.innerText = finalPathArr.join(' / ') + ' / ';
            } else {
                bcPath.style.display = 'none';
            }

            let elName = element ? (element.querySelector('span')?.innerText || element.innerText.trim()) : '';
            bcName.innerText = subTitle || elName || '';
        }
    }

    if (pageId === 'page-personal-manage' && typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
    if (pageId === 'page-webpage-manage' && typeof renderWebpageTable === 'function') renderWebpageTable();
    if (pageId === 'page-menu-manage' && typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
    if (pageId === 'page-fab-manage' && typeof renderFabTable === 'function') renderFabTable();
    if (pageId === 'page-role-manage' && typeof renderRoleTable === 'function') renderRoleTable();
    if (pageId === 'page-account-manage' && typeof renderAccountTable === 'function') renderAccountTable();
    if (pageId === 'page-apply' && typeof renderApplyTable === 'function') renderApplyTable();
    if (pageId === 'page-audit-manage' && typeof renderAuditTable === 'function') renderAuditTable();
    if (pageId !== 'page-app-grid') currentAppGridMenuId = null;
}

function openDynamicIframe(url, title, element, isFullscreen = false) {
    if (!url) return;
    navTo('page-iframe', element, title);
    const iframe = document.getElementById('main-iframe');
    iframe.removeAttribute('srcdoc');

    let finalUrl = url;
    if (!finalUrl.includes('fab=')) {
        finalUrl = finalUrl.includes('?') ? `${finalUrl}&fab=${currentFab}` : `${finalUrl}?fab=${currentFab}`;
    }
    if (!/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith('/') && !finalUrl.startsWith('page-')) {
        finalUrl = 'http://' + finalUrl;
    }
    iframe.src = finalUrl;
    if (isFullscreen) document.body.classList.add('fullscreen-mode');
    else document.body.classList.remove('fullscreen-mode');
}

// 產生 Icon 的 HTML (共用)

// === admin/fab-manage.js - 廠區管理 CRUD ===

// === 權限檢查輔助 ===
function canManageFolderStructure(folderId) {
    if (!currentUser) return false;
    if (currentUser.roleLevel === 'admin') return true;
    if (!folderId) return true;

    const menus = getCustomMenus();
    const fNode = menus.find(m => window.cleanId(m.id) === window.cleanId(folderId));
    if (!fNode) return true;

    if (window.cleanId(fNode.createdBy) === window.cleanId(currentUser.id)) return true;
    if (currentUser.manageableMenus && currentUser.manageableMenus.some(m => window.cleanId(m) === window.cleanId(folderId))) return true;

    let isUnderDelegated = false;
    let queue = [window.cleanId(folderId)];
    let visited = new Set();
    while (queue.length > 0) {
        let curr = queue.shift();
        if (currentUser.manageableMenus && currentUser.manageableMenus.some(m => window.cleanId(m) === curr)) { isUnderDelegated = true; break; }
        visited.add(curr);
        let m = menus.find(x => window.cleanId(x.id) === curr);
        if (m) {
            let pId = window.cleanId(m.parentId);
            if (pId && pId !== 'null' && !visited.has(pId)) queue.push(pId);
            if (m.parentIds) m.parentIds.forEach(p => {
                let cPid = window.cleanId(p);
                if (cPid && cPid !== 'null' && !visited.has(cPid)) queue.push(cPid);
            });
        }
    }
    return isUnderDelegated;
}

// === Fabs 廠區管理 ===
function openAddFabModal() {
    try {
        document.getElementById('fabForm').reset();
        document.getElementById('editFabId').value = '';
        document.getElementById('fabNameInput').disabled = false;
        if (typeof renderFabRoleCheckboxes === 'function') renderFabRoleCheckboxes([]);
        showModalSafely('fabModal');
    } catch (e) { console.error("[openAddFabModal] 錯誤:", e); }
}

function editFab(id) {
    try {
        const fab = getFabs().find(f => window.cleanId(f.id) === window.cleanId(id));
        if (!fab) { console.error("找不到對應的廠區資料 (ID: " + id + ")"); return; }

        document.getElementById('editFabId').value = fab.id;
        document.getElementById('fabNameInput').value = fab.fabName;
        document.getElementById('fabNameInput').disabled = true;
        document.getElementById('fabDisplayNameInput').value = fab.displayName || '';
        document.getElementById('fabLangSelect').value = fab.defaultLang || 'zh';
        if (typeof renderFabRoleCheckboxes === 'function') renderFabRoleCheckboxes(fab.assignedRoles || []);
        showModalSafely('fabModal');
    } catch (e) { console.error("[editFab] 錯誤:", e); }
}

async function saveFabItem(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('editFabId').value;
        const fabName = document.getElementById('fabNameInput').value.trim();
        const displayName = document.getElementById('fabDisplayNameInput').value.trim();
        const lang = document.getElementById('fabLangSelect').value;

        let assignedRoles = [];
        document.querySelectorAll('.fab-role-cb:checked').forEach(cb => assignedRoles.push(cb.value));

        let isNew = !id;
        let fabId = id || ('fab_' + Date.now());

        if (isNew) {
            let fabs = getFabs();
            if (fabs.some(f => window.cleanId(f.fabName) === window.cleanId(fabName))) {
                customAlert('廠區名稱已存在！'); 
                return false; 
            }
        }

        const payload = {
            id: fabId,
            fabName: fabName,
            displayName: displayName || fabName,
            defaultLang: lang,
            assignedRoles: assignedRoles
        };

        const result = await saveFabAPI(isNew, payload);
        if (!result.success) {
            customAlert("儲存失敗: " + result.message);
            return false;
        }

        // 儲存成功後，重新從後端拉取全部資料以更新前端記憶體
        await window.fetchInitialDataFromDB();

        hideModalSafely('fabModal');
        if (typeof renderFabTable === 'function') renderFabTable();
        if (typeof renderFabSwitcher === 'function') renderFabSwitcher();
    } catch (error) { console.error("[saveFabItem] 錯誤:", error); }
    return false;
}

async function deleteFab(id) {
    try {
        customConfirm('確定要刪除此廠區嗎？', async () => {
            const result = await deleteFabAPI(id);
            if (!result.success) {
                customAlert("刪除失敗: " + result.message);
                return;
            }

            // 儲存成功後，重新從後端拉取全部資料以更新前端記憶體
            await window.fetchInitialDataFromDB();

            if (typeof renderFabTable === 'function') renderFabTable();
            if (typeof renderFabSwitcher === 'function') renderFabSwitcher();
        });
    } catch (e) { console.error("[deleteFab] 錯誤:", e); }
}

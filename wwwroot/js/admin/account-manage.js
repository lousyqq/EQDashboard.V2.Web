// === admin/account-manage.js - 帳號管理 CRUD ===

// === Accounts 帳號管理 ===
function openAddAccountModal() {
    try {
        document.getElementById('accForm').reset();
        document.getElementById('editAccMode').value = '';

        // ⭐️ 修復 1：工號欄位狀態還原，確保新增時可輸入 (解除 readOnly 與 disabled)
        document.getElementById('accEmpId').readOnly = false;
        document.getElementById('accEmpId').disabled = false;

        document.getElementById('accRoleLevel').value = 'user';
        document.getElementById('accRoleLevel').disabled = false;
        document.getElementById('accEnableDelegation').checked = false;

        // 新增情境：把「管理層級」、「委派管理」兩個區段重新顯示（清除上次編輯 admin 留下的隱藏狀態）
        const lvlGroup = document.getElementById('accRoleLevelGroup');
        if (lvlGroup) lvlGroup.style.display = '';

        // ⭐️ 修復 2：移除這行舊版的 HTML 覆寫，它會因為找不到舊容器而導致程式報錯中斷！
        // document.getElementById('accRoleCheckboxesContainer').innerHTML = '<div id="accRoleCheckboxes" class="d-flex flex-wrap gap-1 mt-1"></div>';

        tempDefaultPages = {};

        // ⭐️ 修復 3：重置時連同委派細節區塊一併還原/收起
        if (typeof toggleAccDelegationUI === 'function') toggleAccDelegationUI();
        if (typeof toggleDelegationDetails === 'function') toggleDelegationDetails();

        if (typeof renderAccRoleCheckboxes === 'function') renderAccRoleCheckboxes([]);
        if (typeof renderAccManageMenuCheckboxes === 'function') renderAccManageMenuCheckboxes([]);
        if (typeof renderAccDefaultPagesUI === 'function') renderAccDefaultPagesUI();

        showModalSafely('accModal');
    } catch (e) { console.error("[openAddAccountModal] 錯誤:", e); }
}

function editAccount(empId) {
    try {
        const acc = getAccounts().find(a => window.cleanId(a.empId) === window.cleanId(empId));
        if (!acc) { console.error("找不到對應的帳號資料 (工號: " + empId + ")"); return; }

        document.getElementById('editAccMode').value = 'edit';
        document.getElementById('accEmpId').value = acc.empId; document.getElementById('accEmpId').disabled = true;
        document.getElementById('accName').value = acc.name || ''; document.getElementById('accDept').value = acc.department || '';
        document.getElementById('accRoleLevel').value = acc.roleLevel || 'user';

        // 編輯 admin 帳號 → 隱藏「管理層級」與「委派管理」整個區段（admin 是全域管理者，不需要這些選項）
        const isAdminAccount = (acc.roleLevel === 'admin') || window.cleanId(acc.empId) === 'admin';
        const lvlGroup = document.getElementById('accRoleLevelGroup');
        const delegationGroup = document.getElementById('accDelegationGroup');
        if (lvlGroup) lvlGroup.style.display = isAdminAccount ? 'none' : '';
        if (isAdminAccount && delegationGroup) delegationGroup.style.display = 'none';
        document.getElementById('accRoleLevel').disabled = isAdminAccount;

        document.getElementById('accEnableDelegation').checked = (acc.manageableMenus && acc.manageableMenus.length > 0);
        document.getElementById('accCanEditOthers').checked = acc.canEditOthers || false;

        tempDefaultPages = JSON.parse(JSON.stringify(acc.defaultPages || {}));
        if (typeof renderAccDefaultPagesUI === 'function') renderAccDefaultPagesUI();
        if (typeof renderAccRoleCheckboxes === 'function') renderAccRoleCheckboxes(acc.assignedRoles || []);
        if (typeof renderAccManageMenuCheckboxes === 'function') renderAccManageMenuCheckboxes(acc.manageableMenus || []);
        toggleAccDelegationUI(); toggleDelegationDetails();

        showModalSafely('accModal');
    } catch (e) { console.error("[editAccount] 錯誤:", e); }
}

async function saveAccountItem(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const mode = document.getElementById('editAccMode').value; 
        const empId = document.getElementById('accEmpId').value.trim();
        const name = document.getElementById('accName').value.trim(); 
        const dept = document.getElementById('accDept').value.trim();
        const lvl = document.getElementById('accRoleLevel').value;

        let assigned = []; document.querySelectorAll('.acc-role-cb:checked').forEach(cb => assigned.push(cb.value));
        let manageable = []; let canEditOthers = false;
        if (lvl === 'user' && document.getElementById('accEnableDelegation').checked) {
            document.querySelectorAll('.acc-menu-cb:checked').forEach(cb => manageable.push(cb.value));
            canEditOthers = document.getElementById('accCanEditOthers').checked;
        }

        let isNew = (mode !== 'edit');
        if (isNew) {
            let accs = getAccounts();
            if (accs.some(a => window.cleanId(a.empId) === window.cleanId(empId))) { customAlert('工號已存在！'); return false; }
        }

        const payload = {
            empId: empId,
            name: name,
            department: dept,
            roleLevel: lvl,
            canEditOthers: canEditOthers,
            assignedRoles: assigned,
            manageableMenus: manageable,
            defaultPages: JSON.parse(JSON.stringify(tempDefaultPages))
        };

        const result = await saveAccountAPI(isNew, payload);
        if (!result.success) {
            customAlert("儲存失敗: " + result.message);
            return false;
        }

        // 儲存成功後，重新從後端拉取全部資料以更新前端記憶體
        await window.fetchInitialDataFromDB();

        hideModalSafely('accModal');
        if (typeof renderAccountTable === 'function') renderAccountTable();

        if (currentUser && window.cleanId(currentUser.id) === window.cleanId(empId)) {
            currentUser.name = name; currentUser.department = dept; currentUser.roleLevel = lvl;
            currentUser.assignedRoles = assigned; currentUser.manageableMenus = manageable;
            currentUser.canEditOthers = canEditOthers; currentUser.defaultPages = JSON.parse(JSON.stringify(tempDefaultPages));
            localStorage.setItem('umc_current_user', JSON.stringify(currentUser));

            // 修改到自己的可視群組版面時，立即刷新右上角廠區下拉與側邊欄
            if (typeof renderFabSwitcher === 'function') renderFabSwitcher();
            if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
        }
    } catch (error) { console.error("[saveAccountItem] 錯誤:", error); }
    return false;
}

async function deleteAccount(empId) {
    try {
        if (window.cleanId(empId) === 'admin') { customAlert('系統預設管理員無法刪除！'); return; }
        customConfirm('確定要刪除此帳號嗎？', async () => {
            const result = await deleteAccountAPI(empId);
            if (!result.success) {
                customAlert("刪除失敗: " + result.message);
                return;
            }

            // 儲存成功後，重新從後端拉取全部資料以更新前端記憶體
            await window.fetchInitialDataFromDB();

            if (typeof renderAccountTable === 'function') renderAccountTable();
        });
    } catch (e) { console.error("[deleteAccount] 錯誤:", e); }
}

function pickDefaultMenu(menuId) {
    const fab = document.getElementById('pickingForFab').value;
    tempDefaultPages[fab] = menuId;
    if (typeof renderAccDefaultPagesUI === 'function') renderAccDefaultPagesUI();
    const drawerEl = document.getElementById('menuSelectDrawer');
    if (drawerEl) {
        const instance = bootstrap.Offcanvas.getInstance(drawerEl) || bootstrap.Offcanvas.getOrCreateInstance(drawerEl);
        if (instance) instance.hide();
    }
}

function clearDefaultMenu(fabName) {
    delete tempDefaultPages[fabName];
    if (typeof renderAccDefaultPagesUI === 'function') renderAccDefaultPagesUI();
}

function toggleAccDelegationUI() {
    const lvl = document.getElementById('accRoleLevel').value;
    const grp = document.getElementById('accDelegationGroup');
    if (grp) grp.style.display = lvl === 'user' ? 'block' : 'none';
}

function toggleDelegationDetails() {
    const checked = document.getElementById('accEnableDelegation').checked;
    const det = document.getElementById('accDelegationDetails');
    if (det) det.style.display = checked ? 'block' : 'none';
}

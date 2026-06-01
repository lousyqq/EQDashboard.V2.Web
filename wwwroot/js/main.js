function initModalSafely(id) { const el = document.getElementById(id); return el ? new bootstrap.Modal(el) : null; }

function initDashboardUI() {
    if (!currentUser) return;

    // 校正 currentFab 一律為 fabName，並套用該廠區的預設語言
    if (typeof getFabs === 'function') {
        const fabs = getFabs();
        if (fabs.length > 0) {
            let currentFabVal = typeof currentFab !== 'undefined' ? currentFab : '';
            const exists = fabs.find(f =>
                String(f.id || '').toLowerCase() === String(currentFabVal).toLowerCase() ||
                String(f.fabName || '').toLowerCase() === String(currentFabVal).toLowerCase()
            );
            currentFab = exists ? exists.fabName : fabs[0].fabName;

            const fabObj = exists || fabs[0];
            if (fabObj && fabObj.defaultLang && typeof changeLanguage === 'function') {
                changeLanguage(fabObj.defaultLang);
            }
        }
    }

    if (typeof renderFabTable === 'function') renderFabTable();
    if (typeof renderAccountTable === 'function') renderAccountTable();
    if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
    if (typeof renderFabSwitcher === 'function') renderFabSwitcher(); // ⭐️ 補上廠區切換選單的初始化
    if (typeof switchLayoutMode === 'function') switchLayoutMode('system');
    if (typeof renderHomeDashboard === 'function') renderHomeDashboard();
}

// 還原 localStorage 已有的 currentUser；若沒有則 return false（讓 tryAutoLogin 接手）
function restoreLoginFromStorage() {
    const storedUser = localStorage.getItem('umc_current_user');
    if (!storedUser || storedUser === 'null' || storedUser === 'undefined') return false;

    try {
        let tempUser = JSON.parse(storedUser);

        if (typeof getAccounts === 'function') {
            let freshAcc = getAccounts().find(a => String(a.empId).toLowerCase() === String(tempUser.id).toLowerCase());
            if (!freshAcc) {
                // Account 已被刪除 → 強制重新登入
                localStorage.removeItem('umc_current_user');
                return false;
            }
            tempUser.roleLevel = freshAcc.roleLevel;
            tempUser.assignedRoles = freshAcc.assignedRoles || [];
            tempUser.manageableMenus = freshAcc.manageableMenus || [];
            tempUser.canEditOthers = freshAcc.canEditOthers || false;
            tempUser.defaultPages = freshAcc.defaultPages || {};
        }

        currentUser = tempUser;
        localStorage.setItem('umc_current_user', JSON.stringify(currentUser));

        const nameEl = document.getElementById('user-name');
        if (nameEl) nameEl.innerText = currentUser.id;
        return true;
    } catch (e) {
        currentUser = null;
        return false;
    }
}

// 靜默攔截底層全域錯誤，不彈出紅框
window.addEventListener('error', function (event) {
    const msg = event.message || '';
    const src = event.filename || '';
    if (msg.includes('toLowerCase') || msg.includes('browserLink')) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
}, true);

document.addEventListener("DOMContentLoaded", async () => {
    // console.log("正在從資料庫載入資料...");
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'db-loading-overlay';
    loadingOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:9999; display:flex; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:sans-serif;';
    loadingOverlay.innerHTML = '<div class="spinner-border text-info mb-3" style="width: 3rem; height: 3rem;" role="status"></div><h2>系統初始化中...</h2><p class="text-secondary">正在與資料庫連線同步資料</p>';
    document.body.appendChild(loadingOverlay);

    try {
        let isDbLoaded = false;
        if (typeof fetchInitialDataFromDB === 'function') {
            isDbLoaded = await fetchInitialDataFromDB();
        }

        loadingOverlay.remove();
        initModalInstances();

        if (isDbLoaded) {
            // 1) 有 DB 資料時，嘗試還原 localStorage 中既有的 currentUser
            const restored = restoreLoginFromStorage();
            if (restored) {
                initDashboardUI();
            } else {
                if (typeof tryAutoLogin === 'function') {
                    await tryAutoLogin();
                }
            }
        } else {
            // 2) 無 DB 資料 (可能為 401 未登入)，走自動偵測或顯示手動登入
            if (typeof tryAutoLogin === 'function') {
                await tryAutoLogin();
            }
        }
    } catch (error) {
        if (!document.body.contains(loadingOverlay)) document.body.appendChild(loadingOverlay);
        loadingOverlay.innerHTML = '<i class="fas fa-times-circle text-danger" style="font-size: 4rem; margin-bottom: 20px;"></i><h2 class="text-danger">系統發生非預期錯誤</h2><p class="fs-5">' + error.message + '</p><div class="text-warning text-start" style="max-width:800px; overflow:auto; max-height:300px;"><pre>' + error.stack + '</pre></div>';
    }
});

function initModalInstances() {
    // ⭐️ 致命錯誤修復：完整補齊所有遺失的 Modal 宣告，這樣點擊編輯按鈕才會彈出視窗！
    if (typeof bootstrap !== 'undefined') {
        modals.fab = initModalSafely('fabModal');
        modals.role = initModalSafely('roleModal');
        modals.acc = initModalSafely('accModal');
        modals.webpage = initModalSafely('webpageModal');
        modals.menuNode = initModalSafely('menuNodeModal');
        modals.personalMenu = initModalSafely('personalMenuModal');
        modals.appGrid = initModalSafely('appGridModal');
        modals.apply = initModalSafely('applyModal');
        modals.withdraw = initModalSafely('withdrawModal');
        modals.audit = initModalSafely('auditModal');
        systemAlertModalObj = initModalSafely('systemAlertModal');
        systemConfirmModalObj = initModalSafely('systemConfirmModal');
    }
}
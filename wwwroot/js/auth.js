async function doLogin() {
    const empId = document.getElementById('empId').value.trim().toLowerCase();

    // 1) 呼叫後端登入 API 進行真實驗證並取得 Cookie
    let authResult = null;
    try {
        const loginResp = await fetch('/api/Auth/Login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empId: empId })
        });
        
        if (loginResp.ok) {
            authResult = await loginResp.json();
        } else if (loginResp.status === 401) {
            const err = await loginResp.json();
            customAlert(err.message || "找不到此帳號！請確認工號是否正確。");
            return;
        } else {
            customAlert("系統發生未預期錯誤，請稍後再試。");
            return;
        }
    } catch (e) {
        console.error("登入 API 呼叫失敗:", e);
        customAlert("無法連線到伺服器，請檢查網路連線。");
        return;
    }

    if (!authResult || !authResult.success) {
        customAlert(authResult?.message || "登入失敗");
        return;
    }

    // 2) 既然已經成功登入，從 appState 取得完整帳號資訊供前端渲染使用
    let acc = null;
    try {
        acc = getAccounts().find(a => String(a.empId || a.EmpId || '').toLowerCase() === empId);
    } catch (e) {
        console.error("從本地快取讀取帳號失敗:", e);
    }

    if (!acc && empId === 'admin') {
        // 臨時通道 fallback
        acc = {
            empId: 'admin', name: '系統管理員(臨時)', department: '系統救援',
            roleLevel: 'admin', assignedRoles: [], manageableMenus: [],
            canEditOthers: true, defaultPages: {}
        };
    }

    if (!acc) {
        customAlert("無法載入您的權限設定檔！");
        return;
    }

    const accEmpId = acc.empId || acc.EmpId || '';
    const now = new Date();
    const oldLoginCount = parseInt(acc.loginCount || acc.LoginCount || 0) || 0;
    let displayLoginCount = oldLoginCount + 1; // 樂觀預估，避免後端異常時顯示 0
    let displayLoginTime = formatLoginTime(now);
    let backendSucceeded = false;

    // 1) 呼叫後端 /Settings/UpdateLoginStats 更新 DB 的 LoginCount / LastLoginTime
    try {
        const resp = await fetch('/Settings/UpdateLoginStats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empId: accEmpId })
        });
        if (resp.ok) {
            const result = await resp.json();
            if (result && result.success) {
                if (typeof result.loginCount === 'number' && result.loginCount > 0) {
                    displayLoginCount = result.loginCount;
                }
                if (result.lastLoginTime) {
                    displayLoginTime = formatLoginTimeFromDb(result.lastLoginTime);
                }
                backendSucceeded = true;
            } else {
                console.warn('UpdateLoginStats 回傳失敗:', result && result.message);
            }
        } else {
            console.warn('UpdateLoginStats HTTP 狀態異常:', resp.status);
        }
    } catch (e) {
        console.warn('UpdateLoginStats 連線失敗：', e);
    }

    // 不論後端成功與否，都同步回 appState，避免後續 SaveData 把舊值寫回去
    if (window.appState && window.appState.accounts) {
        const a = window.appState.accounts.find(x => String(x.empId).toLowerCase() === accEmpId.toLowerCase());
        if (a) {
            a.loginCount = displayLoginCount;
            a.lastLoginTime = backendSucceeded ? (a.lastLoginTime || new Date().toISOString()) : a.lastLoginTime;
        }
    }

    // LocalStorage 備援（離線/後端異常時仍可累計）
    if (!backendSucceeded) {
        try {
            localStorage.setItem('umc_user_stats_' + accEmpId, JSON.stringify({ count: displayLoginCount, lastLogin: displayLoginTime }));
        } catch (e) { }
    }

    currentUser = {
        id: accEmpId,
        empId: accEmpId,
        name: acc.name || acc.Name || '',
        department: acc.department || acc.Department || '',
        roleLevel: acc.roleLevel || acc.RoleLevel || 'user',
        assignedRoles: acc.assignedRoles || acc.AssignedRoles || [],
        manageableMenus: acc.manageableMenus || acc.ManageableMenus || [],
        canEditOthers: acc.canEditOthers || acc.CanEditOthers || false,
        loginCount: displayLoginCount,
        currentLoginTime: displayLoginTime,
        defaultPages: acc.defaultPages || acc.DefaultPages || {}
    };
    localStorage.setItem('umc_current_user', JSON.stringify(currentUser));

    document.getElementById('login-overlay').style.display = 'none';
    if (typeof initDashboardUI === 'function') initDashboardUI();
}

// 12 小時制顯示：02:35 PM
function formatLoginTime(d) {
    const pad = (n) => n < 10 ? '0' + n : n;
    const h12 = d.getHours() % 12 || 12;
    const ampm = d.getHours() >= 12 ? ' PM' : ' AM';
    return pad(h12) + ':' + pad(d.getMinutes()) + ampm;
}

// DB 回傳 "yyyy-MM-dd HH:mm:ss" → 02:35 PM
function formatLoginTimeFromDb(dbStr) {
    try {
        const d = new Date(dbStr.replace(' ', 'T'));
        if (!isNaN(d.getTime())) return formatLoginTime(d);
    } catch (e) { }
    return dbStr;
}

async function logout() {
    try {
        await fetch('/api/Auth/Logout', { method: 'POST' });
    } catch (e) {
        console.error("登出 API 呼叫失敗", e);
    }
    
    localStorage.removeItem('umc_current_user');
    currentUser = null;
    document.getElementById('login-overlay').style.display = 'flex';
}

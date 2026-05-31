// === auth.js - 雙模式登入流程：Windows 自動偵測 + 手動帳密 ===
// 公開全域：
//   window.tryAutoLogin()    - 主流程進入點 (main.js DOMContentLoaded 會呼叫)
//   window.doWindowsLogin()  - 「以此身份進入」按鈕
//   window.doLogin()         - 手動 tab 的 submit
//   window.retryWhoAmI()     - 「重試偵測」按鈕
//   window.logout()          - 右上頭像下拉的登出

// 「使用者主動登出 → 別再自動登入」旗標
const FORCE_MANUAL_KEY = 'umc_force_manual_login';

// 暫存 whoami 結果（給 doWindowsLogin 用，避免再打一次 API）
let _whoamiResult = null;

// =============================================================
// 1) 主進入點：呼叫 whoami，能自動就自動，不能就顯示登入框
// =============================================================
async function tryAutoLogin() {
    const forceManual = localStorage.getItem(FORCE_MANUAL_KEY) === '1';

    if (forceManual) {
        // 使用者剛剛主動登出 → 不要立刻又被 Windows Auth 拉進來
        showLoginOverlay('manual');
        return false;
    }

    const result = await fetchWhoAmI();

    if (result.success && result.authenticated && result.empId) {
        // Windows 認證成功 + Accounts 表有此帳號 → 自動登入
        const ok = await completeLoginAfterAuth(result.empId, 'windows');
        if (ok) return true;
        // 走到這代表 completeLoginAfterAuth 內部已經 showLoginOverlay 了
        return false;
    }

    // 自動偵測失敗（可能是匿名、可能是帳號不存在）→ 顯示登入框
    showLoginOverlay('windows');
    return false;
}
window.tryAutoLogin = tryAutoLogin;

// =============================================================
// 2) whoami 呼叫 + 把結果填到 Windows tab 的狀態區塊
// =============================================================
async function fetchWhoAmI() {
    const statusEl = document.getElementById('whoami-status');
    const btn = document.getElementById('btn-windows-continue');

    if (statusEl) {
        statusEl.className = 'alert alert-light border text-center py-3 mb-3';
        statusEl.innerHTML = '<div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>正在偵測桌機登入者...';
    }
    if (btn) btn.disabled = true;

    try {
        const resp = await fetch('/api/Auth/WhoAmI', {
            method: 'GET',
            credentials: 'include'
        });
        const data = await resp.json();
        _whoamiResult = data;

        // 填 UI
        if (statusEl) {
            if (data.success && data.authenticated && data.empId) {
                statusEl.className = 'alert alert-success border text-center py-3 mb-3';
                statusEl.innerHTML = `<i class="fas fa-user-check me-1"></i> 偵測到 Windows 帳號：<b>${escapeHtml(data.empId)}</b>`;
                if (btn) btn.disabled = false;
            } else if (data.authenticated && data.empId && !data.success) {
                // 偵測到 Windows 帳號但 Accounts 表沒有
                statusEl.className = 'alert alert-warning border text-center py-3 mb-3';
                statusEl.innerHTML = `<i class="fas fa-exclamation-triangle me-1"></i> ${escapeHtml(data.message || '此 Windows 帳號未在系統建立')}`;
                if (btn) btn.disabled = true;
            } else {
                statusEl.className = 'alert alert-light border text-center py-3 mb-3';
                statusEl.innerHTML = '<i class="fas fa-info-circle me-1 text-muted"></i> 未偵測到 Windows 登入帳號<div class="small text-muted mt-1">請改用手動輸入</div>';
                if (btn) btn.disabled = true;
            }
        }
        return data;
    } catch (e) {
        console.warn('WhoAmI 失敗:', e);
        if (statusEl) {
            statusEl.className = 'alert alert-light border text-center py-3 mb-3';
            statusEl.innerHTML = '<i class="fas fa-times-circle me-1 text-danger"></i> 無法連線到伺服器';
        }
        return { success: false, authenticated: false };
    }
}

function retryWhoAmI() {
    fetchWhoAmI();
}
window.retryWhoAmI = retryWhoAmI;

// =============================================================
// 3) 「以此身份進入」按鈕 (Windows 自動偵測通過後)
// =============================================================
async function doWindowsLogin() {
    if (!_whoamiResult || !_whoamiResult.success || !_whoamiResult.empId) {
        customAlert('尚未偵測到可用的 Windows 帳號');
        return;
    }
    // Windows 模式：直接以 empId 走 completeLoginAfterAuth，不打 /api/Auth/Login（避免又被擋密碼）
    // 後端的 cookie 我們仍然用 Login 一次來發 — 但用「特殊 source」識別。
    // 簡化：直接打 Login 帶 empId 與一個固定密碼 'WINDOWS_AUTH'？不太好。
    // 改採：另開一個 SignIn 端點。為了不增加複雜度，這裡直接複用前端 currentUser，
    //   cookie 不發 — 任何後端 API 都不檢查 cookie（目前後端的 controller 都是 [AllowAnonymous]）。
    const ok = await completeLoginAfterAuth(_whoamiResult.empId, 'windows');
    if (!ok) customAlert('登入失敗');
}
window.doWindowsLogin = doWindowsLogin;

// =============================================================
// 4) 手動 tab 的登入 (走 /api/Auth/Login → LDAP 驗證)
// =============================================================
async function doLogin() {
    const empIdInput = document.getElementById('empId');
    const pwdInput = document.getElementById('empPwd');
    const errEl = document.getElementById('manual-login-error');

    const empId = (empIdInput?.value || '').trim();
    const password = pwdInput?.value || '';

    if (!empId) {
        showManualError('請輸入工號');
        return;
    }

    showManualError('');

    let authResult = null;
    try {
        const loginResp = await fetch('/api/Auth/Login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empId, password })
        });

        if (loginResp.ok) {
            authResult = await loginResp.json();
        } else {
            const err = await safeJson(loginResp);
            showManualError(err?.message || `登入失敗 (HTTP ${loginResp.status})`);
            return;
        }
    } catch (e) {
        console.error('登入 API 呼叫失敗:', e);
        showManualError('無法連線到伺服器');
        return;
    }

    if (!authResult || !authResult.success) {
        showManualError(authResult?.message || '登入失敗');
        return;
    }

    // 清除強制手動旗標（既然手動成功，就允許下次 whoami 嘗試）
    localStorage.removeItem(FORCE_MANUAL_KEY);

    // 後端會回 account 物件 — 當 admin/user 等 TestAccount 不在 DB Accounts 表時，
    // 直接用這個 fallback 才不會卡在「無法載入您的權限設定檔」。
    const apiFallback = authResult.account || null;
    const ok = await completeLoginAfterAuth(authResult.empId || empId, authResult.source || 'manual', apiFallback);
    if (!ok) showManualError('權限資料載入失敗');
}
window.doLogin = doLogin;

function showManualError(msg) {
    const el = document.getElementById('manual-login-error');
    if (!el) return;
    if (!msg) { el.classList.add('d-none'); el.textContent = ''; return; }
    el.classList.remove('d-none');
    el.textContent = msg;
}

// =============================================================
// 5) 完成後續登入流程：對 appState 撈 Account、更新 LoginCount、寫 localStorage、進主畫面
//    fallbackAccount: 後端 Login API 回傳的 account 物件 (TestAccount 用)
// =============================================================
async function completeLoginAfterAuth(empId, source, fallbackAccount) {
    const lowerId = String(empId).toLowerCase();

    // 從 appState 撈完整帳號資訊（appState 在 main.js 進入點時就已經 fetch 過）
    let acc = null;
    try {
        acc = getAccounts().find(a => String(a.empId || a.EmpId || '').toLowerCase() === lowerId);
    } catch (e) {
        console.error('讀取本地帳號資料失敗:', e);
    }

    // 沒撈到 → 使用後端 Login 提供的 fallback (TestAccounts: admin/admin、user/user 等情境)
    if (!acc && fallbackAccount) {
        acc = {
            empId: fallbackAccount.empId || empId,
            name: fallbackAccount.name || empId,
            department: fallbackAccount.department || '',
            roleLevel: fallbackAccount.roleLevel || 'user',
            assignedRoles: fallbackAccount.assignedRoles || [],
            manageableMenus: fallbackAccount.manageableMenus || [],
            canEditOthers: fallbackAccount.canEditOthers === true,
            defaultPages: fallbackAccount.defaultPages || {}
        };
    }

    // 最後一層 fallback：純前端 admin 兜底（後端如果掛了還是能進）
    if (!acc && lowerId === 'admin') {
        acc = {
            empId: 'admin', name: '系統管理員(臨時)', department: '系統救援',
            roleLevel: 'admin', assignedRoles: [], manageableMenus: [],
            canEditOthers: true, defaultPages: {}
        };
    }

    if (!acc) {
        customAlert(`工號 [${empId}] 未在系統建立，請聯絡管理員。`);
        return false;
    }

    const accEmpId = acc.empId || acc.EmpId || '';
    const now = new Date();
    const oldLoginCount = parseInt(acc.loginCount || acc.LoginCount || 0) || 0;
    let displayLoginCount = oldLoginCount + 1;
    let displayLoginTime = formatLoginTime(now);
    let backendSucceeded = false;

    // 更新 DB 的 LoginCount / LastLoginTime
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
            }
        }
    } catch (e) {
        console.warn('UpdateLoginStats 連線失敗：', e);
    }

    // 同步 appState
    if (window.appState && window.appState.accounts) {
        const a = window.appState.accounts.find(x => String(x.empId).toLowerCase() === accEmpId.toLowerCase());
        if (a) {
            a.loginCount = displayLoginCount;
            if (backendSucceeded) a.lastLoginTime = a.lastLoginTime || new Date().toISOString();
        }
    }

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
        defaultPages: acc.defaultPages || acc.DefaultPages || {},
        loginSource: source || 'manual'  // 'windows' / 'manual' / 'emergency'
    };
    const slimUser = { empId: currentUser.empId, name: currentUser.name, department: currentUser.department, roleLevel: currentUser.roleLevel, loginSource: currentUser.loginSource };
    localStorage.setItem('umc_current_user', JSON.stringify(slimUser));

    hideLoginOverlay();
    if (typeof initDashboardUI === 'function') initDashboardUI();
    return true;
}

// =============================================================
// 6) Overlay 顯示 / 隱藏
// =============================================================
function showLoginOverlay(defaultTab) {
    const ov = document.getElementById('login-overlay');
    if (!ov) return;
    ov.style.setProperty('display', 'flex', 'important');

    // 切到指定 tab
    try {
        const tabBtn = (defaultTab === 'manual')
            ? document.getElementById('tab-manual')
            : document.getElementById('tab-windows');
        if (tabBtn && window.bootstrap?.Tab) {
            bootstrap.Tab.getOrCreateInstance(tabBtn).show();
        }
    } catch (e) { }

    // 若停留在 Windows tab 卻還沒 whoami 過，主動觸發一次
    if (defaultTab !== 'manual' && !_whoamiResult) {
        fetchWhoAmI();
    }
}

function hideLoginOverlay() {
    const ov = document.getElementById('login-overlay');
    if (ov) ov.style.setProperty('display', 'none', 'important');
}

// =============================================================
// 7) 登出 — 設旗標 → 後端清 cookie → 顯示登入框（停在手動 tab）
// =============================================================
async function logout() {
    try {
        await fetch('/api/Auth/Logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
        console.error('登出 API 呼叫失敗', e);
    }

    // 設旗標：下次進入時不要又被 Windows Auth 自動拉進來
    try { localStorage.setItem(FORCE_MANUAL_KEY, '1'); } catch (e) { }

    localStorage.removeItem('umc_current_user');
    currentUser = null;
    _whoamiResult = null;

    showLoginOverlay('manual');
}
window.logout = logout;

// =============================================================
// 工具
// =============================================================
function formatLoginTime(d) {
    const pad = (n) => n < 10 ? '0' + n : n;
    const h12 = d.getHours() % 12 || 12;
    const ampm = d.getHours() >= 12 ? ' PM' : ' AM';
    return pad(h12) + ':' + pad(d.getMinutes()) + ampm;
}

function formatLoginTimeFromDb(dbStr) {
    try {
        const d = new Date(dbStr.replace(' ', 'T'));
        if (!isNaN(d.getTime())) return formatLoginTime(d);
    } catch (e) { }
    return dbStr;
}

async function safeJson(resp) {
    try { return await resp.json(); } catch (e) { return null; }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

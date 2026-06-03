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
// 0) 取得後端 Auth 設定 (allowManualLogin 等)；UI 依此決定要不要藏掉手動 tab
// =============================================================
window._authConfig = { allowManualLogin: true };  // 預設值，fetch 失敗時退回 true

async function fetchAuthConfig() {
    try {
        const resp = await fetch('/api/Auth/Config', { credentials: 'include' });
        if (resp.ok) {
            const c = await resp.json();
            if (c) window._authConfig = { allowManualLogin: c.allowManualLogin !== false };
        }
    } catch (e) { console.warn('Auth/Config 失敗:', e); }
    applyAuthConfigToUI(window._authConfig);
    return window._authConfig;
}

function applyAuthConfigToUI(config) {
    const manualTabBtn = document.getElementById('tab-manual');
    const manualTabLi = manualTabBtn ? manualTabBtn.closest('li') : null;
    const winTabBtn = document.getElementById('tab-windows');
    if (!config.allowManualLogin) {
        // 藏掉手動 tab，強制使用 Windows 自動偵測
        if (manualTabLi) manualTabLi.style.display = 'none';
        if (winTabBtn && window.bootstrap?.Tab) {
            try { bootstrap.Tab.getOrCreateInstance(winTabBtn).show(); } catch (e) { }
        }
    } else {
        if (manualTabLi) manualTabLi.style.display = '';
    }
}

// =============================================================
// 1) 主進入點：先抓 config → 嘗試 whoami → 能自動就自動，不能就顯示登入框
// =============================================================
async function tryAutoLogin() {
    const config = await fetchAuthConfig();
    const forceManual = localStorage.getItem(FORCE_MANUAL_KEY) === '1';

    if (forceManual && config.allowManualLogin) {
        showLoginOverlay('manual');
        localStorage.removeItem(FORCE_MANUAL_KEY); // ← 加這行：不要永遠卡住
        return false;
    }


    const result = await fetchWhoAmI();

    if (result && result.success && result.authenticated && result.empId) {
        localStorage.removeItem(FORCE_MANUAL_KEY);
        const ok = await completeLoginAfterAuth(result.empId, 'windows', result.account || null);
        if (ok) return true;
    }


    // 自動偵測失敗或拿到工號但無權限 → 顯示登入框
    // 若 allowManualLogin=false → 強制留在 Windows tab，使用者只能按重試或請聯絡管理員
    showLoginOverlay('windows'); // 失敗也先讓使用者看到自動偵測結果/提示

    return false;
}
window.tryAutoLogin = tryAutoLogin;

// =============================================================
// 2) whoami 呼叫 + 把結果填到 Windows tab 的狀態區塊
// =============================================================
async function fetchWhoAmI() {
    const statusEl = document.getElementById('whoami-status');
    const btn = document.getElementById('btn-windows-continue');
    const config = window._authConfig || { allowManualLogin: true };
    const fallbackHint = '<div class="small text-muted mt-1">請聯繫網頁管理員</div>';

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

        if (resp.status === 401) {
            const data = { success: false, authenticated: false, message: '未偵測到 Windows 登入身份' };
            _whoamiResult = data;
            if (statusEl) {
                statusEl.className = 'alert alert-light border text-center py-3 mb-3';
                statusEl.innerHTML = '<i class="fas fa-info-circle me-1 text-muted"></i> ' + escapeHtml(data.message) + fallbackHint;
            }
            return data;
        }

        if (!resp.ok) {
            const data = { success: false, authenticated: false, message: `WhoAmI HTTP ${resp.status}` };
            _whoamiResult = data;
            if (statusEl) {
                statusEl.className = 'alert alert-light border text-center py-3 mb-3';
                statusEl.innerHTML = '<i class="fas fa-times-circle me-1 text-danger"></i> ' + escapeHtml(data.message) + fallbackHint;
            }
            return data;
        }

        const data = await resp.json();
        _whoamiResult = data;

        if (statusEl) {
            if (data.success && data.authenticated && data.empId) {
                statusEl.className = 'alert alert-success border text-center py-3 mb-3';
                statusEl.innerHTML = `<i class="fas fa-user-check me-1"></i> 偵測到 Windows 帳號：<b>${escapeHtml(data.empId)}</b>`;
                if (btn) btn.disabled = false;
                // ⚠️ 不在此呼叫 completeLoginAfterAuth — 改由唯一呼叫者 tryAutoLogin() 在外層做。
                //   原本兩處都呼叫造成 LoginCount +2、UpdateLoginStats 被打兩次 (Round-5 修)。
            } else {
                statusEl.className = 'alert alert-light border text-center py-3 mb-3';
                const msg = data.message || '未偵測到 Windows 登入帳號';
                statusEl.innerHTML = '<i class="fas fa-info-circle me-1 text-muted"></i> ' + escapeHtml(msg) + fallbackHint;
                if (btn) btn.disabled = true;
            }
        }
        return data;

    } catch (e) {
        // ⚠️ 原本這裡有 `clearTimeout(timer)` 但 `timer` 從未宣告 → ReferenceError 會讓整段 catch 中斷、
        //   UI 永遠卡在 spinner、btn 也不會 enable。Round-5 移除。
        const msg = (e && e.name === 'AbortError')
            ? '偵測逾時（請確認瀏覽器/站台 Windows Auth 設定）'
            : '無法連線到伺服器';

        if (statusEl) {
            statusEl.className = 'alert alert-light border text-center py-3 mb-3';
            statusEl.innerHTML = '<i class="fas fa-times-circle me-1 text-danger"></i> ' + escapeHtml(msg) + fallbackHint;
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
    if (window.appState.accounts.length === 0 && typeof fetchInitialDataFromDB === 'function') {
        const ok = await fetchInitialDataFromDB();
        if (!ok) {
            if (typeof customAlert === 'function') customAlert("無法載入資料庫，請重新整理網頁");
            return false;
        }
    }

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

    // ⚠️ 帳號已被刪除提示：main.js restoreLoginFromStorage() 若發現本地 user 在 DB 已查無，
    //   會設這個旗標。在這裡彈一次訊息，避免使用者誤以為單純 session 過期 (Round-5)
    try {
        if (sessionStorage.getItem('umc_account_deleted_hint') === '1') {
            sessionStorage.removeItem('umc_account_deleted_hint');
            if (typeof customAlert === 'function') {
                customAlert('您的帳號已被系統管理員移除，請重新登入或聯絡管理員確認。');
            }
        }
    } catch (e) {}

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
    if (defaultTab !== 'manual' && (!_whoamiResult || _whoamiResult.success !== true)) {
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

    // Round-5 B10：把所有「使用者個人」快取一併清掉，避免共用電腦切換帳號時讀到上一個人的舊資料。
    //   會清：umc_user_stats_<empId>、umc_user_personal_<empId> 等所有 umc_user_* 前綴；
    //   FORCE_MANUAL_KEY 上面才剛設、要保留。
    try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('umc_user_')) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) { /* localStorage 無法讀寫時靜默忽略 */ }

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

document.addEventListener('DOMContentLoaded', () => {
    const winTabBtn = document.getElementById('tab-windows');
    if (!winTabBtn) return;

    winTabBtn.addEventListener('shown.bs.tab', () => {
        // 每次切到 Windows tab 都重新偵測一次
        _whoamiResult = null;
        fetchWhoAmI();
    });
});

import { appState } from '../store.js';
// === admin/modal-utils.js - Modal 開關封裝 ===
// ====== 後台管理 CRUD 與 Drag & Drop 拖曳邏輯 ======

// Round-5 B9：非 admin 開啟 webpageModal / menuNodeModal 時，把 ACL 區段藏起來。
//   後端 Round-3 已強制 non-admin 的 AllowedEmpIds / DeniedEmpIds 寫入無效 — UI 上若還留著
//   會造成「使用者填了存了沒效」的鬼狀態。
export function applyAclVisibilityForCurrentRole(modalEl) {
    if (!modalEl) return;
    const isAdmin = !!(appState.currentUser && String(appState.currentUser.roleLevel || '').toLowerCase() === 'admin');
    modalEl.querySelectorAll('.admin-only-acl').forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });
}

// ⭐️ 2026-08-24 第八輪 J9：記住「是誰把這個 Modal 打開的」，關窗時把焦點還回去。
//   舊行為實測：fabModal 開窗前焦點在觸發鈕，關窗後 document.activeElement **仍是 #fabNameInput**，
//   而該欄位此時已位於 aria-hidden="true" 的容器內 —— 鍵盤／讀螢幕使用者直接失去位置，
//   且「焦點停在 aria-hidden 子樹內」本身就是 WCAG 違規（Chrome 會在 console 告警）。
//   ⚠️ Bootstrap 5.3 的 Modal 不會自己還原焦點，別指望它。
const _modalTriggers = {};

// 把焦點還給觸發元素（用完即丟，確保只還一次）。
// ⚠️ 觸發鈕可能已經隨著重繪消失（例：編輯完某列後整張表重畫）→ 還在文件內且看得見才還，
//    否則就讓焦點落在 body，總比指向一個已被移除的節點好。
function restoreModalFocus(modalId) {
    const trigger = _modalTriggers[modalId];
    delete _modalTriggers[modalId];
    if (trigger && document.contains(trigger) && trigger.offsetParent !== null) {
        try { trigger.focus(); } catch (e) { /* 忽略 */ }
    }
}

// ⭐️ 終極物理開窗模式：徹底繞過 Visual Studio Browser Link 的底層干擾
export function showModalSafely(modalId) {
    const el = document.getElementById(modalId);
    if (!el) {
        console.error("🚨 系統錯誤：找不到彈窗元素 [" + modalId + "]");
        return;
    }

    // J9：記錄觸發元素。⚠️ 若焦點已經在別的 Modal 內（Modal 開 Modal），不要記 —— 那個元素馬上就會被藏起來。
    const trigger = document.activeElement;
    _modalTriggers[modalId] = (trigger && trigger !== document.body && !trigger.closest('.modal')) ? trigger : null;

    // Round-5 B9：開窗前先按身分套用 ACL 顯隱
    applyAclVisibilityForCurrentRole(el);

    try {
        // 先嘗試標準的 Bootstrap 開窗
        if (typeof bootstrap !== 'undefined') {
            // ⚠️ 自動聚焦必須綁在這條路徑上（2026-08-24 第六輪 G4）：下面那段實體開窗程式碼
            //    在 Bootstrap 可用時**永遠不會執行**（此處直接 return），聚焦邏輯寫在後面等於死碼。
            //    用 shown.bs.modal + { once: true }：等過場動畫真的結束才聚焦（比 setTimeout 猜時間可靠），
            //    且 once 避免每次開窗都疊一個新的監聽器。
            el.addEventListener('shown.bs.modal', () => focusFirstField(el), { once: true });
            // J9：ESC／點背景／data-bs-dismiss 這三條路**不會**經過 hideModalSafely，
            //     所以焦點還原必須也掛在 Bootstrap 自己的 hidden 事件上（用完即丟，不會與 hideModalSafely 重複）。
            el.addEventListener('hidden.bs.modal', () => restoreModalFocus(modalId), { once: true });
            bootstrap.Modal.getOrCreateInstance(el).show();
            return; // 成功就結束
        }
    } catch (error) {
        // ⭐️ 靜默處理 Visual Studio BrowserLink 衝突，移除 console.warn，讓右側視窗不再報錯
    }

    // --- 以下為【物理強制開窗模式】(當 Bootstrap 被干擾時的無敵備案) ---
    el.classList.add('show');
    el.style.display = 'block';
    el.removeAttribute('aria-hidden');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('role', 'dialog');
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';

    // 建立背景黑罩
    if (!document.querySelector('.modal-backdrop.force-backdrop')) {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop fade show force-backdrop';
        document.body.appendChild(backdrop);
    }

    // 為視窗內的關閉按鈕，強加物理關窗事件
    const closeBtns = el.querySelectorAll('[data-bs-dismiss="modal"]');
    closeBtns.forEach(btn => {
        btn.onclick = function (e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            e.stopPropagation();
            hideModalSafely(modalId);
        };
    });

    // 實體開窗模式沒有 shown.bs.modal 可用，只能用計時器等 CSS 過場結束
    setTimeout(() => focusFirstField(el), 150);
}

// ⭐️ UX：開窗後把游標放進第一個「真的看得到、真的能打字」的欄位。
// ⚠️ 不可只寫 `input:not([type=hidden])`：modals.html 有數個 `style="display:none"` 的容器
//    （如 webpageModal 的圖示欄、menuNodeModal 的隱藏欄位），選到它們會靜默失敗、
//    使用者反而以為聚焦壞掉。checkbox / radio / file 也不是「可打字」的欄位，一併排除。
function focusFirstField(el) {
    if (!el) return;
    const candidates = el.querySelectorAll(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled]):not([readonly])'
    );
    for (const field of candidates) {
        // offsetParent 為 null ＝ 自身或任一祖先 display:none（position:fixed 例外，Modal 內不會出現）
        if (field.offsetParent === null) continue;
        field.focus();
        // 編輯既有資料時把游標移到字尾，而不是選取整串（避免使用者一打字就整個覆蓋）
        if (typeof field.setSelectionRange === 'function' && field.type === 'text' && field.value) {
            try { field.setSelectionRange(field.value.length, field.value.length); } catch (e) { /* 部分型別不支援，忽略 */ }
        }
        return;
    }
}

export function hideModalSafely(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;

    // --- 0. J9：先把焦點搬出去，再蓋 aria-hidden ---
    //   順序不可顛倒：焦點還在裡面時就設 aria-hidden，等於在「對輔助技術隱藏」的子樹裡留一個聚焦元素。
    if (el.contains(document.activeElement)) {
        try { document.activeElement.blur(); } catch (e) { /* 部分元素不支援，忽略 */ }
    }
    restoreModalFocus(modalId);

    // --- 1. 物理強制關閉 (無差別執行，保證畫面絕對乾淨，無懼任何套件或 BrowserLink 衝突) ---
    el.classList.remove('show');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    el.removeAttribute('aria-modal');
    el.removeAttribute('role');
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';

    // 2. 暴力清除所有卡住的背景黑罩
    document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());

    // 3. 為了維持 Bootstrap 內部狀態機正常，溫和地呼叫 hide() (不依賴它改變畫面，且移除 return 阻斷)
    try {
        if (typeof bootstrap !== 'undefined') {
            const inst = bootstrap.Modal.getInstance(el) || bootstrap.Modal.getOrCreateInstance(el);
            if (inst) inst.hide();
        }
    } catch (error) {
        // 靜默處理
    }
}

// Expose for HTML inline handlers
window.applyAclVisibilityForCurrentRole = applyAclVisibilityForCurrentRole;
window.showModalSafely = showModalSafely;
window.hideModalSafely = hideModalSafely;

// ⚠️ 2026-08-24 第六輪 G5：移除曾短暫存在的 lockSubmitButton / unlockSubmitButton。
//    它們沒有任何呼叫端（防連點實際上沒生效），且職責與 ui/dialogs.js 的 setButtonLoading()
//    完全重疊 —— 後者才是全站 6 個表單存檔（fab / role / account / menu / webpage / 申請）
//    實際在用的那一份，且已支援傳入 <form> 自動找 submit 鈕。
//    新增防連點請一律呼叫 setButtonLoading(form, true/false)，不要再開第二套（同 A5 / F10 的教訓）。

// === admin/misc-manage.js - AppGrid + 需求申請 + 審核 + Excel 匯出 + 圖示工具 ===

// === 拖曳全域輔助 (表格重新排序使用) ===
function handleDragStart(e, id, parentId) {
    if (e.target.closest('button') || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { e.preventDefault(); return; }
    dragSrcEl = e.target.closest('tr'); if (!dragSrcEl) return;
    dragSrcId = id; dragSrcParentId = parentId;
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id);
    setTimeout(() => { if (dragSrcEl) dragSrcEl.classList.add('dragging'); }, 0);
}
function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const tr = e.target.closest('tr'); if (tr && tr !== dragSrcEl && tr.classList.contains('draggable-row')) tr.classList.add('drag-over'); return false; }
function handleDragLeave(e) { const tr = e.target.closest('tr'); if (tr) tr.classList.remove('drag-over'); }
function handleDrop(e, targetId, targetParentId, mode) {
    e.stopPropagation(); const tr = e.target.closest('tr'); if (tr) tr.classList.remove('drag-over');
    if (dragSrcEl) dragSrcEl.classList.remove('dragging');
    if (dragSrcId === targetId) return false;

    if (mode === 'system') reorderSystemMenu(dragSrcId, targetId, targetParentId);
    else if (mode === 'webpage') reorderWebpageMenu(dragSrcId, targetId);
    else if (mode === 'personal') reorderPersonalMenu(dragSrcId, targetId, targetParentId);
    return false;
}

function reorderSystemMenu(srcId, targetId, parentId) {
    const pId = (!parentId || parentId === 'null') ? null : parentId;
    let menus = getCustomMenus();

    // ⭐️ 核心修復：精準比對，當拖曳的是主選單(Root)時，需採用與 Table 相同的過濾邏輯
    let siblings = [];
    if (pId === null) {
        siblings = menus.filter(m => {
            if (String(m.isPoolItem).toLowerCase() === 'true') return false;
            let hasValidParent = menus.some(pNode => pNode.id !== m.id && (window.isParentMatch(m.parentId, pNode) || (m.parentIds || []).some(pid => window.isParentMatch(pid, pNode))));
            return !hasValidParent;
        });
    } else {
        siblings = menus.filter(m => String(m.isPoolItem).toLowerCase() !== 'true' && (window.cleanId(m.parentId) === window.cleanId(pId) || (m.parentIds && m.parentIds.some(pid => window.cleanId(pid) === window.cleanId(pId)))));
    }

    siblings.sort((a, b) => (a.parentOrders?.[pId] ?? a.order ?? 0) - (b.parentOrders?.[pId] ?? b.order ?? 0));

    const srcIdx = siblings.findIndex(m => window.cleanId(m.id) === window.cleanId(srcId));
    const targetIdx = siblings.findIndex(m => window.cleanId(m.id) === window.cleanId(targetId));
    if (srcIdx > -1 && targetIdx > -1) {
        const [movedItem] = siblings.splice(srcIdx, 1);
        siblings.splice(targetIdx, 0, movedItem);
        siblings.forEach((s, idx) => {
            const realMenu = menus.find(x => window.cleanId(x.id) === window.cleanId(s.id));
            if (realMenu) {
                if (pId === null) realMenu.order = idx * 10;
                else {
                    if (!realMenu.parentOrders) realMenu.parentOrders = {};
                    realMenu.parentOrders[pId] = idx * 10;
                }
            }
        });

        // 異動立即靜默同步到 DB（一般操作不需手動觸發）
        if (typeof syncDataToDB === 'function') syncDataToDB();

        if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
    }
}

// =====================================================================
// 個人頁面拖曳：兩段式 (Pending → Save)
//   - 拖曳只更新「待儲存」記憶體狀態，不碰 localStorage，不重畫上方導覽列
//   - 右上「儲存變更」按鈕亮起，點下去才呼叫 savePersonalSettings 寫 DB 並重畫 sidebar
//   - 「放棄」按鈕直接清掉 pending 回到 localStorage 既有狀態
//   - 切到別頁再回來、pending 仍會保留（只在分頁關閉或 refresh 時才會清掉）
//
//   getEffectivePersonalSettings(empId)：renderPersonalMenuManage 用此 helper 讀取，
//   有 pending 就用 pending；沒有就退回 localStorage。
// =====================================================================

window._personalPendingPSets = null;     // 待儲存的 pSets 物件 (整份 snapshot)
window._personalPendingDirty = false;    // 是否有未儲存的拖曳變更

window.getEffectivePersonalSettings = function (empId) {
    if (window._personalPendingDirty && window._personalPendingPSets) {
        return window._personalPendingPSets;
    }
    return getPersonalSettings(empId);
};

window.updatePersonalSaveButton = function () {
    const saveBtn = document.getElementById('btn-per-save-pending');
    const discardBtn = document.getElementById('btn-per-discard-pending');
    const countEl = document.getElementById('btn-per-pending-count');
    if (!saveBtn) return;

    if (window._personalPendingDirty) {
        saveBtn.classList.remove('d-none');
        if (discardBtn) discardBtn.classList.remove('d-none');
        // 簡單計算「待儲存改動數」= pending 中跟 localStorage 不同的 order 欄位數
        try {
            const saved = getPersonalSettings(currentUser?.id || '');
            const pending = window._personalPendingPSets || {};
            let diff = 0;
            const keys = new Set([...Object.keys(saved), ...Object.keys(pending)]);
            keys.forEach(k => {
                const a = saved[k]?.order;
                const b = pending[k]?.order;
                if (a !== b) diff++;
            });
            if (countEl) countEl.innerText = diff;
        } catch (e) { /* 計數失敗不要擋住按鈕顯示 */ }
    } else {
        saveBtn.classList.add('d-none');
        if (discardBtn) discardBtn.classList.add('d-none');
    }
};

function reorderPersonalMenu(srcId, targetId, parentId) {
    const pId = (!parentId || parentId === 'null' || parentId === '') ? null : parentId;

    // 從 effective (pending 或 localStorage) 起手，深拷一份避免污染
    const basePSets = window.getEffectivePersonalSettings(currentUser.id);
    let pSets = JSON.parse(JSON.stringify(basePSets));
    let menus = getCustomMenus();

    let siblings;
    if (pId === null) {
        siblings = menus.filter(m =>
            String(m.isPoolItem || m.IsPoolItem).toLowerCase() !== 'true' &&
            !m.parentId &&
            (!m.parentIds || m.parentIds.length === 0)
        );
    } else {
        siblings = menus.filter(m =>
            window.cleanId(m.parentId) === window.cleanId(pId) ||
            (m.parentIds && m.parentIds.some(pid => window.cleanId(pid) === window.cleanId(pId)))
        );
    }

    siblings.forEach(s => {
        const personalOrder = pSets[s.id] && pSets[s.id].order;
        s.tempOrder = (personalOrder != null) ? personalOrder : (s.order || 999);
    });
    siblings.sort((a, b) => a.tempOrder - b.tempOrder);

    const srcIdx = siblings.findIndex(m => window.cleanId(m.id) === window.cleanId(srcId));
    const targetIdx = siblings.findIndex(m => window.cleanId(m.id) === window.cleanId(targetId));
    if (srcIdx === -1 || targetIdx === -1) return;

    const [movedItem] = siblings.splice(srcIdx, 1);
    siblings.splice(targetIdx, 0, movedItem);
    siblings.forEach((m, idx) => {
        if (!pSets[m.id]) pSets[m.id] = {};
        pSets[m.id].order = idx * 10;
    });

    // 寫入 pending、不碰 localStorage、不重畫 sidebar (上方導覽列保留舊順序)
    window._personalPendingPSets = pSets;
    window._personalPendingDirty = true;

    if (typeof window.updatePersonalSaveButton === 'function') window.updatePersonalSaveButton();
    if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
    // ⚠️ 故意不呼叫 renderSidebarMenus — 拖曳暫態不要影響上方導覽列
}

// 「儲存變更」按鈕：把 pending 真正寫進 localStorage + DB + 重畫上方導覽列
window.commitPersonalPendingOrder = async function () {
    if (!window._personalPendingDirty || !window._personalPendingPSets) return;
    const pSets = window._personalPendingPSets;

    try {
        await savePersonalSettings(currentUser.id, pSets);
    } catch (e) {
        console.error('儲存個人版面順序失敗', e);
        if (typeof customAlert === 'function') customAlert('儲存失敗，請稍後再試');
        return;
    }

    window._personalPendingPSets = null;
    window._personalPendingDirty = false;

    if (typeof window.updatePersonalSaveButton === 'function') window.updatePersonalSaveButton();
    if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
    if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

    if (typeof customAlert === 'function') customAlert('已儲存個人版面順序，並同步到上方導覽列');
};

// 「放棄」按鈕：清掉 pending、回到 localStorage 既有狀態
window.discardPersonalPendingOrder = function () {
    if (!window._personalPendingDirty) return;
    if (typeof customConfirm === 'function') {
        customConfirm('放棄這次的拖曳變更？', () => {
            window._personalPendingPSets = null;
            window._personalPendingDirty = false;
            if (typeof window.updatePersonalSaveButton === 'function') window.updatePersonalSaveButton();
            if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
        });
    } else {
        window._personalPendingPSets = null;
        window._personalPendingDirty = false;
        if (typeof window.updatePersonalSaveButton === 'function') window.updatePersonalSaveButton();
        if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
    }
};

async function reorderWebpageMenu(srcId, targetId) {
    let menus = getCustomMenus();
    const srcIdx = menus.findIndex(m => window.cleanId(m.id) === window.cleanId(srcId));
    const targetIdx = menus.findIndex(m => window.cleanId(m.id) === window.cleanId(targetId));
    if (srcIdx > -1 && targetIdx > -1) {
        const [movedItem] = menus.splice(srcIdx, 1);
        menus.splice(targetIdx, 0, movedItem);
        menus.forEach((m, idx) => m.order = idx * 10);

        // 異動立即靜默同步到 DB（一般操作不需手動觸發）
        if (typeof syncDataToDB === 'function') syncDataToDB();

        if (typeof renderWebpageTable === 'function') renderWebpageTable();
        if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
    }
}

function rmDragStart(e, id) { rmDragSrcId = id; rmDragSrcEl = e.target.closest('.role-menu-item'); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => { if (rmDragSrcEl) rmDragSrcEl.classList.add('dragging'); }, 0); }
function rmDragOver(e) { e.preventDefault(); const item = e.target.closest('.role-menu-item'); if (item && item !== rmDragSrcEl) item.style.borderLeft = '4px solid #dc3545'; }
function rmDragLeave(e) { const item = e.target.closest('.role-menu-item'); if (item) item.style.borderLeft = ''; }
function rmDrop(e, targetId) {
    e.preventDefault(); e.stopPropagation();
    document.querySelectorAll('.role-menu-item').forEach(el => { el.classList.remove('dragging'); el.style.borderLeft = ''; });
    if (!rmDragSrcId || rmDragSrcId === targetId) return;

    const container = document.getElementById('roleMenuCheckboxes');
    const items = Array.from(container.children);
    const srcEl = items.find(el => window.cleanId(el.querySelector('.role-menu-cb').value) === window.cleanId(rmDragSrcId));
    const targetEl = items.find(el => window.cleanId(el.querySelector('.role-menu-cb').value) === window.cleanId(targetId));

    if (srcEl && targetEl) {
        const srcIdx = items.indexOf(srcEl);
        const tgtIdx = items.indexOf(targetEl);
        if (srcIdx < tgtIdx) targetEl.after(srcEl);
        else targetEl.before(srcEl);
    }
    rmDragSrcId = null;
}

// === App Grid ===
function openAppGridPage(menuId, title, element) {
    currentAppGridMenuId = menuId;
    document.getElementById('app-grid-title').innerText = title || '應用集合';
    if (typeof navTo === 'function') navTo('page-app-grid', element, title);
    const apps = getAppItems().filter(a => window.cleanId(a.menuId) === window.cleanId(menuId));
    if (typeof renderAppGrid === 'function') renderAppGrid('app-grid-container', apps);
}

function openAppGridModal(id = null) {
    try {
        document.getElementById('appForm').reset();
        document.getElementById('appIdInput').value = id || '';
        document.getElementById('appIconPreview').style.display = 'none';
        document.getElementById('appIconPreview').src = '';

        if (id) {
            const app = getAppItems().find(a => window.cleanId(a.id) === window.cleanId(id));
            if (app) {
                document.getElementById('appName').value = app.name;
                document.getElementById('appUrl').value = app.url;
                document.getElementById('appTarget').value = app.target || '_blank';
                if (app.iconBase64) {
                    document.getElementById('appIconPreview').style.display = 'block';
                    document.getElementById('appIconPreview').src = app.iconBase64;
                }
            }
        }
        showModalSafely('appGridModal');
    } catch (e) { console.error("[openAppGridModal] 錯誤:", e); }
}

function saveAppItem(e) {
    // ⭐️ 核心防重整
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('appIdInput').value;
        const name = document.getElementById('appName').value.trim();
        const url = document.getElementById('appUrl').value.trim();
        const target = document.getElementById('appTarget').value;
        const iconSrc = document.getElementById('appIconPreview').src;
        const finalIcon = document.getElementById('appIconPreview').style.display === 'block' ? iconSrc : '';

        let apps = getAppItems();
        if (id) {
            let idx = apps.findIndex(a => window.cleanId(a.id) === window.cleanId(id));
            if (idx > -1) { apps[idx].name = name; apps[idx].url = url; apps[idx].target = target; apps[idx].iconBase64 = finalIcon; }
        } else {
            apps.push({ id: 'app_' + Date.now(), menuId: currentAppGridMenuId, name: name, url: url, target: target, iconBase64: finalIcon });
        }

        // 異動立即靜默同步到 DB（一般操作不需手動觸發）
        if (typeof syncDataToDB === 'function') syncDataToDB();

        hideModalSafely('appGridModal');
        if (currentAppGridMenuId && typeof renderAppGrid === 'function') renderAppGrid('app-grid-container', getAppItems().filter(a => window.cleanId(a.menuId) === window.cleanId(currentAppGridMenuId)));

    } catch (error) { console.error("[saveAppItem] 錯誤:", error); }
    return false;

}

function deleteAppItem(id) {
    try {
        customConfirm('確定要刪除此 APP 嗎？', () => {
            let apps = getAppItems().filter(a => window.cleanId(a.id) !== window.cleanId(id));
            window.appState.apps = apps;

            // 異動立即靜默同步到 DB（一般操作不需手動觸發）
        if (typeof syncDataToDB === 'function') syncDataToDB();

            if (currentAppGridMenuId && typeof renderAppGrid === 'function') renderAppGrid('app-grid-container', apps.filter(a => window.cleanId(a.menuId) === window.cleanId(currentAppGridMenuId)));
        });
    } catch (e) { console.error("[deleteAppItem] 錯誤:", e); }
}

function handleAppIconUpload(e) {
    const file = e.target.files[0];
    if (file) {
        compressImageFile(file, function (base64Str) {
            if (base64Str.length > 32700) {
                customAlert("圖檔太複雜，無法壓縮至安全大小，請更換較簡單的圖標。");
                document.getElementById('appIconPreview').style.display = 'none';
                e.target.value = '';
            } else {
                document.getElementById('appIconPreview').src = base64Str;
                document.getElementById('appIconPreview').style.display = 'block';
            }
        });
    }
}

// === Apply & Audit 申請與審核 ===
function openApplyModal(id = null) {
    try {
        const reasonInput = document.getElementById('applyReason');
        const idInput = document.getElementById('applyReqId');
        const typeInput = document.getElementById('applyType');
        const fabInput = document.getElementById('applyFab');

        if (id) {
            const req = getRequests().find(r => window.cleanId(r.id) === window.cleanId(id));
            if (req) {
                reasonInput.value = req.reason; idInput.value = req.id;
                if (typeInput) typeInput.value = req.reqType || '權限開通';
                if (fabInput) fabInput.value = req.fab || '全域 (Global)';
            }
        } else {
            reasonInput.value = ''; idInput.value = '';
            if (typeInput) typeInput.value = '權限開通';
            if (fabInput) fabInput.value = '全域 (Global)';
        }

        showModalSafely('applyModal');
    } catch (e) { console.error("[openApplyModal] 錯誤:", e); }
}

async function submitApplyItem(e) {
    // ⭐️ 核心防重整
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('applyReqId').value;
        const reason = document.getElementById('applyReason').value.trim();
        const reqType = document.getElementById('applyType') ? document.getElementById('applyType').value : '系統需求';
        const fab = document.getElementById('applyFab') ? document.getElementById('applyFab').value : '全域';

        if (!reason) { customAlert('請填寫需求說明！'); return false; }

        const payload = {
            requestId: id || ('req_' + Date.now()),
            reqType: reqType,
            fab: fab,
            reason: reason
        };

        const response = await fetch('/api/Requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error("API 回傳失敗:", response.status);
            return false;
        }

        // 重新拉取最新資料並重新渲染
        await window.fetchInitialDataFromDB();
        
        hideModalSafely('applyModal');
        if (typeof renderApplyTable === 'function') renderApplyTable();
        customAlert(id ? '需求申請已重新送出！' : '您的需求申請已成功送出！系統管理員將盡快為您處理。');
    } catch (error) { console.error("[submitApplyItem] 錯誤:", error); }
    return false;
}

window.deleteApplyItem = function (id) {
    if (typeof customConfirm !== 'function') return;
    customConfirm('確定要刪除此申請紀錄嗎？', async () => {
        try {
            await fetch('/api/Requests/' + id, { method: 'DELETE' });
            await window.fetchInitialDataFromDB();
            if (typeof renderApplyTable === 'function') renderApplyTable();
        } catch (e) {
            console.error("刪除失敗", e);
        }
    });
};

function withdrawApply(id) {
    try {
        document.getElementById('withdrawReqId').value = id;
        document.getElementById('withdrawReason').value = '';
        showModalSafely('withdrawModal');
    } catch (e) { console.error("[withdrawApply] 錯誤:", e); }
}

async function submitWithdrawItem(e) {
    // ⭐️ 核心防重整
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('withdrawReqId').value;
        const reason = document.getElementById('withdrawReason').value.trim();

        await fetch('/api/Requests/' + id + '/Withdraw', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason })
        });

        await window.fetchInitialDataFromDB();
        
        hideModalSafely('withdrawModal');
        if (typeof renderApplyTable === 'function') renderApplyTable();
    } catch (error) { console.error("[submitWithdrawItem] 錯誤:", error); }
    return false;
}

function openAuditModal(id) {
    try {
        const r = getRequests().find(x => window.cleanId(x.id) === window.cleanId(id));
        if (!r) { console.error("找不到對應的申請資料 (ID: " + id + ")"); return; }

        document.getElementById('auditReqId').value = r.id;
        document.getElementById('auditApplicant').value = `${r.empName} (${r.empId})`;

        let dateStr = r.timestamp;
        if (typeof r.timestamp === 'number') {
            let now = new Date(r.timestamp); let pad = (n) => n < 10 ? '0' + n : n;
            dateStr = now.getFullYear() + '/' + pad(now.getMonth() + 1) + '/' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
        }
        document.getElementById('auditTime').value = dateStr;

        document.getElementById('auditType').value = r.reqType || '系統需求';
        document.getElementById('auditFab').value = r.fab || '全域 (Global)';
        document.getElementById('auditReasonDisplay').innerText = r.reason;
        document.getElementById('auditStatus').value = r.status || 'pending';
        document.getElementById('auditReply').value = r.reply || '';

        showModalSafely('auditModal');
    } catch (e) { console.error("[openAuditModal] 錯誤:", e); }
}

async function saveAuditItem(e) {
    // ⭐️ 核心防重整
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('auditReqId').value;
        const status = document.getElementById('auditStatus').value;
        const reply = document.getElementById('auditReply').value.trim();

        await fetch('/api/Requests/' + id + '/Audit', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: status, reply: reply })
        });

        await window.fetchInitialDataFromDB();
        hideModalSafely('auditModal');

        if (typeof renderAuditTable === 'function') renderAuditTable();
        customAlert("已成功儲存並同步回覆狀態給使用者！");

    } catch (error) { console.error("[saveAuditItem] 錯誤:", error); }
    return false;
}

// === Excel 匯出備份（對齊 TEST_20260429.html:2186-2259）===
function createWorkbookData() {
    if (typeof XLSX === 'undefined') { customAlert('SheetJS 套件未載入'); return null; }
    const wb = XLSX.utils.book_new();

    const appendSafeData = (data, sheetName) => {
        if (!data || data.length === 0) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{}]), sheetName);
            return;
        }
        const safeData = data.map(item => {
            let processed = {};
            for (let key in item) {
                let val = item[key];
                let finalStr = (typeof val === 'object' && val !== null) ? JSON.stringify(val) : (val !== undefined ? String(val) : '');
                if (finalStr.length > 32700) {
                    processed[key] = finalStr.startsWith('data:image') ? '' : (finalStr.substring(0, 32700) + '...');
                } else {
                    processed[key] = finalStr;
                }
            }
            return processed;
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData), sheetName);
    };

    const menus = getCustomMenus();
    const fabs = getFabs();
    const roles = getRoles();
    const accs = getAccounts();
    const apps = getAppItems();
    const reqs = getRequests();

    appendSafeData(menus.map(m => ({ MenuId: m.id, SysName: m.name, DisplayName: m.displayName, MenuMode: m.menuMode, Url: m.url || '', TargetPage: m.targetPage || '', OpenTarget: m.target || '', Icon: m.icon || '', CreatedBy: m.createdBy || 'admin', IsEnabled: m.enabled !== false, IsPoolItem: m.isPoolItem === true, IsEdited: m.isEdited === true, GlobalOrder: m.order || 0 })), "Menus");
    appendSafeData(fabs.map(f => ({ FabId: f.id, FabName: f.fabName, DisplayName: f.displayName, DefaultLang: f.defaultLang || 'zh' })), "Fabs");
    appendSafeData(roles.map(r => ({ RoleId: r.id, GroupName: r.groupName })), "Roles");
    appendSafeData(accs.map(a => ({ EmpId: a.empId, Name: a.name, Department: a.department || '', RoleLevel: a.roleLevel || 'user', CanEditOthers: a.canEditOthers === true })), "Accounts");
    appendSafeData(apps.map(a => ({ AppId: a.id, MenuId: a.menuId, AppName: a.name, Url: a.url || '', IconBase64: a.iconBase64 || '', Target: a.target || '_blank' })), "Apps");
    appendSafeData(reqs.map(r => ({ RequestId: r.id, EmpId: r.empId, EmpName: r.empName, Reason: r.reason, Timestamp: r.timestamp, Status: r.status, WithdrawReason: r.withdrawReason || '', Reply: r.reply || '' })), "Requests");

    let mapFabRole = []; fabs.forEach(f => { if (f.assignedRoles) f.assignedRoles.forEach(rId => mapFabRole.push({ FabId: f.id, RoleId: rId })); });
    appendSafeData(mapFabRole.length ? mapFabRole : [{ FabId: '', RoleId: '' }], "Map_Fab_Role");

    let mapAccRole = []; accs.forEach(a => { if (a.assignedRoles) a.assignedRoles.forEach(rId => mapAccRole.push({ EmpId: a.empId, RoleId: rId })); });
    appendSafeData(mapAccRole.length ? mapAccRole : [{ EmpId: '', RoleId: '' }], "Map_Account_Role");

    let mapAccMenu = []; accs.forEach(a => { if (a.manageableMenus) a.manageableMenus.forEach(mId => mapAccMenu.push({ EmpId: a.empId, MenuId: mId })); });
    appendSafeData(mapAccMenu.length ? mapAccMenu : [{ EmpId: '', MenuId: '' }], "Map_Account_ManageMenu");

    let mapRoleMenu = []; roles.forEach(r => { if (r.allowedMenuIds) r.allowedMenuIds.forEach((mId, idx) => mapRoleMenu.push({ RoleId: r.id, MenuId: mId, SortOrder: idx * 10 })); });
    appendSafeData(mapRoleMenu.length ? mapRoleMenu : [{ RoleId: '', MenuId: '', SortOrder: '' }], "Map_Role_Menu");

    let mapMenuStruct = []; menus.forEach(m => {
        if (m.parentIds && m.parentIds.length > 0) {
            m.parentIds.forEach(pId => mapMenuStruct.push({ ParentMenuId: pId, ChildMenuId: m.id, SortOrder: m.parentOrders ? (m.parentOrders[pId] || 0) : 0 }));
        } else if (m.parentId) {
            mapMenuStruct.push({ ParentMenuId: m.parentId, ChildMenuId: m.id, SortOrder: m.order || 0 });
        }
    });
    appendSafeData(mapMenuStruct.length ? mapMenuStruct : [{ ParentMenuId: '', ChildMenuId: '', SortOrder: '' }], "Map_Menu_Structure");

    let mapAccDefPage = []; accs.forEach(a => { if (a.defaultPages) { for (let fab in a.defaultPages) { mapAccDefPage.push({ EmpId: a.empId, FabId: fab, MenuId: a.defaultPages[fab] }); } } });
    appendSafeData(mapAccDefPage.length ? mapAccDefPage : [{ EmpId: '', FabId: '', MenuId: '' }], "Map_Account_DefaultPage");

    let pSettings = []; accs.forEach(a => {
        let pSet = getPersonalSettings(a.empId);
        if (pSet) for (let mId in pSet) {
            pSettings.push({ EmpId: a.empId, MenuId: mId, IsHidden: pSet[mId].hidden === true, OpenTarget: pSet[mId].target || '', Icon: pSet[mId].icon || '', SortOrder: pSet[mId].order !== undefined ? pSet[mId].order : '' });
        }
    });
    appendSafeData(pSettings.length ? pSettings : [{ EmpId: '', MenuId: '', IsHidden: '', OpenTarget: '', Icon: '', SortOrder: '' }], "PersonalSettings");

    return wb;
}

function exportConfig() {
    try {
        const wb = createWorkbookData();
        if (!wb) return;
        XLSX.writeFile(wb, "EQDashboard_Setting.xlsx");
    } catch (e) {
        console.error("[exportConfig] 錯誤:", e);
        if (typeof customAlert === 'function') customAlert("匯出 Excel 失敗：" + e.message);
    }
}
window.exportConfig = exportConfig;
window.createWorkbookData = createWorkbookData;

// === Icon Helpers ===
function handleIconSelectChange(prefix) {
    const sel = document.getElementById(prefix + 'Icon');
    const fileInput = document.getElementById(prefix + 'IconFile');
    if (sel.value === 'custom') { fileInput.style.display = 'block'; } else { fileInput.style.display = 'none'; }
}

function getSelectedIconVal(prefix) {
    let val = document.getElementById(prefix + 'Icon').value;
    if (val === 'custom') { return document.getElementById(prefix + 'CustomIconBase64').value || ''; }
    return val;
}

function setIconValToModal(prefix, iconVal) {
    if (iconVal && (iconVal.startsWith('data:image') || iconVal.startsWith('icon/'))) {
        document.getElementById(prefix + 'Icon').value = 'custom';
        document.getElementById(prefix + 'IconFile').style.display = 'block';
        document.getElementById(prefix + 'CustomIconBase64').value = iconVal;
    } else {
        document.getElementById(prefix + 'Icon').value = iconVal || '';
        document.getElementById(prefix + 'IconFile').style.display = 'none';
        document.getElementById(prefix + 'CustomIconBase64').value = '';
    }
}

function compressImageFile(file, callback) {
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 80;
            let width = img.width; let height = img.height;
            if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } }
            else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// === Excel 手動匯入與解析 ===
async function importConfig() {
    const fileInput = document.getElementById('configFile'); const file = fileInput.files[0];
    if (!file) return customAlert("請先選擇 Excel 檔案！");
    const reader = new FileReader();

    reader.onload = async function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            await processAndSaveWorkbook(workbook, true);

            fileInput.value = '';
        } catch (err) {
            console.error(err);
            customAlert("匯入失敗，格式錯誤或網路異常。");
        }
    };
    reader.readAsArrayBuffer(file);
}

async function processAndSaveWorkbook(workbook, isManualImport = false) {
    const getSheetData = (sheetName) => {
        if (!workbook.Sheets[sheetName]) return [];
        return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    };

    const rawMenus = getSheetData("Menus"); const rawFabs = getSheetData("Fabs"); const rawRoles = getSheetData("Roles");
    const rawAccs = getSheetData("Accounts"); const rawApps = getSheetData("Apps"); const rawReqs = getSheetData("Requests");

    if (rawAccs.length > 0 && rawAccs[0].hasOwnProperty("EmpId")) {
        const mapFabRole = getSheetData("Map_Fab_Role"); const mapAccRole = getSheetData("Map_Account_Role");
        const mapAccMenu = getSheetData("Map_Account_ManageMenu"); const mapRoleMenu = getSheetData("Map_Role_Menu");
        const mapMenuStruct = getSheetData("Map_Menu_Structure"); const mapAccDefPage = getSheetData("Map_Account_DefaultPage");

        const finalAccs = rawAccs.filter(r => r.EmpId).map(row => {
            let empId = String(row.EmpId); let defPages = {};
            mapAccDefPage.filter(m => window.cleanId(m.EmpId) === window.cleanId(empId) && m.FabId && m.MenuId).forEach(m => { defPages[String(m.FabId)] = String(m.MenuId); });
            return {
                empId: empId, name: row.Name || '', department: row.Department || '',
                roleLevel: (row.RoleLevel || 'user').toLowerCase(),
                canEditOthers: String(row.CanEditOthers).toLowerCase() === 'true',
                defaultPages: defPages,
                assignedRoles: mapAccRole.filter(m => window.cleanId(m.EmpId) === window.cleanId(empId) && m.RoleId).map(m => String(m.RoleId)),
                manageableMenus: mapAccMenu.filter(m => window.cleanId(m.EmpId) === window.cleanId(empId) && m.MenuId).map(m => String(m.MenuId))
            };
        });

        const finalFabs = rawFabs.filter(r => r.FabId).map(row => {
            let fabId = String(row.FabId);
            return { id: fabId, fabName: row.FabName || fabId, displayName: row.DisplayName || '', defaultLang: (row.DefaultLang || 'zh').toLowerCase(), assignedRoles: mapFabRole.filter(m => window.cleanId(m.FabId) === window.cleanId(fabId) && m.RoleId).map(m => String(m.RoleId)) };
        });

        const finalRoles = rawRoles.filter(r => r.RoleId).map(row => {
            let roleId = String(row.RoleId);
            let allowed = mapRoleMenu.filter(m => window.cleanId(m.RoleId) === window.cleanId(roleId) && m.MenuId).sort((a, b) => parseInt(a.SortOrder || 0) - parseInt(b.SortOrder || 0)).map(m => String(m.MenuId));
            return { id: roleId, groupName: row.GroupName || '', allowedMenuIds: allowed };
        });

        const finalMenus = rawMenus.filter(r => r.MenuId).map(row => {
            let mId = String(row.MenuId);
            let m = { id: mId, name: row.SysName || '', displayName: row.DisplayName || '', menuMode: row.MenuMode || 'link', url: row.Url || '', targetPage: row.TargetPage || '', target: row.OpenTarget || 'iframe', icon: row.Icon || '', createdBy: row.CreatedBy || 'admin', enabled: String(row.IsEnabled).toLowerCase() !== 'false', isPoolItem: String(row.IsPoolItem).toLowerCase() === 'true', isEdited: String(row.IsEdited).toLowerCase() === 'true', order: parseInt(row.GlobalOrder || 0), parentId: null, parentIds: [], parentOrders: {} };
            let parents = mapMenuStruct.filter(s => window.cleanId(s.ChildMenuId) === window.cleanId(mId) && s.ParentMenuId);
            if (parents.length > 0) { m.parentId = String(parents[0].ParentMenuId); m.parentIds = parents.map(p => String(p.ParentMenuId)); parents.forEach(p => { m.parentOrders[String(p.ParentMenuId)] = parseInt(p.SortOrder || 0); }); }
            return m;
        });

        let finalApps = [];
        if (rawApps.length > 0) {
            finalApps = rawApps.filter(r => r.AppId || r.id).map(row => ({
                id: String(row.AppId || row.id || ''), menuId: String(row.MenuId || row.menuId || ''),
                name: row.AppName || row.name || '', url: row.Url || row.url || '',
                iconBase64: row.IconBase64 || row.iconBase64 || '', target: row.Target || row.target || '_blank'
            }));
        }

        let finalReqs = [];
        if (rawReqs.length > 0) {
            finalReqs = rawReqs.filter(r => r.RequestId || r.id).map(row => ({
                id: String(row.RequestId || row.id), empId: String(row.EmpId || row.empId),
                empName: row.EmpName || row.empName || '', reason: row.Reason || row.reason || '',
                timestamp: row.Timestamp || row.timestamp, status: row.Status || row.status || 'unreplied',
                withdrawReason: row.WithdrawReason || row.withdrawReason || '', reply: row.Reply || row.reply || ''
            }));
        }

        if (typeof window.appState !== 'undefined') {
            window.appState.accounts = finalAccs;
            window.appState.fabs = finalFabs;
            window.appState.roles = finalRoles;
            window.appState.menus = finalMenus;
            window.appState.apps = finalApps;
            window.appState.requests = finalReqs;
        }

    } else {
        const parseVal = (val) => {
            if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) { try { return JSON.parse(val); } catch (err) { return val; } }
            else if (val === 'true' || val === 'TRUE') return true;
            else if (val === 'false' || val === 'FALSE') return false;
            return val;
        };

        const oldMenus = rawMenus.filter(r => r.id).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });
        const oldFabs = rawFabs.filter(r => r.id).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });
        const oldRoles = rawRoles.filter(r => r.id).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });
        const oldAccs = rawAccs.filter(r => r.empId).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });
        const oldApps = rawApps.filter(r => r.id).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });
        const oldReqs = rawReqs.filter(r => r.id).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });

        if (typeof window.appState !== 'undefined') {
            window.appState.menus = oldMenus;
            window.appState.fabs = oldFabs;
            window.appState.roles = oldRoles;
            window.appState.accounts = oldAccs;
            window.appState.apps = oldApps;
            window.appState.requests = oldReqs;
        }
    }

    if (isManualImport) {
        hasUnsavedChanges = false;
        if (typeof updateSyncButtonUI === 'function') updateSyncButtonUI();

        if (typeof syncDataToDB === 'function') {
            await syncDataToDB(true); // Excel 匯入時要顯示 loading 與完成訊息
            if (typeof initDashboardUI === 'function') initDashboardUI();
        }
    } else {
        hasUnsavedChanges = false;
        if (typeof updateSyncButtonUI === 'function') updateSyncButtonUI();
    }
}

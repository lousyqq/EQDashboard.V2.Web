export const appState = {
    currentUser: null,
    currentLang: 'zh',
    currentFab: '',
    currentLayoutMode: 'system',
    currentAppGridMenuId: null,
    modals: {},
    confirmActionCallback: null,
    dragSrcEl: null,
    dragSrcId: null,
    dragSrcParentId: null,
    draggedRoleItem: null,
    systemAlertModalObj: null,
    systemConfirmModalObj: null,
    currentTreeData: [],
    expandedPerMenuIds: new Set(),
    isPerAllExpanded: false,
    dtInstances: {},
    // 管理頁 DataTable 的「每頁筆數 (pageLength)」session 記憶：key=tableId。
    //   使用者調整筆數後，拖曳/編輯儲存等 destroy+rebuild 不再跳回預設 10；只有「整頁重整」(模組重載→appState 重生) 才回預設。
    dtPageLenMemory: {},
    // 管理頁 DataTable 的「剛新增置頂」session 記憶：key=tableId、值=id 陣列（最新的排最前）。
    //   新增完成後該筆會被搬到第一頁最上方讓使用者立刻確認；只有「整頁重整」(模組重載→appState 重生) 才回歸正常排序。
    dtPinnedNewIds: {},
    currentActiveTopMenuId: null,
    currentActiveSidebarMenuId: null,
    isPinned: true,
    tempDefaultPages: {},    _currentValidMenus: []
};

// Expose state globally ONLY for debugging purposes
// Production code should import appState from store.js
window.appState = appState;

// 全域 XSS 防禦與 JS 跳脫工具函式
// ⭐️ 2026-08-13 收斂為**唯一實作**：先前專案裡有三份各自的版本（store.js 的 escHtml、
//    config.js 的 escapeHTML、traffic-stats.js 內的私有 escHtml），且跳脫的字元集不一致
//    （store 版沒處理單引號 `'`）。現在統一以本函式為準，另外兩處改為指向它的別名。
//    多跳脫一個 `'` 是必要的：屬性值若用單引號包覆（`attr='...'`），少跳脫就能被跳脫出來。
export function escHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function _jsArg(s) {
    let v = String(s == null ? '' : s)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
    return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.escHtml = escHtml;
window._jsArg = _jsArg;
// 別名：舊呼叫端大量使用 escapeHTML / escapeHtml，全部指向同一份實作，避免行為分歧。
//   （store.js 是所有模組的相依起點，故在此定義最早、不會有載入順序問題。）
window.escapeHTML = escHtml;
window.escapeHtml = escHtml;


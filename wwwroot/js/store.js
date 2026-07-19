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
    currentActiveTopMenuId: null,
    currentActiveSidebarMenuId: null,
    isPinned: true,
    tempDefaultPages: {},
    hasUnsavedChanges: false,
    _currentValidMenus: []
};

// Expose state globally ONLY for debugging purposes
// Production code should import appState from store.js
window.appState = appState;

// 全域 XSS 防禦與 JS 跳脫工具函式
export function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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


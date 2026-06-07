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

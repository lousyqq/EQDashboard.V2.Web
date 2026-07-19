// === admin/activity-log.js — 操作紀錄查詢頁 (admin only) ===
//
// 對應後端：GET /api/ActivityLogs   DELETE /api/ActivityLogs/Purge?days=N
// 對應頁面：#page-activity-log
//

import { customAlert, customConfirm, showToast, skeletonRows } from '../ui/dialogs.js?v=20260719c';
import { appState } from '../store.js?v=20260719c';
import { t } from '../config.js?v=20260719c';


window._activityLogPage = 1;
window._activityLogPageSize = 15;
window._activityLogTotal = 0;
window._activityLogLoaded = false;

export async function loadActivityLogs(forceReload = false) {
    // ⚠️ 不能用 appState.currentUser — config.js 用 `let appState.currentUser` 宣告，不會掛到 window
    if (!appState.currentUser || String(appState.currentUser.roleLevel || '').toLowerCase() !== 'admin') {
        if (typeof customAlert === 'function') customAlert(t('admin_only', '僅管理員可執行此操作'));
        return;
    }

    // 第一頁顯示最新的幾筆後，若非換頁、查詢或主動點選重新整理，切換分頁不重複發送請求
    if (!forceReload && window._activityLogLoaded && window._activityLogPage === 1) {
        return;
    }

    const tbody = document.getElementById('activityLogBody');
    const stats = document.getElementById('activityLogStats');
    if (tbody) tbody.innerHTML = skeletonRows(12, 8);

    const params = new URLSearchParams();
    const empId = document.getElementById('alEmpId')?.value?.trim();
    const category = document.getElementById('alCategory')?.value;
    const from = document.getElementById('alFrom')?.value;
    const to = document.getElementById('alTo')?.value;
    const keyword = document.getElementById('alKeyword')?.value?.trim();
    const success = document.getElementById('alSuccess')?.value;
    if (empId) params.set('empId', empId);
    if (category) params.set('category', category);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (keyword) params.set('keyword', keyword);
    if (success) params.set('successOnly', success);
    params.set('page', window._activityLogPage);
    params.set('pageSize', window._activityLogPageSize);

    try {
        const resp = await fetch('/api/ActivityLogs?' + params.toString());
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        window._activityLogTotal = data.total || 0;

        if (!data.rows || data.rows.length === 0) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted py-4">${t('al_no_records', '無符合條件的紀錄')}</td></tr>`;
        } else {
            const html = [];
            for (const r of data.rows) {
                html.push(renderActivityRow(r));
            }
            if (tbody) tbody.innerHTML = html.join('');
        }

        window._activityLogLoaded = true;

        // 分頁狀態
        const totalPages = Math.max(1, Math.ceil(window._activityLogTotal / window._activityLogPageSize));
        document.getElementById('alPageInfo').innerText = `${window._activityLogPage} / ${totalPages}`;
        document.getElementById('alPrev').disabled = window._activityLogPage <= 1;
        document.getElementById('alNext').disabled = window._activityLogPage >= totalPages;
        if (stats) stats.innerText = t('al_stats', '總筆數 {0}，本頁顯示 {1} 筆').replace('{0}', window._activityLogTotal).replace('{1}', data.rows?.length || 0);
    } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="12" class="text-center text-danger py-4">${t('al_query_failed', '查詢失敗：')}${window.escapeHTML(e.message || e)}</td></tr>`;
    }
}

export function renderActivityRow(r) {
    const tsLocal = r.timestampUtc ? new Date(r.timestampUtc + (r.timestampUtc.endsWith('Z') ? '' : 'Z')) : null;
    const tsStr = tsLocal ? tsLocal.toLocaleString('zh-TW', { hour12: false }) : '';
    const isSuccess = r.isSuccess;
    const statusBadge = isSuccess === true
        ? `<span class="badge bg-success bg-opacity-25 text-success border border-success border-opacity-50">${r.statusCode ?? '✓'}</span>`
        : isSuccess === false
            ? `<span class="badge bg-danger bg-opacity-25 text-danger border border-danger border-opacity-50">${r.statusCode ?? '✗'}</span>`
            : `<span class="badge bg-secondary bg-opacity-25 text-secondary">${r.statusCode ?? '—'}</span>`;
    const sourceBadge = r.loginSource
        ? `<span class="badge bg-light text-dark border">${window.escapeHTML(r.loginSource)}</span>`
        : '';
    const detailHtml = r.detail || r.errorMessage
        ? `<small class="text-muted">${window.escapeHTML(r.errorMessage || r.detail || '').slice(0, 120)}</small>`
        : '';

    return `<tr>
        <td class="small">${window.escapeHTML(tsStr)}</td>
        <td class="small fw-bold">${window.escapeHTML(r.empId || '—')}</td>
        <td class="small">${window.escapeHTML(r.empName || '')}</td>
        <td class="small">${sourceBadge}</td>
        <td class="small"><span class="badge bg-info bg-opacity-15 text-primary border">${window.escapeHTML(r.category || '')}</span></td>
        <td class="small">${window.escapeHTML(r.action || '')}</td>
        <td class="small text-muted">${window.escapeHTML(r.httpMethod || '')}</td>
        <td class="small text-muted" style="max-width:300px; overflow:hidden; text-overflow:ellipsis;" title="${window.escapeHTML(r.path || '')}">${window.escapeHTML(r.path || '')}</td>
        <td class="small">${statusBadge}</td>
        <td class="small text-end">${r.durationMs != null ? r.durationMs : ''}</td>
        <td class="small text-muted">${window.escapeHTML(r.ipAddress || '')}</td>
        <td class="text-start" style="max-width:280px; white-space:normal;">${detailHtml}</td>
    </tr>`;
}

// 條件變更後的「新查詢」：回到第 1 頁再查，避免停留在舊查詢的頁碼撈到空頁
export function searchActivityLogs() {
    window._activityLogPage = 1;
    loadActivityLogs(true);
}

// 篩選輸入框按 Enter 直接送出查詢（select 維持瀏覽器預設行為）
document.addEventListener('DOMContentLoaded', () => {
    ['alEmpId', 'alFrom', 'alTo', 'alKeyword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); searchActivityLogs(); }
        });
    });
});

export function changeActivityPage(delta) {
    const totalPages = Math.max(1, Math.ceil(window._activityLogTotal / window._activityLogPageSize));
    const newPage = window._activityLogPage + delta;
    if (newPage < 1 || newPage > totalPages) return;
    window._activityLogPage = newPage;
    loadActivityLogs(true);
}

export async function purgeActivityLogs() {
    if (!appState.currentUser || String(appState.currentUser.roleLevel || '').toLowerCase() !== 'admin') return;
    if (typeof customConfirm === 'function') {
        customConfirm(t('al_purge_confirm', '確定要清除 90 天前的所有操作紀錄？(此操作無法復原)'), async () => {
            try {
                const resp = await fetch('/api/ActivityLogs/Purge?days=90', { method: 'DELETE' });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();
                if (typeof showToast === 'function') showToast(t('al_purged', '已清除 {0} 筆紀錄').replace('{0}', data.deleted || 0));
                window._activityLogPage = 1;
                loadActivityLogs(true);
            } catch (e) {
                if (typeof customAlert === 'function') customAlert(t('al_purge_failed', '清除失敗：') + (e.message || e));
            }
        });
    }
}

// Expose for HTML inline handlers
window.loadActivityLogs = loadActivityLogs;
window.searchActivityLogs = searchActivityLogs;
window.renderActivityRow = renderActivityRow;
window.changeActivityPage = changeActivityPage;
window.purgeActivityLogs = purgeActivityLogs;


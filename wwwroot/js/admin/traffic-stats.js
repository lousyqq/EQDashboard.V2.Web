// === admin/traffic-stats.js — 總瀏覽統計與使用率 (DAU/MAU/部門熱度) 查詢頁 (admin only) ===
//
// 對應後端：GET /api/Analytics/UsageStats?days=N
//           GET /api/Analytics/details?page=...&pageSize=...
// 對應頁面：#page-traffic-stats

import { customAlert, skeletonRows } from '../ui/dialogs.js';
import { appState } from '../store.js';
import { t } from '../config.js';

// XSS 防禦：對插入 innerHTML 的使用者資料做 HTML 實體跳脫
// escHtml 使用 store.js 的全域單一實作（原本此處有一份私有副本，2026-08-13 移除）。
const escHtml = (s) => window.escHtml(s);

window._trafficDetailPage = 1;
window._trafficDetailPageSize = 20;
window._trafficDetailTotal = 0;

// 殭屍看板的「建立日期」欄。後端 GetZombieMenus 回 createTime + createTimeKind 三態：
//   exact    → Menus.CreatedAt 有值，直接顯示
//   inferred → CreatedAt 為 NULL（欄位 2026-08-11 才加，之前建立的都沒有），
//              改用「歷來最早一次點擊日」當下限 → 必須標示成推估值，不可假裝是建立日
//   unknown  → 既無 CreatedAt、也從未被點過 → 誠實顯示「未知」
// 為什麼要分三態：舊資料 31 筆 CreatedAt 全為 NULL，若一律顯示 "-"，
// 管理員無法分辨「真的長期沒人用」與「單純沒有建檔時間」，殭屍清單就失去判讀價值。
function zombieCreateCell(item) {
    const kind = item.createTimeKind || (item.createTime ? 'exact' : 'unknown');
    if (kind === 'exact') return escHtml(item.createTime);
    if (kind === 'inferred') {
        const hint = t('ts_created_inferred_hint', '此看板沒有建立時間紀錄，這是系統可追溯到的最早一次點擊日期（實際建立時間更早）');
        return `<span title="${escHtml(hint)}" class="text-warning-emphasis">≤ ${escHtml(item.createTime)}`
            + ` <i class="fas fa-circle-question opacity-75" aria-hidden="true"></i></span>`;
    }
    return `<span class="fst-italic opacity-75">${escHtml(t('ts_created_unknown', '未知'))}</span>`;
}

export async function loadTrafficStats() {
    if (!appState.currentUser || String(appState.currentUser.roleLevel || '').toLowerCase() !== 'admin') {
        if (typeof customAlert === 'function') customAlert(t('admin_only', '僅管理員可執行此操作'));
        return;
    }

    const daysSelect = document.getElementById('tsDaysSelect');
    const days = daysSelect ? parseInt(daysSelect.value || '30', 10) : 30;

    const dailyBody = document.getElementById('tsDailyBody');
    const monthlyBody = document.getElementById('tsMonthlyBody');
    const deptBody = document.getElementById('tsDeptBody');

    if (dailyBody) dailyBody.innerHTML = skeletonRows(4, 6);
    if (monthlyBody) monthlyBody.innerHTML = skeletonRows(4, 6);
    if (deptBody) deptBody.innerHTML = skeletonRows(4, 6);

    try {
        const resp = await fetch(`/api/Analytics/UsageStats?days=${days}`);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();

        // 1. KPI Summary Cards
        if (data.summary) {
            const elTodayDau = document.getElementById('tsTodayDau');
            const elTodayVisits = document.getElementById('tsTodayVisits');
            const elMonthMau = document.getElementById('tsMonthMau');
            const elMonthVisits = document.getElementById('tsMonthVisits');
            const elTotalAccounts = document.getElementById('tsTotalAccounts');
            const elAvgRate = document.getElementById('tsAvgDauRate');

            if (elTodayDau) elTodayDau.textContent = (data.summary.todayDau || 0).toLocaleString();
            if (elTodayVisits) elTodayVisits.textContent = t('ts_visits_fmt', '{0} 人次造訪').replace('{0}', (data.summary.todayVisits || 0).toLocaleString());
            if (elMonthMau) elMonthMau.textContent = (data.summary.monthMau || 0).toLocaleString();
            if (elMonthVisits) elMonthVisits.textContent = t('ts_visits_fmt', '{0} 人次造訪').replace('{0}', (data.summary.monthVisits || 0).toLocaleString());
            if (elTotalAccounts) elTotalAccounts.textContent = (data.summary.totalAccounts || 0).toLocaleString();

            const totalAcc = data.summary.totalAccounts || 0;
            const dailyArr = data.dailyTrend || [];
            let avgRateText = '0%';
            if (totalAcc > 0 && dailyArr.length > 0) {
                const totalDauSum = dailyArr.reduce((sum, item) => sum + (item.dau || 0), 0);
                const avgDau = totalDauSum / dailyArr.length;
                const rate = Math.round((avgDau / totalAcc) * 100);
                avgRateText = `${rate}%`;
            } else if (totalAcc > 0 && data.summary.todayDau > 0) {
                const rate = Math.round((data.summary.todayDau / totalAcc) * 100);
                avgRateText = `${rate}%`;
            }
            if (elAvgRate) elAvgRate.textContent = avgRateText;
        }

        // 2. Daily Trend Table
        if (dailyBody) {
            const dailyArr = data.dailyTrend || [];
            if (dailyArr.length === 0) {
                dailyBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">${t('ts_no_daily', '目前指定區間無每日造訪紀錄')}</td></tr>`;
            } else {
                const maxVisits = Math.max(...dailyArr.map(x => x.visits || 0), 1);
                dailyBody.innerHTML = dailyArr.map(item => {
                    const pct = Math.min(100, Math.round(((item.visits || 0) / maxVisits) * 100));
                    return `
                        <tr>
                            <td class="fw-bold text-dark"><i class="far fa-calendar text-primary me-1"></i>${escHtml(item.date)}</td>
                            <td><span class="badge bg-primary px-3 py-1" style="font-size: 0.85rem;">${t('ts_people_fmt', '{0} 人').replace('{0}', (item.dau || 0).toLocaleString())}</span></td>
                            <td class="fw-bold">${t('ts_times_fmt', '{0} 人次').replace('{0}', (item.visits || 0).toLocaleString())}</td>
                            <td style="min-width: 180px;">
                                <div class="d-flex align-items-center gap-2">
                                    <div class="progress flex-grow-1" style="height: 10px; background-color: var(--border-color); border-radius: 5px;">
                                        <div class="progress-bar bg-primary" role="progressbar" style="width: ${pct}%;"></div>
                                    </div>
                                    <span class="small text-muted" style="width: 40px;">${pct}%</span>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // 3. Monthly Trend Table
        if (monthlyBody) {
            const monthArr = data.monthlyTrend || [];
            if (monthArr.length === 0) {
                monthlyBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">${t('ts_no_monthly', '目前尚無月份統計紀錄')}</td></tr>`;
            } else {
                const maxVisits = Math.max(...monthArr.map(x => x.visits || 0), 1);
                monthlyBody.innerHTML = monthArr.map(item => {
                    const pct = Math.min(100, Math.round(((item.visits || 0) / maxVisits) * 100));
                    return `
                        <tr>
                            <td class="fw-bold text-dark"><i class="far fa-calendar-alt text-success me-1"></i>${escHtml(item.month)}</td>
                            <td><span class="badge bg-success px-3 py-1" style="font-size: 0.85rem;">${t('ts_people_fmt', '{0} 人').replace('{0}', (item.mau || 0).toLocaleString())}</span></td>
                            <td class="fw-bold">${t('ts_times_fmt', '{0} 人次').replace('{0}', (item.visits || 0).toLocaleString())}</td>
                            <td style="min-width: 180px;">
                                <div class="d-flex align-items-center gap-2">
                                    <div class="progress flex-grow-1" style="height: 10px; background-color: var(--border-color); border-radius: 5px;">
                                        <div class="progress-bar bg-success" role="progressbar" style="width: ${pct}%;"></div>
                                    </div>
                                    <span class="small text-muted" style="width: 40px;">${pct}%</span>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // 4. Department Breakdown Table
        if (deptBody) {
            const deptArr = data.departmentBreakdown || [];
            if (deptArr.length === 0) {
                deptBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">${t('ts_no_dept', '目前指定區間無部門統計紀錄')}</td></tr>`;
            } else {
                const totalDeptVisits = deptArr.reduce((sum, x) => sum + (x.visits || 0), 0) || 1;
                deptBody.innerHTML = deptArr.map(item => {
                    const pct = Math.min(100, Math.round(((item.visits || 0) / totalDeptVisits) * 100));
                    return `
                        <tr>
                            <td class="fw-bold text-dark"><i class="fas fa-building text-info me-2" aria-hidden="true"></i>${escHtml(item.department || t('dept_unspecified_other', '未指定/其他'))}</td>
                            <td><span class="badge bg-info text-dark px-3 py-1" style="font-size: 0.85rem;">${t('ts_people_fmt', '{0} 人').replace('{0}', (item.activeUsers || 0).toLocaleString())}</span></td>
                            <td class="fw-bold">${t('ts_times_fmt', '{0} 人次').replace('{0}', (item.visits || 0).toLocaleString())}</td>
                            <td style="min-width: 180px;">
                                <div class="d-flex align-items-center gap-2">
                                    <div class="progress flex-grow-1" style="height: 10px; background-color: var(--border-color); border-radius: 5px;">
                                        <div class="progress-bar bg-info" role="progressbar" style="width: ${pct}%;"></div>
                                    </div>
                                    <span class="small text-muted" style="width: 40px;">${pct}%</span>
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // 當點擊進入統計時，順便載入第一頁每日明細
        loadTrafficDetails(1);

        // 5. Popular Menus (常用看板)
        const popularBody = document.getElementById('tsPopularBody');
        if (popularBody) {
            popularBody.innerHTML = skeletonRows(4, 5);
            fetch(`/api/Analytics/MenuClickStats?days=${days}`)
                .then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status))
                .then(d => {
                    if (!d.items || d.items.length === 0) {
                        popularBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">${escHtml(t('ts_no_popular', '目前無看板點擊紀錄'))}</td></tr>`;
                    } else {
                        popularBody.innerHTML = d.items.map(item => `
                            <tr>
                                <td class="fw-bold text-dark"><i class="fas fa-desktop text-primary me-2" aria-hidden="true"></i>${escHtml(item.menuName || t('menu_deleted', '已刪除看板'))}</td>
                                <td><span class="badge bg-primary px-3 py-1">${t('ts_count_fmt', '{0} 次').replace('{0}', (item.totalClicks || 0).toLocaleString())}</span></td>
                                <td><span class="badge bg-info text-dark px-3 py-1">${t('ts_people_fmt', '{0} 人').replace('{0}', (item.activeUsers || 0).toLocaleString())}</span></td>
                                <td class="text-muted small">${escHtml(item.lastClick)}</td>
                            </tr>
                        `).join('');
                    }
                })
                .catch(e => {
                    console.error('載入常用看板失敗', e);
                    popularBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">${escHtml(t('load_failed', '載入失敗: '))}${escHtml(e.message || e)}</td></tr>`;
                });
        }

        // 6. Zombie Menus (殭屍看板)
        const zombieBody = document.getElementById('tsZombieBody');
        const zombieDesc = document.getElementById('tsZombieDesc');
        if (zombieBody) {
            zombieBody.innerHTML = skeletonRows(4, 5);
            fetch(`/api/Analytics/ZombieMenus?days=${days}`)
                .then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status))
                .then(d => {
                    if (zombieDesc) zombieDesc.innerText = t('ts_zombie_desc_fmt', '以下看板在過去 {d} 天內從未被點擊過。')
                        .replace('{d}', d.thresholdDays || days);
                    if (!d.items || d.items.length === 0) {
                        zombieBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">${escHtml(t('ts_no_zombie', '恭喜！目前沒有殭屍看板'))}</td></tr>`;
                    } else {
                        zombieBody.innerHTML = d.items.map(item => `
                            <tr>
                                <td class="text-muted small">${escHtml(item.menuId)}</td>
                                <td class="fw-bold text-dark"><i class="fas fa-ghost text-warning me-2"></i>${escHtml(item.menuName)}</td>
                                <td>${escHtml(item.creator)}</td>
                                <td class="text-muted small">${zombieCreateCell(item)}</td>
                            </tr>
                        `).join('');
                    }
                })
                .catch(e => {
                    console.error('載入殭屍看板失敗', e);
                    zombieBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">${escHtml(t('load_failed', '載入失敗: '))}${escHtml(e.message || e)}</td></tr>`;
                });
        }

    } catch (err) {
        console.error('[loadTrafficStats] 載入統計失敗:', err);
        if (dailyBody) dailyBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">${t('load_failed', '載入失敗: ')}${escHtml(err.message || err)}</td></tr>`;
        if (monthlyBody) monthlyBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">${t('load_failed', '載入失敗: ')}${escHtml(err.message || err)}</td></tr>`;
        if (deptBody) deptBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger">${t('load_failed', '載入失敗: ')}${escHtml(err.message || err)}</td></tr>`;
    }
}

export async function loadTrafficDetails(page = 1) {
    if (page < 1) page = 1;
    window._trafficDetailPage = page;

    const tbody = document.getElementById('tsDetailsBody');
    const stats = document.getElementById('tsDetailsStats');
    if (tbody) tbody.innerHTML = skeletonRows(7, 6);

    const dateVal = document.getElementById('tsDetailDate')?.value || '';
    const deptVal = document.getElementById('tsDetailDept')?.value?.trim() || '';
    const qVal = document.getElementById('tsDetailKeyword')?.value?.trim() || '';

    const params = new URLSearchParams();
    params.set('page', window._trafficDetailPage);
    params.set('pageSize', window._trafficDetailPageSize);
    if (dateVal) params.set('date', dateVal);
    if (deptVal) params.set('dept', deptVal);
    if (qVal) params.set('q', qVal);

    try {
        const resp = await fetch(`/api/Analytics/details?${params.toString()}`);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();

        window._trafficDetailTotal = data.total || 0;
        const totalPages = Math.max(1, Math.ceil(window._trafficDetailTotal / window._trafficDetailPageSize));

        const pageInfoEl = document.getElementById('tsDetailPageInfo');
        const prevBtn = document.getElementById('tsDetailPrev');
        const nextBtn = document.getElementById('tsDetailNext');

        if (pageInfoEl) pageInfoEl.textContent = `${window._trafficDetailPage} / ${totalPages}`;
        if (prevBtn) prevBtn.disabled = window._trafficDetailPage <= 1;
        if (nextBtn) nextBtn.disabled = window._trafficDetailPage >= totalPages;

        if (stats) stats.textContent = t('ts_stats_fmt', '共 {0} 筆造訪紀錄').replace('{0}', window._trafficDetailTotal.toLocaleString());

        const items = data.items || [];
        if (items.length === 0) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">${t('ts_no_details', '目前條件無造訪明細')}</td></tr>`;
            return;
        }

        if (tbody) {
            tbody.innerHTML = items.map(item => `
                <tr>
                    <td><span class="badge bg-light text-dark border">${escHtml(item.visitDate)}</span></td>
                    <td class="fw-bold font-monospace">${escHtml(item.empId)}</td>
                    <td class="fw-bold text-primary">${escHtml(item.empName)}</td>
                    <td><span class="badge bg-secondary">${escHtml(item.department || t('unspecified', '未指定'))}</span></td>
                    <td><span class="badge bg-info text-dark px-2 py-1">${t('ts_count_fmt', '{0} 次').replace('{0}', item.visitCount ?? 1)}</span></td>
                    <td class="small text-muted font-monospace">${escHtml(item.firstVisitTime)}</td>
                    <td class="small text-muted font-monospace">${escHtml(item.lastVisitTime)}</td>
                </tr>
            `).join('');
        }

    } catch (err) {
        console.error('[loadTrafficDetails] 查詢明細失敗:', err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">${t('al_query_failed', '查詢失敗：')}${escHtml(err.message || err)}</td></tr>`;
    }
}

// 明細篩選輸入框按 Enter 直接送出查詢（回到第 1 頁）
const initTrafficStats = () => {
    ['tsDetailDate', 'tsDetailDept', 'tsDetailKeyword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); loadTrafficDetails(1); }
        });
    });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTrafficStats);
else initTrafficStats();

export function changeTrafficDetailPage(delta) {
    const targetPage = window._trafficDetailPage + delta;
    const totalPages = Math.max(1, Math.ceil(window._trafficDetailTotal / window._trafficDetailPageSize));
    if (targetPage >= 1 && targetPage <= totalPages) {
        loadTrafficDetails(targetPage);
    }
}

// Expose for HTML inline handlers
window.loadTrafficStats = loadTrafficStats;
window.loadTrafficDetails = loadTrafficDetails;
window.changeTrafficDetailPage = changeTrafficDetailPage;

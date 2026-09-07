// ==UserScript==
// @name         报账单号处理人变更监控
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  监控报账单号处理人变更，醒目显示变化
// @author       You
// @match        https://fssc.gdghg.com/ecs/userBills*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_notification
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    console.log('[变更监控] 脚本开始加载 v2.1...');

    const STORAGE_KEY = 'bill_processor_history';
    const RETENTION_KEY = 'bill_retention_records';

    GM_addStyle(`
        .bill-change-highlight {
            background-color: #ffeb3b !important;
            transition: background-color 1s ease;
            position: relative;
        }
        .bill-change-highlight td {
            background-color: #ffeb3b !important;
        }
        .bill-change-highlight .cell {
            background-color: #ffeb3b !important;
        }

        .bill-change-badge {
            display: inline-block;
            background-color: #f44336;
            color: #fff;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
            margin-left: 8px;
            animation: blink-badge 1s ease 3;
        }
        @keyframes blink-badge {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }

        .bill-change-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            padding: 20px 30px;
            z-index: 99999;
            max-width: 600px;
            min-width: 350px;
            max-height: 80vh;
            overflow-y: auto;
            border: 3px solid #f44336;
        }
        .bill-change-popup h3 {
            color: #f44336;
            margin-bottom: 15px;
            font-size: 18px;
            font-weight: bold;
            position: sticky;
            top: 0;
            background: #fff;
            padding-bottom: 10px;
            border-bottom: 1px solid #eee;
        }
        .bill-change-popup .change-item {
            padding: 6px 0;
            border-bottom: 1px solid #f5f5f5;
            font-size: 13px;
        }
        .bill-change-popup .change-item:last-child {
            border-bottom: none;
        }
        .bill-change-popup .old-val {
            color: #999;
            text-decoration: line-through;
            margin-right: 8px;
        }
        .bill-change-popup .new-val {
            color: #f44336;
            font-weight: bold;
        }
        .bill-change-popup .change-time {
            color: #666;
            font-size: 12px;
            margin-left: 8px;
        }
        .bill-change-popup .btn-group {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #eee;
            position: sticky;
            bottom: 0;
            background: #fff;
        }
        .bill-change-popup .confirm-btn {
            padding: 8px 24px;
            background: #f44336;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .bill-change-popup .confirm-btn:hover {
            background: #d32f2f;
        }
        .bill-change-popup .ignore-btn {
            padding: 8px 24px;
            margin-left: 10px;
            background: #999;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .bill-change-popup .ignore-btn:hover {
            background: #777;
        }
        .bill-change-popup .close-btn {
            padding: 8px 24px;
            margin-left: 10px;
            background: #4CAF50;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .bill-change-popup .close-btn:hover {
            background: #388E3C;
        }

        .bill-cancel-retention {
            position: absolute;
            top: 2px;
            left: 2px;
            background: #f44336;
            color: #fff;
            border: 2px solid #fff;
            border-radius: 50%;
            width: 22px;
            height: 22px;
            font-size: 14px;
            line-height: 18px;
            text-align: center;
            cursor: pointer;
            z-index: 10;
            font-weight: bold;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            padding: 0;
        }
        .bill-cancel-retention {
            display: none !important;
        }
        .bill-change-highlight:hover .bill-cancel-retention {
            display: block !important;
        }
        .bill-cancel-retention:hover {
            background: #b71c1c !important;
            transform: scale(1.15);
        }

        .bill-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.4);
            z-index: 99998;
        }

        .bill-loading-indicator {
            position: fixed;
            bottom: 70px;
            right: 20px;
            z-index: 99990;
            background: #0089d1;
            color: #fff;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            display: none;
        }
    `);

    let isPopupShowing = false;

    function getCurrentPageData() {
        const data = {};
        const rows = document.querySelectorAll('table tbody tr');

        rows.forEach((row) => {
            const boeCell = row.querySelector('td.boeNo-temp .cell .el-button span');
            if (!boeCell) return;

            const billNo = boeCell.textContent.trim();
            if (!billNo) return;

            const disposeCell = row.querySelector('td.disposeName .cell');
            const processor = disposeCell ? disposeCell.textContent.trim() : '';

            data[billNo] = processor;
        });

        return data;
    }

    function isPageLoaded() {
        const rows = document.querySelectorAll('table tbody tr');
        if (rows.length === 0) return false;

        const pagination = document.querySelector('.el-pagination');
        if (pagination) {
            const loading = document.querySelector('.el-loading-mask');
            if (loading && loading.style.display !== 'none') {
                return false;
            }
        }

        const firstRow = rows[0];
        if (firstRow) {
            const hasBoe = firstRow.querySelector('td.boeNo-temp');
            const hasDispose = firstRow.querySelector('td.disposeName');
            if (hasBoe && hasDispose) {
                return true;
            }
        }

        return false;
    }

    function getHistoryData() {
        const stored = GM_getValue(STORAGE_KEY, '{}');
        try {
            return JSON.parse(stored);
        } catch {
            return {};
        }
    }

    function saveHistoryData(data) {
        GM_setValue(STORAGE_KEY, JSON.stringify(data));
    }

    function getRetentionRecords() {
        const stored = GM_getValue(RETENTION_KEY, '{}');
        try {
            return JSON.parse(stored);
        } catch {
            return {};
        }
    }

    function saveRetentionRecords(data) {
        GM_setValue(RETENTION_KEY, JSON.stringify(data));
    }

    function detectChanges(currentData, historyData) {
        const changes = [];
        const retentionRecords = getRetentionRecords();
        const now = new Date();
        const timeStr = now.toLocaleString('zh-CN', { hour12: false });

        const currentCount = Object.keys(currentData).length;
        const historyCount = Object.keys(historyData).length;

        if (currentCount === 0) {
            return [];
        }

        const isLoadComplete = historyCount === 0 || currentCount >= historyCount * 0.7;
        if (!isLoadComplete) {
            console.log('[变更监控] 页面未加载完整，跳过检测');
            return [];
        }

        for (const [billNo, processor] of Object.entries(currentData)) {
            if (historyData[billNo] === undefined) {
                continue;
            }

            if (retentionRecords[billNo]) continue;

            if (historyData[billNo] !== processor) {
                console.log(`[变更监控] 发现变更: ${billNo}, ${historyData[billNo]} -> ${processor}`);
                changes.push({
                    billNo,
                    oldValue: historyData[billNo] || '(空)',
                    newValue: processor || '(空)',
                    changeTime: timeStr
                });
            }
        }

        console.log(`[变更监控] 共检测到 ${changes.length} 项处理人变更`);
        return changes;
    }

    function showChangeNotification(changes) {
        if (changes.length === 0) return;
        if (isPopupShowing) return;

        isPopupShowing = true;

        const overlay = document.createElement('div');
        overlay.className = 'bill-overlay';
        document.body.appendChild(overlay);

        const popup = document.createElement('div');
        popup.className = 'bill-change-popup';
        popup.id = 'bill-popup-' + Date.now();

        let changeHtml = changes.map(c => {
            return `
                <div class="change-item">
                    ✏️ <strong>${c.billNo}</strong>
                    <span class="old-val">${c.oldValue}</span>
                    →
                    <span class="new-val">${c.newValue}</span>
                    <span class="change-time">${c.changeTime}</span>
                </div>
            `;
        }).join('');

        popup.innerHTML = `
            <h3>🔔 检测到 ${changes.length} 项处理人变更</h3>
            <div style="max-height: 400px; overflow-y: auto;">
                ${changeHtml}
            </div>
            <div class="btn-group">
                <button class="confirm-btn" id="bill-confirm-btn">✅ 确认并留存变更</button>
                <button class="ignore-btn" id="bill-ignore-btn">忽略本次变更</button>
                <button class="close-btn" id="bill-close-btn">✕ 仅关闭</button>
            </div>
        `;
        document.body.appendChild(popup);

        const confirmBtn = document.getElementById('bill-confirm-btn');
        const ignoreBtn = document.getElementById('bill-ignore-btn');
        const closeBtn = document.getElementById('bill-close-btn');

        if (confirmBtn) {
            confirmBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                if (this.disabled) return;
                this.disabled = true;
                handleConfirm(changes, overlay, popup);
            });
        }

        if (ignoreBtn) {
            ignoreBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                if (this.disabled) return;
                this.disabled = true;
                handleIgnore(changes, overlay, popup);
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                if (this.disabled) return;
                this.disabled = true;
                handleClose(overlay, popup);
            });
        }

        overlay.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        GM_notification({
            title: '报账系统变更提醒',
            text: `检测到 ${changes.length} 项处理人变更，请查看详情`,
            timeout: 5000
        });
    }

    function handleConfirm(changes, overlay, popup) {
        try {
            const retentionRecords = getRetentionRecords();

            changes.forEach(c => {
                retentionRecords[c.billNo] = {
                    oldValue: c.oldValue,
                    newValue: c.newValue,
                    changeTime: c.changeTime
                };
            });
            saveRetentionRecords(retentionRecords);

            const currentData = getCurrentPageData();
            saveHistoryData(currentData);

            applyHighlights();

            closePopup(overlay, popup);

            GM_notification({
                text: `✅ 已留存 ${changes.length} 项变更记录`,
                timeout: 3000
            });
        } catch (err) {
            console.error('[变更监控] 确认操作出错:', err);
            alert('操作失败，请查看控制台错误信息');
            closePopup(overlay, popup);
        }
    }

    function handleIgnore(changes, overlay, popup) {
        try {
            const currentData = getCurrentPageData();
            saveHistoryData(currentData);

            closePopup(overlay, popup);

            GM_notification({
                text: `⏭️ 已忽略 ${changes.length} 项变更`,
                timeout: 3000
            });
        } catch (err) {
            console.error('[变更监控] 忽略操作出错:', err);
            alert('操作失败，请查看控制台错误信息');
            closePopup(overlay, popup);
        }
    }

    function handleClose(overlay, popup) {
        try {
            closePopup(overlay, popup);
        } catch (err) {
            console.error('[变更监控] 关闭操作出错:', err);
            closePopup(overlay, popup);
        }
    }

    function closePopup(overlay, popup) {
        if (overlay && overlay.parentNode) {
            overlay.remove();
        }
        if (popup && popup.parentNode) {
            popup.remove();
        }
        isPopupShowing = false;
    }

    // 移除单行高亮（完整清理）
    function removeRowHighlight(row) {
        // 移除所有高亮类
        row.classList.remove('bill-change-highlight', 'bill-deleted-highlight');

        // 移除徽章
        const badge = row.querySelector('.bill-change-badge, .bill-deleted-badge');
        if (badge) badge.remove();

        // 移除取消按钮
        const cancelBtn = row.querySelector('.bill-cancel-retention');
        if (cancelBtn) cancelBtn.remove();
    }

    function applyHighlights() {
        const retentionRecords = getRetentionRecords();

        // 清除所有旧高亮
        document.querySelectorAll('.bill-change-highlight, .bill-deleted-highlight').forEach(el => {
            el.classList.remove('bill-change-highlight', 'bill-deleted-highlight');
            const badge = el.querySelector('.bill-change-badge, .bill-deleted-badge');
            if (badge) badge.remove();
            const cancelBtn = el.querySelector('.bill-cancel-retention');
            if (cancelBtn) cancelBtn.remove();
        });

        const rows = document.querySelectorAll('table tbody tr');

        rows.forEach(row => {
            const boeCell = row.querySelector('td.boeNo-temp .cell .el-button span');
            if (!boeCell) return;
            const billNo = boeCell.textContent.trim();

            if (retentionRecords[billNo]) {
                const record = retentionRecords[billNo];
                row.classList.add('bill-change-highlight');

                let badge = row.querySelector('.bill-change-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'bill-change-badge';
                    badge.textContent = `✏️ 变更 ${record.changeTime}`;
                    const firstCell = row.querySelector('td');
                    if (firstCell) {
                        firstCell.appendChild(badge);
                    }
                }

                let cancelBtn = row.querySelector('.bill-cancel-retention');
                if (!cancelBtn) {
                    cancelBtn = document.createElement('button');
                    cancelBtn.className = 'bill-cancel-retention';
                    cancelBtn.textContent = '✕';
                    cancelBtn.title = '点击取消此记录的变更留存';
                    row.style.position = 'relative';
                    row.appendChild(cancelBtn);

                    // 保存 billNo 到按钮上，方便调试
                    cancelBtn.dataset.billNo = billNo;

                    cancelBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        e.preventDefault();

                        const billNo = this.dataset.billNo;
                        console.log(`[变更监控] 点击取消留存: ${billNo}`);

                        if (confirm(`确定要取消单号 ${billNo} 的变更留存吗？\n\n取消后该记录将不再高亮显示。`)) {
                            // 1. 从存储中删除
                            const records = getRetentionRecords();
                            delete records[billNo];
                            saveRetentionRecords(records);
                            console.log(`[变更监控] 已从存储删除: ${billNo}`);

                            // 2. 找到该行并移除所有高亮
                            const row = this.closest('tr');
                            if (row) {
                                removeRowHighlight(row);
                                console.log(`[变更监控] 已移除行高亮: ${billNo}`);
                            }

                            GM_notification({
                                text: `✅ 已取消单号 ${billNo} 的变更留存`,
                                timeout: 2000
                            });
                        }
                    });
                }
            }
        });
    }

    function waitForPageLoad(callback, maxAttempts = 30) {
        let attempts = 0;

        function check() {
            attempts++;
            if (isPageLoaded()) {
                callback();
                return;
            }

            if (attempts >= maxAttempts) {
                callback();
                return;
            }

            setTimeout(check, 500);
        }

        check();
    }

    function processPage() {
        try {
            const currentData = getCurrentPageData();
            const currentCount = Object.keys(currentData).length;

            if (currentCount === 0) {
                return;
            }

            const historyData = getHistoryData();
            const changes = detectChanges(currentData, historyData);

            if (changes.length > 0) {
                showChangeNotification(changes);
            } else {
                saveHistoryData(currentData);
                console.log('[变更监控] 无处理人变更，已更新历史数据');
            }

            applyHighlights();
        } catch (err) {
            console.error('[变更监控] processPage 出错:', err);
        }
    }

    function setupPaginationListener() {
        document.addEventListener('click', function(e) {
            const target = e.target.closest('.el-pagination .btn-next, .el-pagination .btn-prev, .el-pagination .number');
            if (target) {
                console.log('[变更监控] 检测到分页切换');
                setTimeout(() => {
                    waitForPageLoad(function() {
                        processPage();
                    }, 20);
                }, 500);
            }
        });
    }

    function setupObserver() {
        let lastMutationTime = 0;
        let pendingProcess = false;

        const observer = new MutationObserver(function(mutations) {
            let hasRelevantChange = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.target.closest) {
                    const table = mutation.target.closest('table');
                    if (table) {
                        hasRelevantChange = true;
                        break;
                    }
                }
            }

            if (!hasRelevantChange) return;

            const now = Date.now();
            if (now - lastMutationTime < 1000) {
                if (pendingProcess) return;
                pendingProcess = true;
                setTimeout(() => {
                    pendingProcess = false;
                    waitForPageLoad(function() {
                        processPage();
                    }, 15);
                }, 1000);
                return;
            }

            lastMutationTime = now;
            waitForPageLoad(function() {
                processPage();
            }, 15);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false
        });
    }

    function init() {
        console.log('[变更监控] ===== 脚本启动 v2.1 =====');
        console.log('[变更监控] 只监控处理人变更，新增/删除单号不触发提醒');

        if (document.readyState === 'complete') {
            waitForPageLoad(function() {
                processPage();
            }, 30);
        } else {
            window.addEventListener('load', function() {
                waitForPageLoad(function() {
                    processPage();
                }, 30);
            });
        }

        setupObserver();
        setupPaginationListener();

        const refreshBtn = document.createElement('button');
        refreshBtn.textContent = '🔄 刷新监控';
        refreshBtn.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 20px;
            z-index: 99990;
            padding: 8px 16px;
            background: #0089d1;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        `;
        refreshBtn.addEventListener('click', function() {
            waitForPageLoad(function() {
                processPage();
            }, 20);
            GM_notification({
                text: '已刷新监控数据',
                timeout: 1500
            });
        });
        document.body.appendChild(refreshBtn);

        const indicator = document.createElement('div');
        indicator.className = 'bill-loading-indicator';
        indicator.id = 'bill-loading-indicator';
        indicator.textContent = '⏳ 数据加载中...';
        document.body.appendChild(indicator);
    }

    init();

})();

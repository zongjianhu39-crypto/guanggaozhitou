(function attachDashboardExport(window) {
    function toCSV(headers, rows) {
        if (!rows.length) return headers.join(',') + '\n';
        let csv = headers.join(',') + '\n';
        rows.forEach((row) => {
            csv += headers.map((header) => {
                let value = row[header] ?? '';
                value = String(value).replace(/"/g, '""');
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    value = `"${value}"`;
                }
                return value;
            }).join(',') + '\n';
        });
        return csv;
    }

    async function downloadAdsCSV() {
        const app = window.DashboardApp;
        const button = document.getElementById('download-ads-csv-btn');
        app.setButtonBusy(button, '导出中...');
        app.setDashboardStatus('info', '正在导出投放日报 CSV...', 0);
        try {
            const result = await app.ensureAdsResponseCurrent();
            const rows = result.ads?.daily || [];
            if (!rows.length) return;
            const csvRows = rows.map((row) => ({
                '日期': row.label,
                '花费': row.cost.toFixed(2),
                '总成交金额': row.amount.toFixed(2),
                '总成交笔数': row.orders,
                'ROI': row.roi > 0 ? row.roi.toFixed(2) : '-',
                '直接ROI': row.directRoi > 0 ? row.directRoi.toFixed(2) : '-',
                '盈亏平衡ROI': row.breakevenRoi !== null && Number.isFinite(Number(row.breakevenRoi)) ? Number(row.breakevenRoi).toFixed(2) : '-',
                '广告收入': row.adRevenue !== null && Number.isFinite(Number(row.adRevenue)) ? Number(row.adRevenue).toFixed(2) : '-',
                '去退ROI': row.returnRoi > 0 ? row.returnRoi.toFixed(2) : '-',
                '广告成交占比': Number.isFinite(Number(row.adShare)) ? (Number(row.adShare) * 100).toFixed(2) + '%' : '-',
                '可计算天数': row.computableDays,
                '跳过天数': row.skippedDays,
                '观看成本': row.viewCost > 0 ? row.viewCost.toFixed(2) : '-',
                '订单成本': row.orderCost > 0 ? row.orderCost.toFixed(2) : '-',
                '加购成本': row.cartCost > 0 ? row.cartCost.toFixed(2) : '-',
                '总预售成交笔数': row.preOrders,
                '预售订单成本': row.preOrderCost > 0 ? row.preOrderCost.toFixed(2) : '-',
                '观看转化率': row.viewConvertRate > 0 ? row.viewConvertRate.toFixed(2) + '%' : '-',
                '深度互动率': row.deepInteractRate > 0 ? row.deepInteractRate.toFixed(2) + '%' : '-',
                '观看率': row.viewRate > 0 ? row.viewRate.toFixed(2) + '%' : '-',
                '千次展现成本': row.cpm > 0 ? row.cpm.toFixed(2) : '-',
                '直接成交金额': row.directAmount.toFixed(2),
                '总购物车数': row.cart,
                '展现量': row.shows,
                '保量佣金': row.finGuarantee.toFixed(2),
                '预估结算线下佣金': row.finOffline.toFixed(2),
                '预估结算机构佣金': row.finAgency.toFixed(2),
                '直播间红包': row.finRedPacket.toFixed(2),
                '严选红包': row.finYanxuanRed.toFixed(2),
                '淘宝直播成交笔数': row.taobaoOrders,
                '退货率': row.taobaoReturnRate > 0 ? (row.taobaoReturnRate * 100).toFixed(2) + '%' : '-',
            }));
            const headers = Object.keys(csvRows[0]);
            const blob = new Blob(['\uFEFF' + toCSV(headers, csvRows)], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = '每日投放明细.csv';
            link.click();
            app.setDashboardStatus('success', '投放日报 CSV 已开始下载。', 2200);
        } finally {
            app.resetButtonState(button);
        }
    }

    async function downloadFullReportCSV() {
        const app = window.DashboardApp;
        const button = document.getElementById('download-full-report-btn');
        app.setButtonBusy(button, '导出中...');
        app.setDashboardStatus('info', '正在导出当前聚合报告 CSV...', 0);
        try {
            const adsResult = await app.ensureAdsResponseCurrent();
            const crowdResult = await app.ensureCrowdResponseCurrent();
            const adsStart = document.getElementById('ads-start')?.value;
            const adsEnd = document.getElementById('ads-end')?.value;
            const crowdStart = document.getElementById('crowd-start')?.value;
            const crowdEnd = document.getElementById('crowd-end')?.value;
            const singleStart = document.getElementById('single-start')?.value || '';
            const singleEnd = document.getElementById('single-end')?.value || '';
            const singleResult = await app.ensureSingleResponseCurrent(singleStart, singleEnd);

            const adsHeaders = ['粒度', '标签', '花费', '总成交金额', '总成交笔数', 'ROI', '直接ROI', '盈亏平衡ROI', '广告收入', '去退ROI', '广告成交占比', '可计算天数', '跳过天数', '观看成本', '订单成本', '加购成本', '总预售成交笔数', '预售订单成本', '观看转化率', '深度互动率', '观看率', '千次展现成本', '直接成交金额', '总购物车数', '展现量', '保量佣金', '预估结算线下佣金', '预估结算机构佣金', '直播间红包', '严选红包', '淘宝直播成交笔数', '退货率'];
            const adsRows = [];
            ['monthly', 'weekly', 'daily'].forEach((grain) => {
                (adsResult.ads?.[grain] || []).forEach((row) => {
                    adsRows.push({
                        '粒度': grain,
                        '标签': row.label,
                        '花费': row.cost.toFixed(2),
                        '总成交金额': row.amount.toFixed(2),
                        '总成交笔数': row.orders,
                        'ROI': row.roi > 0 ? row.roi.toFixed(2) : '-',
                        '直接ROI': row.directRoi > 0 ? row.directRoi.toFixed(2) : '-',
                        '盈亏平衡ROI': row.breakevenRoi !== null && Number.isFinite(Number(row.breakevenRoi)) ? Number(row.breakevenRoi).toFixed(2) : '-',
                        '广告收入': row.adRevenue !== null && Number.isFinite(Number(row.adRevenue)) ? Number(row.adRevenue).toFixed(2) : '-',
                        '去退ROI': row.returnRoi > 0 ? row.returnRoi.toFixed(2) : '-',
                        '广告成交占比': Number.isFinite(Number(row.adShare)) ? (Number(row.adShare) * 100).toFixed(2) + '%' : '-',
                        '可计算天数': row.computableDays,
                        '跳过天数': row.skippedDays,
                        '观看成本': row.viewCost > 0 ? row.viewCost.toFixed(2) : '-',
                        '订单成本': row.orderCost > 0 ? row.orderCost.toFixed(2) : '-',
                        '加购成本': row.cartCost > 0 ? row.cartCost.toFixed(2) : '-',
                        '总预售成交笔数': row.preOrders,
                        '预售订单成本': row.preOrderCost > 0 ? row.preOrderCost.toFixed(2) : '-',
                        '观看转化率': row.viewConvertRate > 0 ? row.viewConvertRate.toFixed(2) + '%' : '-',
                        '深度互动率': row.deepInteractRate > 0 ? row.deepInteractRate.toFixed(2) + '%' : '-',
                        '观看率': row.viewRate > 0 ? row.viewRate.toFixed(2) + '%' : '-',
                        '千次展现成本': row.cpm > 0 ? row.cpm.toFixed(2) : '-',
                        '直接成交金额': row.directAmount.toFixed(2),
                        '总购物车数': row.cart,
                        '展现量': row.shows,
                        '保量佣金': row.finGuarantee.toFixed(2),
                        '预估结算线下佣金': row.finOffline.toFixed(2),
                        '预估结算机构佣金': row.finAgency.toFixed(2),
                        '直播间红包': row.finRedPacket.toFixed(2),
                        '严选红包': row.finYanxuanRed.toFixed(2),
                        '淘宝直播成交笔数': row.taobaoOrders,
                        '退货率': row.taobaoReturnRate > 0 ? (row.taobaoReturnRate * 100).toFixed(2) + '%' : '-',
                    });
                });
            });

            const crowdHeaders = ['人群分层', '标签', '花费', '总成交金额', '总成交笔数', 'ROI', '直接ROI', '观看成本', '订单成本', '加购成本', '总预售成交笔数', '预售订单成本', '观看转化率', '深度互动率', '观看率', '千次展现成本', '直接成交金额', '总购物车数', '展现量'];
            const crowdRows = [];
            (crowdResult.crowd?.summary || []).forEach((group) => {
                crowdRows.push({
                    '人群分层': group.crowd,
                    '标签': '分层汇总',
                    '花费': group.summary.cost.toFixed(2),
                    '总成交金额': group.summary.amount.toFixed(2),
                    '总成交笔数': group.summary.orders,
                    'ROI': group.summary.roi > 0 ? group.summary.roi.toFixed(2) : '-',
                    '直接ROI': group.summary.directRoi > 0 ? group.summary.directRoi.toFixed(2) : '-',
                    '观看成本': group.summary.viewCost > 0 ? group.summary.viewCost.toFixed(2) : '-',
                    '订单成本': group.summary.orderCost > 0 ? group.summary.orderCost.toFixed(2) : '-',
                    '加购成本': group.summary.cartCost > 0 ? group.summary.cartCost.toFixed(2) : '-',
                    '总预售成交笔数': group.summary.preOrders,
                    '预售订单成本': group.summary.preOrderCost > 0 ? group.summary.preOrderCost.toFixed(2) : '-',
                    '观看转化率': group.summary.viewConvertRate > 0 ? group.summary.viewConvertRate.toFixed(2) + '%' : '-',
                    '深度互动率': group.summary.deepInteractRate > 0 ? group.summary.deepInteractRate.toFixed(2) + '%' : '-',
                    '观看率': group.summary.viewRate > 0 ? group.summary.viewRate.toFixed(2) + '%' : '-',
                    '千次展现成本': group.summary.cpm > 0 ? group.summary.cpm.toFixed(2) : '-',
                    '直接成交金额': group.summary.directAmount.toFixed(2),
                    '总购物车数': group.summary.cart,
                    '展现量': group.summary.shows,
                });
                (group.subRows || []).forEach((row) => {
                    crowdRows.push({
                        '人群分层': group.crowd,
                        '标签': row.label,
                        '花费': row.cost.toFixed(2),
                        '总成交金额': row.amount.toFixed(2),
                        '总成交笔数': row.orders,
                        'ROI': row.roi > 0 ? row.roi.toFixed(2) : '-',
                        '直接ROI': row.directRoi > 0 ? row.directRoi.toFixed(2) : '-',
                        '观看成本': row.viewCost > 0 ? row.viewCost.toFixed(2) : '-',
                        '订单成本': row.orderCost > 0 ? row.orderCost.toFixed(2) : '-',
                        '加购成本': row.cartCost > 0 ? row.cartCost.toFixed(2) : '-',
                        '总预售成交笔数': row.preOrders,
                        '预售订单成本': row.preOrderCost > 0 ? row.preOrderCost.toFixed(2) : '-',
                        '观看转化率': row.viewConvertRate > 0 ? row.viewConvertRate.toFixed(2) + '%' : '-',
                        '深度互动率': row.deepInteractRate > 0 ? row.deepInteractRate.toFixed(2) + '%' : '-',
                        '观看率': row.viewRate > 0 ? row.viewRate.toFixed(2) + '%' : '-',
                        '千次展现成本': row.cpm > 0 ? row.cpm.toFixed(2) : '-',
                        '直接成交金额': row.directAmount.toFixed(2),
                        '总购物车数': row.cart,
                        '展现量': row.shows,
                    });
                });
            });

            const singleHeaders = ['商品id', '商品名称', '花费', '直接成交笔数', '直接成交金额', '直接ROI', '该商品直接成交笔数', '该商品直接成交金额', '该商品直接ROI', '该商品加购数', '加购成本', '该商品收藏数', '观看人数'];
            const singleRows = (singleResult.single?.items || []).map((row) => {
                const cost = Number(row.花费 || 0);
                const directAmount = Number(row.直接成交金额 || 0);
                const productDirectAmount = Number(row['该商品直接成交金额'] || 0);
                const cart = Number(row['该商品加购数'] || 0);
                const directRoi = cost > 0 ? directAmount / cost : 0;
                const productDirectRoi = cost > 0 ? productDirectAmount / cost : 0;
                const cartCost = cart > 0 ? cost / cart : 0;
                return {
                    '商品id': row.商品id || '',
                    '商品名称': row.商品名称 || '',
                    '花费': cost.toFixed(2),
                    '直接成交笔数': Number(row.直接成交笔数 || 0),
                    '直接成交金额': directAmount.toFixed(2),
                    '直接ROI': directRoi > 0 ? directRoi.toFixed(2) : '-',
                    '该商品直接成交笔数': Number(row['该商品直接成交笔数'] || 0),
                    '该商品直接成交金额': productDirectAmount.toFixed(2),
                    '该商品直接ROI': productDirectRoi > 0 ? productDirectRoi.toFixed(2) : '-',
                    '该商品加购数': cart,
                    '加购成本': cartCost > 0 ? cartCost.toFixed(2) : '-',
                    '该商品收藏数': Number(row['该商品收藏数'] || 0),
                    '观看人数': Number(row.观看人数 || 0),
                };
            });

            let fullCSV = '# ===== 投放分析聚合结果 =====\n';
            fullCSV += '# 日期范围：' + adsStart + ' 至 ' + adsEnd + '\n';
            fullCSV += toCSV(adsHeaders, adsRows);
            fullCSV += '\n# ===== 人群维度聚合结果 =====\n';
            fullCSV += '# 日期范围：' + crowdStart + ' 至 ' + crowdEnd + '\n';
            fullCSV += toCSV(crowdHeaders, crowdRows);
            fullCSV += '\n# ===== 单品广告聚合结果 =====\n';
            fullCSV += '# 日期范围：' + singleStart + ' 至 ' + singleEnd + '\n';
            fullCSV += toCSV(singleHeaders, singleRows);

            const blob = new Blob(['\uFEFF' + fullCSV], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `投放聚合报告_${adsStart}_${adsEnd}.csv`;
            link.click();
            app.setDashboardStatus('success', '当前聚合报告 CSV 已开始下载。', 2200);
        } finally {
            app.resetButtonState(button);
        }
    }

    async function downloadSingleCSV() {
        const app = window.DashboardApp;
        const start = document.getElementById('single-start')?.value || '';
        const end = document.getElementById('single-end')?.value || '';
        const button = document.getElementById('download-single-csv-btn');
        try {
            app.setButtonBusy(button, '导出中...');
            app.setDashboardStatus('info', `正在导出单品广告 CSV（${start || '全期'} 至 ${end || '当前'}）...`, 0);
            const result = await app.ensureSingleResponseCurrent(start, end);
            const data = Array.isArray(result?.single?.exportRows) ? result.single.exportRows : [];
            if (!data.length) {
                alert('无导出数据');
                return;
            }
            const exportCols = ['日期', '商品id', '商品名称', '花费', '直接成交笔数', '直接成交金额', '该商品直接成交笔数', '该商品直接成交金额', '该商品加购数', '该商品收藏数', '观看人数'];
            const csv = [exportCols.join(','), ...data.map((row) => exportCols.map((col) => `"${String(row[col] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `单品广告_${start || '全期'}_${end || ''}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            app.setDashboardStatus('success', '单品广告 CSV 已开始下载。', 2200);
        } catch (error) {
            app.setDashboardStatus('warn', '单品广告 CSV 导出失败，请稍后重试。', 4200);
            alert('导出失败: ' + error.message);
        } finally {
            app.resetButtonState(button);
        }
    }

    window.DashboardExport = {
        downloadAdsCSV,
        downloadFullReportCSV,
        downloadSingleCSV,
    };
})(window);

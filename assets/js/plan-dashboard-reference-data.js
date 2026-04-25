(function attachPlanDashboardReferenceData(window) {
  'use strict';

  var DOUBLE11_REFERENCE_MONTHS = [5, 6];

  var DOUBLE11_REFERENCE_SUMMARY = [
    { label: '总投放周期', value: '10/1-11/30', helper: '61 天完整双11周期' },
    { label: '广告花费', value: '1,610.6万', helper: '有客代投 + 万相台' },
    { label: '日均花费', value: '26.4万', helper: '全周期日均投放强度' },
    { label: '渠道拆分', value: '772.0万 / 838.6万', helper: '有客代投 / 万相台' },
    { label: '预售成交', value: '127.6万', helper: '万相台总预售成交笔数' },
  ];

  var DOUBLE11_REFERENCE_PHASES = [
    {
      phase: '第一波预热', dateRange: '10/1-10/14', days: '14', dailySpend: '15.6万',
      spendShare: '13.6%', totalSpend: '218.3万', agentSpend: '155.0万', wanxiangSpend: '63.3万',
      views: '242.0万', orders: '20.7万', directOrders: '8.8万', carts: '69.4万', presaleOrders: '24.1万',
      viewCost: '0.26', orderCost: '3.1', directOrderCost: '7.2', cartCost: '0.9', presaleOrderCost: '2.6',
      viewConversion: '9%', focus: '低成本蓄水，订单成本和加购成本为全周期最低。',
    },
    {
      phase: '第一波预售', dateRange: '10/15-10/20', days: '6', dailySpend: '121.8万',
      spendShare: '45.4%', totalSpend: '730.9万', agentSpend: '272.0万', wanxiangSpend: '458.9万',
      views: '1,225.8万', orders: '60.9万', directOrders: '39.4万', carts: '101.8万', presaleOrders: '76.8万',
      viewCost: '0.37', orderCost: '7.5', directOrderCost: '11.7', cartCost: '4.5', presaleOrderCost: '6.0',
      viewConversion: '5%', focus: '主投放高峰，广告花费占比 45.4%，预售成交集中爆发。',
    },
    {
      phase: '第一波尾款', dateRange: '10/21-10/24', days: '4', dailySpend: '22.1万',
      spendShare: '5.5%', totalSpend: '88.2万', agentSpend: '0.0万', wanxiangSpend: '88.2万',
      views: '258.5万', orders: '8.1万', directOrders: '5.0万', carts: '28.4万', presaleOrders: '0.3万',
      viewCost: '0.34', orderCost: '10.9', directOrderCost: '17.8', cartCost: '3.1', presaleOrderCost: '-',
      viewConversion: '3%', focus: '尾款期更偏承接，预售新增少，订单成本抬升。',
    },
    {
      phase: '现货', dateRange: '10/25-10/31', days: '7', dailySpend: '2.8万',
      spendShare: '1.2%', totalSpend: '19.5万', agentSpend: '0.0万', wanxiangSpend: '19.5万',
      views: '69.4万', orders: '4.9万', directOrders: '2.7万', carts: '15.1万', presaleOrders: '1.6万',
      viewCost: '0.28', orderCost: '3.9', directOrderCost: '7.1', cartCost: '1.3', presaleOrderCost: '-',
      viewConversion: '7%', focus: '低投放维持转化，成交效率较高但规模小。',
    },
    {
      phase: '第二波预热', dateRange: '11/1-11/6', days: '6', dailySpend: '22.3万',
      spendShare: '8.3%', totalSpend: '133.7万', agentSpend: '90.0万', wanxiangSpend: '43.7万',
      views: '131.7万', orders: '5.0万', directOrders: '1.7万', carts: '15.8万', presaleOrders: '6.0万',
      viewCost: '0.33', orderCost: '8.7', directOrderCost: '26.4', cartCost: '2.8', presaleOrderCost: '7.3',
      viewConversion: '4%', focus: '第二波前置蓄水，代投占比高于万相台。',
    },
    {
      phase: '第二波预售', dateRange: '11/7-11/14', days: '8', dailySpend: '47.2万',
      spendShare: '23.4%', totalSpend: '377.7万', agentSpend: '255.0万', wanxiangSpend: '122.7万',
      views: '311.6万', orders: '17.4万', directOrders: '11.0万', carts: '32.0万', presaleOrders: '18.8万',
      viewCost: '0.39', orderCost: '7.0', directOrderCost: '11.2', cartCost: '3.8', presaleOrderCost: '6.5',
      viewConversion: '6%', focus: '第二个投放峰值，代投花费集中，规模低于第一波预售。',
    },
    {
      phase: '日常', dateRange: '11/15-11/30', days: '16', dailySpend: '2.6万',
      spendShare: '2.6%', totalSpend: '42.3万', agentSpend: '0.0万', wanxiangSpend: '42.3万',
      views: '70.3万', orders: '3.3万', directOrders: '2.5万', carts: '5.4万', presaleOrders: '0.0万',
      viewCost: '0.60', orderCost: '12.8', directOrderCost: '17.2', cartCost: '7.9', presaleOrderCost: '-',
      viewConversion: '5%', focus: '大促后长尾收口，效率指标明显走弱。',
    },
  ];

  var SIX18_REFERENCE_MONTHS = [5, 6];
  var SIX18_RHYTHM_MONTHS = [5, 6];

  var SIX18_RHYTHM_PHASES = [
    { dateRange: '5月1日 00:00 ~ 5月5日 23:59', shortDate: '5/1-5/5', platformRhythm: '日常期', rhythmLabel: '日常', keySession: '–', operation: '发定金红包+100%商品预热', color: '#94a3b8' },
    { dateRange: '5月6日 00:00 ~ 5月13日 19:59', shortDate: '5/6-5/13', platformRhythm: '预售预热期', rhythmLabel: '第一波预售预热', keySession: '–', operation: '发定金红包+追竞对的领取定金红包人数', color: '#f59e0b' },
    { dateRange: '5月13日 20:00 ~ 5月16日 19:59', shortDate: '5/13-5/16', platformRhythm: '预售付定金期', rhythmLabel: '第一波预售付定期', keySession: '罗老师场', operation: '催付定金锁单', color: '#ef4444' },
    { dateRange: '5月16日 20:00 ~ 5月26日 23:59', shortDate: '5/16-5/26', platformRhythm: '预售付尾款期', rhythmLabel: '第一波预售尾款期', keySession: '–', operation: '催付尾款', color: '#6366f1' },
    { dateRange: '5月27日 00:00 ~ 6月5日 23:59', shortDate: '5/27-6/5', platformRhythm: '日常期', rhythmLabel: '现货期', keySession: '–', operation: '可能会做品牌专场发9折券', color: '#94a3b8' },
    { dateRange: '6月6日 00:00 ~ 6月12日 09:59', shortDate: '6/6-6/12', platformRhythm: '预售预热期', rhythmLabel: '第二波预售预热期', keySession: '–', operation: '发定金红包+100%商品预热', color: '#f59e0b' },
    { dateRange: '6月12日 10:00 ~ 6月14日 23:00', shortDate: '6/12-6/14', platformRhythm: '预售付定金期', rhythmLabel: '第二波预售付定', keySession: '罗老师场', operation: '催付定金锁单', color: '#ef4444' },
    { dateRange: '6月15日 00:00 ~ 6月20日 23:59', shortDate: '6/15-6/20', platformRhythm: '预售付尾款期', rhythmLabel: '第二波预售尾款期', keySession: '–', operation: '催付尾款', color: '#6366f1' },
    { dateRange: '6月21日 00:00 ~ 6月30日 23:59', shortDate: '6/21-6/30', platformRhythm: '日常期', rhythmLabel: '日常', keySession: '–', operation: '可能会停播', color: '#94a3b8' },
  ];

  var SIX18_REFERENCE_DAILY = [
    { date: '5/1',  views: 100000000, phase: '蓄水期' },
    { date: '5/2',  views: 102000000, phase: '蓄水期' },
    { date: '5/3',  views: 100000000, phase: '蓄水期' },
    { date: '5/4',  views: 93166379,  phase: '蓄水期' },
    { date: '5/5',  views: 100000000, phase: '蓄水期' },
    { date: '5/6',  views: 100000000, phase: '蓄水期' },
    { date: '5/7',  views: 102000000, phase: '蓄水期' },
    { date: '5/8',  views: 102000000, phase: '蓄水期' },
    { date: '5/9',  views: 102000000, phase: '蓄水期' },
    { date: '5/10', views: 102000000, phase: '蓄水期' },
    { date: '5/11', views: 102000000, phase: '蓄水期' },
    { date: '5/12', views: 105000000, phase: '蓄水期' },
    { date: '5/13', views: 115000000, phase: '蓄水期' },
    { date: '5/14', views: 140000000, phase: '蓄水期' },
    { date: '5/15', views: 175000000, phase: '第一波爆发' },
    { date: '5/16', views: 175000000, phase: '第一波爆发' },
    { date: '5/17', views: 160000000, phase: '第一波爆发' },
    { date: '5/18', views: 165000000, phase: '第一波爆发' },
    { date: '5/19', views: 155000000, phase: '第一波爆发' },
    { date: '5/20', views: 155000000, phase: '第一波爆发' },
    { date: '5/21', views: 155000000, phase: '蓄力期' },
    { date: '5/22', views: 155000000, phase: '蓄力期' },
    { date: '5/23', views: 150000000, phase: '蓄力期' },
    { date: '5/24', views: 152000000, phase: '蓄力期' },
    { date: '5/25', views: 155000000, phase: '蓄力期' },
    { date: '5/26', views: 168000000, phase: '蓄力期' },
    { date: '5/27', views: 168000000, phase: '蓄力期' },
    { date: '5/28', views: 168000000, phase: '蓄力期' },
    { date: '5/29', views: 180000000, phase: '第二波爆发' },
    { date: '5/30', views: 180000000, phase: '第二波爆发' },
    { date: '5/31', views: 175000000, phase: '第二波爆发' },
    { date: '6/1',  views: 175000000, phase: '第二波爆发' },
    { date: '6/2',  views: 194994457, phase: '第二波爆发' },
    { date: '6/3',  views: 180000000, phase: '第二波爆发' },
    { date: '6/4',  views: 175000000, phase: '第二波爆发' },
    { date: '6/5',  views: 175000000, phase: '第二波爆发' },
    { date: '6/6',  views: 170000000, phase: '回落期' },
    { date: '6/7',  views: 165000000, phase: '回落期' },
    { date: '6/8',  views: 155000000, phase: '回落期' },
    { date: '6/9',  views: 150000000, phase: '回落期' },
    { date: '6/10', views: 150000000, phase: '回落期' },
    { date: '6/11', views: 145000000, phase: '回落期' },
    { date: '6/12', views: 135000000, phase: '回落期' },
    { date: '6/13', views: 110000000, phase: '回落期' },
    { date: '6/14', views: 105000000, phase: '回落期' },
    { date: '6/15', views: 105000000, phase: '回落期' },
    { date: '6/16', views: 105000000, phase: '回落期' },
    { date: '6/17', views: 110000000, phase: '回落期' },
    { date: '6/18', views: 105000000, phase: '回落期' },
    { date: '6/19', views: 110000000, phase: '回落期' },
    { date: '6/20', views: 115000000, phase: '回落期' },
    { date: '6/21', views: 110000000, phase: '返场期' },
    { date: '6/22', views: 95000000,  phase: '返场期' },
    { date: '6/23', views: 92000000,  phase: '返场期' },
    { date: '6/24', views: 92000000,  phase: '返场期' },
    { date: '6/25', views: 92000000,  phase: '返场期' },
    { date: '6/26', views: 90000000,  phase: '返场期' },
    { date: '6/27', views: 90507712,  phase: '返场期' },
    { date: '6/28', views: 90000000,  phase: '返场期' },
    { date: '6/29', views: 92000000,  phase: '返场期' },
    { date: '6/30', views: 95000000,  phase: '返场期' },
  ];

  var SIX18_REFERENCE_PHASE_META = [
    { phase: '蓄水期',     color: '#94a3b8', bgColor: 'rgba(148,163,184,0.12)' },
    { phase: '第一波爆发', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.12)' },
    { phase: '蓄力期',     color: '#6366f1', bgColor: 'rgba(99,102,241,0.12)' },
    { phase: '第二波爆发', color: '#ef4444', bgColor: 'rgba(239,68,68,0.12)' },
    { phase: '回落期',     color: '#64748b', bgColor: 'rgba(100,116,139,0.08)' },
    { phase: '返场期',     color: '#0ea5e9', bgColor: 'rgba(14,165,233,0.10)' },
  ];

  window.PlanDashboardReferenceData = {
    DOUBLE11_REFERENCE_MONTHS: DOUBLE11_REFERENCE_MONTHS,
    DOUBLE11_REFERENCE_SUMMARY: DOUBLE11_REFERENCE_SUMMARY,
    DOUBLE11_REFERENCE_PHASES: DOUBLE11_REFERENCE_PHASES,
    SIX18_REFERENCE_MONTHS: SIX18_REFERENCE_MONTHS,
    SIX18_RHYTHM_MONTHS: SIX18_RHYTHM_MONTHS,
    SIX18_RHYTHM_PHASES: SIX18_RHYTHM_PHASES,
    SIX18_REFERENCE_DAILY: SIX18_REFERENCE_DAILY,
    SIX18_REFERENCE_PHASE_META: SIX18_REFERENCE_PHASE_META,
  };
})(window);

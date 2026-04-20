(function attachPlanDashboardUtils(window) {
  function toNumber(value) {
    const normalized = String(value ?? '').replace(/,/g, '').trim();
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(toNumber(value));
  }

  function formatPercent(value) {
    if (value == null || value === '') return '-';
    const num = Number(value);
    if (!Number.isFinite(num)) return '-';
    return `${(num * 100).toFixed(2)}%`;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(toNumber(value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sum(values) {
    return values.reduce((acc, item) => acc + toNumber(item), 0);
  }

  const DEFAULT_ACTIVITY_TYPES = [
    'daily',
    'presale_warmup',
    'presale_deposit',
    'presale_balance',
    'spot_warmup',
    'spot_burst',
  ];

  function getActivityTypeMeta(type) {
    const map = {
      daily: { label: '日常期', className: 'type-daily', color: '#64748b' },
      presale_warmup: { label: '预售预热期', className: 'type-presale_warmup', color: '#f59e0b' },
      presale_deposit: { label: '预售付定金期', className: 'type-presale_deposit', color: '#ef4444' },
      presale_balance: { label: '预售付尾款期', className: 'type-presale_balance', color: '#8b5cf6' },
      spot_warmup: { label: '现货预热期', className: 'type-spot_warmup', color: '#06b6d4' },
      spot_burst: { label: '现货爆发期', className: 'type-spot_burst', color: '#ec4899' },
    };
    return map[type] || { label: type || '未分类', className: 'type-default', color: '#94a3b8' };
  }

  function getActivityTypeOptions() {
    return [...DEFAULT_ACTIVITY_TYPES];
  }

  function formatDateTimeLabel(date, time) {
    if (!date) return '';
    const [y, m, d] = date.split('-');
    const label = `${Number(m)}月${Number(d)}日`;
    return time ? `${label} ${time}` : label;
  }

  function buildCurrentUserLabel() {
    const helpers = window.authHelpers || {};
    const user = typeof helpers.getStoredUser === 'function' ? helpers.getStoredUser() : null;
    if (!user) return 'unknown';
    return String(user.name || user.en_name || user.email || user.open_id || 'unknown');
  }

  window.PlanDashboardUtils = {
    toNumber,
    formatCurrency,
    formatPercent,
    formatNumber,
    escapeHtml,
    sum,
    getActivityTypeMeta,
    getActivityTypeOptions,
    formatDateTimeLabel,
    buildCurrentUserLabel,
  };
})(window);

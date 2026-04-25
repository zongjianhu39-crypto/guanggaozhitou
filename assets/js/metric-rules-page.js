(function attachMetricRulesPage(window) {
  const state = {
    dashboard: null,
    semantic: null,
    tab: 'dashboard',
    query: '',
  };

  var escapeHtml = window.sharedUtils && window.sharedUtils.escapeHtml;

  function normalizeText(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  async function fetchJson(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`读取 ${path} 失败: HTTP ${response.status}`);
    }
    return response.json();
  }

  function renderStats() {
    const container = document.getElementById('rules-stats');
    if (!container || !state.dashboard || !state.semantic) return;

    const dashboardMetricCount = Array.isArray(state.dashboard?.metrics?.adsFormulaRows)
      ? state.dashboard.metrics.adsFormulaRows.length
      : 0;
    const crowdRuleCount = Array.isArray(state.dashboard?.dimensions?.crowdLayer?.rules)
      ? state.dashboard.dimensions.crowdLayer.rules.length
      : 0;
    const semanticMetricCount = state.semantic?.metrics ? Object.keys(state.semantic.metrics).length : 0;
    const intentGroupCount = Array.isArray(state.semantic?.intentGroups)
      ? state.semantic.intentGroups.length
      : 0;

    container.innerHTML = [
      { value: dashboardMetricCount, label: '看板指标公式' },
      { value: crowdRuleCount, label: '人群分层规则' },
      { value: semanticMetricCount, label: 'GenBI 指标定义' },
      { value: intentGroupCount, label: '受控问题类型' },
    ].map(function(item) {
      return `
        <div class="stat-card">
          <strong>${item.value}</strong>
          <span>${item.label}</span>
        </div>
      `;
    }).join('');
  }

  function getWebsiteMetricInventory(dashboard, semantic) {
    const adsFormulaRows = Array.isArray(dashboard?.metrics?.adsFormulaRows) ? dashboard.metrics.adsFormulaRows : [];
    const adsRawFields = [
      '花费',
      '总成交金额',
      '总成交笔数',
      '直接成交金额',
      '总购物车数',
      '总预售成交笔数',
      '展现量',
      '观看次数',
      '互动量',
      '保量佣金',
      '预估结算线下佣金',
      '预估结算机构佣金',
      '直播间红包',
      '严选红包',
      '淘宝直播成交笔数',
      '退货率',
    ].map(function(label) {
      return {
        group: '投放分析原始字段',
        label: label,
        key: '-',
        kind: '原始字段',
        source: 'super_live / taobao_live / financial',
        usage: '数据看板·投放分析 / GenBI·周报月报亏损归因',
        note: '用于投放分析聚合与派生公式计算',
      };
    });

    const adsFormulaMetrics = adsFormulaRows.map(function(row) {
      return {
        group: '投放分析公式指标',
        label: row.label,
        key: row.key,
        kind: '派生指标',
        source: 'dashboard-spec',
        usage: '数据看板·投放分析 / GenBI·周报月报亏损归因',
        note: row.formula,
      };
    });

    const crowdMetrics = [
      ['花费', 'cost'],
      ['花费占比', 'costShare'],
      ['总成交金额', 'amount'],
      ['总成交笔数', 'orders'],
      ['ROI', 'roi'],
      ['直接ROI', 'directRoi'],
      ['观看成本', 'viewCost'],
      ['订单成本', 'orderCost'],
      ['加购成本', 'cartCost'],
      ['总预售成交笔数', 'preOrders'],
      ['预售订单成本', 'preOrderCost'],
      ['观看转化率', 'viewConvertRate'],
      ['深度互动率', 'deepInteractRate'],
      ['观看率', 'viewRate'],
      ['千次展现成本', 'cpm'],
      ['直接成交金额', 'directAmount'],
      ['总购物车数', 'cartCount'],
      ['展现量', 'impression'],
    ].map(function(item) {
      return {
        group: '人群指标',
        label: item[0],
        key: item[1],
        kind: '聚合结果',
        source: 'dashboard-data crowd.summary',
        usage: '数据看板·人群维度 / GenBI·人群预算建议·结构分析·花费波动归因',
        note: '人群分层看板和 GenBI 人群问题共用',
      };
    });

    const singleMetrics = [
      ['花费', 'cost'],
      ['直接ROI', 'directRoi'],
      ['商品直接ROI', 'productDirectRoi'],
      ['直接成交笔数', 'directOrders'],
      ['商品直接笔数', 'productOrders'],
      ['商品直接金额', 'productAmount'],
      ['加购数', 'cartCount'],
      ['加购成本', 'cartCost'],
      ['观看人数', 'viewCount'],
      ['商品订单成本', 'orderCost'],
    ].map(function(item) {
      return {
        group: '单品指标',
        label: item[0],
        key: item[1],
        kind: '聚合结果',
        source: 'dashboard-data single.items',
        usage: '数据看板·单品广告 / GenBI·高花费低回报·冲销售额·单商品查询',
        note: '单品看板和 GenBI 单品问题共用',
      };
    });

    const semanticMetrics = Object.entries(semantic?.metrics || {}).map(function(entry) {
      const key = entry[0];
      const item = entry[1];
      return {
        group: 'GenBI 语义指标',
        label: item.label,
        key: key,
        kind: '语义口径',
        source: Array.isArray(item.sourceScope) ? item.sourceScope.join(' / ') : '-',
        usage: 'GenBI',
        note: item.formula || item.description || '-',
      };
    });

    return adsRawFields
      .concat(adsFormulaMetrics)
      .concat(crowdMetrics)
      .concat(singleMetrics)
      .concat(semanticMetrics);
  }

  function buildDashboardCards(dashboard) {
    const metricRows = Array.isArray(dashboard?.metrics?.adsFormulaRows) ? dashboard.metrics.adsFormulaRows : [];
    const planRules = Array.isArray(dashboard?.dimensions?.planType?.rules) ? dashboard.dimensions.planType.rules : [];
    const crowdRules = Array.isArray(dashboard?.dimensions?.crowdLayer?.rules) ? dashboard.dimensions.crowdLayer.rules : [];

    return [
      {
        tab: 'all',
        title: '当前网站全部生效指标总表',
        searchText: JSON.stringify(getWebsiteMetricInventory(dashboard, state.semantic)),
        meta: ['汇总视图', `共 ${getWebsiteMetricInventory(dashboard, state.semantic).length} 项`],
        body: `
          <p>这张总表不是只看投放分析公式，而是把当前网站实际生效的指标按“原始字段 / 派生公式 / 看板聚合结果 / GenBI 语义口径”统一放到一起，方便核对到底哪些数字在被系统使用。</p>
          <table class="rule-table">
            <thead><tr><th>分组</th><th>指标</th><th>键名</th><th>类型</th><th>来源</th><th>当前使用场景</th><th>说明 / 公式</th></tr></thead>
            <tbody>
              ${getWebsiteMetricInventory(dashboard, state.semantic).map(function(item) {
                return `<tr><td>${escapeHtml(item.group)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.key)}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.usage || '-')}</td><td>${escapeHtml(item.note)}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `,
      },
      {
        tab: 'dashboard',
        title: '投放分析指标公式',
        searchText: JSON.stringify(metricRows),
        meta: [`版本 ${dashboard?.version || '--'}`, `共 ${metricRows.length} 条公式`],
        body: `
          <p>这里显示数据看板投放分析区当前生效的公式定义，优先用来核对指标口径，而不是解释业务结论。</p>
          <table class="rule-table">
            <thead><tr><th>指标</th><th>键名</th><th>公式</th></tr></thead>
            <tbody>
              ${metricRows.map(function(row) {
                return `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.key)}</td><td>${escapeHtml(row.formula)}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `,
      },
      {
        tab: 'dashboard',
        title: '计划分类规则',
        searchText: JSON.stringify(planRules),
        meta: [`默认分类 ${dashboard?.dimensions?.planType?.defaultLabel || '--'}`, `共 ${planRules.length} 条规则`],
        body: `
          <p>当前只读展示“计划名字 -> 计划分类”的映射规则，方便检查单品投放、直播间投放等归类是否准确。</p>
          <table class="rule-table">
            <thead><tr><th>目标分类</th><th>匹配条件</th></tr></thead>
            <tbody>
              ${planRules.map(function(rule) {
                return `<tr><td>${escapeHtml(rule.label)}</td><td>${escapeHtml((rule.includes || []).join(' / ')) || '-'}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `,
      },
      {
        tab: 'dashboard',
        title: '人群分层规则',
        searchText: JSON.stringify(crowdRules),
        meta: [`回退标签 ${dashboard?.dimensions?.crowdLayer?.fallbackLabel || '--'}`, `共 ${crowdRules.length} 条规则`],
        body: `
          <p>这里是当前“人群名字 -> 人群分层”的实际规则，最适合用来核对人群分类是否被错误归到了新客、老客、灰盒或兴趣新客。</p>
          <table class="rule-table">
            <thead><tr><th>目标分层</th><th>exact / includes / prefixes / subRules</th></tr></thead>
            <tbody>
              ${crowdRules.map(function(rule) {
                const parts = [];
                if (Array.isArray(rule.exact) && rule.exact.length) parts.push(`exact: ${rule.exact.join(' / ')}`);
                if (Array.isArray(rule.includes) && rule.includes.length) parts.push(`includes: ${rule.includes.join(' / ')}`);
                if (Array.isArray(rule.prefixes) && rule.prefixes.length) parts.push(`prefixes: ${rule.prefixes.join(' / ')}`);
                if (Array.isArray(rule.subRules) && rule.subRules.length) parts.push(`subRules: ${rule.subRules.map(function(sub) { return sub.label; }).join(' / ')}`);
                return `<tr><td>${escapeHtml(rule.label)}</td><td>${escapeHtml(parts.join(' | ')) || '-'}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `,
      },
    ];
  }

  function buildSemanticCards(semantic) {
    const sources = semantic?.sources ? Object.entries(semantic.sources) : [];
    const dimensions = semantic?.dimensions ? Object.entries(semantic.dimensions) : [];
    const metrics = semantic?.metrics ? Object.entries(semantic.metrics) : [];
    const intentGroups = Array.isArray(semantic?.intentGroups) ? semantic.intentGroups : [];
    const rules = semantic?.rules ? Object.entries(semantic.rules) : [];

    return [
      {
        tab: 'genbi',
        title: '默认口径与配置',
        searchText: JSON.stringify(semantic?.defaults || {}),
        meta: [`版本 ${semantic?.version || '--'}`, `文档来源 ${semantic?.docsSource || '--'}`],
        body: `
          <p>这里定义 GenBI 回答问题时优先采用的默认口径。当前最关键的是 ROI 主口径和单品/人群的效率回退口径。</p>
          <table class="rule-table">
            <thead><tr><th>键名</th><th>当前值</th></tr></thead>
            <tbody>
              ${Object.entries(semantic?.defaults || {}).map(function(entry) {
                return `<tr><td>${escapeHtml(entry[0])}</td><td>${escapeHtml(entry[1])}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `,
      },
      {
        tab: 'genbi',
        title: '数据源定义',
        searchText: JSON.stringify(sources),
        meta: [`共 ${sources.length} 个数据源`],
        body: `
          <p>这些配置定义 GenBI 当前可以依赖哪些数据源，以及每个数据源的主日期字段和粒度范围。</p>
          <table class="rule-table">
            <thead><tr><th>数据源</th><th>标签</th><th>粒度</th><th>主日期字段</th></tr></thead>
            <tbody>
              ${sources.map(function(entry) {
                const key = entry[0];
                const source = entry[1];
                return `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(source.label)}</td><td>${escapeHtml((source.grain || []).join(' / '))}</td><td>${escapeHtml(source.primaryDateField)}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `,
      },
      {
        tab: 'genbi',
        title: '维度定义',
        searchText: JSON.stringify(dimensions),
        meta: [`共 ${dimensions.length} 个维度`],
        body: `
          <p>这些维度定义告诉系统哪些业务对象可被直接检索和解释，例如人群分层、计划分类、商品名称、日期。</p>
          <table class="rule-table">
            <thead><tr><th>维度</th><th>标签</th><th>来源 / 说明</th></tr></thead>
            <tbody>
              ${dimensions.map(function(entry) {
                const key = entry[0];
                const item = entry[1];
                const source = item.derivedFrom ? `derivedFrom: ${item.derivedFrom}` : '';
                const ext = item.extensible ? '可扩展' : '';
                return `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml([source, ext].filter(Boolean).join(' | ')) || '-'}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `,
      },
      {
        tab: 'genbi',
        title: '指标定义',
        searchText: JSON.stringify(metrics),
        meta: [`共 ${metrics.length} 个指标`],
        body: `
          <p>这里是 GenBI 的指标层真相，说明系统如何理解盈亏平衡 ROI、订单成本、直接 ROI、花费、GMV 等业务概念。</p>
          <table class="rule-table">
            <thead><tr><th>指标</th><th>标签</th><th>来源范围</th><th>公式 / 说明</th></tr></thead>
            <tbody>
              ${metrics.map(function(entry) {
                const key = entry[0];
                const item = entry[1];
                return `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml((item.sourceScope || []).join(' / ')) || '-'}</td><td>${escapeHtml(item.formula || item.description || '-')}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `,
      },
      {
        tab: 'genbi',
        title: '受控问题集',
        searchText: JSON.stringify(intentGroups),
        meta: [`共 ${intentGroups.length} 类问题`],
        body: `
          <p>当前 GenBI 不是开放问答，而是先命中这组受控问题类型。这里可以直接核对系统现在承诺支持哪些问题。</p>
          <table class="rule-table">
            <thead><tr><th>问题类型</th><th>标签</th><th>示例问题</th></tr></thead>
            <tbody>
              ${intentGroups.map(function(item) {
                return `<tr><td>${escapeHtml(item.key)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml((item.examples || []).join(' / '))}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `,
      },
      {
        tab: 'genbi',
        title: '判定阈值',
        searchText: JSON.stringify(rules),
        meta: [`共 ${rules.length} 组阈值`],
        body: `
          <p>这里展示的是当前 GenBI 判断“该加预算”“高花费低回报”“重点人群/重点商品”的阈值。现在仍是只读，但你至少能知道系统在按什么标准出结论。</p>
          <table class="rule-table">
            <thead><tr><th>规则组</th><th>当前配置</th></tr></thead>
            <tbody>
              ${rules.map(function(entry) {
                return `<tr><td>${escapeHtml(entry[0])}</td><td>${escapeHtml(JSON.stringify(entry[1]))}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        `,
      },
    ];
  }

  function getAllCards() {
    if (!state.dashboard || !state.semantic) return [];
    return buildDashboardCards(state.dashboard).concat(buildSemanticCards(state.semantic));
  }

  function getFilteredCards() {
    const cards = getAllCards();
    return cards.filter(function(card) {
      const matchTab = state.tab === 'all' || card.tab === state.tab;
      if (!matchTab) return false;
      if (!state.query) return true;
      return normalizeText(card.title + ' ' + card.searchText).includes(state.query);
    });
  }

  function renderSummary() {
    const title = document.getElementById('rules-summary-title');
    const copy = document.getElementById('rules-summary-copy');
    const source = document.getElementById('rules-summary-source');
    if (!title || !copy || !source || !state.dashboard || !state.semantic) return;

    if (state.tab === 'dashboard') {
      title.textContent = '当前查看：数据看板规则';
      copy.textContent = '优先看投放分析公式、计划分类和人群分层规则。这里最适合发现“看板数字是对的，但分层或归类不符合业务预期”的问题。';
      source.style.display = 'inline-flex';
      source.innerHTML = `<strong>规则文件</strong><span>${escapeHtml(state.dashboard.docsSource || 'assets/data/dashboard-spec.json')}</span>`;
      return;
    }
    if (state.tab === 'genbi') {
      title.textContent = '当前查看：GenBI 语义规则';
      copy.textContent = '优先看默认口径、指标定义、问题集和判定阈值。这里最适合发现“GenBI 回答看着合理，但规则基线不对”的问题。';
      source.style.display = 'inline-flex';
      source.innerHTML = `<strong>语义文件</strong><span>${escapeHtml(state.semantic.docsSource || 'assets/data/genbi-semantic.json')}</span>`;
      return;
    }

    title.textContent = '当前查看：全部规则';
    copy.textContent = '这一页把看板规则和 GenBI 规则都拉到了可视化层，后续如果要做编辑能力，也应该先基于这里的结构继续演进，而不是直接开放 JSON。';
    source.style.display = 'inline-flex';
    source.innerHTML = `<strong>当前来源</strong><span>${escapeHtml(state.dashboard.docsSource || '--')}</span><span>${escapeHtml(state.semantic.docsSource || '--')}</span>`;
  }

  function renderCards() {
    const list = document.getElementById('rules-list');
    if (!list) return;
    const cards = getFilteredCards();
    if (!cards.length) {
      list.innerHTML = '<div class="rule-empty">当前筛选条件下没有命中的规则项。</div>';
      return;
    }
    list.innerHTML = cards.map(function(card) {
      return `
        <article class="rule-card">
          <h3>${escapeHtml(card.title)}</h3>
          <div class="rule-meta">${card.meta.map(function(item) { return `<span class="meta-chip">${escapeHtml(item)}</span>`; }).join('')}</div>
          ${card.body}
        </article>
      `;
    }).join('');
  }

  function render() {
    renderStats();
    renderSummary();
    renderCards();
  }

  function bindEvents() {
    document.querySelectorAll('.rules-tab').forEach(function(button) {
      button.addEventListener('click', function() {
        state.tab = button.dataset.tab || 'all';
        document.querySelectorAll('.rules-tab').forEach(function(tab) {
          tab.classList.toggle('active', tab === button);
        });
        render();
      });
    });

    document.getElementById('rules-search')?.addEventListener('input', function(event) {
      state.query = normalizeText(event.target.value);
      render();
    });
  }

  async function init() {
    bindEvents();
    const [dashboard, semantic] = await Promise.all([
      fetchJson('assets/data/dashboard-spec.json'),
      fetchJson('assets/data/genbi-semantic.json'),
    ]);
    state.dashboard = dashboard;
    state.semantic = semantic;
    render();
  }

  document.addEventListener('DOMContentLoaded', function() {
    init().catch(function(error) {
      const list = document.getElementById('rules-list');
      if (list) {
        list.innerHTML = `<div class="rule-empty">规则台加载失败：${escapeHtml(error && error.message ? error.message : '未知错误')}</div>`;
      }
    });
  });
})(window);

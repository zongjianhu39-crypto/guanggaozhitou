export type GenbiIntent =
  | 'crowd_budget'
  | 'weak_products'
  | 'crowd_mix'
  | 'product_potential'
  | 'product_sales'
  | 'weekly_report'
  | 'monthly_report'
  | 'daily_drop_reason'
  | 'loss_reason'
  | 'budget_plan'
  | 'unknown';

export function detectIntent(question: string): GenbiIntent {
  const normalized = question.replace(/\s+/g, '');
  if (/哪些.*人群.*(增加预算|降低预算|预算|加预算|降预算)/.test(normalized)) return 'crowd_budget';
  if (/单品广告.*哪些.*商品.*花费.*(回报差|差|低)/.test(normalized)) return 'weak_products';
  if (/老客.*新客.*占比/.test(normalized)) return 'crowd_mix';
  if (/哪些.*商品.*适合.*冲销售额/.test(normalized)) return 'product_potential';
  if (/商品.*(销售数据|表现如何|近期.*如何)/.test(normalized)) return 'product_sales';
  if (/上周.*周报|周报/.test(normalized)) return 'weekly_report';
  if (/上月.*月报|月报/.test(normalized)) return 'monthly_report';
  if (/(昨日|昨天).*花费.*下降/.test(normalized)) return 'daily_drop_reason';
  if (/盈亏.*ROI.*低于?1|亏钱.*亏在了哪里/.test(normalized)) return 'loss_reason';
  if (/(100万|预算).*(怎么花|怎么分配|如何花)/.test(normalized)) return 'budget_plan';
  return 'unknown';
}

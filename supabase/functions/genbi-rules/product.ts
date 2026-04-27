import { getDashboardPayload } from '../_shared/dashboard-payload.ts';
import type { GenbiRange } from '../_shared/genbi-time.ts';
import { buildAnswerEnvelope, composeTable, money, ratio } from '../_shared/genbi-format.ts';
import { mapPayloadSingleItems } from '../_shared/genbi-payload-adapters.ts';
import { getProductPotentialRuleConfig, getProductSalesRuleConfig, getWeakProductsRuleConfig } from '../_shared/genbi-rule-resolver.ts';

function extractProductName(question: string): string | null {
  const quoted = question.match(/[“"]([^”"]{2,40})[”"]/);
  if (quoted?.[1]) return quoted[1].trim();
  const afterKeyword = question.match(/商品(?:是|为|：|:)?\s*([A-Za-z0-9\u4e00-\u9fa5·\-_\s]{2,40})/);
  if (afterKeyword?.[1]) return afterKeyword[1].trim();
  return null;
}

export function buildWeakProductsResponse(range: GenbiRange, allProducts: any[], options: { minFocusPoolSize: number; focusPoolCostCoverage: number; topCount: number; highlightCount: number }) {
  const totalCost = allProducts.reduce((sum, item) => sum + item.cost, 0);
  const sortedByCost = [...allProducts].sort((a, b) => b.cost - a.cost);
  let cumulativeCost = 0;
  const focusPool = sortedByCost.filter((item, index) => {
    cumulativeCost += item.cost;
    if (index < options.minFocusPoolSize) return true;
    if (totalCost <= 0) return false;
    return cumulativeCost / totalCost <= options.focusPoolCostCoverage;
  });

  const products = focusPool
    .sort((a, b) => {
      const roiA = a.productDirectRoi > 0 ? a.productDirectRoi : -1;
      const roiB = b.productDirectRoi > 0 ? b.productDirectRoi : -1;
      if (roiA !== roiB) return roiA - roiB;
      const orderCostA = Number.isFinite(a.orderCost) ? a.orderCost : Number.MAX_SAFE_INTEGER;
      const orderCostB = Number.isFinite(b.orderCost) ? b.orderCost : Number.MAX_SAFE_INTEGER;
      if (orderCostA !== orderCostB) return orderCostB - orderCostA;
      return b.cost - a.cost;
    })
    .slice(0, options.topCount);

  const answer = products.length
    ? `在 ${range.start} 至 ${range.end} 这段时间里，最需要优先检查的是 ${products.slice(0, options.highlightCount).map((item) => `${item.productName}（花费 ${money(item.cost)}，商品订单成本 ${Number.isFinite(item.orderCost) ? money(item.orderCost) : '无成交'}，商品直接ROI ${ratio(item.productDirectRoi)}）`).join('、')}。`
    : '当前时间范围没有拿到单品广告数据。';

  return buildAnswerEnvelope(
    'weak_products',
    '高花费低回报商品诊断',
    answer,
    range,
    [
      composeTable(
        '单品广告高花费低回报商品',
        ['商品', '花费', '商品订单成本', '商品直接ROI', '商品直接成交金额', '商品直接成交笔数'],
        products.map((item) => ({
          '商品': item.productName,
          '花费': money(item.cost),
          '商品订单成本': Number.isFinite(item.orderCost) ? money(item.orderCost) : '无成交',
          '商品直接ROI': ratio(item.productDirectRoi),
          '商品直接成交金额': money(item.productAmount),
          '商品直接成交笔数': item.productOrders,
        })),
      ),
    ],
  );
}

export async function answerWeakProducts(range: GenbiRange) {
  const config = await getWeakProductsRuleConfig();
  const payload = await getDashboardPayload(range.start, range.end, config.dataScopeFlags) as any;
  const allProducts = mapPayloadSingleItems(payload?.single?.items).filter((item) => item.cost > 0);
  return buildWeakProductsResponse(range, allProducts, {
    minFocusPoolSize: config.minFocusPoolSize,
    focusPoolCostCoverage: config.focusPoolCostCoverage,
    topCount: config.topCount,
    highlightCount: config.highlightCount,
  });
}

export function buildProductPotentialResponse(range: GenbiRange, allProducts: any[], options: { topCount: number; highlightCount: number }) {
  const products = allProducts
    .filter((item) => item.cost > 0 && item.productOrders > 0)
    .sort((a, b) => (b.productDirectRoi * b.productAmount) - (a.productDirectRoi * a.productAmount))
    .slice(0, options.topCount);
  const answer = products.length
    ? `更适合冲销售额的商品优先看 ${products.slice(0, options.highlightCount).map((item) => `${item.productName}（商品直接ROI ${ratio(item.productDirectRoi)}，商品直接成交金额 ${money(item.productAmount)}）`).join('、')}。`
    : '当前时间范围没有筛出可判断的商品。';
  return buildAnswerEnvelope(
    'product_potential',
    '冲销售额商品识别',
    answer,
    range,
    [composeTable('潜力商品', ['商品', '花费', '商品直接ROI', '商品直接成交金额', '商品订单成本'], products.map((item) => ({
      '商品': item.productName,
      '花费': money(item.cost),
      '商品直接ROI': ratio(item.productDirectRoi),
      '商品直接成交金额': money(item.productAmount),
      '商品订单成本': Number.isFinite(item.orderCost) ? money(item.orderCost) : '-',
    })))],
  );
}

export async function answerProductPotential(range: GenbiRange) {
  const config = await getProductPotentialRuleConfig();
  const payload = await getDashboardPayload(range.start, range.end, config.dataScopeFlags) as any;
  const products = mapPayloadSingleItems(payload?.single?.items);
  return buildProductPotentialResponse(range, products, {
    topCount: config.topCount,
    highlightCount: config.highlightCount,
  });
}

export async function answerProductSales(question: string, range: GenbiRange) {
  const config = await getProductSalesRuleConfig();
  const productName = extractProductName(question);
  if (!productName) {
    return buildAnswerEnvelope(
      'product_sales',
      '单商品销售查询',
      '我可以查单个商品的近期单品广告销售数据，但当前问题里没有明确商品名。请直接在问题里带上商品名，例如“MacBook Air 近期单品广告销售数据如何”。',
      range,
    );
  }
  const payload = await getDashboardPayload(range.start, range.end, config.dataScopeFlags) as any;
  const products = mapPayloadSingleItems(payload?.single?.items).filter((item) => item.productName.includes(productName));
  if (!products.length) {
    return buildAnswerEnvelope('product_sales', '单商品销售查询', `在 ${range.start} 至 ${range.end} 期间没有找到与“${productName}”匹配的单品广告数据。`, range);
  }
  const product = products.slice(0, config.resultLimit)[0];
  return buildAnswerEnvelope(
    'product_sales',
    '单商品销售查询',
    `商品“${product.productName}”在 ${range.start} 至 ${range.end} 的单品广告表现：花费 ${money(product.cost)}，商品直接成交金额 ${money(product.productAmount)}，商品直接成交笔数 ${product.productOrders}，商品直接ROI ${ratio(product.productDirectRoi)}，商品订单成本 ${Number.isFinite(product.orderCost) ? money(product.orderCost) : '无成交'}。`,
    range,
    [composeTable('商品近期表现', ['商品', '花费', '商品直接成交金额', '商品直接成交笔数', '商品直接ROI', '商品订单成本'], [{
      '商品': product.productName,
      '花费': money(product.cost),
      '商品直接成交金额': money(product.productAmount),
      '商品直接成交笔数': product.productOrders,
      '商品直接ROI': ratio(product.productDirectRoi),
      '商品订单成本': Number.isFinite(product.orderCost) ? money(product.orderCost) : '无成交',
    }])],
  );
}

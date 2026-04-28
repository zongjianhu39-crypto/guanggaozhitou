function toNum(value: unknown): number {
  return Number.parseFloat(String(value ?? '').replace(/,/g, '')) || 0;
}

export function mapPayloadSingleItems(items: any[]) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const cost = toNum(item['花费']);
    const productOrders = toNum(item['该商品直接成交笔数']);
    const productAmount = toNum(item['该商品直接成交金额']);
    const directOrders = toNum(item['直接成交笔数']);
    const directAmount = toNum(item['直接成交金额']);
    const orderCost = productOrders > 0 ? cost / productOrders : Infinity;
    const productDirectRoi = cost > 0 ? productAmount / cost : 0;
    const directRoi = cost > 0 ? directAmount / cost : 0;
    return {
      productId: String(item['商品id'] ?? ''),
      productName: String(item['商品名称'] ?? ''),
      imgUrl: String(item['img_url'] ?? ''),
      cost,
      directOrders,
      directAmount,
      productOrders,
      productAmount,
      cart: toNum(item['该商品加购数']),
      viewers: toNum(item['观看人数']),
      orderCost,
      productDirectRoi,
      directRoi,
      // 同时暴露中文键，兼容下游 METRIC_FORMATTERS 直接读取
      '花费': cost,
      '订单成本': orderCost,
      '直接ROI': directRoi,
      '商品直接ROI': productDirectRoi,
      '商品直接成交金额': productAmount,
      '商品直接成交笔数': productOrders,
      '成交笔数': directOrders,
      '总成交金额': directAmount,
    };
  });
}

export function mapPayloadCrowdSummary(rows: any[]) {
  const groups = Array.isArray(rows) ? rows : [];
  // 先计算所有人群的总花费，用于推导人群花费占比
  const totalCost = groups.reduce((sum, g) => sum + toNum(g?.summary?.cost), 0);
  return groups.map((group) => {
    const cost = toNum(group?.summary?.cost);
    const amount = toNum(group?.summary?.amount);
    const orders = toNum(group?.summary?.orders);
    const rawOrderCost = toNum(group?.summary?.orderCost);
    const orderCost = rawOrderCost > 0 ? rawOrderCost : (orders > 0 ? cost / orders : Infinity);
    const costShare = totalCost > 0 ? cost / totalCost : 0;
    const directRoi = cost > 0 ? amount / cost : 0;
    return {
      layer: String(group?.crowd ?? ''),
      cost,
      amount,
      orders,
      costShare,
      orderCost,
      directRoi,
      // 同时暴露中文键，兼容下游 METRIC_FORMATTERS 直接读取
      '花费': cost,
      '订单成本': orderCost,
      '直接ROI': directRoi,
      '总成交金额': amount,
      '成交笔数': orders,
      '人群花费占比': costShare,
      directNames: Array.isArray(group?.subRows)
        ? group.subRows.map((row: any) => ({
          name: String(row?.label ?? ''),
          cost: toNum(row?.cost),
          amount: toNum(row?.amount),
          orders: toNum(row?.orders),
          orderCost: toNum(row?.orderCost) > 0 ? toNum(row?.orderCost) : Infinity,
        }))
        : [],
    };
  });
}

function toNum(value: unknown): number {
  return Number.parseFloat(String(value ?? '').replace(/,/g, '')) || 0;
}

export function mapPayloadSingleItems(items: any[]) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const cost = toNum(item['花费']);
    const productOrders = toNum(item['该商品直接成交笔数']);
    const productAmount = toNum(item['该商品直接成交金额']);
    return {
      productId: String(item['商品id'] ?? ''),
      productName: String(item['商品名称'] ?? ''),
      imgUrl: String(item['img_url'] ?? ''),
      cost,
      directOrders: toNum(item['直接成交笔数']),
      directAmount: toNum(item['直接成交金额']),
      productOrders,
      productAmount,
      cart: toNum(item['该商品加购数']),
      viewers: toNum(item['观看人数']),
      orderCost: productOrders > 0 ? cost / productOrders : Infinity,
      productDirectRoi: cost > 0 ? productAmount / cost : 0,
    };
  });
}

export function mapPayloadCrowdSummary(rows: any[]) {
  return (Array.isArray(rows) ? rows : []).map((group) => ({
    layer: String(group?.crowd ?? ''),
    cost: toNum(group?.summary?.cost),
    amount: toNum(group?.summary?.amount),
    orders: toNum(group?.summary?.orders),
    costShare: 0,
    orderCost: toNum(group?.summary?.orderCost) > 0 ? toNum(group?.summary?.orderCost) : Infinity,
    directNames: Array.isArray(group?.subRows)
      ? group.subRows.map((row: any) => ({
        name: String(row?.label ?? ''),
        cost: toNum(row?.cost),
        amount: toNum(row?.amount),
        orders: toNum(row?.orders),
        orderCost: toNum(row?.orderCost) > 0 ? toNum(row?.orderCost) : Infinity,
      }))
      : [],
  }));
}

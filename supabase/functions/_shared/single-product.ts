function toNum(value: unknown): number {
  return Number.parseFloat(String(value ?? '').replace(/,/g, '')) || 0;
}

const SINGLE_PRODUCT_DEDUPE_FIELDS = [
  '日期',
  '商品id',
  '商品名称',
  '花费',
  '直接成交笔数',
  '直接成交金额',
  '该商品直接成交笔数',
  '该商品直接成交金额',
  '该商品加购数',
  '该商品收藏数',
  '观看人数',
];

const SINGLE_PRODUCT_NUMERIC_FIELDS = new Set([
  '花费',
  '直接成交笔数',
  '直接成交金额',
  '该商品直接成交笔数',
  '该商品直接成交金额',
  '该商品加购数',
  '该商品收藏数',
  '观看人数',
]);

function buildSingleProductRowSignature(row: any): string {
  return SINGLE_PRODUCT_DEDUPE_FIELDS
    .map((field) => {
      if (SINGLE_PRODUCT_NUMERIC_FIELDS.has(field)) {
        return toNum(row?.[field]).toFixed(6);
      }
      return String(row?.[field] ?? '').trim();
    })
    .join('\u001f');
}

export function dedupeSingleProductRows(rows: any[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const signature = buildSingleProductRowSignature(row);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function aggregateSingleByProduct(rows: any[]) {
  const map = new Map<string, Record<string, unknown>>();

  rows.forEach((row) => {
    const productId = String(row['商品id'] ?? '').trim();
    if (!productId) return;

    const existing = map.get(productId) ?? {
      商品id: productId,
      商品名称: String(row['商品名称'] ?? ''),
      img_url: String(row['img_url'] ?? ''),
      花费: 0,
      直接成交笔数: 0,
      直接成交金额: 0,
      该商品直接成交笔数: 0,
      该商品直接成交金额: 0,
      该商品加购数: 0,
      该商品收藏数: 0,
      观看人数: 0,
    };

    existing['花费'] = toNum(existing['花费']) + toNum(row['花费']);
    existing['直接成交笔数'] = toNum(existing['直接成交笔数']) + toNum(row['直接成交笔数']);
    existing['直接成交金额'] = toNum(existing['直接成交金额']) + toNum(row['直接成交金额']);
    existing['该商品直接成交笔数'] = toNum(existing['该商品直接成交笔数']) + toNum(row['该商品直接成交笔数']);
    existing['该商品直接成交金额'] = toNum(existing['该商品直接成交金额']) + toNum(row['该商品直接成交金额']);
    existing['该商品加购数'] = toNum(existing['该商品加购数']) + toNum(row['该商品加购数']);
    existing['该商品收藏数'] = toNum(existing['该商品收藏数']) + toNum(row['该商品收藏数']);
    existing['观看人数'] = toNum(existing['观看人数']) + toNum(row['观看人数']);

    map.set(productId, existing);
  });

  return Array.from(map.values()).sort((left, right) => toNum(right['花费']) - toNum(left['花费']));
}

export function buildSingleKpiPayload(sourceRows: any[], aggregatedRows: Record<string, unknown>[]) {
  const totalCost = aggregatedRows.reduce((sum, row) => sum + toNum(row['花费']), 0);
  const totalDirectAmount = aggregatedRows.reduce((sum, row) => sum + toNum(row['直接成交金额']), 0);
  const totalProductDirectAmount = aggregatedRows.reduce((sum, row) => sum + toNum(row['该商品直接成交金额']), 0);
  const totalCart = aggregatedRows.reduce((sum, row) => sum + toNum(row['该商品加购数']), 0);

  return {
    totalCost,
    totalDirectAmount,
    totalProductDirectAmount,
    totalDirectRoi: totalCost > 0 ? totalDirectAmount / totalCost : 0,
    totalProductDirectRoi: totalCost > 0 ? totalProductDirectAmount / totalCost : 0,
    totalCart,
    avgCartCost: totalCart > 0 ? totalCost / totalCart : 0,
    productCount: aggregatedRows.length,
    sourceRowCount: sourceRows.length,
  };
}

-- 人群手动分层映射表
-- 在 Supabase SQL Editor 中执行此 SQL 即可

CREATE TABLE IF NOT EXISTS audience_layer_mapping (
  audience_name  TEXT PRIMARY KEY,
  layer          TEXT NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT now(),
  updated_by     TEXT
);

-- 允许 anon 角色读取（前端需要展示已有分层）
ALTER TABLE audience_layer_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "所有人可读" ON audience_layer_mapping FOR SELECT USING (true);
CREATE POLICY "认证用户可写入" ON audience_layer_mapping FOR INSERT WITH CHECK (true);
CREATE POLICY "认证用户可更新" ON audience_layer_mapping FOR UPDATE USING (true);
CREATE POLICY "认证用户可删除" ON audience_layer_mapping FOR DELETE USING (true);

COMMENT ON TABLE audience_layer_mapping IS '定向人群 → 分层手动映射，优先于 dashboard-spec.json 自动规则';

-- 创建预测结果表
-- 用于存储 ML 模型的预测结果和后续回填的实际成本

CREATE TABLE IF NOT EXISTS model_predictions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    prediction_date DATE NOT NULL,
    model_version VARCHAR(20) NOT NULL,
    scene_id TEXT,
    scene_name TEXT,
    plan_id TEXT,
    plan_name TEXT,
    audience_name TEXT,
    input_features JSONB,              -- 完整输入参数（用于审计）
    predicted_cost DECIMAL(10,2),      -- 预测的订单成本
    lower_bound DECIMAL(10,2),         -- 置信区间下界
    upper_bound DECIMAL(10,2),         -- 置信区间上界
    actual_cost DECIMAL(10,2),         -- 实际成本（回填时填充）
    prediction_error DECIMAL(10,2),    -- 预测误差 = actual - predicted
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_predictions_date ON model_predictions(prediction_date);
CREATE INDEX IF NOT EXISTS idx_predictions_model ON model_predictions(model_version);
CREATE INDEX IF NOT EXISTS idx_predictions_plan ON model_predictions(plan_id);

-- 添加表注释
COMMENT ON TABLE model_predictions IS 'ML 模型预测结果存储表';
COMMENT ON COLUMN model_predictions.input_features IS '完整输入参数（JSONB 格式，用于审计和回溯）';
COMMENT ON COLUMN model_predictions.predicted_cost IS '预测的订单成本（花费/总成交笔数）';
COMMENT ON COLUMN model_predictions.actual_cost IS '实际成本（数据回填时填充）';
COMMENT ON COLUMN model_predictions.prediction_error IS '预测误差（actual_cost - predicted_cost）';

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticateEdgeRequest } from "../_shared/request-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

serve(async (req: Request) => {
  try {
    // 1. 认证请求
    const authResult = await authenticateEdgeRequest(req);
    if (!authResult.authenticated) {
      return new Response(JSON.stringify({ error: "未授权访问" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // 处理获取场景列表的请求
    if (action === "list_scenes") {
      return await handleListScenes();
    }

    // 处理预测请求（POST）
    if (req.method === "POST") {
      return await handlePrediction(req, authResult);
    }

    return new Response(
      JSON.stringify({ error: "不支持的请求方法" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[成交预测] 服务器错误:", error);
    return new Response(
      JSON.stringify({
        error: "服务器内部错误",
        message: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * 处理预测请求
 */
async function handlePrediction(req: Request, authResult: any) {
  // 解析请求体
  const body = await req.json();
  const { start_date, end_date, crowd_name, scene_id } = body;

  if (!start_date || !end_date) {
    return new Response(
      JSON.stringify({ error: "缺少必要参数：start_date 和 end_date" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  console.log(
    `[成交预测] 开始预测: ${start_date} 至 ${end_date}`
  );

  // 创建 Supabase 客户端
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 从数据库读取投放数据
  const { data: rawData, error: dbError } = await supabase
    .from("super_live_data")
    .select("*")
    .gte("日期", start_date)
    .lte("日期", end_date);

  if (dbError) {
    console.error("[成交预测] 数据库查询错误:", dbError);
    return new Response(
      JSON.stringify({ error: "数据库查询失败", message: dbError.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  if (!rawData || rawData.length === 0) {
    return new Response(
      JSON.stringify({
        error: "没有找到数据",
        message: "在指定日期范围内没有找到投放数据",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  console.log(`[成交预测] 获取到 ${rawData.length} 行原始数据`);

  // 调用本地Python API进行预测
  const localApiUrl = Deno.env.get("PREDICTION_API_URL") || "http://host.docker.internal:8000/predict";
  
  console.log(`[成交预测] 调用本地API: ${localApiUrl}`);

  try {
    const apiResponse = await fetch(localApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date,
        end_date,
        crowd_name,
        scene_id,
      }),
    });

    if (!apiResponse.ok) {
      throw new Error(`本地API返回错误: ${apiResponse.status}`);
    }

    const apiResult = await apiResponse.json();
    
    if (!apiResult.success) {
      return new Response(
        JSON.stringify({
          error: "预测失败",
          message: apiResult.error || "未知错误",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 存储预测结果到数据库
    await savePredictions(supabase, apiResult.predictions);

    return new Response(
      JSON.stringify({
        success: true,
        predictions: apiResult.predictions,
        count: apiResult.count,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[成交预测] 调用本地API失败:", error);
    
    // 降级到简化规则引擎
    console.log("[成交预测] 降级使用简化规则引擎");
    const predictions = await runPredictionModel(rawData);
    await savePredictions(supabase, predictions);
    
    return new Response(
      JSON.stringify({
        success: true,
        predictions,
        count: predictions.length,
        warning: "本地API不可用，使用简化规则引擎",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * 运行预测模型（简化版本）
 * 生产环境应调用 Python 模型
 */
async function runPredictionModel(data: any[]) {
  console.log("[成交预测] 开始运行预测模型...");

  // TODO: 调用 Python 模型
  // 当前使用简化的规则引擎作为演示

  const predictions = data.map((row) => {
    // 简化规则：基于历史转化率估算成交概率
    const views = row.观看次数 || 0;
    const orders = row.总成交笔数 || 0;
    const spend = row.花费 || 0;

    // 计算历史转化率
    const convRate = views > 0 ? orders / views : 0;

    // 简化估算成交概率（实际应使用 LightGBM 分类模型）
    const convProbability = Math.min(convRate * 10, 0.95);

    // 计算订单成本（实际应使用 LightGBM 回归模型）
    const orderCost = orders > 0 ? spend / orders : 15.0;

    // 最终预测成本 = 成交概率 × 订单成本
    const finalCost = convProbability * orderCost;

    // 置信区间（简化）
    const margin = orderCost * 0.2;

    return {
      prediction_date: row.日期,
      scene_id: row.场景ID,
      scene_name: row.场景名字,
      audience_name: row.人群名字,
      conv_probability: parseFloat(convProbability.toFixed(4)),
      predicted_cost: parseFloat(orderCost.toFixed(2)),
      final_cost: parseFloat(finalCost.toFixed(2)),
      lower_bound: parseFloat(Math.max(0, orderCost - margin).toFixed(2)),
      upper_bound: parseFloat((orderCost + margin).toFixed(2)),
      model_version: "v0.4.0-rule-based",
    };
  });

  console.log(`[成交预测] 生成 ${predictions.length} 条预测结果`);

  return predictions;
}

/**
 * 存储预测结果到数据库
 */
async function savePredictions(supabase: any, predictions: any[]) {
  console.log("[成交预测] 存储预测结果到数据库...");

  // 批量插入（每次最多100条）
  const batchSize = 100;
  for (let i = 0; i < predictions.length; i += batchSize) {
    const batch = predictions.slice(i, i + batchSize);

    const insertData = batch.map((pred) => ({
      prediction_date: pred.prediction_date,
      model_version: pred.model_version,
      scene_id: pred.scene_id,
      scene_name: pred.scene_name,
      audience_name: pred.audience_name,
      input_features: JSON.stringify({
        conv_probability: pred.conv_probability,
      }),
      predicted_cost: pred.predicted_cost,
      lower_bound: pred.lower_bound,
      upper_bound: pred.upper_bound,
    }));

    const { error } = await supabase
      .from("model_predictions")
      .insert(insertData);

    if (error) {
      console.error("[成交预测] 插入预测结果失败:", error);
      // 不阻断流程，继续返回结果
    }
  }

  console.log("[成交预测] 预测结果存储完成");
}

/**
 * 获取场景列表
 */
async function handleListScenes() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from("super_live_data")
    .select("场景ID, 场景名字")
    .order("场景ID");

  if (error) {
    console.error("[成交预测] 查询场景列表失败:", error);
    return new Response(
      JSON.stringify({ error: "查询场景列表失败", message: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 去重
  const uniqueScenes = [];
  const seen = new Set();

  if (data) {
    for (const row of data) {
      if (!seen.has(row.场景ID)) {
        seen.add(row.场景ID);
        uniqueScenes.push({
          id: row.场景ID,
          name: row.场景名字,
        });
      }
    }
  }

  return new Response(
    JSON.stringify({ scenes: uniqueScenes }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

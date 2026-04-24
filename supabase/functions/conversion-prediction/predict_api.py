#!/usr/bin/env python3
"""
成交预测 - Python模型推理接口
供Edge Function调用，执行实际的LightGBM模型预测
"""

import json
import logging
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent / "ad-cost-predictor" / "src"))

from src.config import config
from src.predictor import predict_batch, load_model
from src.data_reader import read_from_csv_fallback

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_prediction(
    start_date: str,
    end_date: str,
    csv_dir: str,
    model_path: str,
    crowd_name: str = None,
    scene_id: str = None,
) -> dict:
    """
    执行批量预测

    Args:
        start_date: 开始日期 YYYY-MM-DD
        end_date: 结束日期 YYYY-MM-DD
        csv_dir: CSV数据目录
        model_path: 模型文件路径
        crowd_name: 人群名称筛选（可选）
        scene_id: 场景ID筛选（可选）

    Returns:
        预测结果字典
    """
    logger.info(f"开始预测: {start_date} 至 {end_date}")

    # 1. 读取数据
    df = read_from_csv_fallback(csv_dir, start_date, end_date)
    logger.info(f"读取到 {len(df)} 行原始数据")

    # 2. 应用筛选条件
    if crowd_name:
        df = df[df["人群名字"].str.contains(crowd_name, na=False)]
        logger.info(f"人群筛选后: {len(df)} 行")

    if scene_id:
        df = df[df["场景ID"] == scene_id]
        logger.info(f"场景筛选后: {len(df)} 行")

    if len(df) == 0:
        return {"error": "筛选后没有数据", "predictions": []}

    # 3. 加载模型
    model = load_model(model_path)
    logger.info(f"加载模型: {model_path}")

    # 4. 批量预测
    predictions = predict_batch(df, model, config)
    logger.info(f"生成 {len(predictions)} 条预测结果")

    # 5. 合并结果
    result_df = pd.concat([df.reset_index(drop=True), predictions], axis=1)

    # 6. 计算最终成本
    result_df["final_cost"] = (
        result_df["conv_probability"] * result_df["predicted_cost"]
    )

    # 7. 转换为字典列表
    predictions_list = []
    for _, row in result_df.iterrows():
        pred = {
            "prediction_date": row.get("日期", "").strftime("%Y-%m-%d")
            if pd.notna(row.get("日期"))
            else "",
            "scene_id": row.get("场景ID", ""),
            "scene_name": row.get("场景名字", ""),
            "audience_name": row.get("人群名字", ""),
            "conv_probability": round(float(row.get("conv_probability", 0)), 4),
            "predicted_cost": round(float(row.get("predicted_cost", 0)), 2),
            "final_cost": round(float(row.get("final_cost", 0)), 2),
            "lower_bound": round(float(row.get("lower_bound", 0)), 2),
            "upper_bound": round(float(row.get("upper_bound", 0)), 2),
            "model_version": "v0.4.0",
        }
        predictions_list.append(pred)

    logger.info(f"预测完成，返回 {len(predictions_list)} 条结果")

    return {
        "success": True,
        "predictions": predictions_list,
        "count": len(predictions_list),
    }


def main():
    """命令行入口"""
    if len(sys.argv) < 4:
        print(
            "用法: python predict_api.py <start_date> <end_date> <csv_dir> [model_path] [crowd_name] [scene_id]"
        )
        sys.exit(1)

    start_date = sys.argv[1]
    end_date = sys.argv[2]
    csv_dir = sys.argv[3]
    model_path = (
        sys.argv[4]
        if len(sys.argv) > 4
        else "/Users/zhouhao/Desktop/ad-cost-predictor/models/latest.pkl"
    )
    crowd_name = sys.argv[5] if len(sys.argv) > 5 else None
    scene_id = sys.argv[6] if len(sys.argv) > 6 else None

    result = run_prediction(
        start_date, end_date, csv_dir, model_path, crowd_name, scene_id
    )

    # 输出JSON结果
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

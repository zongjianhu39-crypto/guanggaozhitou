#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
核对 2026-05-01 ~ 2026-05-22 万相台口径花费拆分。
用途：验证日报「万相台花费」556.1万 = 超级直播(super_live) + 短直联动(short_live_link) 的假设。

运行：  python3 verify_wanxiang_cost.py
（首次运行会自动安装 psycopg2-binary）
"""
import subprocess, sys

try:
    import psycopg2
except ImportError:
    print("正在安装 psycopg2-binary ...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary"])
    import psycopg2

REF = "qjscsikithbxuxmjyjsp"
PWD = "WsSZi4M13FMhYIse"
START, END = "2026-05-01", "2026-05-22"

# 依次尝试：直连 + 各区域 pooler
CANDIDATES = [
    (f"db.{REF}.supabase.co", 5432, "postgres"),
    ("aws-0-us-east-1.pooler.supabase.com", 6543, f"postgres.{REF}"),
    ("aws-0-us-east-1.pooler.supabase.com", 5432, f"postgres.{REF}"),
    ("aws-0-ap-southeast-1.pooler.supabase.com", 6543, f"postgres.{REF}"),
    ("aws-0-ap-northeast-1.pooler.supabase.com", 6543, f"postgres.{REF}"),
    ("aws-0-eu-central-1.pooler.supabase.com", 6543, f"postgres.{REF}"),
]

def connect():
    last = None
    for host, port, user in CANDIDATES:
        try:
            c = psycopg2.connect(host=host, port=port, dbname="postgres",
                                 user=user, password=PWD, connect_timeout=10,
                                 sslmode="require")
            print(f"已连接: {host}:{port} ({user})\n")
            return c
        except Exception as e:
            last = e
            print(f"连接失败 {host}:{port} -> {str(e)[:90]}")
    raise SystemExit(f"\n所有连接方式都失败，请检查网络/密码。最后错误: {last}")

def scalar(cur, sql):
    cur.execute(sql)
    v = cur.fetchone()[0]
    return float(v or 0)

def main():
    conn = connect()
    cur = conn.cursor()
    w = f"\"日期\" between '{START}' and '{END}'"

    super_cost = scalar(cur, f"""select sum(public.dashboard_to_numeric("花费"::text))
                                 from public.dashboard_src_super_live where {w}""")
    short_cost = scalar(cur, f"""select sum(public.dashboard_to_numeric("花费"::text))
                                 from public.dashboard_src_short_live_link where {w}""")
    summary_cost = scalar(cur, f"""select sum(public.dashboard_to_numeric("花费"::text))
                                   from public.dashboard_ads_daily_summary where {w}""")

    def wan(x):  # 转“万”
        return f"{x/10000:,.1f}万 ({x:,.0f})"

    print("=" * 60)
    print(f"区间: {START} ~ {END}")
    print("-" * 60)
    print(f"超级直播 super_live 花费 : {wan(super_cost)}")
    print(f"短直联动 short_live 花费 : {wan(short_cost)}")
    print(f"两者相加                : {wan(super_cost + short_cost)}")
    print(f"汇总表 ads_summary 花费  : {wan(summary_cost)}  <- 日报实际读取值")
    print("=" * 60)
    print("\n判断：")
    print(f"  · 若你认为万相台应=363.3万，对应的就是 super_live 单独 = {wan(super_cost)}")
    print(f"  · 短直联动 = {wan(short_cost)} 是这次被并进日报的部分")
    conn.close()

if __name__ == "__main__":
    main()

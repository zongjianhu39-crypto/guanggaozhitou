#!/usr/bin/env python3
"""FTP 部署脚本 — Python 版，替代 lftp，零依赖
用法: python3 scripts/deploy_ftp.py [--dry-run]
"""
import ftplib
import os
import sys
import time
import json
import re
from pathlib import Path

# ── 配置 ──────────────────────────────────────────────
LOCAL_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = LOCAL_DIR / "scripts" / ".deploy.env"
MAX_RETRIES = 3
RETRY_DELAY = 10
DRY_RUN = "--dry-run" in sys.argv

# 部署版本号
DEPLOY_VERSION = time.strftime("%Y%m%d%H%M")

# 排除的目录和文件后缀
EXCLUDE_DIRS = {".git", ".github", ".gitee", ".claude", "node_modules", "supabase", "scripts", "tools", "__pycache__", "docs"}
EXCLUDE_SUFFIXES = {".ts", ".map", ".pyc", ".py", ".md"}
EXCLUDE_FILES = {"tsconfig.json", "package.json", "package-lock.json", ".deploy.env", "deploy_ftp.py", "CHANGELOG.md", "test-genbi-query.js"}

# ── 加载环境变量 ────────────────────────────────────────
def load_env(path):
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env

env = load_env(ENV_FILE)
FTP_HOST = env.get("FTP_HOST", "")
FTP_USER = env.get("FTP_USER", "")
FTP_PASS = env.get("FTP_PASS", "")
REMOTE_ROOT = env.get("REMOTE_ROOT", "/wwwroot")
SITE_URL = env.get("SITE_URL", "https://www.friends.wang")

if not all([FTP_HOST, FTP_USER, FTP_PASS]):
    print("❌ 缺少 FTP 凭证，请检查 scripts/.deploy.env")
    sys.exit(1)

# ── 收集需部署的文件 ─────────────────────────────────────
def collect_files():
    """收集所有需要部署的文件（相对路径）"""
    files = []
    for root, dirs, filenames in os.walk(LOCAL_DIR):
        # 过滤排除目录
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for fname in filenames:
            fpath = Path(root) / fname
            rel = fpath.relative_to(LOCAL_DIR)
            # 跳过排除后缀和文件
            if rel.suffix in EXCLUDE_SUFFIXES:
                continue
            if fname in EXCLUDE_FILES:
                continue
            if fname.startswith(".") and fname != ".htaccess":
                continue
            files.append(str(rel))
    return sorted(files)

# ── FTP 操作 ──────────────────────────────────────────
def ftp_connect():
    """连接 FTP 服务器"""
    ftp = ftplib.FTP()
    ftp.encoding = "gbk"  # 国内虚拟主机常返回 GBK 编码的欢迎消息
    ftp.connect(FTP_HOST, 21, timeout=30)
    ftp.login(FTP_USER, FTP_PASS)
    ftp.set_pasv(True)
    return ftp

def ftp_ensure_dir(ftp, remote_dir):
    """递归创建远程目录"""
    dirs = remote_dir.strip("/").split("/")
    current = ""
    for d in dirs:
        current += "/" + d
        try:
            ftp.cwd(current)
        except ftplib.error_perm:
            try:
                ftp.mkd(current)
                ftp.cwd(current)
            except ftplib.error_perm:
                pass  # 可能已存在

def upload_file(ftp, local_path, remote_path):
    """上传单个文件"""
    with open(local_path, "rb") as f:
        ftp.storbinary(f"STOR {remote_path}", f, blocksize=8192)

# ── 版本号注入 ─────────────────────────────────────────
def inject_versions():
    """替换 HTML/JS 中的 ?v= 缓存破坏参数"""
    if DRY_RUN:
        print("  [dry-run] 跳过版本号注入")
        return
    print(f"  注入部署版本号 {DEPLOY_VERSION}...")
    count = 0
    for pattern in ["**/*.html", "dashboard.js"]:
        for fpath in LOCAL_DIR.glob(pattern):
            if fpath.is_file():
                try:
                    content = fpath.read_text(encoding="utf-8")
                    new_content = re.sub(r'\?v=[a-zA-Z0-9]+', f'?v={DEPLOY_VERSION}', content)
                    if content != new_content:
                        fpath.write_text(new_content, encoding="utf-8")
                        count += 1
                except Exception:
                    pass
    print(f"  版本号注入完成 ({count} 个文件)")

# ── 验证 ───────────────────────────────────────────────
def verify_online(files):
    """在线验证部署结果"""
    import urllib.request
    print("\n===== 在线验证 =====")
    failed = []
    for rel in files:
        url = f"{SITE_URL}/{rel}"
        try:
            req = urllib.request.Request(url, method="HEAD")
            resp = urllib.request.urlopen(req, timeout=10)
            code = resp.getcode()
            if code in (200, 204, 301, 302, 304):
                print(f"  ✓ {rel:<40} {code}")
            else:
                print(f"  ✗ {rel:<40} {code}")
                failed.append(rel)
        except Exception as e:
            print(f"  ✗ {rel:<40} ERR {e}")
            failed.append(rel)
    return failed

# ── 主流程 ─────────────────────────────────────────────
def main():
    files = collect_files()
    print(f"🚀 部署到 {FTP_HOST}{REMOTE_ROOT}")
    print(f"   本地目录: {LOCAL_DIR}")
    print(f"   文件数量: {len(files)}")
    print(f"   部署版本: {DEPLOY_VERSION}")
    if DRY_RUN:
        print("   *** DRY RUN 模式 ***")
    print()

    # 版本号注入
    inject_versions()
    print()

    # 连接 FTP
    if DRY_RUN:
        for f in files:
            print(f"  [dry-run] {f} -> {REMOTE_ROOT}/{f}")
        print(f"\n共 {len(files)} 个文件待部署（dry-run 模式，未实际上传）")
        return

    ftp = None
    succeeded = []
    failed = []

    try:
        print("连接 FTP 服务器...")
        ftp = ftp_connect()
        print(f"✓ 已连接 ({ftp.getwelcome().strip()})")
        print()

        for i, rel in enumerate(files, 1):
            local_path = LOCAL_DIR / rel
            if not local_path.exists():
                print(f"  ⚠ {rel} (本地不存在，跳过)")
                continue

            remote_dir = REMOTE_ROOT + "/" + str(Path(rel).parent)
            remote_dir = remote_dir.rstrip("/.")

            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    ftp_ensure_dir(ftp, remote_dir)
                    ftp.cwd("/")  # 回到根目录
                    remote_file = REMOTE_ROOT + "/" + rel
                    upload_file(ftp, str(local_path), remote_file)
                    print(f"  ✓ [{i}/{len(files)}] {rel}")
                    succeeded.append(rel)
                    break
                except Exception as e:
                    print(f"  ✗ [{i}/{len(files)}] {rel} (尝试 {attempt}/{MAX_RETRIES}: {e})")
                    if attempt < MAX_RETRIES:
                        time.sleep(RETRY_DELAY)
                        try:
                            ftp.quit()
                        except:
                            pass
                        try:
                            ftp = ftp_connect()
                        except:
                            pass
                    else:
                        failed.append(rel)

    except KeyboardInterrupt:
        print("\n⚠ 用户中断")
    finally:
        if ftp:
            try:
                ftp.quit()
            except:
                pass

    # 结果汇总
    print()
    print("===== 上传结果 =====")
    print(f"成功: {len(succeeded)}/{len(files)}")
    if failed:
        print(f"失败: {len(failed)} — {failed}")

    # 在线验证
    if succeeded and not failed:
        verify_failed = verify_online(succeeded)
        if verify_failed:
            print(f"\n⚠ 以下文件验证失败: {verify_failed}")
            sys.exit(1)
        else:
            print("\n✅ 全部文件验证通过！网站部署成功。")
    elif failed:
        sys.exit(1)

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""FTP 部署脚本 — Python 版，替代 lftp，零依赖
用法: python3 scripts/deploy_ftp.py [--dry-run] [--force] [--skip-verify]

选项:
  --dry-run       模拟运行，不实际上传
  --force         强制全量上传（跳过增量对比）
  --skip-verify   跳过在线验证
"""
import ftplib
import os
import sys
import time
import re
import subprocess
from pathlib import Path
from io import BytesIO

# ── 配置 ──────────────────────────────────────────────
LOCAL_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = LOCAL_DIR / "scripts" / ".deploy.env"
MAX_RETRIES = 3
RETRY_DELAY = 10
DRY_RUN = "--dry-run" in sys.argv
FORCE_UPLOAD = "--force" in sys.argv
SKIP_VERIFY = "--skip-verify" in sys.argv

# 部署版本号
DEPLOY_VERSION = time.strftime("%Y%m%d%H%M")

# 排除的目录和文件后缀
EXCLUDE_DIRS = {".git", ".github", ".gitee", ".claude", "node_modules", "supabase", "scripts", "tools", "__pycache__", "docs"}
EXCLUDE_SUFFIXES = {".ts", ".map", ".pyc", ".py", ".md"}
EXCLUDE_FILES = {"tsconfig.json", "package.json", "package-lock.json", ".deploy.env", "deploy_ftp.py", "CHANGELOG.md", "test-genbi-query.js"}

# 在线验证的关键文件
VERIFY_FILES = ["index.html", "script.js", "style.css"]

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

def get_remote_size(ftp, remote_path):
    """获取远程文件大小，不存在则返回 -1"""
    try:
        return ftp.size(remote_path)
    except Exception:
        return -1

def upload_file(ftp, local_path, remote_path):
    """上传单个文件，对 HTML/JS 自动注入版本号"""
    suffix = Path(local_path).suffix
    name = Path(local_path).name

    # 对 HTML 和特定 JS 文件在内存中替换版本号
    if suffix == '.html' or name == 'dashboard.js':
        content = Path(local_path).read_bytes()
        try:
            text = content.decode('utf-8')
            text = re.sub(r'\?v=[a-zA-Z0-9]+', f'?v={DEPLOY_VERSION}', text)
            content = text.encode('utf-8')
        except UnicodeDecodeError:
            print(f"  ⚠ {name} 编码异常，跳过版本号注入")
        ftp.storbinary(f"STOR {remote_path}", BytesIO(content), blocksize=8192)
    else:
        with open(local_path, "rb") as f:
            ftp.storbinary(f"STOR {remote_path}", f, blocksize=8192)

# ── 代理检测 ─────────────────────────────────────────
def get_proxy_url():
    """获取系统代理地址，优先级：环境变量 > scutil > 硬编码 fallback"""
    # 1. 环境变量
    proxy = os.environ.get("https_proxy") or os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY") or os.environ.get("HTTPS_PROXY")
    if proxy:
        return proxy

    # 2. scutil --proxy 动态获取
    try:
        result = subprocess.run(["scutil", "--proxy"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            output = result.stdout
            # 解析 HTTPSEnable/HTTPEnable 和端口
            https_enabled = re.search(r'HTTPSEnable\s*:\s*1', output)
            http_enabled = re.search(r'HTTPEnable\s*:\s*1', output)
            if https_enabled:
                port_match = re.search(r'HTTPSPort\s*:\s*(\d+)', output)
                if port_match:
                    return f"http://127.0.0.1:{port_match.group(1)}"
            if http_enabled:
                port_match = re.search(r'HTTPPort\s*:\s*(\d+)', output)
                if port_match:
                    return f"http://127.0.0.1:{port_match.group(1)}"
    except Exception:
        pass

    # 3. 硬编码 fallback
    return "http://127.0.0.1:7897"

# ── 验证 ───────────────────────────────────────────────
def verify_online():
    """在线验证部署结果（仅验证关键文件）"""
    print("\n===== 在线验证 =====")
    proxy_url = get_proxy_url()
    print(f"  使用代理: {proxy_url}")

    failed = []
    for rel in VERIFY_FILES:
        url = f"{SITE_URL}/{rel}"
        try:
            result = subprocess.run(
                ["curl", "-sI", "--proxy", proxy_url, "--max-time", "10", url],
                capture_output=True, text=True, timeout=15
            )
            output = result.stdout
            if "HTTP/1.1 200" in output or "HTTP/2 200" in output:
                print(f"  ✓ {rel:<40} 200")
            else:
                # 尝试提取状态码
                status_match = re.search(r'HTTP/[\d.]+ (\d+)', output)
                code = status_match.group(1) if status_match else "UNKNOWN"
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
    print(f"   部署模式: {'全量' if FORCE_UPLOAD else '增量'}")
    if DRY_RUN:
        print("   *** DRY RUN 模式 ***")
    if SKIP_VERIFY:
        print("   *** 跳过在线验证 ***")
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
    skipped = []

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

            remote_file = REMOTE_ROOT + "/" + rel

            # 增量对比：比较文件大小
            if not FORCE_UPLOAD:
                local_size = local_path.stat().st_size
                remote_size = get_remote_size(ftp, remote_file)
                if remote_size == local_size and local_size >= 0:
                    skipped.append(rel)
                    continue

            remote_dir = REMOTE_ROOT + "/" + str(Path(rel).parent)
            remote_dir = remote_dir.rstrip("/.")

            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    ftp_ensure_dir(ftp, remote_dir)
                    ftp.cwd("/")  # 回到根目录
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
                        except Exception:
                            print(f"  ⚠ FTP 断开连接异常，忽略")
                        try:
                            ftp = ftp_connect()
                        except Exception as e2:
                            print(f"  ⚠ FTP 重连失败: {e2}")
                    else:
                        failed.append(rel)

    except KeyboardInterrupt:
        print("\n⚠ 用户中断")
    finally:
        if ftp:
            try:
                ftp.quit()
            except Exception:
                pass

    # 结果汇总
    print()
    print("===== 上传结果 =====")
    print(f"上传: {len(succeeded)} 个变更文件")
    if skipped:
        print(f"跳过: {len(skipped)} 个未变文件")
    if failed:
        print(f"失败: {len(failed)} — {failed}")

    # 在线验证
    if SKIP_VERIFY:
        print("\n⏭ 已跳过在线验证")
    elif succeeded and not failed:
        verify_failed = verify_online()
        if verify_failed:
            print(f"\n⚠ 以下文件验证失败: {verify_failed}")
            sys.exit(1)
        else:
            print("\n✅ 全部文件验证通过！网站部署成功。")
    elif not succeeded and not failed and skipped:
        print("\n✅ 所有文件均为最新，无需上传。")
    elif failed:
        sys.exit(1)

if __name__ == "__main__":
    main()

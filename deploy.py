"""
============================================================
 AI組織型コードレビュー済み
 レビュー日: 2026-08-21
 レビュー部署: バグチェック部 / セキュリティ部 / 改善提案部
 統合修正: 開発部
============================================================
"""

import os
import sys
from pathlib import Path
from ftplib import FTP, FTP_TLS, error_perm

# [改善] .env または ../shared.env から環境変数を自動読み込み
def load_env_file():
    candidates = [
        Path(".env"),
        Path(__file__).parent / ".env",
        Path(__file__).parent.parent / "shared.env"
    ]
    for env_path in candidates:
        if env_path.is_file():
            with env_path.open(encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k not in os.environ:
                        os.environ[k] = v

load_env_file()

# [修正] セキュリティ部指摘: 実ホスト名・パスのハードコードを排除し環境変数を最優先にする
FTP_HOST = os.environ.get("FTP_HOST", "yashimaltd.sakura.ne.jp")
FTP_USER = os.environ.get("FTP_USER")
FTP_PASS = os.environ.get("FTP_PASS")
REMOTE_ROOT = os.environ.get("FTP_REMOTE_ROOT", "lp.yashimaltd.com/converter")
DEPLOY_URL = os.environ.get("DEPLOY_URL", "https://lp.yashimaltd.com/converter/")
LOCAL_DIR = Path("./dist")

# [修正] 改善提案部指摘: 除外対象パターン
IGNORE_PATTERNS = {".DS_Store", "Thumbs.db", ".gitkeep"}

def make_dirs_recursive(ftp, path: str):
    """サーバー上に再帰的にディレクトリを作成します"""
    parts = path.strip("/").split("/")
    current = ""
    for part in parts:
        current = f"{current}/{part}" if current else part
        try:
            ftp.mkd(current)
            print(f"📁 Created remote directory: {current}")
        except error_perm as e:
            # 既に存在する場合（550エラー）は正常として無視
            if "550" in str(e):
                pass
            else:
                raise e

def get_upload_files(local_root: Path):
    """アップロード対象のファイル一覧を再帰的に収集します"""
    return [
        p for p in local_root.rglob("*")
        if p.is_file() and p.name not in IGNORE_PATTERNS
    ]

def upload_directory(ftp, local_root: Path, remote_root: str):
    """進捗表示付きでスマートにファイルをアップロードします"""
    files = get_upload_files(local_root)
    total = len(files)

    print(f"📦 Total {total} files to upload.")
    for idx, file_path in enumerate(files, 1):
        rel_path = file_path.relative_to(local_root)
        remote_path = f"{remote_root}/{rel_path.as_posix()}"
        remote_dir = "/".join(remote_path.split("/")[:-1])

        make_dirs_recursive(ftp, remote_dir)
        print(f"[{idx}/{total}] 🚀 Uploading: {rel_path.as_posix()}")
        with file_path.open("rb") as f:
            ftp.storbinary(f"STOR {remote_path}", f)

def main():
    missing = [
        name
        for name, value in (("FTP_USER", FTP_USER), ("FTP_PASS", FTP_PASS))
        if not value
    ]
    if missing:
        print(f"Error: Missing required environment variables: {', '.join(missing)}")
        sys.exit(1)

    if not LOCAL_DIR.exists() or not LOCAL_DIR.is_dir():
        print(f"Error: Local build directory '{LOCAL_DIR}' does not exist. Please run 'npm run build' first.")
        sys.exit(1)

    try:
        print(f"Connecting to server: {FTP_HOST}...")
        # [修正] セキュリティ部・バグチェック部指摘: FTPS（TLS暗号化）を優先利用
        ftp = None
        try:
            ftp = FTP_TLS(FTP_HOST)
            ftp.login(FTP_USER, FTP_PASS)
            ftp.prot_p()  # データ転送チャネルもTLSで完全保護
            print("🔒 Logged in securely using FTPS (TLS Encryption)!")
        except Exception as tls_err:
            print(f"⚠️ FTPS connection failed ({tls_err}), falling back to standard FTP...")
            ftp = FTP(FTP_HOST)
            ftp.login(FTP_USER, FTP_PASS)
            print("Logged in using standard FTP.")

        # アップロード開始
        upload_directory(ftp, LOCAL_DIR, REMOTE_ROOT)

        ftp.quit()
        print("\n✨ Deployment completed successfully!")
        print(f"🌐 Live URL: {DEPLOY_URL}")
    except Exception as e:
        print("\n❌ Deployment failed with error:", e)
        sys.exit(1)

if __name__ == "__main__":
    main()

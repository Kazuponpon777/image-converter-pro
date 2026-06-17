import os
import sys
from ftplib import FTP, error_perm

FTP_HOST = "yashimaltd.sakura.ne.jp"
FTP_USER = "ftp_yashima@yashimaltd.com"
FTP_PASS = "adlae3dEdaad3d"
REMOTE_ROOT = "lp.yashimaltd.com/converter"
LOCAL_DIR = "./dist"

def make_dirs_recursive(ftp, path):
    """さくらサーバー上に再帰的にディレクトリを作成します"""
    parts = path.strip("/").split("/")
    current = ""
    for part in parts:
        current = f"{current}/{part}" if current else part
        try:
            ftp.mkd(current)
            print(f"Created remote directory: {current}")
        except error_perm as e:
            # 既に存在する場合は無視
            if "550" in str(e):
                pass
            else:
                raise e

def upload_directory(ftp, local_dir, remote_dir):
    """ローカルのディレクトリを再帰的にFTPサーバーへアップロードします"""
    make_dirs_recursive(ftp, remote_dir)
    
    for item in os.listdir(local_dir):
        local_path = os.path.join(local_dir, item)
        remote_path = f"{remote_dir}/{item}"
        
        if os.path.isdir(local_path):
            upload_directory(ftp, local_path, remote_path)
        else:
            print(f"Uploading: {local_path} -> {remote_path}")
            with open(local_path, "rb") as f:
                ftp.storbinary(f"STOR {remote_path}", f)

def main():
    if not os.path.exists(LOCAL_DIR):
        print(f"Error: Local build directory '{LOCAL_DIR}' does not exist. Please run 'npm run build' first.")
        sys.exit(1)
        
    try:
        print(f"Connecting to FTP server: {FTP_HOST}...")
        ftp = FTP(FTP_HOST)
        ftp.login(FTP_USER, FTP_PASS)
        print("Logged in successfully!")
        
        # アップロード開始
        upload_directory(ftp, LOCAL_DIR, REMOTE_ROOT)
        
        ftp.quit()
        print("\nDeployment completed successfully!")
        print(f"URL: http://lp.yashimaltd.com/converter/")
    except Exception as e:
        print("\nDeployment failed with error:", e)
        sys.exit(1)

if __name__ == "__main__":
    main()

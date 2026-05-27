#!/bin/bash
# Barber Pro - One-command deploy
# Run as root on a fresh Ubuntu 24.04 VPS

set -e

echo "=== Barber Pro Deploy ==="

# Update system
apt update && apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git

# Create app directory
mkdir -p /opt/barber-pro
cd /opt/barber-pro

# Download the app (you'll need to upload your code)
# Option A: If you have a git repo:
# git clone YOUR_REPO_URL .

# Option B: Copy from your local machine:
# scp -r /home/erden/barber-system/* root@YOUR_IP:/opt/barber-pro/

echo "If you haven't uploaded your code yet, do:"
echo "  scp -r /home/erden/barber-system/* root@159.223.49.1:/opt/barber-pro/"
echo ""
echo "Then run:"
echo "  cd /opt/barber-pro && npm install"

# Install dependencies (runs when code is present)
cd /opt/barber-pro && npm install --production 2>/dev/null || true

# Create systemd service
cat > /etc/systemd/system/barber-pro.service << 'SERVICE'
[Unit]
Description=Barber Pro
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/barber-pro
Environment=TZ=Asia/Ulaanbaatar
Environment=PORT=3000
ExecStart=/usr/bin/node /opt/barber-pro/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

# Start the service
systemctl daemon-reload
systemctl enable barber-pro
systemctl start barber-pro

echo ""
echo "=== Done ==="
echo "Server running at: http://159.223.49.1:3000"
echo "Admin login: http://159.223.49.1:3000/admin-login?slug=barber-pro"
echo "Demo password: admin123"
echo ""
echo "Check status: systemctl status barber-pro"
echo "View logs: journalctl -u barber-pro -f"

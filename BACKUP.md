Backup manifest — barberpro-mn.duckdns.org
Date: 2026-06-01
Git tag: v1.2-pre-queue-section

== Files backed up in git ==
- public/ (landing.html, admin.html, queue.html, barber-queue.html, booking3.html, etc.)
- server.js (in repo — deployed version has extra changes)
- prototype-premium.html (landing page source)
- All HTML, CSS, JS, blog content

== Files backed up via SCP (vps-backup/) ==
- server.js (deployed version with Cache-Control headers + 5mb limit + plan column migration)
- barber.db (SQLite database — customer data, shops, queues)
- deploy.sh (custom deploy script)
- package.json

== VPS environment ==
- Ubuntu 24.04.4 LTS
- Node.js v22.22.2
- nginx reverse proxy → localhost:3000
- SSL: Let's Encrypt (Certbot)
- Domain: barberpro-mn.duckdns.org
- Database: SQLite at /opt/barber-pro/barber.db
- Service: systemctl restart barber-pro

== To restore ==
1. git clone + git checkout v1.2-pre-queue-section
2. Copy server.js from vps-backup/ over the repo version
3. npm install
4. Copy barber.db to /opt/barber-pro/
5. systemctl restart barber-pro

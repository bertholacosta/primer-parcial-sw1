#!/usr/bin/env bash
set -euo pipefail

# Ejecutar como root en Ubuntu 24.04 luego de copiar el repositorio a /opt/case.
case_root=/opt/case
if [[ $(id -u) -ne 0 ]]; then
  echo "Ejecutar como root" >&2
  exit 1
fi
if [[ ! -f "$case_root/deploy/aws/compose.yaml" || ! -f "$case_root/apps/case-web/dist/index.html" ]]; then
  echo "Falta el paquete de despliegue en $case_root" >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg openssl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

token=$(curl -fsS -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token)
public_ip=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/public-ipv4)
site_domain="${public_ip//./-}.sslip.io"
env_file="$case_root/deploy/aws/.env"
if [[ ! -e "$env_file" ]]; then
  umask 077
  cat >"$env_file" <<EOF
SITE_DOMAIN=$site_domain
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
EOF
fi
chmod 600 "$env_file"

cd "$case_root/deploy/aws"
docker compose --env-file .env up --build -d
docker compose --env-file .env ps

# Detener la instancia transcurridos 15 días, incluso si se reinicia durante la prueba.
expires_at=$(date -u -d '+15 days' '+%Y-%m-%d %H:%M:%S UTC')
cat >/etc/systemd/system/case-expiry.service <<'EOF'
[Unit]
Description=Stop temporary CASE EC2 instance

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl poweroff
EOF
cat >/etc/systemd/system/case-expiry.timer <<EOF
[Unit]
Description=Stop temporary CASE EC2 instance after 15 days

[Timer]
OnCalendar=$expires_at
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now case-expiry.timer
systemctl list-timers case-expiry.timer --no-pager
echo "URL: https://$site_domain"

#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# Content Creator Hub — Deploy
#
# Usage:
#   ./scripts/deploy.sh              # Build, start, auto-migrate, seed on first run
#   ./scripts/deploy.sh --ssl        # Also provision SSL cert (first deploy)
#   ./scripts/deploy.sh --migrate    # Force schema push even if already seeded
#
# First deploy:  ./scripts/deploy.sh --ssl
# Subsequent:    ./scripts/deploy.sh
#
# Handles:
#   - Nginx config generation from template (no domain in tracked code)
#   - SSL certificate provisioning (Let's Encrypt)
#   - Docker image builds
#   - Service startup with health checks
#   - Database schema push (always on first run, or with --migrate)
#   - Seeding (first run only — tracked by .seed_completed marker)
# ═══════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1" >&2; }

SETUP_SSL=false
MIGRATE=false

for arg in "$@"; do
  case "$arg" in
    --ssl)      SETUP_SSL=true ;;
    --migrate)  MIGRATE=true ;;
    *)          err "Unknown flag: $arg"; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."

# ═════════════════════════════════════════
# 1. Validate environment
# ═════════════════════════════════════════
echo -e "\n${GREEN}=== Content Creator Hub — Deploy ===${NC}\n"

if [ ! -f .env ]; then
  if [ -f .env.enc ]; then
    info "Found .env.enc — decrypting..."
    bash scripts/env-crypt.sh decrypt
  else
    err ".env not found. Run scripts/setup.sh first, or:"
    echo "  cp .env.example .env && \$EDITOR .env"
    echo "  — or decrypt an existing .env.enc:"
    echo "  ./scripts/env-crypt.sh decrypt"
    exit 1
  fi
fi

# Safe env loading — only extract KEY=VALUE lines, skip lines with special chars
eval "$(grep -E '^[A-Z_]+=.+' .env | grep -v '[<>]')"

MISSING=""
[ -z "${DOMAIN:-}" ]             && MISSING="$MISSING DOMAIN"
[ -z "${POSTGRES_PASSWORD:-}" ]  && MISSING="$MISSING POSTGRES_PASSWORD"
[ -z "${JWT_SECRET:-}" ]         && MISSING="$MISSING JWT_SECRET"
[ -z "${WS_INTERNAL_API_KEY:-}" ] && MISSING="$MISSING WS_INTERNAL_API_KEY"

if [ -n "$MISSING" ]; then
  err "Missing required variables in .env:$MISSING"
  exit 1
fi

info "Environment validated (domain: $DOMAIN)"

# ═════════════════════════════════════════
# 2. Generate nginx config from template
# ═════════════════════════════════════════
echo ""
echo "[1/6] Generating nginx config..."

# Always regenerate from template — tracked code stays clean
if [ ! -f nginx/conf.d/default.conf.template ]; then
  err "nginx/conf.d/default.conf.template not found"
  exit 1
fi

sed "s/\${DOMAIN}/$DOMAIN/g" nginx/conf.d/default.conf.template > nginx/conf.d/default.conf
info "nginx config generated for $DOMAIN"

# ═════════════════════════════════════════
# 3. Build Docker images
# ═════════════════════════════════════════
echo ""
echo "[2/6] Building Docker images..."
docker compose build --quiet
info "All images built"

# ═════════════════════════════════════════
# 4. SSL certificate (if --ssl)
# ═════════════════════════════════════════
if $SETUP_SSL; then
  echo ""
  echo "[3/6] Setting up SSL certificate..."

  EMAIL="${SSL_EMAIL:-admin@$DOMAIN}"

  # Temporarily use HTTP-only config for ACME challenge
  cat > nginx/conf.d/default.conf <<'HTTPEOF'
server {
    listen 80;
    server_name _;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 200 'waiting for SSL setup';
        add_header Content-Type text/plain;
    }
}
HTTPEOF

  docker compose up -d nginx
  sleep 3

  # Request certificate
  docker compose run --rm --entrypoint "certbot certonly \
    --webroot -w /var/www/certbot \
    -d $DOMAIN -d www.$DOMAIN \
    --email $EMAIL \
    --agree-tos --no-eff-email" certbot

  # Restore real nginx config
  sed "s/\${DOMAIN}/$DOMAIN/g" nginx/conf.d/default.conf.template > nginx/conf.d/default.conf

  info "SSL certificate obtained for $DOMAIN + www.$DOMAIN"
else
  echo ""
  echo "[3/6] Skipping SSL (use --ssl for first-time setup)"
fi

# ═════════════════════════════════════════
# 5. Start services
# ═════════════════════════════════════════
echo ""
echo "[4/6] Starting services..."

# Start postgres first, wait for healthy
docker compose up -d postgres
echo "  Waiting for PostgreSQL..."
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-contenthub}" > /dev/null 2>&1; do
  sleep 2
done
info "PostgreSQL is ready"

# Start app services
docker compose up -d
info "All services started"

# ═════════════════════════════════════════
# 6. Database setup
# ═════════════════════════════════════════
echo ""
echo "[5/6] Database setup..."

SEED_MARKER=".seed_completed"

# Wait for Next.js to be reachable
echo "  Waiting for Next.js to start..."
for i in $(seq 1 30); do
  if docker compose exec -T nextjs node -e "fetch('http://localhost:3000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 2
done

# Always run migrations (idempotent — only applies pending changes)
echo "  Running database migrations..."
docker compose exec -T nextjs npx drizzle-kit migrate
info "Migrations applied"

# Push schema to catch any drift (idempotent)
echo "  Pushing schema..."
docker compose exec -T nextjs npx drizzle-kit push --force
info "Schema up to date"

# Seed only on first deploy — never again
if [ ! -f "$SEED_MARKER" ]; then
  echo "  Running seed (first-time only)..."
  docker compose exec -T nextjs npx tsx src/db/seed.ts
  touch "$SEED_MARKER"
  info "Database seeded"
else
  echo "  Seed already completed (remove $SEED_MARKER to force re-seed)"
fi

# ═════════════════════════════════════════
# 7. Health check
# ═════════════════════════════════════════
echo ""
echo "[6/6] Verifying services..."
sleep 5

docker compose ps --format "table {{.Name}}\t{{.Status}}"

echo ""
echo -e "${GREEN}=== Deployment complete! ===${NC}"
echo ""
echo "  App:          https://$DOMAIN"
echo "  Task Creator: https://$DOMAIN/task-creator/"
echo ""
if [ -f "$SEED_MARKER" ] && [ "$(find "$SEED_MARKER" -mmin -1 2>/dev/null)" ]; then
  echo "  Admin credentials were printed in the seed output above."
  echo "  Admin email: admin@$DOMAIN"
  echo ""
fi

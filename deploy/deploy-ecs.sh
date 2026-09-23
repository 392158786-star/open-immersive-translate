#!/usr/bin/env bash
set -euo pipefail

BRANCH="competition/huawei-codearts"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLOUD_DIR="$REPO_DIR/cloud-demo"
HEALTH_URL="http://127.0.0.1:8787/health"
MAX_WAIT=60

log() { printf '[deploy] %s\n' "$*"; }
fail() { printf '[deploy][FAIL] %s\n' "$*" >&2; exit 1; }

log "=== 一键部署开始 ==="

# 1. 拉取最新代码
log "拉取 $BRANCH 分支..."
cd "$REPO_DIR"
git fetch origin "$BRANCH" 2>/dev/null || log "fetch 跳过（无远端或离线）"
git checkout "$BRANCH" 2>/dev/null || true
git pull origin "$BRANCH" 2>/dev/null || log "pull 跳过（无远端或离线）"

# 2. 进入 cloud-demo
cd "$CLOUD_DIR"

# 3. 检查 .env 存在
if [ -f .env ]; then
  log ".env 已存在（内容不打印）"
else
  fail ".env 不存在，请先 cp .env.example .env 并填写云端参数"
fi

# 4. 预检
log "运行预检 (preflight)..."
if node scripts/preflight.ts; then
  log "预检通过"
else
  fail "预检失败，请按上方提示修复后重试"
fi

# 5. 构建并启动容器
log "构建并启动 Docker 容器..."
docker compose -f docker-compose.huawei.yml up -d --build

# 6. 轮询健康检查
log "等待服务就绪（最多 ${MAX_WAIT}s）..."
elapsed=0
ready=false
while [ "$elapsed" -lt "$MAX_WAIT" ]; do
  response="$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "")"
  if [ -n "$response" ]; then
    api_status="$(printf '%s' "$response" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.checks?.api?.status||'')}catch{console.log('')}})")"
    rds_status="$(printf '%s' "$response" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.checks?.rds?.status||'')}catch{console.log('')}})")"
    redis_status="$(printf '%s' "$response" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.checks?.redis?.status||'')}catch{console.log('')}})")"
    upstream_status="$(printf '%s' "$response" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.checks?.upstream?.status||'')}catch{console.log('')}})")"
    if [ "$api_status" = "up" ] && [ "$rds_status" = "up" ] && [ "$redis_status" = "up" ] && [ "$upstream_status" = "up" ]; then
      ready=true
      break
    fi
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

if [ "$ready" = true ]; then
  log "服务已就绪（耗时 ${elapsed}s）"
else
  fail "服务在 ${MAX_WAIT}s 内未就绪，请检查日志：docker compose -f docker-compose.huawei.yml logs app"
fi

# 7. 输出结果
log "=== 部署完成 ==="
printf '\n'
printf '访问地址:\n'
printf '  健康检查:  %s\n' "$HEALTH_URL"
printf '  翻译 API:   http://127.0.0.1:8787/v1/translate\n'
printf '  统计:       http://127.0.0.1:8787/v1/stats\n'
printf '\n'
printf '日志命令:\n'
printf '  docker compose -f docker-compose.huawei.yml logs -f app\n'
printf '\n'
printf '停止命令:\n'
printf '  docker compose -f docker-compose.huawei.yml down\n'
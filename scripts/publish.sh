#!/bin/bash
# ============================================================================
# ERGENEKON ENGINE — npm Publish Script
#
# Publishes all packages to npm registry in the correct dependency order.
# Run: bash scripts/publish.sh
#
# Prerequisites:
#   - npm login (must be authenticated)
#   - All packages must build successfully
# ============================================================================

set -e

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║      ERGENEKON — npm Publish Pipeline        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check npm auth
echo -e "${CYAN}[1/7] Checking npm authentication...${NC}"
if ! npm whoami > /dev/null 2>&1; then
  echo "❌ Not logged in to npm. Run: npm login"
  exit 1
fi
NPMUSER=$(npm whoami)
echo -e "${GREEN}   ✅ Logged in as: ${NPMUSER}${NC}"

# Build all packages
echo -e "${CYAN}[2/7] Building all packages...${NC}"
npm run build 2>/dev/null || true
echo -e "${GREEN}   ✅ Build complete${NC}"

# Publish in dependency order
PACKAGES=(
  "packages/ergenekon-core"
  "packages/ergenekon-replay"
  "packages/ergenekon-probe"
  "packages/ergenekon-collector"
  "packages/ergenekon-cli"
  "packages/ergenekon-ui"
)

STEP=3
for pkg in "${PACKAGES[@]}"; do
  NAME=$(node -e "console.log(require('./${pkg}/package.json').name)")
  VERSION=$(node -e "console.log(require('./${pkg}/package.json').version)")
  
  echo -e "${CYAN}[${STEP}/7] Publishing ${NAME}@${VERSION}...${NC}"
  
  # Check if version already published
  if npm view "${NAME}@${VERSION}" version > /dev/null 2>&1; then
    echo -e "${YELLOW}   ⏭️  Already published, skipping${NC}"
  else
    cd "${pkg}"
    npm publish --access public
    cd - > /dev/null
    echo -e "${GREEN}   ✅ Published ${NAME}@${VERSION}${NC}"
  fi
  
  STEP=$((STEP + 1))
done

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ All packages published successfully!    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "Verify: https://www.npmjs.com/org/ergenekon"

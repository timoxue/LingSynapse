#!/bin/bash

# LingSynapse Environment Teardown Script
# This script cleans up the Docker environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOCKER_NETWORK="synapse-net"
STORAGE_DIR="$HOME/.openclaw/storage"

echo -e "${BLUE}=== LingSynapse Environment Teardown ===${NC}"
echo ""

# Warning
echo -e "${RED}WARNING: This will stop all LingSynapse containers and remove the network${NC}"
echo -e "${YELLOW}This will NOT delete storage data${NC}"
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Teardown cancelled${NC}"
    exit 0
fi

echo ""

# Step 1: Stop all containers in the network
echo -e "${YELLOW}Step 1: Stopping containers...${NC}"
CONTAINERS=$(docker ps -q -f network="$DOCKER_NETWORK" 2>/dev/null || true)
if [ -n "$CONTAINERS" ]; then
    docker stop $CONTAINERS
    echo -e "${GREEN}✓ Stopped ${#CONTAINERS[@]} container(s)${NC}"
else
    echo -e "${BLUE}No containers found in network${NC}"
fi
echo ""

# Step 2: Remove Docker network
echo -e "${YELLOW}Step 2: Removing Docker network...${NC}"
if docker network inspect "$DOCKER_NETWORK" &> /dev/null; then
    docker network rm "$DOCKER_NETWORK"
    echo -e "${GREEN}✓ Removed network: $DOCKER_NETWORK${NC}"
else
    echo -e "${BLUE}Network '$DOCKER_NETWORK' not found${NC}"
fi
echo ""

# Step 3: Ask about storage cleanup
echo -e "${YELLOW}Step 3: Storage cleanup...${NC}"
read -p "Do you want to remove storage data in $STORAGE_DIR? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$STORAGE_DIR"
    mkdir -p "$STORAGE_DIR"
    touch "$STORAGE_DIR/.gitkeep"
    echo -e "${GREEN}✓ Storage directory cleaned${NC}"
else
    echo -e "${BLUE}Storage directory kept intact${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}=== Teardown Complete ===${NC}"
echo -e "${GREEN}Environment cleaned up!${NC}"
echo ""
echo "To restore environment:"
echo "  ./scripts/setup.sh"

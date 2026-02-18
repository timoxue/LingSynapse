#!/bin/bash

# LingSynapse Environment Setup Script
# This script prepares the Docker environment for the Synapse Orchestrator

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOCKER_NETWORK="synapse-net"
DOCKER_IMAGE="openclaw/gateway:latest"
STORAGE_BASE="$HOME/.openclaw"
STORAGE_DIR="$STORAGE_BASE/storage"

echo -e "${BLUE}=== LingSynapse Environment Setup ===${NC}"
echo ""

# Step 1: Verify Docker is installed
echo -e "${YELLOW}Step 1: Verifying Docker installation...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    echo "Please install Docker Desktop or Docker Engine first"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}Error: Docker daemon is not running${NC}"
    echo "Please start Docker Desktop or Docker Engine"
    exit 1
fi

echo -e "${GREEN}✓ Docker is installed and running${NC}"
echo ""

# Step 2: Create Docker network (idempotent)
echo -e "${YELLOW}Step 2: Creating Docker network...${NC}"
if docker network inspect "$DOCKER_NETWORK" &> /dev/null; then
    echo -e "${GREEN}✓ Network '$DOCKER_NETWORK' already exists${NC}"
else
    docker network create "$DOCKER_NETWORK"
    echo -e "${GREEN}✓ Created Docker network: $DOCKER_NETWORK${NC}"
fi
echo ""

# Step 3: Create storage directory
echo -e "${YELLOW}Step 3: Creating storage directories...${NC}"
mkdir -p "$STORAGE_DIR"
echo -e "${GREEN}✓ Created storage directory: $STORAGE_DIR${NC}"

# Create .gitkeep to ensure empty directory is tracked
touch "$STORAGE_DIR/.gitkeep"

echo ""

# Step 4: Pull Docker image (optional)
echo -e "${YELLOW}Step 4: Pulling Docker image (optional)...${NC}"
read -p "Do you want to pull the OpenClaw Gateway image now? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if docker pull "$DOCKER_IMAGE" &> /dev/null; then
        echo -e "${GREEN}✓ Pulled Docker image: $DOCKER_IMAGE${NC}"
    else
        echo -e "${YELLOW}⚠ Warning: Failed to pull image. It will be pulled automatically when needed${NC}"
    fi
else
    echo -e "${BLUE}Skipping image pull. It will be pulled automatically when needed${NC}"
fi
echo ""

# Step 5: Verify Docker socket permissions
echo -e "${YELLOW}Step 5: Checking Docker socket permissions...${NC}"
if [ -w "/var/run/docker.sock" ]; then
    echo -e "${GREEN}✓ Docker socket is accessible${NC}"
else
    echo -e "${YELLOW}⚠ Warning: Docker socket may not be writable${NC}"
    echo "  You may need to add your user to the docker group:"
    echo "  sudo usermod -aG docker $USER"
    echo "  Then log out and log back in"
fi
echo ""

# Summary
echo -e "${BLUE}=== Setup Complete ===${NC}"
echo -e "${GREEN}Environment is ready for LingSynapse!${NC}"
echo ""
echo "Network:     $DOCKER_NETWORK"
echo "Storage:     $STORAGE_DIR"
echo "Docker:      $(docker --version)"
echo ""
echo "To run teardown later:"
echo "  ./scripts/teardown.sh"

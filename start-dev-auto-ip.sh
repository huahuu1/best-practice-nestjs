#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting chat service with auto IP detection...${NC}"

# Get the current IP address (works on macOS and most Linux distributions)
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    IP_ADDRESS=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
    if [ -z "$IP_ADDRESS" ]; then
        # Try alternative method for macOS
        IP_ADDRESS=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)
    fi
else
    # Linux
    IP_ADDRESS=$(hostname -I | awk '{print $1}')
fi

# Check if IP was found
if [ -z "$IP_ADDRESS" ]; then
    echo -e "${RED}Error: Could not determine IP address.${NC}"
    exit 1
fi

# Set the port
PORT=3001
# Set Kafka broker with detected IP
KAFKA_BROKER="${IP_ADDRESS}:9092"

echo -e "${GREEN}Detected IP address: ${IP_ADDRESS}${NC}"
echo -e "${GREEN}Service will be available at: http://${IP_ADDRESS}:${PORT}${NC}"
echo -e "${GREEN}Using Kafka broker: ${KAFKA_BROKER}${NC}"

# Kill any existing npm run start:dev processes
echo -e "${YELLOW}Stopping any running development servers...${NC}"
pkill -f "npm run start:dev" 2>/dev/null
pkill -f "nest start" 2>/dev/null

# Start the development server with the detected IP
echo -e "${GREEN}Starting development server...${NC}"
HOST=${IP_ADDRESS} PORT=${PORT} KAFKA_BROKER=${KAFKA_BROKER} npm run start:dev 
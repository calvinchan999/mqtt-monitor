#!/bin/bash

# MQTT Monitor - Docker Build Script

set -e

echo "🐳 Building MQTT Monitor Docker Image..."

# Build arguments
IMAGE_NAME="mqtt-monitor"
VERSION=${1:-latest}
PLATFORM=${2:-linux/amd64}

echo "📋 Build Configuration:"
echo "  Image: ${IMAGE_NAME}:${VERSION}"
echo "  Platform: ${PLATFORM}"
echo "  Context: $(pwd)"

# Build the image
echo "🔨 Building Docker image..."
docker build \
  --platform ${PLATFORM} \
  --tag ${IMAGE_NAME}:${VERSION} \
  --tag ${IMAGE_NAME}:latest \
  .

echo "✅ Build completed successfully!"

# Show image info
echo "📊 Image Information:"
docker images ${IMAGE_NAME}:${VERSION}

# Optional: Run container for testing
read -p "🚀 Do you want to run the container now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🏃 Starting container..."
    docker run -d \
      --name mqtt-monitor-test \
      -p 3000:3000 \
      ${IMAGE_NAME}:${VERSION}
    
    echo "✅ Container started!"
    echo "🌐 Access the application at: http://localhost:3000"
    echo "🔍 Container logs: docker logs mqtt-monitor-test"
    echo "🛑 Stop container: docker stop mqtt-monitor-test"
fi

echo "🎉 Done!"

# MQTT Monitor - Docker Deployment

This document explains how to run the MQTT Monitor tool using Docker and Docker Compose.

## 🐳 Quick Start

### Prerequisites
- Docker Engine 20.10+
- Docker Compose V2

### Option 1: Docker Compose (Recommended)

1. **Clone and navigate to the project:**
```bash
git clone <your-repo>
cd mqtt-tool
```

2. **Start the application:**
```bash
docker-compose up -d
```

3. **Access the application:**
- MQTT Monitor Web UI: http://localhost:3000
- The Node.js server serves both the API and the web interface
- Connect to your existing MQTT brokers through the web interface

### Option 2: Docker Build and Run

1. **Build the image:**
```bash
docker build -t mqtt-monitor .
```

2. **Run the container:**
```bash
docker run -d \
  --name mqtt-monitor \
  -p 3000:3000 \
  -v $(pwd)/mqtt_monitor.db:/app/data/mqtt_monitor.db \
  mqtt-monitor
```

## 📁 File Structure

```
mqtt-tool/
├── Dockerfile              # Container definition
├── docker-compose.yml      # Multi-service orchestration
├── .dockerignore           # Files to exclude from build
├── server.js               # Main application
├── database.js             # Database layer
├── public/                 # Frontend assets
└── data/                   # Database storage (created in container)
```

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | Application port |

### Docker Compose Services

1. **mqtt-monitor**: Main application
   - Port: 3000
   - Persistent database storage
   - Health checks enabled
   - Connects to external MQTT brokers

## 💾 Data Persistence

### Database
- SQLite database is stored in Docker volume `mqtt_data`
- Mounted to `/app/data/mqtt_monitor.db` in container
- Automatically persists connections and topics

### External MQTT Brokers
The application connects to your existing MQTT brokers:
- AWS IoT Core
- Azure IoT Hub
- Google Cloud IoT
- HiveMQ Cloud
- Local Mosquitto instances
- Any MQTT 3.1.1/5.0 compatible broker

## 🔍 Health Monitoring

### Application Health Check
```bash
# Check application status
docker-compose ps

# View health status
docker inspect mqtt-monitor --format='{{.State.Health.Status}}'

# Check logs
docker-compose logs mqtt-monitor
```

### Manual Health Check
```bash
curl http://localhost:3000/api/stats
```

## 🚀 Production Deployment

### Cloud/VM Deployment

The application is ready for cloud deployment out of the box:

**1. Access via Public IP:**
```bash
# After deploying to cloud VM
http://YOUR_PUBLIC_IP:3000
```

**2. Behind Load Balancer/Proxy:**
```bash
# Configure your load balancer to forward to container port 3000
# The Node.js server handles both web UI and API requests
```

**3. Port Configuration:**
```yaml
# In docker-compose.yml - change external port if needed
ports:
  - "8080:3000"  # Access via http://your-server:8080
```

### 1. Environment-specific Compose

Create `docker-compose.prod.yml`:
```yaml
version: '3.8'
services:
  mqtt-monitor:
    image: mqtt-monitor:latest
    environment:
      - NODE_ENV=production
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
```

### 2. Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. SSL/HTTPS Setup

```bash
# Using Let's Encrypt with Certbot
certbot --nginx -d your-domain.com
```

## 🛠️ Development

### Local Development with Docker
```bash
# Start with live reload
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# View logs
docker-compose logs -f mqtt-monitor

# Execute commands in container
docker-compose exec mqtt-monitor sh
```

### Building for Different Architectures
```bash
# Multi-platform build
docker buildx build --platform linux/amd64,linux/arm64 -t mqtt-monitor:latest .

# ARM64 (Apple Silicon)
docker build --platform linux/arm64 -t mqtt-monitor:arm64 .
```

## 📊 Monitoring & Logs

### Application Logs
```bash
# Real-time logs
docker-compose logs -f mqtt-monitor

# Last 100 lines
docker-compose logs --tail=100 mqtt-monitor
```

### Resource Usage
```bash
# Container stats
docker stats mqtt-monitor

# Detailed container info
docker inspect mqtt-monitor
```

### Database Access
```bash
# Access SQLite database
docker-compose exec mqtt-monitor sqlite3 /app/data/mqtt_monitor.db

# Backup database
docker-compose exec mqtt-monitor cp /app/data/mqtt_monitor.db /tmp/
docker cp mqtt-monitor:/tmp/mqtt_monitor.db ./backup.db
```

## 🔧 Troubleshooting

### Common Issues

1. **Port already in use:**
```bash
# Change port in docker-compose.yml
ports:
  - "3001:3000"  # Use port 3001 instead
```

2. **Database permissions:**
```bash
# Fix database file permissions
sudo chown -R 1001:1001 ./mqtt_monitor.db
```

3. **Container won't start:**
```bash
# Check logs
docker-compose logs mqtt-monitor

# Rebuild image
docker-compose build --no-cache
```

4. **MQTT connection issues:**
```bash
# Check application logs for connection errors
docker-compose logs -f mqtt-monitor

# Test external MQTT broker connectivity from host
mosquitto_pub -h your-broker.com -t test -m "hello"
```

## 🔄 Updates & Maintenance

### Update Application
```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose build
docker-compose up -d
```

### Backup & Restore
```bash
# Backup
docker-compose exec mqtt-monitor tar -czf /tmp/backup.tar.gz /app/data/
docker cp mqtt-monitor:/tmp/backup.tar.gz ./

# Restore
docker cp ./backup.tar.gz mqtt-monitor:/tmp/
docker-compose exec mqtt-monitor tar -xzf /tmp/backup.tar.gz -C /
```

## 🌐 Network Configuration

### Custom Network
```yaml
# In docker-compose.yml
networks:
  mqtt-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

### External MQTT Brokers
- AWS IoT Core
- Azure IoT Hub  
- Google Cloud IoT
- HiveMQ Cloud
- Local Mosquitto instances

## 📈 Scaling

### Horizontal Scaling
```bash
# Scale to 3 instances
docker-compose up -d --scale mqtt-monitor=3

# Use load balancer (nginx/traefik)
```

### Resource Limits
```yaml
services:
  mqtt-monitor:
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
```

## 🔐 Security

### Best Practices
1. Use non-root user (already implemented)
2. Keep base images updated
3. Use secrets for sensitive data
4. Enable container security scanning
5. Use TLS for MQTT connections

### Security Scanning
```bash
# Scan for vulnerabilities
docker scout cves mqtt-monitor:latest
```

---

For more information, visit the main [README.md](README.md) file.

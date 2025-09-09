const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mqtt = require('mqtt');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const Database = require('./database');

class MQTTMonitor {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    this.db = new Database();
    this.mqttClients = new Map(); // Store multiple MQTT connections
    this.wsClients = new Map(); // Track WebSocket clients and their associated MQTT connections
    this.heartbeatInterval = null; // Heartbeat interval for WebSocket connections
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.startHeartbeat();
    
    // No message storage or cleanup needed - messages are only displayed in real-time
    console.log('💡 MQTT messages are displayed in real-time only (not stored in database)');
    
    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // Serve index.html at root path
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  setupRoutes() {
    // Get all MQTT connections
    this.app.get('/api/connections', async (req, res) => {
      try {
        const connections = await this.db.getConnections();
        res.json(connections);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Add MQTT connection
    this.app.post('/api/connections', async (req, res) => {
      try {
        const connection = await this.db.addConnection(req.body);
        res.json(connection);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get topics for specified connection
    this.app.get('/api/connections/:id/topics', async (req, res) => {
      try {
        const topics = await this.db.getTopics(req.params.id);
        res.json(topics);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Add topic
    this.app.post('/api/topics', async (req, res) => {
      try {
        const topic = await this.db.addTopic(req.body);
        res.json(topic);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Messages are no longer stored - only real-time display via WebSocket

    // Connect MQTT
    this.app.post('/api/connect', async (req, res) => {
      try {
        const { connectionId, wsClientId } = req.body;
        const connections = await this.db.getConnections();
        const connection = connections.find(c => c.id == connectionId);
        
        if (!connection) {
          return res.status(404).json({ error: 'Connection not found' });
        }

        await this.connectMQTT(connection, wsClientId);
        res.json({ success: true, message: 'Connected to MQTT broker' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Disconnect MQTT connection
    this.app.post('/api/disconnect', async (req, res) => {
      try {
        const { connectionId } = req.body;
        await this.disconnectMQTT(connectionId);
        res.json({ success: true, message: 'Disconnected from MQTT broker' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Pause/resume message monitoring
    this.app.post('/api/pause-monitoring', async (req, res) => {
      try {
        const { connectionId, paused } = req.body;
        const client = this.mqttClients.get(connectionId);
        
        if (client) {
          // Store pause state for this connection
          client._pauseMonitoring = paused;
          res.json({ success: true, message: paused ? 'Message monitoring paused' : 'Message monitoring resumed' });
        } else {
          res.status(404).json({ error: 'Connection not found' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete connection
    this.app.delete('/api/connections/:id', async (req, res) => {
      try {
        const connectionId = req.params.id;
        await this.disconnectMQTT(connectionId);
        await this.db.deleteConnection(connectionId);
        res.json({ success: true, message: 'Connection deleted' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete topic
    // Update topic status (enable/disable)
    this.app.put('/api/topics/:id', async (req, res) => {
      try {
        const topicId = req.params.id;
        const { active } = req.body;
        
        console.log(`🔄 Updating topic ${topicId} status to ${active ? 'active' : 'inactive'}`);
        
        // Update topic status in database
        await this.db.updateTopicStatus(topicId, active);
        
        // Get topic details to handle subscription changes
        const topic = await this.db.getTopicById(topicId);
        if (topic) {
          const client = this.mqttClients.get(topic.connection_id);
          if (client && client.connected) {
            if (active) {
              // Subscribe to topic
              client.subscribe(topic.topic, { qos: topic.qos }, (err) => {
                if (err) {
                  console.error(`❌ Failed to subscribe to topic "${topic.topic}":`, err);
                } else {
                  console.log(`✅ Subscribed to topic "${topic.topic}" with QoS ${topic.qos}`);
                }
              });
            } else {
              // Unsubscribe from topic
              client.unsubscribe(topic.topic, (err) => {
                if (err) {
                  console.error(`❌ Failed to unsubscribe from topic "${topic.topic}":`, err);
                } else {
                  console.log(`✅ Unsubscribed from topic "${topic.topic}"`);
                }
              });
            }
          }
        }
        
        res.json({ success: true, message: 'Topic status updated', active });
      } catch (error) {
        console.error('❌ Error updating topic status:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.delete('/api/topics/:id', async (req, res) => {
      try {
        const topicId = req.params.id;
        await this.db.deleteTopic(topicId);
        res.json({ success: true, message: 'Topic deleted' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Debug endpoint to check MQTT subscriptions
    this.app.get('/api/debug/subscriptions/:connectionId', async (req, res) => {
      try {
        const connectionId = parseInt(req.params.connectionId);
        const client = this.mqttClients.get(connectionId);
        
        if (!client) {
          return res.json({ error: 'MQTT client not found', subscriptions: [] });
        }

        const topics = await this.db.getTopics(connectionId);
        const activeTopics = topics.filter(t => t.active);
        
        const debugInfo = {
          clientConnected: client.connected,
          activeTopics: activeTopics.map(t => ({
            id: t.id,
            topic: t.topic,
            qos: t.qos,
            isWildcard: t.topic.includes('#') || t.topic.includes('+')
          })),
          clientSubscriptions: Object.keys(client.options?.subscriptions || {}),
          timestamp: new Date().toISOString()
        };

        console.log(`🔍 Debug info for connection ${connectionId}:`, debugInfo);
        res.json(debugInfo);
      } catch (error) {
        console.error('Error getting debug info:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Add debug endpoint to check active WebSocket and MQTT connections
    this.app.get('/api/debug/connections', async (req, res) => {
      try {
        const wsConnections = Array.from(this.wsClients.entries()).map(([wsId, info]) => ({
          wsClientId: wsId,
          connectedAt: info.connectedAt,
          lastPong: info.lastPong,
          mqttConnections: Array.from(info.mqttConnections),
          wsState: info.ws.readyState === WebSocket.OPEN ? 'OPEN' : 
                  info.ws.readyState === WebSocket.CLOSED ? 'CLOSED' : 
                  info.ws.readyState === WebSocket.CONNECTING ? 'CONNECTING' : 'CLOSING'
        }));

        const mqttConnections = Array.from(this.mqttClients.entries()).map(([connId, client]) => ({
          connectionId: connId,
          connected: client.connected,
          reconnecting: client.reconnecting
        }));

        res.json({
          webSocketClients: wsConnections,
          mqttClients: mqttConnections,
          totalWsClients: this.wsClients.size,
          totalMqttClients: this.mqttClients.size
        });
      } catch (error) {
        console.error('Error getting debug connections info:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get basic statistics (without message count)
    this.app.get('/api/stats', async (req, res) => {
      try {
        const connections = await this.db.getConnections();
        const allTopics = await this.db.getAllActiveTopics();
        
        res.json({
          connectionCount: connections.length,
          activeTopicCount: allTopics.length,
          totalTopicCount: allTopics.length,
          messageStorage: 'disabled - real-time only'
        });
      } catch (error) {
        console.error('❌ Error getting database stats:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Catch-all handler: send back index.html for any non-API routes
    this.app.get('*', (req, res) => {
      // Only serve index.html for non-API routes
      if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
      } else {
        res.status(404).json({ error: 'API endpoint not found' });
      }
    });
  }

  // Helper function to check if a topic matches a wildcard pattern
  topicMatches(topic, pattern) {
    // Convert MQTT wildcard pattern to regex
    // # matches any number of levels
    // + matches exactly one level
    const regexPattern = pattern
      .replace(/\+/g, '[^/]+')  // + matches one level (no slashes)
      .replace(/#/g, '.*')      // # matches any number of levels (including slashes)
      .replace(/\$/g, '\\$');   // Escape $ if present
    
    const regex = new RegExp(`^${regexPattern}$`);
    const matches = regex.test(topic);
    
    if (matches) {
      console.log(`🎯 Topic "${topic}" matches pattern "${pattern}"`);
    }
    
    return matches;
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      // Generate unique ID for this WebSocket client
      const wsClientId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log(`WebSocket client connected: ${wsClientId}`);
      
      // Store WebSocket client with its associated MQTT connections
      this.wsClients.set(wsClientId, {
        ws: ws,
        mqttConnections: new Set(),
        connectedAt: new Date(),
        lastPong: Date.now() // Track last heartbeat response
      });
      
      // Send initial connection status with client ID
      ws.send(JSON.stringify({ 
        type: 'connectionStatus', 
        status: 'connected',
        wsClientId: wsClientId,
        message: 'WebSocket connection established'
      }));
      
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          console.log('WebSocket message received:', data);
          
          switch (data.type) {
            case 'subscribe':
              await this.subscribeToTopics(data.connectionId);
              break;
            case 'getMessages':
              const messages = await this.db.getMessages(data.connectionId, data.topic, data.limit);
              ws.send(JSON.stringify({ type: 'messages', data: messages }));
              break;
            case 'ping':
              ws.send(JSON.stringify({ type: 'pong' }));
              break;
            case 'pong':
              // Client responded to our heartbeat
              const clientInfo = this.wsClients.get(wsClientId);
              if (clientInfo) {
                clientInfo.lastPong = Date.now();
                console.log(`💓 Received pong from client ${wsClientId}`);
              }
              break;
            case 'register':
              // Allow client to register with a specific ID
              if (data.wsClientId && this.wsClients.has(data.wsClientId)) {
                // Update existing client
                const clientInfo = this.wsClients.get(data.wsClientId);
                clientInfo.ws = ws;
                this.wsClients.delete(wsClientId); // Remove auto-generated ID
                console.log(`WebSocket client re-registered: ${data.wsClientId}`);
              }
              break;
            case 'cleanup':
              // Handle explicit cleanup request from client
              const targetClientId = data.wsClientId || wsClientId;
              console.log(`🧹 Received cleanup request for client: ${targetClientId}`);
              this.handleWebSocketDisconnect(targetClientId);
              break;
          }
        } catch (error) {
          console.error('WebSocket error:', error);
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Error processing message: ' + error.message 
          }));
        }
      });

      ws.on('close', (code, reason) => {
        console.log(`WebSocket client disconnected: ${wsClientId}, code: ${code}, reason: ${reason.toString()}`);
        this.handleWebSocketDisconnect(wsClientId);
      });

      ws.on('error', (error) => {
        console.error(`WebSocket client error: ${wsClientId}:`, error);
        this.handleWebSocketDisconnect(wsClientId);
      });
    });
  }

  async connectMQTT(connection, wsClientId = null) {
    const clientId = connection.client_id || `mqtt_monitor_${Date.now()}`;
    
    // Parse the connection URL to determine protocol
    let brokerUrl;
    let options = {
      clientId: clientId,
      keepalive: connection.keepalive || 60,
      clean: connection.clean_session !== false,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
    };

    // Check if it's a WebSocket URL (AWS MQ format)
    if (connection.host.startsWith('wss://') || connection.host.startsWith('ws://')) {
      brokerUrl = connection.host;
      
      // For WSS connections (AWS MQ), add TLS options
      if (connection.host.startsWith('wss://')) {
        options.protocol = 'wss';
        options.rejectUnauthorized = false; // For self-signed certificates
        options.secureProtocol = 'TLSv1_2_method'; // Force TLS 1.2
      }
    } else {
      // Traditional MQTT connection
      const protocol = connection.port === 8883 || connection.port === 443 ? 'mqtts' : 'mqtt';
      brokerUrl = `${protocol}://${connection.host}:${connection.port}`;
      
      // For secure MQTT connections
      if (protocol === 'mqtts') {
        options.rejectUnauthorized = false;
        options.secureProtocol = 'TLSv1_2_method';
      }
    }

    if (connection.username) {
      options.username = connection.username;
    }
    if (connection.password) {
      options.password = connection.password;
    }

    console.log('Connecting to MQTT broker:', brokerUrl, 'with options:', { ...options, password: options.password ? '[HIDDEN]' : undefined });
    
    const client = mqtt.connect(brokerUrl, options);

    client.on('connect', () => {
      console.log(`Connected to MQTT broker: ${connection.host}:${connection.port}`);
      this.mqttClients.set(connection.id, client);
      
      // Associate MQTT connection with WebSocket client if provided
      if (wsClientId && this.wsClients.has(wsClientId)) {
        this.wsClients.get(wsClientId).mqttConnections.add(connection.id);
        console.log(`Associated MQTT connection ${connection.id} with WebSocket client ${wsClientId}`);
      }
      
      this.broadcast({ type: 'connectionStatus', connectionId: connection.id, status: 'connected' });
      
      // Automatically subscribe to all active topics for this connection
      this.subscribeToTopics(connection.id);
    });

    client.on('error', (error) => {
      console.error(`MQTT connection error for ${connection.name}:`, error);
      
      // Provide more specific error messages
      let errorMessage = error.message;
      if (error.code === 5) {
        errorMessage = 'Authentication failed: Check username and password in AWS MQ console';
      } else if (error.code === 4) {
        errorMessage = 'Bad username or password format';
      } else if (error.code === 2) {
        errorMessage = 'Client identifier rejected';
      }
      
      this.broadcast({ 
        type: 'connectionStatus', 
        connectionId: connection.id, 
        status: 'error', 
        error: errorMessage,
        errorCode: error.code 
      });
    });

    client.on('close', () => {
      console.log(`MQTT connection closed: ${connection.name}`);
      this.mqttClients.delete(connection.id);
      
      // Remove association from all WebSocket clients
      this.wsClients.forEach((clientInfo, wsId) => {
        if (clientInfo.mqttConnections.has(connection.id)) {
          clientInfo.mqttConnections.delete(connection.id);
          console.log(`Removed MQTT connection ${connection.id} from WebSocket client ${wsId}`);
        }
      });
      
      this.broadcast({ type: 'connectionStatus', connectionId: connection.id, status: 'disconnected' });
    });

    client.on('message', async (topic, message, packet) => {
      try {
        const messagePreview = message.toString().length > 100 ? 
          message.toString().substring(0, 100) + '...' : 
          message.toString();
        console.log(`📨 Received MQTT message on topic "${topic}": ${messagePreview}`);
        console.log(`🔍 Message details: Connection=${connection.id}, QoS=${packet.qos}, Retained=${packet.retain}`);
        
        // Check if this message was received through a wildcard subscription
        const topics = await this.db.getTopics(connection.id);
        const activeTopics = topics.filter(t => t.active);
        const matchingWildcards = activeTopics.filter(t => 
          (t.topic.includes('#') || t.topic.includes('+')) && 
          this.topicMatches(topic, t.topic)
        );
        
        if (matchingWildcards.length > 0) {
          console.log(`🌟 Message on "${topic}" matched wildcard subscriptions: ${matchingWildcards.map(t => t.topic).join(', ')}`);
        } else {
          // Check if we have any wildcard subscriptions at all
          const wildcardSubs = activeTopics.filter(t => t.topic.includes('#') || t.topic.includes('+'));
          if (wildcardSubs.length > 0) {
            console.log(`⚠️ Message on "${topic}" did NOT match any wildcard subscriptions:`);
            wildcardSubs.forEach(sub => {
              console.log(`   - "${sub.topic}" -> ${this.topicMatches(topic, sub.topic) ? 'MATCH' : 'NO MATCH'}`);
            });
          }
        }
        
        const messageData = {
          connection_id: connection.id,
          topic: topic,
          message: message.toString(),
          qos: packet.qos,
          retained: packet.retain,
          timestamp: new Date().toISOString()
        };

        console.log(`📨 Processing MQTT message for real-time display only`);

        // Only broadcast if monitoring is not paused (no database storage)
        if (!client._pauseMonitoring) {
          this.broadcast({
            type: 'message',
            data: messageData
          });
          console.log(`📡 Message broadcasted to WebSocket clients (real-time only)`);
        } else {
          console.log(`⏸️ Message monitoring paused - not broadcasting to UI`);
        }
      } catch (error) {
        console.error('Error processing MQTT message:', error);
      }
    });
  }

  async subscribeToTopics(connectionId) {
    try {
      const topics = await this.db.getTopics(connectionId);
      const client = this.mqttClients.get(connectionId);
      
      if (client && client.connected) {
        const activeTopics = topics.filter(topic => topic.active);
        
        if (activeTopics.length > 0) {
          console.log(`Attempting to subscribe to ${activeTopics.length} topics for connection ${connectionId}`);
          
          // Subscribe to each topic individually with its QoS
          activeTopics.forEach(topic => {
            const isWildcard = topic.topic.includes('#') || topic.topic.includes('+');
            console.log(`🔄 Subscribing to ${isWildcard ? 'wildcard' : 'regular'} topic: "${topic.topic}"`);
            
            if (isWildcard) {
              console.log(`🌟 Wildcard pattern: "${topic.topic}"`);
            }
            
            client.subscribe(topic.topic, { qos: topic.qos }, (err) => {
              if (err) {
                console.error(`❌ Subscription error for topic "${topic.topic}":`, err);
              } else {
                console.log(`✅ Successfully subscribed to ${isWildcard ? 'wildcard' : 'regular'} topic "${topic.topic}" with QoS ${topic.qos}`);
                if (isWildcard) {
                  console.log(`🌟 Wildcard topic "${topic.topic}" will receive messages from matching subtopics`);
                }
              }
            });
          });
        } else {
          console.log(`⚠️ No active topics found for connection ${connectionId}`);
        }
      }
    } catch (error) {
      console.error('Error subscribing to topics:', error);
    }
  }

  async disconnectMQTT(connectionId) {
    const client = this.mqttClients.get(connectionId);
    if (client) {
      client.end();
      this.mqttClients.delete(connectionId);
    }
  }

  broadcast(data) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  // Cleanup methods removed - no message storage needed

  start(port = 3000) {
    this.server.listen(port, () => {
      console.log(`MQTT Monitor server running on http://localhost:${port}`);
      console.log(`WebSocket server running on ws://localhost:${port}`);
    });

    this.server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Please try a different port.`);
      } else {
        console.error('Server error:', error);
      }
    });
  }

  handleWebSocketDisconnect(wsClientId) {
    const clientInfo = this.wsClients.get(wsClientId);
    if (clientInfo) {
      console.log(`🧹 Cleaning up WebSocket client: ${wsClientId}`);
      console.log(`📊 Client had ${clientInfo.mqttConnections.size} MQTT connections`);
      
      // Disconnect all MQTT connections associated with this WebSocket client
      clientInfo.mqttConnections.forEach(connectionId => {
        console.log(`🔌 Auto-disconnecting MQTT connection ${connectionId} due to WebSocket disconnect`);
        this.disconnectMQTT(connectionId).catch(error => {
          console.error(`Error auto-disconnecting MQTT connection ${connectionId}:`, error);
        });
      });
      
      // Remove client info
      this.wsClients.delete(wsClientId);
      console.log(`✅ WebSocket client ${wsClientId} cleaned up`);
    }
  }

  // Method to gracefully shutdown all connections
  setupGracefulShutdown() {
    const cleanup = async (signal) => {
      console.log(`\n🚫 Received ${signal}. Performing graceful shutdown...`);
      
      // Stop heartbeat
      this.stopHeartbeat();
      
      // Disconnect all MQTT clients
      console.log(`🔌 Disconnecting ${this.mqttClients.size} MQTT connections...`);
      const disconnectPromises = Array.from(this.mqttClients.keys()).map(connectionId => 
        this.disconnectMQTT(connectionId).catch(error => 
          console.error(`Error disconnecting MQTT connection ${connectionId}:`, error)
        )
      );
      
      await Promise.allSettled(disconnectPromises);
      
      // Close WebSocket server
      if (this.wss) {
        console.log('🌐 Closing WebSocket server...');
        this.wss.close(() => {
          console.log('✅ WebSocket server closed');
        });
      }
      
      // Close HTTP server
      if (this.server) {
        console.log('🖥️ Closing HTTP server...');
        this.server.close(() => {
          console.log('✅ HTTP server closed');
          process.exit(0);
        });
      }
      
      // Force exit after 10 seconds
      setTimeout(() => {
        console.log('⏰ Force exiting after timeout');
        process.exit(1);
      }, 10000);
    };

    // Handle different termination signals
    process.on('SIGINT', () => cleanup('SIGINT'));
    process.on('SIGTERM', () => cleanup('SIGTERM'));
    process.on('SIGQUIT', () => cleanup('SIGQUIT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
      cleanup('UNCAUGHT_EXCEPTION');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      cleanup('UNHANDLED_REJECTION');
    });
  }

  startHeartbeat() {
    // Send heartbeat to all WebSocket clients every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.wsClients.forEach((clientInfo, wsClientId) => {
        if (clientInfo.ws.readyState === WebSocket.OPEN) {
          try {
            clientInfo.ws.send(JSON.stringify({ 
              type: 'ping', 
              timestamp: Date.now() 
            }));
            console.log(`💓 Sent heartbeat to client ${wsClientId}`);
          } catch (error) {
            console.error(`Error sending heartbeat to ${wsClientId}:`, error);
            this.handleWebSocketDisconnect(wsClientId);
          }
        } else {
          console.log(`💔 Client ${wsClientId} has dead WebSocket connection`);
          this.handleWebSocketDisconnect(wsClientId);
        }
      });
    }, 30000); // 30 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('💔 Heartbeat stopped');
    }
  }
}

// Start the server
const monitor = new MQTTMonitor();
monitor.start(3000);

module.exports = MQTTMonitor;

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 8080; // Different port from main server

// Enable CORS for all routes
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Proxy API calls to the main MQTT server
app.use('/api', createProxyMiddleware({
    target: 'http://localhost:3000',
    changeOrigin: true,
    ws: true, // Enable WebSocket proxying
    logLevel: 'debug',
    onError: (err, req, res) => {
        console.error('Proxy error:', err);
        res.status(500).json({ 
            error: 'Proxy error', 
            message: 'Cannot connect to MQTT server. Make sure it\'s running on port 3000.' 
        });
    },
    onProxyReq: (proxyReq, req, res) => {
        console.log(`Proxying ${req.method} ${req.url} to http://localhost:3000${req.url}`);
    }
}));

// Create HTTP server
const server = require('http').createServer(app);

// Handle WebSocket upgrade requests
const httpProxy = require('http-proxy');
const proxy = httpProxy.createProxyServer({});

server.on('upgrade', (req, socket, head) => {
    console.log('WebSocket upgrade request received, proxying to localhost:3000');
    proxy.ws(req, socket, head, {
        target: 'ws://localhost:3000',
        ws: true
    });
});

// Handle proxy errors
proxy.on('error', (err, req, res) => {
    console.error('Proxy error:', err);
    if (res && !res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Proxy error');
    }
});

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        // Check if main server is running
        const fetch = require('node-fetch');
        const response = await fetch('http://localhost:3000/api/connections');
        
        res.json({ 
            status: 'ok', 
            proxy: 'running',
            mainServer: response.ok ? 'connected' : 'error',
            port: PORT 
        });
    } catch (error) {
        res.status(503).json({ 
            status: 'error', 
            proxy: 'running',
            mainServer: 'disconnected',
            error: error.message,
            port: PORT 
        });
    }
});

server.listen(PORT, () => {
    console.log('🚀 MQTT Monitor Proxy Server Started!');
    console.log('=====================================');
    console.log(`📡 Proxy Server: http://localhost:${PORT}`);
    console.log('🎯 Target Server: http://localhost:3000');
    console.log('');
    console.log('📋 Instructions:');
    console.log('1. Start the main MQTT server: npm start');
    console.log('2. Open your browser to: http://localhost:8080');
    console.log('');
    console.log('✅ This proxy server will:');
    console.log('   - Serve your static files');
    console.log('   - Proxy API calls to localhost:3000');
    console.log('   - Handle CORS issues');
    console.log('   - Proxy WebSocket connections');
    console.log('');
});

// Handle server errors
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use.`);
        console.log('Try using a different port or kill the process using this port.');
    } else {
        console.error('❌ Server error:', error);
    }
});

module.exports = app;

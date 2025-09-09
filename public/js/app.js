class MQTTMonitorApp {
    constructor() {
        this.ws = null;
        this.wsClientId = null; // Track WebSocket client ID
        this.connections = [];
        this.topics = [];
        this.messages = [];
        this.currentConnectionId = null;
        this.monitoringPaused = false;
        this.activeTopicFilter = null;
        this.selectedTopicForExport = null;
        this.topicMessageCounts = new Map();
        this.autoScroll = true;
        this.lastMessageCount = 0;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
        this.dialogOpen = false; // Track if messages dialog is open
        this.init();
    }

    init() {
        this.setupWebSocket();
        this.setupEventListeners();
        this.loadConnections();
        this.initializeMessages();
        this.setupResponsiveHandlers();
        this.setupPageUnloadHandlers(); // Add page unload handling
    }

    // Smart API call function that works with both file:// and http://
    async apiCall(endpoint, options = {}) {
        let url;
        if (window.location.protocol === 'file:') {
            url = `http://localhost:3000${endpoint}`;
        } else {
            url = endpoint;
        }
        
        console.log('API call:', url, options);
        return fetch(url, options);
    }

    // Show error message to user
    showError(message) {
        // You can customize this to show a nice error UI
        alert(message);
        console.error(message);
    }

    showNotification(message, type = 'info') {
        console.log(`📢 ${type.toUpperCase()}: ${message}`);
        // Simple notification - you could enhance this with a toast library
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'success' ? '#2ecc71' : type === 'error' ? '#e74c3c' : '#3498db'};
            color: white;
            border-radius: 8px;
            z-index: 10000;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }

    setupWebSocket() {
        let wsUrl;
        
        if (window.location.protocol === 'file:') {
            // When opening HTML file directly, connect to main server
            wsUrl = 'ws://localhost:3000';
        } else {
            // When accessing via HTTP (proxy or direct), use same host and port
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${protocol}//${window.location.host}`;
        }
        
        console.log('Attempting to connect to WebSocket:', wsUrl);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected successfully');
                this.updateConnectionStatus('connected');
                this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
                
                // Try to restore previous client ID if available
                const storedClientId = localStorage.getItem('wsClientId');
                if (storedClientId) {
                    console.log(`🔄 Attempting to restore WebSocket client ID: ${storedClientId}`);
                    this.ws.send(JSON.stringify({
                        type: 'register',
                        wsClientId: storedClientId
                    }));
                }
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };
            
            this.ws.onclose = (event) => {
                console.log('WebSocket disconnected:', event.code, event.reason);
                this.updateConnectionStatus('disconnected');
                
                // Attempt to reconnect with exponential backoff
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
                    console.log(`Attempting to reconnect WebSocket (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);
                    
                    setTimeout(() => {
                        this.setupWebSocket();
                    }, delay);
                } else {
                    console.error('Max reconnection attempts reached. Please refresh the page.');
                    this.showNotification('Connection lost. Please refresh the page.', 'error');
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateConnectionStatus('error');
            };
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.updateConnectionStatus('error');
            
            // Retry connection after delay
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = this.reconnectDelay;
                setTimeout(() => {
                    console.log('Retrying WebSocket connection...');
                    this.setupWebSocket();
                }, delay);
            }
        }
    }

    updateConnectionStatus(status) {
        const statusElement = document.getElementById('wsStatus');
        statusElement.className = `status ${status}`;
        
        switch (status) {
            case 'connected':
                statusElement.textContent = 'Online';
                break;
            case 'disconnected':
                statusElement.textContent = 'Offline';
                break;
            case 'error':
                statusElement.textContent = 'Error';
                break;
        }
    }

    updateConnectionStatusInUI(connectionId, status) {
        const statusElement = document.getElementById(`status-${connectionId}`);
        if (statusElement) {
            const statusSpan = statusElement.querySelector('.status');
            if (statusSpan) {
                // Remove all status classes
                statusSpan.classList.remove('connected', 'disconnected', 'offline', 'error');
                
                // Add the new status class and update text
                switch (status) {
                    case 'connected':
                        statusSpan.classList.add('connected');
                        statusSpan.textContent = 'Connected';
                        break;
                    case 'disconnected':
                    case 'offline':
                        statusSpan.classList.add('offline');
                        statusSpan.textContent = 'Offline';
                        break;
                    case 'error':
                        statusSpan.classList.add('error');
                        statusSpan.textContent = 'Error';
                        break;
                    default:
                        statusSpan.classList.add('offline');
                        statusSpan.textContent = 'Unknown';
                }
                
                console.log(`🔄 Updated connection ${connectionId} status to: ${status}`);
            }
        }
    }

    handleWebSocketMessage(data) {
        console.log('📨 WebSocket message received:', data.type, data);
        
        switch (data.type) {
            case 'connectionStatus':
                if (data.wsClientId && !this.wsClientId) {
                    this.wsClientId = data.wsClientId;
                    console.log(`🆔 WebSocket client ID assigned: ${this.wsClientId}`);
                    
                    // Store in localStorage for reconnection
                    localStorage.setItem('wsClientId', this.wsClientId);
                }
                
                if (data.connectionId) {
                    console.log('🔗 Connection status update:', data.connectionId, data.status);
                    this.updateConnectionStatusInUI(data.connectionId, data.status);
                } else {
                    console.log('🌐 WebSocket status update:', data.status);
                }
                break;
            case 'message':
                const messageData = data.data;
                console.log('📨 Adding new MQTT message to UI:', messageData);
                console.log(`🔍 Message details - Topic: "${messageData.topic}", Connection: ${messageData.connection_id}`);
                
                // Check if this might be a wildcard match
                const isWildcardLike = messageData.topic.includes('/');
                if (isWildcardLike) {
                    console.log(`🌟 Received message on subtopic: "${messageData.topic}"`);
                }
                
                this.addMessage(messageData);
                break;
            case 'messages':
                console.log('📨 Displaying messages batch:', data.data.length, 'messages');
                this.displayMessages(data.data);
                break;
            case 'ping':
                // Respond to server heartbeat
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ 
                        type: 'pong', 
                        timestamp: Date.now() 
                    }));
                    console.log('💓 Responded to server heartbeat');
                }
                break;
            case 'pong':
                // Server responded to our ping
                console.log('💓 Server heartbeat response received');
                break;
        }
    }

    setupEventListeners() {
        // Connection management
        const addConnectionBtn = document.getElementById('addConnectionBtn');
        if (addConnectionBtn) {
            addConnectionBtn.addEventListener('click', () => {
                console.log('Add Connection button clicked');
                this.toggleConnectionForm();
            });
        } else {
            console.error('Add Connection button not found');
        }

        const cancelConnectionBtn = document.getElementById('cancelConnectionBtn');
        if (cancelConnectionBtn) {
            cancelConnectionBtn.addEventListener('click', () => {
                console.log('Cancel Connection button clicked');
                this.toggleConnectionForm();
            });
        }

        const connectionFormElement = document.getElementById('connectionFormElement');
        if (connectionFormElement) {
            connectionFormElement.addEventListener('submit', (e) => {
                e.preventDefault();
                console.log('Connection form submitted');
                this.saveConnection();
            });
        } else {
            console.error('Connection form element not found');
        }

        // Topic management
        const addTopicBtn = document.getElementById('addTopicBtn');
        if (addTopicBtn) {
            addTopicBtn.addEventListener('click', () => {
                console.log('Add Topic button clicked');
                this.toggleTopicForm();
            });
        } else {
            console.error('Add Topic button not found');
        }

        const cancelTopicBtn = document.getElementById('cancelTopicBtn');
        if (cancelTopicBtn) {
            cancelTopicBtn.addEventListener('click', () => {
                console.log('Cancel Topic button clicked');
                this.toggleTopicForm();
            });
        }

        const topicFormElement = document.getElementById('topicFormElement');
        if (topicFormElement) {
            topicFormElement.addEventListener('submit', (e) => {
                e.preventDefault();
                console.log('Topic form submitted');
                this.saveTopic();
            });
        } else {
            console.error('Topic form element not found');
        }

        // Message management
        const pauseMonitoringBtn = document.getElementById('pauseMonitoringBtn');
        if (pauseMonitoringBtn) {
            pauseMonitoringBtn.addEventListener('click', () => {
                this.toggleMonitoring();
            });
        }

        const autoScrollBtn = document.getElementById('autoScrollBtn');
        if (autoScrollBtn) {
            autoScrollBtn.addEventListener('click', () => {
                this.toggleAutoScroll();
            });
        }

        document.getElementById('clearMessagesBtn').addEventListener('click', () => {
            this.clearMessages();
        });

        document.getElementById('exportMessagesBtn').addEventListener('click', () => {
            this.exportMessages();
        });

        const openMessagesDialogBtn = document.getElementById('openMessagesDialogBtn');
        if (openMessagesDialogBtn) {
            openMessagesDialogBtn.addEventListener('click', () => {
                this.openMessagesDialog();
            });
        }

        const clearTopicFiltersBtn = document.getElementById('clearTopicFiltersBtn');
        if (clearTopicFiltersBtn) {
            clearTopicFiltersBtn.addEventListener('click', () => {
                this.clearTopicFilters();
            });
        }

        // Message limit control removed - messages are real-time only

        // Modal dialogs
        document.querySelector('.close').addEventListener('click', () => {
            this.closeModal();
        });

        window.addEventListener('click', (e) => {
            const modal = document.getElementById('messageModal');
            if (e.target === modal) {
                this.closeModal();
            }
        });

        // Messages dialog event listeners
        this.setupMessagesDialogEventListeners();
    }

    async loadConnections() {
        try {
            console.log('Loading connections...');
            const response = await this.apiCall('/api/connections');
            
            if (response.ok) {
                this.connections = await response.json();
                console.log('Connections loaded:', this.connections);
                this.displayConnections();
                this.updateConnectionSelects();
            } else {
                console.error('Failed to load connections:', response.status, response.statusText);
                this.showError('Failed to load connections: ' + response.statusText);
            }
        } catch (error) {
            console.error('Error loading connections:', error);
            if (window.location.protocol === 'file:') {
                this.showError('Failed to connect to server. Please ensure the server is running:\n1. Open terminal\n2. Run: npm start\n3. Or visit: http://localhost:3000');
            } else {
                this.showError('Failed to load connections: ' + error.message);
            }
        }
    }

    displayConnections() {
        const container = document.getElementById('connectionsList');
        container.innerHTML = '';

        this.connections.forEach(connection => {
            const connectionElement = this.createConnectionElement(connection);
            container.appendChild(connectionElement);
        });

        // Enable/disable Add Topic button based on whether connections exist
        const addTopicBtn = document.getElementById('addTopicBtn');
        if (addTopicBtn) {
            addTopicBtn.disabled = this.connections.length === 0;
        }
    }

    updateConnectionSelects() {
        const topicConnectionSelect = document.getElementById('topicConnection');
        if (topicConnectionSelect) {
            // Clear existing options except the first one
            topicConnectionSelect.innerHTML = '<option value="">Please select a connection</option>';
            
            // Add all connections as options
            this.connections.forEach(connection => {
                const option = document.createElement('option');
                option.value = connection.id;
                option.textContent = connection.name;
                topicConnectionSelect.appendChild(option);
            });
        }
    }

    createConnectionElement(connection) {
        const div = document.createElement('div');
        div.className = 'connection-item';
        
        // Format the connection display based on whether it's WebSocket or traditional MQTT
        let connectionDisplay;
        if (connection.host.startsWith('ws://') || connection.host.startsWith('wss://')) {
            connectionDisplay = connection.host;
        } else if (connection.port === 0) {
            // Port 0 indicates WebSocket URL stored in host field
            connectionDisplay = connection.host;
        } else {
            connectionDisplay = `${connection.host}:${connection.port}`;
        }
        
        div.innerHTML = `
            <div class="connection-info">
                <h3>${connection.name}</h3>
                <p><i class="fas fa-server"></i> ${connectionDisplay}</p>
                <p><i class="fas fa-user"></i> ${connection.username || 'No username'}</p>
            </div>
            <div class="connection-actions">
                <button class="btn btn-sm btn-info" onclick="app.showConnectionDetail(${connection.id})">
                    <i class="fas fa-info-circle"></i> Details
                </button>
                <button class="btn btn-sm btn-success" onclick="app.connectMQTT(${connection.id})">
                    <i class="fas fa-play"></i> Connect
                </button>
                <button class="btn btn-sm btn-warning" onclick="app.disconnectMQTT(${connection.id})">
                    <i class="fas fa-stop"></i> Disconnect
                </button>
                <button class="btn btn-sm btn-secondary" onclick="app.loadTopics(${connection.id})">
                    <i class="fas fa-list"></i> Topics
                </button>
                <button class="btn btn-sm btn-danger" onclick="app.deleteConnection(${connection.id})">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
            <div class="connection-status" id="status-${connection.id}">
                <span class="status offline">Offline</span>
            </div>
        `;
        return div;
    }

    async saveConnection() {
        const hostValue = document.getElementById('connectionHost').value;
        const portValue = document.getElementById('connectionPort').value;
        
        const formData = {
            name: document.getElementById('connectionName').value,
            host: hostValue,
            port: portValue ? parseInt(portValue) : (hostValue.startsWith('ws://') || hostValue.startsWith('wss://') ? 0 : 1883),
            username: document.getElementById('connectionUsername').value || null,
            password: document.getElementById('connectionPassword').value || null,
            client_id: document.getElementById('connectionClientId').value || null,
            keepalive: 60,
            clean_session: true
        };

        // Validate required fields
        if (!formData.name || !formData.host) {
            alert('Please fill in the connection name and host address');
            return;
        }

        // For non-WebSocket URLs, port is required
        if (!hostValue.startsWith('ws://') && !hostValue.startsWith('wss://') && !formData.port) {
            alert('For traditional MQTT connections, port is required');
            return;
        }

        try {
            console.log('Saving connection:', formData);
            const response = await this.apiCall('/api/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Connection saved successfully:', result);
                this.toggleConnectionForm();
                this.loadConnections();
                this.clearConnectionForm();
                alert('Connection saved successfully!');
            } else {
                const error = await response.json();
                console.error('Server error:', error);
                alert('Failed to save connection: ' + (error.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error saving connection:', error);
            alert('Failed to save connection: ' + error.message);
        }
    }

    async connectMQTT(connectionId) {
        try {
            const requestBody = { connectionId };
            
            // Include WebSocket client ID if available
            if (this.wsClientId) {
                requestBody.wsClientId = this.wsClientId;
                console.log(`🆔 Connecting MQTT with WebSocket client ID: ${this.wsClientId}`);
            }
            
            const response = await this.apiCall('/api/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (response.ok) {
                this.currentConnectionId = connectionId;
                this.loadTopics(connectionId);
                this.initializeMessages();
                this.showNotification('MQTT connection established', 'success');
            } else {
                const error = await response.json();
                this.showNotification('Failed to connect: ' + error.error, 'error');
            }
        } catch (error) {
            console.error('Error connecting to MQTT:', error);
            this.showNotification('Failed to connect: ' + error.message, 'error');
        }
    }

    async disconnectMQTT(connectionId) {
        try {
            const response = await this.apiCall('/api/disconnect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connectionId })
            });

            if (response.ok) {
                this.updateConnectionStatusInUI(connectionId, 'disconnected');
                this.showNotification('MQTT connection disconnected', 'success');
            } else {
                const error = await response.json();
                this.showNotification('Failed to disconnect: ' + error.error, 'error');
            }
        } catch (error) {
            console.error('Error disconnecting from MQTT:', error);
            this.showNotification('Failed to disconnect: ' + error.message, 'error');
        }
    }

    async deleteConnection(connectionId) {
        if (confirm('Are you sure you want to delete this connection? This will also delete related topics and messages.')) {
            try {
                const response = await this.apiCall(`/api/connections/${connectionId}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    this.loadConnections();
                    this.loadTopics(this.currentConnectionId);
                } else {
                    const error = await response.json();
                    alert('Failed to delete connection: ' + error.error);
                }
            } catch (error) {
                console.error('Error deleting connection:', error);
                alert('Failed to delete connection: ' + error.message);
            }
        }
    }

    async toggleTopicStatus(topicId, newStatus) {
        try {
            console.log(`🔄 Toggling topic ${topicId} to ${newStatus ? 'active' : 'inactive'}`);
            
            const response = await this.apiCall(`/api/topics/${topicId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: newStatus })
            });

            if (response.ok) {
                console.log(`✅ Topic status updated successfully`);
                this.loadTopics(this.currentConnectionId);
                
                // Show user feedback
                const statusText = newStatus ? 'Active' : 'Inactive';
                this.showNotification(`Topic is ${statusText}`, 'success');
            } else {
                const error = await response.json();
                console.error('❌ Error updating topic status:', error);
                alert('Failed to update topic status: ' + error.error);
            }
        } catch (error) {
            console.error('Error toggling topic status:', error);
            alert('Failed to update topic status: ' + error.message);
        }
    }

    async deleteTopic(topicId) {
        if (confirm('Are you sure you want to delete this topic?')) {
            try {
                const response = await this.apiCall(`/api/topics/${topicId}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    this.loadTopics(this.currentConnectionId);
                    this.showNotification('Topic deleted', 'success');
                } else {
                    const error = await response.json();
                    alert('Failed to delete topic: ' + error.error);
                }
            } catch (error) {
                console.error('Error deleting topic:', error);
                alert('Failed to delete topic: ' + error.message);
            }
        }
    }

    async loadTopics(connectionId) {
        try {
            const response = await this.apiCall(`/api/connections/${connectionId}/topics`);
            this.topics = await response.json();
            this.displayTopics();
        } catch (error) {
            console.error('Error loading topics:', error);
        }
    }

    displayTopics() {
        const container = document.getElementById('topicsList');
        container.innerHTML = '';
        
        // Count active and inactive topics
        const activeCount = this.topics.filter(t => t.active).length;
        const inactiveCount = this.topics.filter(t => !t.active).length;
        
        // Update section header with counts
        const sectionHeader = document.querySelector('#topicsSection .section-header h2');
        if (sectionHeader) {
            sectionHeader.innerHTML = `<i class="fas fa-list"></i> Topic Management <small style="font-size: 0.7rem; color: #b0b0b0;">(${activeCount} Active, ${inactiveCount} Inactive)</small>`;
        }
        
        this.topics.forEach(topic => {
            const topicElement = this.createTopicElement(topic);
            container.appendChild(topicElement);
        });
    }

    createTopicElement(topic) {
        const div = document.createElement('div');
        div.className = `topic-item ${topic.active ? 'topic-active' : 'topic-inactive'}`;
        
        const toggleButtonClass = topic.active ? 'btn-warning' : 'btn-success';
        const toggleIcon = topic.active ? 'fa-pause' : 'fa-play';
        const toggleText = topic.active ? 'Pause' : 'Activate';
        
        div.innerHTML = `
            <div class="topic-info">
                <h4>${topic.topic}</h4>
                <p><i class="fas fa-layer-group"></i> QoS: ${topic.qos} | Status: ${topic.active ? 'Active' : 'Inactive'}</p>
            </div>
            <div class="topic-actions">
                <button class="btn btn-sm ${toggleButtonClass}" onclick="app.toggleTopicStatus(${topic.id}, ${!topic.active})">
                    <i class="fas ${toggleIcon}"></i> ${toggleText}
                </button>
                <button class="btn btn-sm btn-danger" onclick="app.deleteTopic(${topic.id})">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        `;
        return div;
    }

    async saveTopic() {
        const formData = {
            connection_id: parseInt(document.getElementById('topicConnection').value),
            topic: document.getElementById('topicName').value,
            qos: parseInt(document.getElementById('topicQos').value),
            active: true
        };

        try {
            const response = await this.apiCall('/api/topics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                this.toggleTopicForm();
                this.loadTopics(this.currentConnectionId);
                this.clearTopicForm();
            } else {
                const error = await response.json();
                alert('Failed to save topic: ' + error.error);
            }
        } catch (error) {
            console.error('Error saving topic:', error);
            alert('Failed to save topic: ' + error.message);
        }
    }

    // Message loading removed - messages are only displayed in real-time via WebSocket
    initializeMessages() {
        this.messages = [];
        this.displayMessages(this.messages);
        console.log('📡 Messages will be displayed in real-time only (not loaded from database)');
    }

    displayMessages(messages) {
        const container = document.getElementById('messagesList');
        const messagesContainer = document.getElementById('messagesList').parentElement;
        
        // Check if user was scrolled to bottom before update
        const wasScrolledToBottom = messagesContainer.scrollTop + messagesContainer.clientHeight >= messagesContainer.scrollHeight - 10;
        
        // Only do full refresh if message count changed significantly or it's a filter operation
        const isNewMessage = messages.length > this.lastMessageCount;
        const isFilter = messages.length < this.messages.length;
        
        if (isFilter || !isNewMessage) {
            // Full refresh for filtering - display oldest to newest (top to bottom)
            container.innerHTML = '';
            messages.slice().reverse().forEach(message => {
                const messageElement = this.createMessageElement(message);
                container.appendChild(messageElement);
            });
        } else {
            // Incremental update for new messages - add at bottom
            const newMessages = messages.slice(0, messages.length - this.lastMessageCount);
            newMessages.reverse().forEach(message => {
                const messageElement = this.createMessageElement(message);
                messageElement.classList.add('new-message');
                container.appendChild(messageElement);
                
                // Remove the new-message class after animation
                setTimeout(() => {
                    messageElement.classList.remove('new-message');
                }, 500);
            });
        }
        
        this.lastMessageCount = messages.length;
        
        // Auto-scroll to bottom if user was at bottom or if auto-scroll is enabled
        if (this.autoScroll && (wasScrolledToBottom || isNewMessage)) {
            setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 100);
        }
        
        // Update message counter
        this.updateMessageCounter(messages.length);
    }

    updateMessageCounter(count) {
        const header = document.querySelector('#messagesList').closest('.section').querySelector('h2');
        if (header) {
            const counterSpan = header.querySelector('.message-counter') || document.createElement('span');
            counterSpan.className = 'message-counter';
            counterSpan.textContent = `(${count})`;
            if (!header.querySelector('.message-counter')) {
                header.appendChild(counterSpan);
            }
        }
    }

    createMessageElement(message) {
        const div = document.createElement('div');
        const isRecent = Date.now() - new Date(message.timestamp).getTime() < 5000; // 5 seconds
        div.className = `message-item ${isRecent ? 'recent' : ''}`;
        
        const formattedMessage = this.formatMessageContent(message.message);
        
        div.innerHTML = `
            <div class="message-header">
                <span class="message-topic">${message.topic}</span>
                <span class="message-time">${new Date(message.timestamp).toLocaleString()}</span>
            </div>
            <div class="message-content">
                <pre class="json-content">${formattedMessage}</pre>
            </div>
            <div class="message-meta">
                <span class="message-qos">QoS: ${message.qos}</span>
                <span class="message-retained">${message.retained ? 'Retained' : 'Not Retained'}</span>
                <button class="btn btn-sm btn-info" onclick="app.showMessageDetail(${message.id})">
                    <i class="fas fa-eye"></i> Details
                </button>
            </div>
        `;
        return div;
    }

    formatMessageContent(messageContent) {
        try {
            // Try to parse as JSON
            const jsonObj = JSON.parse(messageContent);
            const formatted = JSON.stringify(jsonObj, null, 2);
            
            // Apply syntax highlighting
            return this.syntaxHighlight(formatted);
        } catch (e) {
            // If not valid JSON, try to detect if it looks like JSON and fix common issues
            let content = messageContent.trim();
            
            // Check if it looks like JSON but might have issues
            if ((content.startsWith('{') && content.endsWith('}')) || 
                (content.startsWith('[') && content.endsWith(']'))) {
                try {
                    // Try to fix common JSON issues
                    content = content
                        .replace(/'/g, '"')  // Replace single quotes with double quotes
                        .replace(/(\w+):/g, '"$1":')  // Add quotes around keys
                        .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
                        .replace(/\n/g, ' ')  // Replace newlines with spaces
                        .replace(/\s+/g, ' ');  // Normalize whitespace
                    
                    const jsonObj = JSON.parse(content);
                    const formatted = JSON.stringify(jsonObj, null, 2);
                    return this.syntaxHighlight(formatted);
                } catch (e2) {
                    // Still not valid JSON, return as plain text
                    return this.escapeHtml(messageContent);
                }
            }
            
            // Not JSON-like, return as plain text
            return this.escapeHtml(messageContent);
        }
    }

    syntaxHighlight(json) {
        if (typeof json !== 'string') {
            json = JSON.stringify(json, undefined, 2);
        }
        
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            let cls = 'json-number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'json-key';
                } else {
                    cls = 'json-string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'json-boolean';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        });
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    addMessage(message) {
        console.log('➕ Adding message to local array:', message);
        this.messages.unshift(message);
        if (this.messages.length > 1000) {
            this.messages = this.messages.slice(0, 1000);
        }
        
        // Update topic message counts
        const count = this.topicMessageCounts.get(message.topic) || 0;
        this.topicMessageCounts.set(message.topic, count + 1);
        
        console.log(`📊 Total messages in array: ${this.messages.length}`);
        this.updateTopicTags();
        this.updateExportButtonText();
        this.displayMessages(this.messages);
        
        // Update dialog if open
        if (this.dialogOpen) {
            this.updateDialogTopicTags();
            this.updateDialogMessages();
        }
    }

    async toggleMonitoring() {
        this.monitoringPaused = !this.monitoringPaused;
        const btn = document.getElementById('pauseMonitoringBtn');
        
        if (this.monitoringPaused) {
            btn.innerHTML = '<i class="fas fa-play"></i> Resume Monitoring';
            btn.className = 'btn btn-success';
        } else {
            btn.innerHTML = '<i class="fas fa-pause"></i> Pause Monitoring';
            btn.className = 'btn btn-secondary';
        }

        // Notify server about pause state for all connections
        for (const connection of this.connections) {
            try {
                await this.apiCall('/api/pause-monitoring', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        connectionId: connection.id, 
                        paused: this.monitoringPaused 
                    })
                });
            } catch (error) {
                console.error('Error toggling monitoring:', error);
            }
        }
    }

    toggleAutoScroll() {
        this.autoScroll = !this.autoScroll;
        const btn = document.getElementById('autoScrollBtn');
        
        if (this.autoScroll) {
            btn.innerHTML = '<i class="fas fa-arrow-down"></i> Auto Scroll';
            btn.className = 'btn btn-success';
            
            // Scroll to bottom immediately when enabled
            const messagesContainer = document.getElementById('messagesList').parentElement;
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } else {
            btn.innerHTML = '<i class="fas fa-hand-paper"></i> Manual Scroll';
            btn.className = 'btn btn-secondary';
        }
    }


    updateTopicTags() {
        const container = document.getElementById('topicTagsContainer');
        if (!container) return;

        // Group messages by topic and connection
        const topicGroups = {};
        this.messages.forEach(message => {
            const key = `${message.topic}|${message.connection_id}`;
            if (!topicGroups[key]) {
                topicGroups[key] = {
                    topic: message.topic,
                    connection_id: message.connection_id,
                    count: 0
                };
            }
            topicGroups[key].count++;
        });

        container.innerHTML = '';

        Object.values(topicGroups).forEach(group => {
            const connection = this.connections.find(c => c.id === group.connection_id);
            const connectionName = connection ? connection.name : `Connection ${group.connection_id}`;
            
            const count = group.count;
            const tag = document.createElement('div');
            const isActive = this.activeTopicFilter === group.topic;
            const isSelected = this.selectedTopicForExport === group.topic;
            tag.className = `topic-tag ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`;
            tag.innerHTML = `
                <div class="topic-name">${group.topic}</div>
                <div class="connection-row">
                    <div class="connection-name">📡 ${connectionName}</div>
                    <span class="message-count">${count}</span>
                </div>
            `;
            
            // Single click for filtering
            tag.addEventListener('click', () => {
                this.filterByTopic(group.topic);
            });
            
            // Double click for export selection
            tag.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.selectTopicForExport(group.topic);
            });
            
            container.appendChild(tag);
        });
    }

    filterByTopic(topic) {
        if (this.activeTopicFilter === topic) {
            this.activeTopicFilter = null;
        } else {
            this.activeTopicFilter = topic;
        }
        this.updateTopicTags();
        this.filterMessages();
    }

    clearTopicFilters() {
        this.activeTopicFilter = null;
        this.updateTopicTags();
        this.filterMessages();
    }

    filterMessages() {
        let filteredMessages = this.messages;
        if (this.activeTopicFilter) {
            filteredMessages = filteredMessages.filter(m => m.topic === this.activeTopicFilter);
        }
        this.displayMessages(filteredMessages);
        
        // Update dialog if open
        if (this.dialogOpen) {
            this.updateDialogMessages();
        }
    }

    clearMessages() {
        this.messages = [];
        this.topicMessageCounts.clear();
        this.displayMessages(this.messages);
        this.updateTopicTags();
        this.updateExportButtonText();
        
        // Update dialog if open
        if (this.dialogOpen) {
            this.updateDialogTopicTags();
            this.updateDialogMessages();
        }
        
        this.showNotification('Messages cleared', 'success');
        console.log('🗑️ All messages cleared');
    }

    exportMessages() {
        let messagesToExport;
        let filename;
        
        if (this.selectedTopicForExport) {
            // Export messages for selected topic only
            messagesToExport = this.messages.filter(m => m.topic === this.selectedTopicForExport);
            filename = `mqtt_messages_${this.selectedTopicForExport.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.json`;
        } else {
            // Export all messages
            messagesToExport = this.messages;
            filename = `mqtt_messages_all_${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.json`;
        }
        
        if (messagesToExport.length === 0) {
            this.showNotification('No messages to export', 'warning');
            return;
        }
        
        // Create export data
        const exportData = {
            exportedAt: new Date().toISOString(),
            totalMessages: messagesToExport.length,
            topicFilter: this.selectedTopicForExport || 'all',
            messages: messagesToExport
        };
        
        // Create downloadable JSON file
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // Create download link and trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showNotification(`Exported ${messagesToExport.length} messages`, 'success');
        console.log(`📤 Exported ${messagesToExport.length} messages to ${filename}`);
    }

    selectTopicForExport(topic) {
        if (this.selectedTopicForExport === topic) {
            // Deselect if already selected
            this.selectedTopicForExport = null;
            this.showNotification('Topic deselected for export', 'info');
        } else {
            // Select new topic
            this.selectedTopicForExport = topic;
            this.showNotification(`Topic "${topic}" selected for export`, 'success');
        }
        this.updateTopicTags();
        this.updateExportButtonText();
    }

    updateExportButtonText() {
        const exportBtn = document.getElementById('exportMessagesBtn');
        if (exportBtn) {
            if (this.selectedTopicForExport) {
                const messageCount = this.messages.filter(m => m.topic === this.selectedTopicForExport).length;
                exportBtn.innerHTML = `<i class="fas fa-download"></i> Export Topic (${messageCount})`;
            } else {
                exportBtn.innerHTML = `<i class="fas fa-download"></i> Export Messages`;
            }
        }
    }

    showConnectionDetail(connectionId) {
        const connection = this.connections.find(c => c.id === connectionId);
        if (connection) {
            // Create connection detail modal content
            const modalContent = `
                <div id="connectionDetailModal" class="modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3>Connection Details</h3>
                            <span class="close" onclick="app.closeConnectionDetailModal()">&times;</span>
                        </div>
                        <div class="modal-body">
                            <div class="connection-detail">
                                <div class="detail-row">
                                    <label>Connection Name:</label>
                                    <span>${connection.name}</span>
                                </div>
                                <div class="detail-row">
                                    <label>Host Address:</label>
                                    <span class="connection-url">${connection.host}</span>
                                </div>
                                <div class="detail-row">
                                    <label>Port:</label>
                                    <span>${connection.port === 0 ? 'WebSocket URL' : connection.port}</span>
                                </div>
                                <div class="detail-row">
                                    <label>Username:</label>
                                    <span>${connection.username || 'No username'}</span>
                                </div>
                                <div class="detail-row">
                                    <label>Client ID:</label>
                                    <span>${connection.client_id || 'Auto generated'}</span>
                                </div>
                                <div class="detail-row">
                                    <label>Connection Type:</label>
                                    <span>${connection.host.startsWith('wss://') ? 'WebSocket Secure (WSS)' : 
                                           connection.host.startsWith('ws://') ? 'WebSocket (WS)' : 
                                           connection.port === 8883 ? 'MQTT Secure (MQTTS)' : 'MQTT'}</span>
                                </div>
                                <div class="detail-row">
                                    <label>Full URL:</label>
                                    <pre class="connection-full-url">${connection.host.startsWith('ws') ? connection.host : 
                                        (connection.port === 8883 ? 'mqtts://' : 'mqtt://') + connection.host + ':' + connection.port}</pre>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Remove existing modal if present
            const existingModal = document.getElementById('connectionDetailModal');
            if (existingModal) {
                existingModal.remove();
            }
            
            // Add new modal to body
            document.body.insertAdjacentHTML('beforeend', modalContent);
            document.getElementById('connectionDetailModal').style.display = 'block';
        }
    }

    closeConnectionDetailModal() {
        const modal = document.getElementById('connectionDetailModal');
        if (modal) {
            modal.style.display = 'none';
            modal.remove();
        }
    }

    showMessageDetail(messageId) {
        const message = this.messages.find(m => m.id === messageId);
        if (message) {
            document.getElementById('modalTopic').textContent = message.topic;
            document.getElementById('modalConnection').textContent = message.connection_id;
            document.getElementById('modalTimestamp').textContent = new Date(message.timestamp).toLocaleString();
            document.getElementById('modalQos').textContent = message.qos;
            document.getElementById('modalRetained').textContent = message.retained ? 'Yes' : 'No';
            
            // Format the message content as JSON with syntax highlighting
            const modalMessageElement = document.getElementById('modalMessage');
            const formattedMessage = this.formatMessageContent(message.message);
            modalMessageElement.innerHTML = formattedMessage;
            modalMessageElement.className = 'json-content';
            
            document.getElementById('messageModal').style.display = 'block';
        }
    }

    setupMessagesDialogEventListeners() {
        // Close dialog
        const closeDialog = document.querySelector('.close-dialog');
        if (closeDialog) {
            closeDialog.addEventListener('click', () => {
                this.closeMessagesDialog();
            });
        }

        // Dialog controls
        const dialogPauseBtn = document.getElementById('dialogPauseBtn');
        if (dialogPauseBtn) {
            dialogPauseBtn.addEventListener('click', () => {
                this.toggleMonitoring();
                this.updateDialogControls();
            });
        }

        const dialogAutoScrollBtn = document.getElementById('dialogAutoScrollBtn');
        if (dialogAutoScrollBtn) {
            dialogAutoScrollBtn.addEventListener('click', () => {
                this.toggleAutoScroll();
                this.updateDialogControls();
            });
        }

        const dialogClearBtn = document.getElementById('dialogClearBtn');
        if (dialogClearBtn) {
            dialogClearBtn.addEventListener('click', () => {
                this.clearMessages();
            });
        }

        const dialogExportBtn = document.getElementById('dialogExportBtn');
        if (dialogExportBtn) {
            dialogExportBtn.addEventListener('click', () => {
                this.exportMessages();
            });
        }

        const dialogClearFiltersBtn = document.getElementById('dialogClearFiltersBtn');
        if (dialogClearFiltersBtn) {
            dialogClearFiltersBtn.addEventListener('click', () => {
                this.clearTopicFilters();
            });
        }

        // Close dialog when clicking outside
        window.addEventListener('click', (e) => {
            const messagesDialog = document.getElementById('messagesDialog');
            if (e.target === messagesDialog) {
                this.closeMessagesDialog();
            }
        });

        // Close dialog with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.dialogOpen) {
                this.closeMessagesDialog();
            }
        });
    }

    openMessagesDialog() {
        const dialog = document.getElementById('messagesDialog');
        if (dialog) {
            dialog.style.display = 'block';
            this.dialogOpen = true;
            
            // Update dialog content
            this.updateDialogTopicTags();
            this.updateDialogMessages();
            this.updateDialogControls();
            
            console.log('📱 Messages dialog opened');
            this.showNotification('Messages dialog opened', 'info');
        }
    }

    closeMessagesDialog() {
        const dialog = document.getElementById('messagesDialog');
        if (dialog) {
            dialog.style.display = 'none';
            this.dialogOpen = false;
            console.log('📱 Messages dialog closed');
        }
    }

    updateDialogControls() {
        // Update pause button
        const dialogPauseBtn = document.getElementById('dialogPauseBtn');
        if (dialogPauseBtn) {
            if (this.monitoringPaused) {
                dialogPauseBtn.innerHTML = '<i class="fas fa-play"></i> Resume';
                dialogPauseBtn.className = 'btn btn-sm btn-success';
            } else {
                dialogPauseBtn.innerHTML = '<i class="fas fa-pause"></i> Pause';
                dialogPauseBtn.className = 'btn btn-sm btn-secondary';
            }
        }

        // Update auto scroll button
        const dialogAutoScrollBtn = document.getElementById('dialogAutoScrollBtn');
        if (dialogAutoScrollBtn) {
            if (this.autoScroll) {
                dialogAutoScrollBtn.innerHTML = '<i class="fas fa-arrow-down"></i> Auto Scroll';
                dialogAutoScrollBtn.className = 'btn btn-sm btn-success';
            } else {
                dialogAutoScrollBtn.innerHTML = '<i class="fas fa-hand-paper"></i> Manual Scroll';
                dialogAutoScrollBtn.className = 'btn btn-sm btn-secondary';
            }
        }
    }

    updateDialogTopicTags() {
        const container = document.getElementById('dialogTopicTagsContainer');
        if (!container) return;

        // Reuse the same logic as the main topic tags
        const topicGroups = {};
        this.messages.forEach(message => {
            const key = `${message.topic}|${message.connection_id}`;
            if (!topicGroups[key]) {
                topicGroups[key] = {
                    topic: message.topic,
                    connection_id: message.connection_id,
                    count: 0
                };
            }
            topicGroups[key].count++;
        });

        container.innerHTML = '';

        Object.values(topicGroups).forEach(group => {
            const connection = this.connections.find(c => c.id === group.connection_id);
            const connectionName = connection ? connection.name : `Connection ${group.connection_id}`;
            
            const count = group.count;
            const tag = document.createElement('div');
            const isActive = this.activeTopicFilter === group.topic;
            const isSelected = this.selectedTopicForExport === group.topic;
            tag.className = `topic-tag ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`;
            tag.innerHTML = `
                <div class="topic-name">${group.topic}</div>
                <div class="connection-row">
                    <div class="connection-name">📡 ${connectionName}</div>
                    <span class="message-count">${count}</span>
                </div>
            `;
            
            // Single click for filtering
            tag.addEventListener('click', () => {
                this.filterByTopic(group.topic);
                this.updateDialogTopicTags(); // Update dialog tags
            });
            
            // Double click for export selection
            tag.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.selectTopicForExport(group.topic);
                this.updateDialogTopicTags(); // Update dialog tags
            });
            
            container.appendChild(tag);
        });
    }

    updateDialogMessages() {
        const container = document.getElementById('dialogMessagesList');
        const countElement = document.getElementById('dialogMessageCount');
        
        if (!container) return;

        // Apply the same filtering as main messages
        let filteredMessages = this.messages;
        if (this.activeTopicFilter) {
            filteredMessages = filteredMessages.filter(m => m.topic === this.activeTopicFilter);
        }

        // Update count
        if (countElement) {
            countElement.textContent = `(${filteredMessages.length})`;
        }

        // Clear and rebuild message list
        container.innerHTML = '';
        
        // Display messages (oldest to newest, like main view)
        filteredMessages.slice().reverse().forEach(message => {
            const messageElement = this.createMessageElement(message);
            container.appendChild(messageElement);
        });

        // Auto-scroll to bottom if enabled
        if (this.autoScroll) {
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 100);
        }
    }

    async toggleConnectionForm() {
        const form = document.getElementById('connectionForm');
        if (form) {
            const isHidden = form.style.display === 'none' || form.style.display === '';
            form.style.display = isHidden ? 'block' : 'none';
            console.log('Connection form toggled:', isHidden ? 'shown' : 'hidden');
        } else {
            console.error('Connection form element not found');
        }
    }

    async toggleTopicForm() {
        const form = document.getElementById('topicForm');
        if (form) {
            const isHidden = form.style.display === 'none' || form.style.display === '';
            form.style.display = isHidden ? 'block' : 'none';
            console.log('Topic form toggled:', isHidden ? 'shown' : 'hidden');
        } else {
            console.error('Topic form element not found');
        }
    }

    clearConnectionForm() {
        document.getElementById('connectionFormElement').reset();
    }

    clearTopicForm() {
        document.getElementById('topicFormElement').reset();
    }

    closeModal() {
        document.getElementById('messageModal').style.display = 'none';
    }

    setupResponsiveHandlers() {
        // Handle window resize events
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.handleResize();
            }, 250);
        });

        // Handle orientation change on mobile devices
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.handleResize();
            }, 500);
        });
    }

    handleResize() {
        // Adjust message container height based on screen size
        const messagesContainer = document.querySelector('.messages-container');
        if (messagesContainer) {
            const viewportHeight = window.innerHeight;
            const isMobile = window.innerWidth <= 768;
            const isSmallMobile = window.innerWidth <= 480;
            
            if (isSmallMobile) {
                messagesContainer.style.maxHeight = '40vh';
                messagesContainer.style.minHeight = '200px';
            } else if (isMobile) {
                messagesContainer.style.maxHeight = '50vh';
                messagesContainer.style.minHeight = '250px';
            } else if (viewportHeight < 800) {
                messagesContainer.style.maxHeight = '60vh';
                messagesContainer.style.minHeight = '300px';
            } else {
                messagesContainer.style.maxHeight = 'calc(100vh - 320px)';
                messagesContainer.style.minHeight = '200px';
            }
        }

        // Adjust button layouts for smaller screens
        this.adjustButtonLayouts();
        
        // Recalculate message display if needed
        if (this.messages.length > 0) {
            this.displayMessages(this.messages);
        }
    }

    adjustButtonLayouts() {
        const messageControls = document.querySelector('.message-controls');
        if (messageControls) {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                messageControls.style.flexWrap = 'wrap';
                messageControls.style.justifyContent = 'center';
                messageControls.style.gap = '6px';
            } else {
                messageControls.style.flexWrap = 'nowrap';
                messageControls.style.justifyContent = 'flex-start';
                messageControls.style.gap = '8px';
            }
        }

        // Adjust connection and topic action buttons
        const actionButtons = document.querySelectorAll('.connection-actions, .topic-actions');
        actionButtons.forEach(actions => {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                actions.style.flexWrap = 'wrap';
                actions.style.justifyContent = 'center';
                actions.style.gap = '6px';
            } else {
                actions.style.flexWrap = 'nowrap';
                actions.style.justifyContent = 'flex-end';
                actions.style.gap = '8px';
            }
        });
    }

    setupPageUnloadHandlers() {
        // Handle page unload/refresh/close events
        const handlePageUnload = (event) => {
            console.log('🚪 Page unloading, cleaning up connections...');
            
            // Send disconnect signal for all active MQTT connections if WebSocket is still open
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try {
                    // Send a cleanup message to server
                    this.ws.send(JSON.stringify({
                        type: 'cleanup',
                        wsClientId: this.wsClientId
                    }));
                    
                    // Small delay to allow message to be sent
                    const start = Date.now();
                    while (Date.now() - start < 100) {
                        // Busy wait for a short time
                    }
                } catch (error) {
                    console.error('Error sending cleanup message:', error);
                }
            }
            
            // Clear stored client ID
            localStorage.removeItem('wsClientId');
        };

        // Handle different page unload scenarios
        window.addEventListener('beforeunload', handlePageUnload);
        window.addEventListener('unload', handlePageUnload);
        
        // Handle browser tab/window close
        window.addEventListener('pagehide', (event) => {
            if (event.persisted) {
                console.log('🔄 Page cached, maintaining connections');
            } else {
                handlePageUnload(event);
            }
        });
        
        // Handle visibility changes (tab switch, minimize)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('👁️ Page hidden (tab switched or minimized)');
                // Don't disconnect on visibility change, only on actual page unload
            } else {
                console.log('👁️ Page visible again');
                // Ensure WebSocket connection is still alive
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    console.log('🔄 Reconnecting WebSocket after visibility change');
                    this.setupWebSocket();
                }
            }
        });
    }
}

// Initialize application
const app = new MQTTMonitorApp();

const sqlite3 = require("sqlite3").verbose();
const path = require("path");

class Database {
  constructor() {
    // Use data directory in Docker, current directory otherwise
    const dbPath = process.env.NODE_ENV === 'production' 
      ? path.join(__dirname, "data", "mqtt_monitor.db")
      : path.join(__dirname, "mqtt_monitor.db");
    
    console.log(`📁 Database path: ${dbPath}`);
    this.db = new sqlite3.Database(dbPath);
    this.configureDatabase();
    this.initTables();
  }

  configureDatabase() {
    // Minimal database configuration to avoid SQLITE_BUSY errors
    try {
      // Only set the most essential PRAGMA - busy timeout
      this.db.run("PRAGMA busy_timeout = 10000", (err) => {
        if (err) {
          console.log('Warning: Could not set busy_timeout, continuing without it');
        } else {
          console.log('✅ Database busy timeout set to 10 seconds');
        }
      });
    } catch (error) {
      console.log('Warning: Database configuration minimal setup failed, continuing...');
    }
  }

  initTables() {
    // MQTT連接配置表
    this.db.run(`CREATE TABLE IF NOT EXISTS mqtt_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      client_id TEXT,
      keepalive INTEGER DEFAULT 60,
      clean_session BOOLEAN DEFAULT true,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // MQTT主題配置表
    this.db.run(`CREATE TABLE IF NOT EXISTS mqtt_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL,
      topic TEXT NOT NULL,
      qos INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT true,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES mqtt_connections (id)
    )`);

    // MQTT messages are no longer stored in database - only real-time display
  }


  async addConnection(connectionData) {
    return new Promise((resolve, reject) => {
      const { name, host, port, username, password, client_id, keepalive, clean_session } = connectionData;
      this.db.run(
        `INSERT INTO mqtt_connections (name, host, port, username, password, client_id, keepalive, clean_session) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, host, port, username, password, client_id, keepalive, clean_session],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, ...connectionData });
        }
      );
    });
  }

  async getConnections() {
    return new Promise((resolve, reject) => {
      this.db.all("SELECT * FROM mqtt_connections ORDER BY created_at DESC", (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async addTopic(topicData) {
    return new Promise((resolve, reject) => {
      const { connection_id, topic, qos, active } = topicData;
      this.db.run(
        `INSERT INTO mqtt_topics (connection_id, topic, qos, active) VALUES (?, ?, ?, ?)`,
        [connection_id, topic, qos, active],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, ...topicData });
        }
      );
    });
  }

  async getTopics(connectionId) {
    return new Promise((resolve, reject) => {
      this.db.all("SELECT * FROM mqtt_topics WHERE connection_id = ? ORDER BY created_at DESC", [connectionId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async getAllActiveTopics() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT t.*, c.name as connection_name, c.host, c.port 
        FROM mqtt_topics t 
        JOIN mqtt_connections c ON t.connection_id = c.id 
        WHERE t.active = 1 
        ORDER BY t.created_at DESC`
      , (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Message storage methods removed - messages are only displayed in real-time

  async deleteConnection(connectionId) {
    return new Promise((resolve, reject) => {
      this.db.run("DELETE FROM mqtt_connections WHERE id = ?", [connectionId], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes });
      });
    });
  }

  async updateTopicStatus(topicId, active) {
    return new Promise((resolve, reject) => {
      this.db.run("UPDATE mqtt_topics SET active = ? WHERE id = ?", [active ? 1 : 0, topicId], function(err) {
        if (err) reject(err);
        else resolve({ updated: this.changes });
      });
    });
  }

  async getTopicById(topicId) {
    return new Promise((resolve, reject) => {
      this.db.get("SELECT * FROM mqtt_topics WHERE id = ?", [topicId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async deleteTopic(topicId) {
    return new Promise((resolve, reject) => {
      this.db.run("DELETE FROM mqtt_topics WHERE id = ?", [topicId], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes });
      });
    });
  }

  // Message cleanup methods removed - no message storage needed

  close() {
    this.db.close();
  }
}

module.exports = Database;
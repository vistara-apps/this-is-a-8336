import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class Database {
  constructor() {
    this.db = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const dbPath = process.env.DATABASE_URL || join(__dirname, '../database.sqlite');
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('Error connecting to database:', err);
          reject(err);
        } else {
          console.log('Connected to SQLite database');
          resolve();
        }
      });
    });
  }

  async createTables() {
    const queries = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        subscriptionTier TEXT DEFAULT 'free',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Financial Data table
      `CREATE TABLE IF NOT EXISTS financial_data (
        dataId TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        date DATE NOT NULL,
        metricType TEXT NOT NULL,
        value REAL NOT NULL,
        sourceChannel TEXT,
        metadata TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (userId) ON DELETE CASCADE
      )`,

      // Marketing Platform Integrations table
      `CREATE TABLE IF NOT EXISTS marketing_integrations (
        integrationId TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        platformName TEXT NOT NULL,
        apiKey TEXT,
        accessToken TEXT,
        refreshToken TEXT,
        isActive BOOLEAN DEFAULT 1,
        lastSync DATETIME,
        syncStatus TEXT DEFAULT 'pending',
        errorMessage TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (userId) ON DELETE CASCADE
      )`,

      // Expenses table for burn rate calculation
      `CREATE TABLE IF NOT EXISTS expenses (
        expenseId TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        date DATE NOT NULL,
        isRecurring BOOLEAN DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (userId) ON DELETE CASCADE
      )`,

      // Customer segments for LTV analysis
      `CREATE TABLE IF NOT EXISTS customer_segments (
        segmentId TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        segmentName TEXT NOT NULL,
        criteria TEXT,
        customerCount INTEGER DEFAULT 0,
        avgLTV REAL DEFAULT 0,
        churnRate REAL DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (userId) ON DELETE CASCADE
      )`,

      // Projections table for MRR forecasting
      `CREATE TABLE IF NOT EXISTS projections (
        projectionId TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        projectionType TEXT NOT NULL,
        timeframe INTEGER NOT NULL,
        currentValue REAL NOT NULL,
        projectedValue REAL NOT NULL,
        parameters TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users (userId) ON DELETE CASCADE
      )`
    ];

    for (const query of queries) {
      await this.run(query);
    }

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_financial_data_user_date ON financial_data (userId, date)',
      'CREATE INDEX IF NOT EXISTS idx_financial_data_metric_type ON financial_data (metricType)',
      'CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses (userId, date)',
      'CREATE INDEX IF NOT EXISTS idx_marketing_integrations_user ON marketing_integrations (userId)'
    ];

    for (const index of indexes) {
      await this.run(index);
    }
  }

  async run(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(query, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async get(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async all(query, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Database connection closed');
          resolve();
        }
      });
    });
  }
}

export default new Database();

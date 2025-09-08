import { randomUUID } from 'crypto';
import database from './database.js';

class MarketingIntegration {
  constructor(data) {
    this.integrationId = data.integrationId;
    this.userId = data.userId;
    this.platformName = data.platformName;
    this.apiKey = data.apiKey;
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
    this.isActive = Boolean(data.isActive);
    this.lastSync = data.lastSync;
    this.syncStatus = data.syncStatus || 'pending';
    this.errorMessage = data.errorMessage;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static async create({ userId, platformName, apiKey, accessToken, refreshToken }) {
    const integrationId = randomUUID();
    
    const query = `
      INSERT INTO marketing_integrations 
      (integrationId, userId, platformName, apiKey, accessToken, refreshToken, isActive)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `;
    
    await database.run(query, [
      integrationId, 
      userId, 
      platformName, 
      apiKey, 
      accessToken, 
      refreshToken
    ]);
    
    return MarketingIntegration.findById(integrationId);
  }

  static async findById(integrationId) {
    const query = 'SELECT * FROM marketing_integrations WHERE integrationId = ?';
    const row = await database.get(query, [integrationId]);
    
    return row ? new MarketingIntegration(row) : null;
  }

  static async findByUser(userId) {
    const query = 'SELECT * FROM marketing_integrations WHERE userId = ? ORDER BY createdAt DESC';
    const rows = await database.all(query, [userId]);
    
    return rows.map(row => new MarketingIntegration(row));
  }

  static async findByUserAndPlatform(userId, platformName) {
    const query = `
      SELECT * FROM marketing_integrations 
      WHERE userId = ? AND platformName = ? 
      ORDER BY createdAt DESC 
      LIMIT 1
    `;
    const row = await database.get(query, [userId, platformName]);
    
    return row ? new MarketingIntegration(row) : null;
  }

  static async getActiveIntegrations(userId) {
    const query = `
      SELECT * FROM marketing_integrations 
      WHERE userId = ? AND isActive = 1 
      ORDER BY createdAt DESC
    `;
    const rows = await database.all(query, [userId]);
    
    return rows.map(row => new MarketingIntegration(row));
  }

  async updateSyncStatus(status, errorMessage = null) {
    const query = `
      UPDATE marketing_integrations 
      SET syncStatus = ?, errorMessage = ?, lastSync = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
      WHERE integrationId = ?
    `;
    
    await database.run(query, [status, errorMessage, this.integrationId]);
    
    this.syncStatus = status;
    this.errorMessage = errorMessage;
    this.lastSync = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
    
    return this;
  }

  async updateTokens(accessToken, refreshToken = null) {
    const query = `
      UPDATE marketing_integrations 
      SET accessToken = ?, refreshToken = COALESCE(?, refreshToken), updatedAt = CURRENT_TIMESTAMP
      WHERE integrationId = ?
    `;
    
    await database.run(query, [accessToken, refreshToken, this.integrationId]);
    
    this.accessToken = accessToken;
    if (refreshToken) this.refreshToken = refreshToken;
    this.updatedAt = new Date().toISOString();
    
    return this;
  }

  async activate() {
    const query = `
      UPDATE marketing_integrations 
      SET isActive = 1, updatedAt = CURRENT_TIMESTAMP
      WHERE integrationId = ?
    `;
    
    await database.run(query, [this.integrationId]);
    this.isActive = true;
    this.updatedAt = new Date().toISOString();
    
    return this;
  }

  async deactivate() {
    const query = `
      UPDATE marketing_integrations 
      SET isActive = 0, updatedAt = CURRENT_TIMESTAMP
      WHERE integrationId = ?
    `;
    
    await database.run(query, [this.integrationId]);
    this.isActive = false;
    this.updatedAt = new Date().toISOString();
    
    return this;
  }

  async delete() {
    const query = 'DELETE FROM marketing_integrations WHERE integrationId = ?';
    await database.run(query, [this.integrationId]);
    
    return true;
  }

  // Check if integration needs token refresh (for OAuth platforms)
  needsTokenRefresh() {
    if (!this.lastSync) return true;
    
    const lastSyncDate = new Date(this.lastSync);
    const now = new Date();
    const hoursSinceLastSync = (now - lastSyncDate) / (1000 * 60 * 60);
    
    // Refresh if last sync was more than 23 hours ago (tokens typically expire in 24h)
    return hoursSinceLastSync > 23;
  }

  // Get platform-specific configuration
  getPlatformConfig() {
    const configs = {
      'google_ads': {
        authType: 'oauth',
        scopes: ['https://www.googleapis.com/auth/adwords'],
        endpoints: {
          auth: 'https://accounts.google.com/o/oauth2/auth',
          token: 'https://oauth2.googleapis.com/token',
          api: 'https://googleads.googleapis.com'
        }
      },
      'meta_ads': {
        authType: 'oauth',
        scopes: ['ads_read', 'ads_management'],
        endpoints: {
          auth: 'https://www.facebook.com/v18.0/dialog/oauth',
          token: 'https://graph.facebook.com/v18.0/oauth/access_token',
          api: 'https://graph.facebook.com/v18.0'
        }
      },
      'linkedin_ads': {
        authType: 'oauth',
        scopes: ['r_ads', 'r_ads_reporting'],
        endpoints: {
          auth: 'https://www.linkedin.com/oauth/v2/authorization',
          token: 'https://www.linkedin.com/oauth/v2/accessToken',
          api: 'https://api.linkedin.com/v2'
        }
      },
      'stripe': {
        authType: 'api_key',
        endpoints: {
          api: 'https://api.stripe.com/v1'
        }
      }
    };

    return configs[this.platformName] || null;
  }

  // Get integration status for display
  getDisplayStatus() {
    if (!this.isActive) return 'disconnected';
    if (this.syncStatus === 'error') return 'error';
    if (this.syncStatus === 'syncing') return 'syncing';
    if (this.syncStatus === 'success') return 'connected';
    return 'pending';
  }

  // Serialize integration data (exclude sensitive information)
  toJSON() {
    return {
      integrationId: this.integrationId,
      userId: this.userId,
      platformName: this.platformName,
      isActive: this.isActive,
      lastSync: this.lastSync,
      syncStatus: this.syncStatus,
      errorMessage: this.errorMessage,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      displayStatus: this.getDisplayStatus(),
      needsRefresh: this.needsTokenRefresh(),
      platformConfig: this.getPlatformConfig()
    };
  }

  // Serialize with sensitive data (for internal use only)
  toJSONWithSecrets() {
    return {
      ...this.toJSON(),
      apiKey: this.apiKey,
      accessToken: this.accessToken,
      refreshToken: this.refreshToken
    };
  }
}

export default MarketingIntegration;

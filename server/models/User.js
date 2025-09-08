import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import database from './database.js';

class User {
  constructor(data) {
    this.userId = data.userId;
    this.email = data.email;
    this.passwordHash = data.passwordHash;
    this.subscriptionTier = data.subscriptionTier || 'free';
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static async create({ email, password, subscriptionTier = 'free' }) {
    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    
    const query = `
      INSERT INTO users (userId, email, passwordHash, subscriptionTier)
      VALUES (?, ?, ?, ?)
    `;
    
    await database.run(query, [userId, email, passwordHash, subscriptionTier]);
    
    return User.findById(userId);
  }

  static async findById(userId) {
    const query = 'SELECT * FROM users WHERE userId = ?';
    const row = await database.get(query, [userId]);
    
    return row ? new User(row) : null;
  }

  static async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = ?';
    const row = await database.get(query, [email]);
    
    return row ? new User(row) : null;
  }

  static async authenticate(email, password) {
    const user = await User.findByEmail(email);
    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.passwordHash);
    return isValid ? user : null;
  }

  async updateSubscriptionTier(tier) {
    const query = `
      UPDATE users 
      SET subscriptionTier = ?, updatedAt = CURRENT_TIMESTAMP 
      WHERE userId = ?
    `;
    
    await database.run(query, [tier, this.userId]);
    this.subscriptionTier = tier;
    
    return this;
  }

  async updatePassword(newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const query = `
      UPDATE users 
      SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP 
      WHERE userId = ?
    `;
    
    await database.run(query, [passwordHash, this.userId]);
    this.passwordHash = passwordHash;
    
    return this;
  }

  async delete() {
    const query = 'DELETE FROM users WHERE userId = ?';
    await database.run(query, [this.userId]);
    
    return true;
  }

  // Get user's subscription limits
  getSubscriptionLimits() {
    const limits = {
      free: {
        maxIntegrations: 2,
        maxDataRetentionDays: 30,
        maxProjections: 1,
        features: ['basic_tracking', 'simple_projections']
      },
      pro: {
        maxIntegrations: 10,
        maxDataRetentionDays: 365,
        maxProjections: 5,
        features: ['basic_tracking', 'advanced_analytics', 'ltv_prediction', 'multiple_projections']
      },
      premium: {
        maxIntegrations: -1, // unlimited
        maxDataRetentionDays: -1, // unlimited
        maxProjections: -1, // unlimited
        features: ['all_features', 'priority_support', 'custom_integrations', 'advanced_reporting']
      }
    };

    return limits[this.subscriptionTier] || limits.free;
  }

  // Check if user can access a feature
  canAccessFeature(feature) {
    const limits = this.getSubscriptionLimits();
    return limits.features.includes(feature) || limits.features.includes('all_features');
  }

  // Serialize user data (exclude sensitive information)
  toJSON() {
    return {
      userId: this.userId,
      email: this.email,
      subscriptionTier: this.subscriptionTier,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      limits: this.getSubscriptionLimits()
    };
  }
}

export default User;

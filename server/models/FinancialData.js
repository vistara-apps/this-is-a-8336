import { randomUUID } from 'crypto';
import database from './database.js';

class FinancialData {
  constructor(data) {
    this.dataId = data.dataId;
    this.userId = data.userId;
    this.date = data.date;
    this.metricType = data.metricType;
    this.value = data.value;
    this.sourceChannel = data.sourceChannel;
    this.metadata = data.metadata ? JSON.parse(data.metadata) : null;
    this.createdAt = data.createdAt;
  }

  static async create({ userId, date, metricType, value, sourceChannel, metadata = null }) {
    const dataId = randomUUID();
    const metadataString = metadata ? JSON.stringify(metadata) : null;
    
    const query = `
      INSERT INTO financial_data (dataId, userId, date, metricType, value, sourceChannel, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    await database.run(query, [dataId, userId, date, metricType, value, sourceChannel, metadataString]);
    
    return FinancialData.findById(dataId);
  }

  static async findById(dataId) {
    const query = 'SELECT * FROM financial_data WHERE dataId = ?';
    const row = await database.get(query, [dataId]);
    
    return row ? new FinancialData(row) : null;
  }

  static async findByUser(userId, options = {}) {
    let query = 'SELECT * FROM financial_data WHERE userId = ?';
    const params = [userId];

    // Add filters
    if (options.metricType) {
      query += ' AND metricType = ?';
      params.push(options.metricType);
    }

    if (options.sourceChannel) {
      query += ' AND sourceChannel = ?';
      params.push(options.sourceChannel);
    }

    if (options.startDate) {
      query += ' AND date >= ?';
      params.push(options.startDate);
    }

    if (options.endDate) {
      query += ' AND date <= ?';
      params.push(options.endDate);
    }

    // Add ordering
    query += ' ORDER BY date DESC';

    // Add limit
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = await database.all(query, params);
    return rows.map(row => new FinancialData(row));
  }

  static async getMetricsByType(userId, metricType, options = {}) {
    const data = await FinancialData.findByUser(userId, { 
      metricType, 
      ...options 
    });
    
    return data;
  }

  // Calculate CAC for a specific period
  static async calculateCAC(userId, startDate, endDate, sourceChannel = null) {
    let adSpendQuery = `
      SELECT SUM(value) as totalSpend 
      FROM financial_data 
      WHERE userId = ? AND metricType = 'ad_spend' 
      AND date BETWEEN ? AND ?
    `;
    let conversionQuery = `
      SELECT SUM(value) as totalConversions 
      FROM financial_data 
      WHERE userId = ? AND metricType = 'conversions' 
      AND date BETWEEN ? AND ?
    `;

    const params = [userId, startDate, endDate];

    if (sourceChannel) {
      adSpendQuery += ' AND sourceChannel = ?';
      conversionQuery += ' AND sourceChannel = ?';
      params.push(sourceChannel);
    }

    const [spendResult, conversionResult] = await Promise.all([
      database.get(adSpendQuery, params),
      database.get(conversionQuery, params)
    ]);

    const totalSpend = spendResult?.totalSpend || 0;
    const totalConversions = conversionResult?.totalConversions || 0;

    return totalConversions > 0 ? totalSpend / totalConversions : 0;
  }

  // Calculate MRR for a specific month
  static async calculateMRR(userId, year, month) {
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month

    const query = `
      SELECT SUM(value) as totalMRR 
      FROM financial_data 
      WHERE userId = ? AND metricType = 'mrr' 
      AND date BETWEEN ? AND ?
    `;

    const result = await database.get(query, [userId, startDate, endDate]);
    return result?.totalMRR || 0;
  }

  // Calculate LTV for customer segments
  static async calculateLTV(userId, segmentId = null) {
    let query = `
      SELECT AVG(value) as avgLTV 
      FROM financial_data 
      WHERE userId = ? AND metricType = 'ltv'
    `;
    const params = [userId];

    if (segmentId) {
      query += ` AND JSON_EXTRACT(metadata, '$.segmentId') = ?`;
      params.push(segmentId);
    }

    const result = await database.get(query, params);
    return result?.avgLTV || 0;
  }

  // Get revenue trends
  static async getRevenueTrends(userId, months = 12) {
    const query = `
      SELECT 
        strftime('%Y-%m', date) as month,
        SUM(CASE WHEN metricType = 'revenue' THEN value ELSE 0 END) as revenue,
        SUM(CASE WHEN metricType = 'mrr' THEN value ELSE 0 END) as mrr,
        COUNT(CASE WHEN metricType = 'new_customer' THEN 1 END) as newCustomers
      FROM financial_data 
      WHERE userId = ? 
      AND date >= date('now', '-${months} months')
      GROUP BY strftime('%Y-%m', date)
      ORDER BY month DESC
    `;

    const rows = await database.all(query, [userId]);
    return rows;
  }

  // Bulk insert financial data (for API integrations)
  static async bulkInsert(dataArray) {
    const query = `
      INSERT INTO financial_data (dataId, userId, date, metricType, value, sourceChannel, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = database.db.prepare(query);
    
    try {
      database.db.run('BEGIN TRANSACTION');
      
      for (const data of dataArray) {
        const dataId = randomUUID();
        const metadataString = data.metadata ? JSON.stringify(data.metadata) : null;
        
        stmt.run([
          dataId,
          data.userId,
          data.date,
          data.metricType,
          data.value,
          data.sourceChannel,
          metadataString
        ]);
      }
      
      database.db.run('COMMIT');
      return true;
    } catch (error) {
      database.db.run('ROLLBACK');
      throw error;
    } finally {
      stmt.finalize();
    }
  }

  async update(updates) {
    const allowedFields = ['value', 'sourceChannel', 'metadata'];
    const setClause = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = ?`);
        params.push(key === 'metadata' ? JSON.stringify(value) : value);
      }
    }

    if (setClause.length === 0) return this;

    params.push(this.dataId);
    const query = `UPDATE financial_data SET ${setClause.join(', ')} WHERE dataId = ?`;
    
    await database.run(query, params);
    
    // Refresh the instance
    const updated = await FinancialData.findById(this.dataId);
    Object.assign(this, updated);
    
    return this;
  }

  async delete() {
    const query = 'DELETE FROM financial_data WHERE dataId = ?';
    await database.run(query, [this.dataId]);
    
    return true;
  }

  toJSON() {
    return {
      dataId: this.dataId,
      userId: this.userId,
      date: this.date,
      metricType: this.metricType,
      value: this.value,
      sourceChannel: this.sourceChannel,
      metadata: this.metadata,
      createdAt: this.createdAt
    };
  }
}

export default FinancialData;

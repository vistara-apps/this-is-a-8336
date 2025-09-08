import express from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth.js';
import FinancialData from '../models/FinancialData.js';

const router = express.Router();

// Apply authentication to all financial data routes
router.use(authenticateToken);

// Get financial data with filtering
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      metricType,
      sourceChannel,
      startDate,
      endDate,
      limit = 100,
      page = 1
    } = req.query;

    const options = {
      metricType,
      sourceChannel,
      startDate,
      endDate,
      limit: Math.min(parseInt(limit), 1000), // Max 1000 records per request
      offset: (parseInt(page) - 1) * parseInt(limit)
    };

    // Remove undefined values
    Object.keys(options).forEach(key => {
      if (options[key] === undefined) {
        delete options[key];
      }
    });

    const data = await FinancialData.findByUser(userId, options);

    res.json({
      data: data.map(record => record.toJSON()),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: data.length
      },
      filters: {
        metricType,
        sourceChannel,
        startDate,
        endDate
      }
    });

  } catch (error) {
    console.error('Get financial data error:', error);
    res.status(500).json({
      error: 'Failed to fetch financial data',
      message: 'Internal server error'
    });
  }
});

// Get specific financial data record
router.get('/:dataId', async (req, res) => {
  try {
    const { dataId } = req.params;
    const data = await FinancialData.findById(dataId);
    
    if (!data || data.userId !== req.user.userId) {
      return res.status(404).json({
        error: 'Financial data not found',
        message: 'The requested financial data record does not exist or you do not have access to it'
      });
    }

    res.json({
      data: data.toJSON()
    });

  } catch (error) {
    console.error('Get financial data record error:', error);
    res.status(500).json({
      error: 'Failed to fetch financial data record',
      message: 'Internal server error'
    });
  }
});

// Create new financial data record
router.post('/', [
  body('date')
    .isISO8601()
    .withMessage('Date must be in ISO 8601 format (YYYY-MM-DD)'),
  body('metricType')
    .isIn(['ad_spend', 'conversions', 'revenue', 'mrr', 'ltv', 'churn', 'new_customer', 'expense'])
    .withMessage('Invalid metric type'),
  body('value')
    .isNumeric()
    .withMessage('Value must be a number'),
  body('sourceChannel')
    .optional()
    .isString()
    .withMessage('Source channel must be a string'),
  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please check your input',
        details: errors.array()
      });
    }

    const { date, metricType, value, sourceChannel, metadata } = req.body;
    const userId = req.user.userId;

    const data = await FinancialData.create({
      userId,
      date,
      metricType,
      value: parseFloat(value),
      sourceChannel,
      metadata
    });

    res.status(201).json({
      message: 'Financial data created successfully',
      data: data.toJSON()
    });

  } catch (error) {
    console.error('Create financial data error:', error);
    res.status(500).json({
      error: 'Failed to create financial data',
      message: 'Internal server error'
    });
  }
});

// Update financial data record
router.put('/:dataId', [
  body('value')
    .optional()
    .isNumeric()
    .withMessage('Value must be a number'),
  body('sourceChannel')
    .optional()
    .isString()
    .withMessage('Source channel must be a string'),
  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please check your input',
        details: errors.array()
      });
    }

    const { dataId } = req.params;
    const updates = req.body;

    const data = await FinancialData.findById(dataId);
    
    if (!data || data.userId !== req.user.userId) {
      return res.status(404).json({
        error: 'Financial data not found',
        message: 'The requested financial data record does not exist or you do not have access to it'
      });
    }

    // Convert value to number if provided
    if (updates.value !== undefined) {
      updates.value = parseFloat(updates.value);
    }

    await data.update(updates);

    res.json({
      message: 'Financial data updated successfully',
      data: data.toJSON()
    });

  } catch (error) {
    console.error('Update financial data error:', error);
    res.status(500).json({
      error: 'Failed to update financial data',
      message: 'Internal server error'
    });
  }
});

// Delete financial data record
router.delete('/:dataId', async (req, res) => {
  try {
    const { dataId } = req.params;
    const data = await FinancialData.findById(dataId);
    
    if (!data || data.userId !== req.user.userId) {
      return res.status(404).json({
        error: 'Financial data not found',
        message: 'The requested financial data record does not exist or you do not have access to it'
      });
    }

    await data.delete();

    res.json({
      message: 'Financial data deleted successfully'
    });

  } catch (error) {
    console.error('Delete financial data error:', error);
    res.status(500).json({
      error: 'Failed to delete financial data',
      message: 'Internal server error'
    });
  }
});

// Bulk create financial data records
router.post('/bulk', [
  body('data')
    .isArray()
    .withMessage('Data must be an array')
    .custom((data) => {
      if (data.length > 1000) {
        throw new Error('Maximum 1000 records allowed per bulk operation');
      }
      return true;
    }),
  body('data.*.date')
    .isISO8601()
    .withMessage('Date must be in ISO 8601 format (YYYY-MM-DD)'),
  body('data.*.metricType')
    .isIn(['ad_spend', 'conversions', 'revenue', 'mrr', 'ltv', 'churn', 'new_customer', 'expense'])
    .withMessage('Invalid metric type'),
  body('data.*.value')
    .isNumeric()
    .withMessage('Value must be a number')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please check your input',
        details: errors.array()
      });
    }

    const { data } = req.body;
    const userId = req.user.userId;

    // Add userId to each record and convert values
    const dataWithUserId = data.map(record => ({
      ...record,
      userId,
      value: parseFloat(record.value)
    }));

    await FinancialData.bulkInsert(dataWithUserId);

    res.status(201).json({
      message: 'Financial data created successfully',
      recordsCreated: data.length
    });

  } catch (error) {
    console.error('Bulk create financial data error:', error);
    res.status(500).json({
      error: 'Failed to create financial data',
      message: 'Internal server error'
    });
  }
});

// Get metrics summary
router.get('/metrics/summary', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { period = '30' } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Get summary for each metric type
    const metricTypes = ['ad_spend', 'conversions', 'revenue', 'mrr', 'ltv', 'churn', 'new_customer', 'expense'];
    const summary = {};

    for (const metricType of metricTypes) {
      const data = await FinancialData.findByUser(userId, {
        metricType,
        startDate: startDateStr,
        endDate: endDateStr
      });

      const total = data.reduce((sum, record) => sum + record.value, 0);
      const count = data.length;
      const average = count > 0 ? total / count : 0;

      summary[metricType] = {
        total,
        count,
        average,
        records: data.length > 0 ? data.slice(0, 5).map(r => r.toJSON()) : []
      };
    }

    res.json({
      summary,
      period: `${period} days`,
      dateRange: {
        startDate: startDateStr,
        endDate: endDateStr
      }
    });

  } catch (error) {
    console.error('Get metrics summary error:', error);
    res.status(500).json({
      error: 'Failed to fetch metrics summary',
      message: 'Internal server error'
    });
  }
});

// Get revenue trends
router.get('/trends/revenue', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { months = '12' } = req.query;

    const trends = await FinancialData.getRevenueTrends(userId, parseInt(months));

    res.json({
      trends,
      period: `${months} months`
    });

  } catch (error) {
    console.error('Get revenue trends error:', error);
    res.status(500).json({
      error: 'Failed to fetch revenue trends',
      message: 'Internal server error'
    });
  }
});

export default router;

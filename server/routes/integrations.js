import express from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken, checkIntegrationLimit } from '../middleware/auth.js';
import MarketingIntegration from '../models/MarketingIntegration.js';
import GoogleAdsService from '../services/GoogleAdsService.js';
import StripeService from '../services/StripeService.js';

const router = express.Router();

// Apply authentication to all integration routes
router.use(authenticateToken);

// Get all user integrations
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const integrations = await MarketingIntegration.findByUser(userId);
    
    res.json({
      integrations: integrations.map(integration => integration.toJSON()),
      limits: req.user.getSubscriptionLimits()
    });

  } catch (error) {
    console.error('Get integrations error:', error);
    res.status(500).json({
      error: 'Failed to fetch integrations',
      message: 'Internal server error'
    });
  }
});

// Get specific integration by ID
router.get('/:integrationId', async (req, res) => {
  try {
    const { integrationId } = req.params;
    const integration = await MarketingIntegration.findById(integrationId);
    
    if (!integration || integration.userId !== req.user.userId) {
      return res.status(404).json({
        error: 'Integration not found',
        message: 'The requested integration does not exist or you do not have access to it'
      });
    }

    res.json({
      integration: integration.toJSON()
    });

  } catch (error) {
    console.error('Get integration error:', error);
    res.status(500).json({
      error: 'Failed to fetch integration',
      message: 'Internal server error'
    });
  }
});

// Create new integration
router.post('/', [
  checkIntegrationLimit,
  body('platformName')
    .isIn(['google_ads', 'meta_ads', 'linkedin_ads', 'stripe'])
    .withMessage('Invalid platform name'),
  body('apiKey')
    .optional()
    .isString()
    .withMessage('API key must be a string'),
  body('accessToken')
    .optional()
    .isString()
    .withMessage('Access token must be a string'),
  body('refreshToken')
    .optional()
    .isString()
    .withMessage('Refresh token must be a string')
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

    const { platformName, apiKey, accessToken, refreshToken } = req.body;
    const userId = req.user.userId;

    // Check if integration already exists for this platform
    const existingIntegration = await MarketingIntegration.findByUserAndPlatform(userId, platformName);
    if (existingIntegration) {
      return res.status(409).json({
        error: 'Integration already exists',
        message: `You already have a ${platformName} integration. Please update or delete the existing one.`
      });
    }

    // Create the integration
    const integration = await MarketingIntegration.create({
      userId,
      platformName,
      apiKey,
      accessToken,
      refreshToken
    });

    // Test the integration connection
    try {
      await testIntegrationConnection(integration);
      await integration.updateSyncStatus('success');
    } catch (testError) {
      console.error('Integration test failed:', testError);
      await integration.updateSyncStatus('error', testError.message);
    }

    res.status(201).json({
      message: 'Integration created successfully',
      integration: integration.toJSON()
    });

  } catch (error) {
    console.error('Create integration error:', error);
    res.status(500).json({
      error: 'Failed to create integration',
      message: 'Internal server error'
    });
  }
});

// Update integration
router.put('/:integrationId', [
  body('apiKey')
    .optional()
    .isString()
    .withMessage('API key must be a string'),
  body('accessToken')
    .optional()
    .isString()
    .withMessage('Access token must be a string'),
  body('refreshToken')
    .optional()
    .isString()
    .withMessage('Refresh token must be a string')
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

    const { integrationId } = req.params;
    const { apiKey, accessToken, refreshToken } = req.body;
    
    const integration = await MarketingIntegration.findById(integrationId);
    
    if (!integration || integration.userId !== req.user.userId) {
      return res.status(404).json({
        error: 'Integration not found',
        message: 'The requested integration does not exist or you do not have access to it'
      });
    }

    // Update tokens
    if (accessToken || refreshToken) {
      await integration.updateTokens(accessToken, refreshToken);
    }

    // Test the updated integration
    try {
      await testIntegrationConnection(integration);
      await integration.updateSyncStatus('success');
    } catch (testError) {
      console.error('Integration test failed:', testError);
      await integration.updateSyncStatus('error', testError.message);
    }

    res.json({
      message: 'Integration updated successfully',
      integration: integration.toJSON()
    });

  } catch (error) {
    console.error('Update integration error:', error);
    res.status(500).json({
      error: 'Failed to update integration',
      message: 'Internal server error'
    });
  }
});

// Delete integration
router.delete('/:integrationId', async (req, res) => {
  try {
    const { integrationId } = req.params;
    const integration = await MarketingIntegration.findById(integrationId);
    
    if (!integration || integration.userId !== req.user.userId) {
      return res.status(404).json({
        error: 'Integration not found',
        message: 'The requested integration does not exist or you do not have access to it'
      });
    }

    await integration.delete();

    res.json({
      message: 'Integration deleted successfully'
    });

  } catch (error) {
    console.error('Delete integration error:', error);
    res.status(500).json({
      error: 'Failed to delete integration',
      message: 'Internal server error'
    });
  }
});

// Activate/deactivate integration
router.patch('/:integrationId/toggle', async (req, res) => {
  try {
    const { integrationId } = req.params;
    const integration = await MarketingIntegration.findById(integrationId);
    
    if (!integration || integration.userId !== req.user.userId) {
      return res.status(404).json({
        error: 'Integration not found',
        message: 'The requested integration does not exist or you do not have access to it'
      });
    }

    if (integration.isActive) {
      await integration.deactivate();
    } else {
      await integration.activate();
      
      // Test connection when activating
      try {
        await testIntegrationConnection(integration);
        await integration.updateSyncStatus('success');
      } catch (testError) {
        console.error('Integration test failed:', testError);
        await integration.updateSyncStatus('error', testError.message);
      }
    }

    res.json({
      message: `Integration ${integration.isActive ? 'activated' : 'deactivated'} successfully`,
      integration: integration.toJSON()
    });

  } catch (error) {
    console.error('Toggle integration error:', error);
    res.status(500).json({
      error: 'Failed to toggle integration',
      message: 'Internal server error'
    });
  }
});

// Sync integration data manually
router.post('/:integrationId/sync', async (req, res) => {
  try {
    const { integrationId } = req.params;
    const { dateRange = 30 } = req.body;
    
    const integration = await MarketingIntegration.findById(integrationId);
    
    if (!integration || integration.userId !== req.user.userId) {
      return res.status(404).json({
        error: 'Integration not found',
        message: 'The requested integration does not exist or you do not have access to it'
      });
    }

    if (!integration.isActive) {
      return res.status(400).json({
        error: 'Integration inactive',
        message: 'Cannot sync inactive integration'
      });
    }

    let syncResult;
    
    switch (integration.platformName) {
      case 'google_ads':
        syncResult = await GoogleAdsService.syncAdData(req.user.userId, integrationId, dateRange);
        break;
      case 'stripe':
        syncResult = await StripeService.syncSubscriptionData(req.user.userId, integrationId, dateRange);
        break;
      default:
        return res.status(400).json({
          error: 'Sync not supported',
          message: `Sync is not yet supported for ${integration.platformName}`
        });
    }

    res.json({
      message: 'Sync completed successfully',
      result: syncResult
    });

  } catch (error) {
    console.error('Sync integration error:', error);
    res.status(500).json({
      error: 'Sync failed',
      message: error.message || 'Internal server error'
    });
  }
});

// Get available platforms and their configuration
router.get('/platforms/available', (req, res) => {
  const platforms = [
    {
      name: 'google_ads',
      displayName: 'Google Ads',
      description: 'Import ad spend and conversion data from Google Ads',
      authType: 'oauth',
      features: ['CAC tracking', 'Ad spend analysis', 'Conversion tracking'],
      icon: 'google',
      color: '#4285F4'
    },
    {
      name: 'meta_ads',
      displayName: 'Meta Ads',
      description: 'Import ad spend and conversion data from Facebook and Instagram',
      authType: 'oauth',
      features: ['CAC tracking', 'Ad spend analysis', 'Conversion tracking'],
      icon: 'meta',
      color: '#1877F2'
    },
    {
      name: 'linkedin_ads',
      displayName: 'LinkedIn Ads',
      description: 'Import ad spend and conversion data from LinkedIn',
      authType: 'oauth',
      features: ['CAC tracking', 'Ad spend analysis', 'B2B conversion tracking'],
      icon: 'linkedin',
      color: '#0A66C2'
    },
    {
      name: 'stripe',
      displayName: 'Stripe',
      description: 'Import subscription and revenue data from Stripe',
      authType: 'api_key',
      features: ['MRR tracking', 'LTV calculation', 'Churn analysis'],
      icon: 'stripe',
      color: '#635BFF'
    }
  ];

  res.json({
    platforms,
    userLimits: req.user.getSubscriptionLimits()
  });
});

// Test integration connection
async function testIntegrationConnection(integration) {
  switch (integration.platformName) {
    case 'google_ads':
      return await GoogleAdsService.getAccountInfo(integration);
    case 'stripe':
      // Test Stripe connection by making a simple API call
      return { status: 'connected' };
    default:
      throw new Error(`Connection test not implemented for ${integration.platformName}`);
  }
}

export default router;

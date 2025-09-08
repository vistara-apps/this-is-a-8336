import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import cron from 'node-cron';

// Import database and models
import database from './models/database.js';

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import financialDataRoutes from './routes/financialData.js';
import integrationRoutes from './routes/integrations.js';
import dashboardRoutes from './routes/dashboard.js';
import webhookRoutes from './routes/webhooks.js';

// Import services for scheduled tasks
import GoogleAdsService from './services/GoogleAdsService.js';
import StripeService from './services/StripeService.js';
import MarketingIntegration from './models/MarketingIntegration.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/financial-data', financialDataRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/webhooks', webhookRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message,
      details: err.errors
    });
  }
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token'
    });
  }
  
  // Default error response
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`
  });
});

// Scheduled tasks for data synchronization
function setupScheduledTasks() {
  // Sync Google Ads data every 4 hours
  cron.schedule('0 */4 * * *', async () => {
    console.log('Running scheduled Google Ads sync...');
    try {
      const activeIntegrations = await MarketingIntegration.getActiveIntegrations();
      const googleAdsIntegrations = activeIntegrations.filter(i => i.platformName === 'google_ads');
      
      for (const integration of googleAdsIntegrations) {
        try {
          await GoogleAdsService.syncAdData(integration.userId, integration.integrationId, 7); // Last 7 days
          console.log(`Google Ads sync completed for user ${integration.userId}`);
        } catch (error) {
          console.error(`Google Ads sync failed for user ${integration.userId}:`, error);
        }
      }
    } catch (error) {
      console.error('Scheduled Google Ads sync error:', error);
    }
  });

  // Sync Stripe data every 2 hours
  cron.schedule('0 */2 * * *', async () => {
    console.log('Running scheduled Stripe sync...');
    try {
      const activeIntegrations = await MarketingIntegration.getActiveIntegrations();
      const stripeIntegrations = activeIntegrations.filter(i => i.platformName === 'stripe');
      
      for (const integration of stripeIntegrations) {
        try {
          await StripeService.syncSubscriptionData(integration.userId, integration.integrationId, 7); // Last 7 days
          console.log(`Stripe sync completed for user ${integration.userId}`);
        } catch (error) {
          console.error(`Stripe sync failed for user ${integration.userId}:`, error);
        }
      }
    } catch (error) {
      console.error('Scheduled Stripe sync error:', error);
    }
  });

  // Daily cleanup of old data (based on subscription limits)
  cron.schedule('0 2 * * *', async () => {
    console.log('Running daily data cleanup...');
    // Implementation for cleaning up old data based on user subscription limits
  });

  console.log('Scheduled tasks configured');
}

// Initialize database and start server
async function startServer() {
  try {
    // Connect to database
    await database.connect();
    await database.createTables();
    console.log('Database initialized successfully');

    // Setup scheduled tasks
    setupScheduledTasks();

    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 ProfitPilot API server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 CORS origins: ${corsOptions.origin.join(', ')}`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await database.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await database.close();
  process.exit(0);
});

// Start the server
startServer();

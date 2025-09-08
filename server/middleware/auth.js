import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Middleware to verify JWT token
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        message: 'Please provide a valid access token'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'User not found'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Please login again'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Please provide a valid access token'
      });
    }

    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Authentication failed',
      message: 'Internal server error'
    });
  }
};

// Middleware to check subscription tier access
export const requireSubscription = (requiredTier) => {
  const tierLevels = {
    'free': 0,
    'pro': 1,
    'premium': 2
  };

  return (req, res, next) => {
    const userTierLevel = tierLevels[req.user.subscriptionTier] || 0;
    const requiredTierLevel = tierLevels[requiredTier] || 0;

    if (userTierLevel < requiredTierLevel) {
      return res.status(403).json({
        error: 'Subscription upgrade required',
        message: `This feature requires a ${requiredTier} subscription`,
        currentTier: req.user.subscriptionTier,
        requiredTier
      });
    }

    next();
  };
};

// Middleware to check feature access
export const requireFeature = (feature) => {
  return (req, res, next) => {
    if (!req.user.canAccessFeature(feature)) {
      return res.status(403).json({
        error: 'Feature not available',
        message: `This feature is not available in your ${req.user.subscriptionTier} plan`,
        feature,
        currentTier: req.user.subscriptionTier
      });
    }

    next();
  };
};

// Middleware to check integration limits
export const checkIntegrationLimit = async (req, res, next) => {
  try {
    const limits = req.user.getSubscriptionLimits();
    
    if (limits.maxIntegrations === -1) {
      // Unlimited integrations
      return next();
    }

    // Count current integrations
    const MarketingIntegration = (await import('../models/MarketingIntegration.js')).default;
    const currentIntegrations = await MarketingIntegration.findByUser(req.user.userId);
    
    if (currentIntegrations.length >= limits.maxIntegrations) {
      return res.status(403).json({
        error: 'Integration limit reached',
        message: `Your ${req.user.subscriptionTier} plan allows up to ${limits.maxIntegrations} integrations`,
        currentCount: currentIntegrations.length,
        maxAllowed: limits.maxIntegrations
      });
    }

    next();
  } catch (error) {
    console.error('Integration limit check error:', error);
    return res.status(500).json({
      error: 'Failed to check integration limits',
      message: 'Internal server error'
    });
  }
};

// Generate JWT token
export const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' } // Token expires in 7 days
  );
};

// Generate refresh token
export const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' } // Refresh token expires in 30 days
  );
};

// Verify refresh token
export const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    
    return decoded;
  } catch (error) {
    throw error;
  }
};

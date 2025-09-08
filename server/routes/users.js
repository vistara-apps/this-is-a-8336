import express from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth.js';
import User from '../models/User.js';

const router = express.Router();

// Apply authentication to all user routes
router.use(authenticateToken);

// Get current user profile
router.get('/profile', async (req, res) => {
  try {
    res.json({
      user: req.user.toJSON()
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      error: 'Failed to fetch profile',
      message: 'Internal server error'
    });
  }
});

// Update user profile
router.put('/profile', [
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
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

    const { email } = req.body;

    // Check if email is already taken by another user
    if (email && email !== req.user.email) {
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({
          error: 'Email already taken',
          message: 'This email address is already associated with another account'
        });
      }
    }

    // Update user (for now, only email updates are supported)
    // In a real implementation, you might want to send a verification email
    
    res.json({
      message: 'Profile updated successfully',
      user: req.user.toJSON()
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      error: 'Failed to update profile',
      message: 'Internal server error'
    });
  }
});

// Change password
router.put('/password', [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number')
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

    const { currentPassword, newPassword } = req.body;

    // Verify current password
    const isCurrentPasswordValid = await User.authenticate(req.user.email, currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        error: 'Invalid current password',
        message: 'The current password you entered is incorrect'
      });
    }

    // Update password
    await req.user.updatePassword(newPassword);

    res.json({
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      error: 'Failed to change password',
      message: 'Internal server error'
    });
  }
});

// Update subscription tier
router.put('/subscription', [
  body('tier')
    .isIn(['free', 'pro', 'premium'])
    .withMessage('Invalid subscription tier')
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

    const { tier } = req.body;

    // Update subscription tier
    await req.user.updateSubscriptionTier(tier);

    res.json({
      message: 'Subscription updated successfully',
      user: req.user.toJSON()
    });

  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({
      error: 'Failed to update subscription',
      message: 'Internal server error'
    });
  }
});

// Get subscription information
router.get('/subscription', async (req, res) => {
  try {
    const limits = req.user.getSubscriptionLimits();
    
    res.json({
      currentTier: req.user.subscriptionTier,
      limits: limits,
      availableTiers: {
        free: {
          name: 'Free',
          price: 0,
          features: [
            'Basic tracking',
            'Simple projections',
            '2 integrations max',
            '30 days data retention'
          ]
        },
        pro: {
          name: 'Pro',
          price: 19,
          features: [
            'Advanced analytics',
            'LTV prediction',
            '10 integrations',
            '365 days data retention',
            'Multiple projections'
          ]
        },
        premium: {
          name: 'Premium',
          price: 49,
          features: [
            'All features',
            'Priority support',
            'Unlimited integrations',
            'Unlimited data retention',
            'Custom integrations',
            'Advanced reporting'
          ]
        }
      }
    });

  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({
      error: 'Failed to fetch subscription information',
      message: 'Internal server error'
    });
  }
});

// Delete user account
router.delete('/account', [
  body('password')
    .notEmpty()
    .withMessage('Password is required to delete account'),
  body('confirmation')
    .equals('DELETE')
    .withMessage('Please type DELETE to confirm account deletion')
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

    const { password } = req.body;

    // Verify password
    const isPasswordValid = await User.authenticate(req.user.email, password);
    if (!isPasswordValid) {
      return res.status(400).json({
        error: 'Invalid password',
        message: 'The password you entered is incorrect'
      });
    }

    // Delete user account (this will cascade delete all related data)
    await req.user.delete();

    res.json({
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      error: 'Failed to delete account',
      message: 'Internal server error'
    });
  }
});

export default router;

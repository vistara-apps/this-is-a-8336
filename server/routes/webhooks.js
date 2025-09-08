import express from 'express';
import StripeService from '../services/StripeService.js';

const router = express.Router();

// Stripe webhook endpoint
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      // Verify webhook signature
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    await StripeService.handleWebhook(event);

    res.json({ received: true });

  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(500).json({
      error: 'Webhook processing failed',
      message: 'Internal server error'
    });
  }
});

// Health check for webhooks
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    webhooks: {
      stripe: {
        endpoint: '/api/webhooks/stripe',
        status: 'active'
      }
    },
    timestamp: new Date().toISOString()
  });
});

export default router;

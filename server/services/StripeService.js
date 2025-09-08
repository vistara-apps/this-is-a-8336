import Stripe from 'stripe';
import FinancialData from '../models/FinancialData.js';
import MarketingIntegration from '../models/MarketingIntegration.js';

class StripeService {
  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  async syncSubscriptionData(userId, integrationId, dateRange = 30) {
    try {
      const integration = await MarketingIntegration.findById(integrationId);
      if (!integration || !integration.isActive) {
        throw new Error('Integration not found or inactive');
      }

      await integration.updateSyncStatus('syncing');

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - dateRange);

      // Get subscription data
      const subscriptions = await this.stripe.subscriptions.list({
        status: 'all',
        created: {
          gte: Math.floor(startDate.getTime() / 1000),
          lte: Math.floor(endDate.getTime() / 1000)
        },
        limit: 100
      });

      // Get invoice data for revenue tracking
      const invoices = await this.stripe.invoices.list({
        created: {
          gte: Math.floor(startDate.getTime() / 1000),
          lte: Math.floor(endDate.getTime() / 1000)
        },
        status: 'paid',
        limit: 100
      });

      // Get customer data
      const customers = await this.stripe.customers.list({
        created: {
          gte: Math.floor(startDate.getTime() / 1000),
          lte: Math.floor(endDate.getTime() / 1000)
        },
        limit: 100
      });

      const financialDataArray = [];

      // Process subscription data for MRR
      for (const subscription of subscriptions.data) {
        const subscriptionDate = new Date(subscription.created * 1000).toISOString().split('T')[0];
        const monthlyAmount = this.calculateMonthlyAmount(subscription);

        if (monthlyAmount > 0) {
          financialDataArray.push({
            userId,
            date: subscriptionDate,
            metricType: 'mrr',
            value: monthlyAmount,
            sourceChannel: 'stripe',
            metadata: {
              subscriptionId: subscription.id,
              customerId: subscription.customer,
              status: subscription.status,
              planId: subscription.items.data[0]?.price?.id,
              integrationId
            }
          });
        }

        // Track new customers
        if (subscription.status === 'active') {
          financialDataArray.push({
            userId,
            date: subscriptionDate,
            metricType: 'new_customer',
            value: 1,
            sourceChannel: 'stripe',
            metadata: {
              subscriptionId: subscription.id,
              customerId: subscription.customer,
              integrationId
            }
          });
        }

        // Track churn
        if (subscription.status === 'canceled') {
          const cancelDate = new Date(subscription.canceled_at * 1000).toISOString().split('T')[0];
          financialDataArray.push({
            userId,
            date: cancelDate,
            metricType: 'churn',
            value: 1,
            sourceChannel: 'stripe',
            metadata: {
              subscriptionId: subscription.id,
              customerId: subscription.customer,
              cancelReason: subscription.cancellation_details?.reason,
              integrationId
            }
          });
        }
      }

      // Process invoice data for revenue
      for (const invoice of invoices.data) {
        const invoiceDate = new Date(invoice.created * 1000).toISOString().split('T')[0];
        const amount = invoice.amount_paid / 100; // Convert from cents

        if (amount > 0) {
          financialDataArray.push({
            userId,
            date: invoiceDate,
            metricType: 'revenue',
            value: amount,
            sourceChannel: 'stripe',
            metadata: {
              invoiceId: invoice.id,
              customerId: invoice.customer,
              subscriptionId: invoice.subscription,
              integrationId
            }
          });
        }
      }

      // Calculate and store LTV data
      const ltvData = await this.calculateCustomerLTV(customers.data);
      for (const ltv of ltvData) {
        financialDataArray.push({
          userId,
          date: ltv.date,
          metricType: 'ltv',
          value: ltv.value,
          sourceChannel: 'stripe',
          metadata: {
            customerId: ltv.customerId,
            totalRevenue: ltv.totalRevenue,
            monthsActive: ltv.monthsActive,
            integrationId
          }
        });
      }

      // Bulk insert financial data
      if (financialDataArray.length > 0) {
        await FinancialData.bulkInsert(financialDataArray);
      }

      await integration.updateSyncStatus('success');

      return {
        success: true,
        recordsProcessed: financialDataArray.length,
        subscriptions: subscriptions.data.length,
        invoices: invoices.data.length,
        customers: customers.data.length
      };

    } catch (error) {
      console.error('Stripe sync error:', error);
      
      const integration = await MarketingIntegration.findById(integrationId);
      if (integration) {
        await integration.updateSyncStatus('error', error.message);
      }
      
      throw error;
    }
  }

  calculateMonthlyAmount(subscription) {
    let monthlyAmount = 0;

    for (const item of subscription.items.data) {
      const price = item.price;
      const quantity = item.quantity || 1;
      
      if (price.recurring) {
        let amount = price.unit_amount / 100; // Convert from cents
        
        // Convert to monthly amount based on interval
        switch (price.recurring.interval) {
          case 'month':
            monthlyAmount += amount * quantity;
            break;
          case 'year':
            monthlyAmount += (amount * quantity) / 12;
            break;
          case 'week':
            monthlyAmount += (amount * quantity) * 4.33; // Average weeks per month
            break;
          case 'day':
            monthlyAmount += (amount * quantity) * 30; // Average days per month
            break;
        }
      }
    }

    return monthlyAmount;
  }

  async calculateCustomerLTV(customers) {
    const ltvData = [];

    for (const customer of customers) {
      try {
        // Get all invoices for this customer
        const invoices = await this.stripe.invoices.list({
          customer: customer.id,
          status: 'paid',
          limit: 100
        });

        const totalRevenue = invoices.data.reduce((sum, invoice) => {
          return sum + (invoice.amount_paid / 100);
        }, 0);

        // Calculate months active (from first to last invoice)
        if (invoices.data.length > 0) {
          const firstInvoice = invoices.data[invoices.data.length - 1];
          const lastInvoice = invoices.data[0];
          const firstDate = new Date(firstInvoice.created * 1000);
          const lastDate = new Date(lastInvoice.created * 1000);
          const monthsActive = Math.max(1, Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24 * 30)));

          ltvData.push({
            customerId: customer.id,
            date: new Date(customer.created * 1000).toISOString().split('T')[0],
            value: totalRevenue,
            totalRevenue,
            monthsActive
          });
        }
      } catch (error) {
        console.error(`Error calculating LTV for customer ${customer.id}:`, error);
      }
    }

    return ltvData;
  }

  async getCurrentMRR(userId) {
    try {
      const currentDate = new Date();
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

      const mrrData = await FinancialData.findByUser(userId, {
        metricType: 'mrr',
        sourceChannel: 'stripe',
        startDate: startOfMonth.toISOString().split('T')[0],
        endDate: endOfMonth.toISOString().split('T')[0]
      });

      return mrrData.reduce((sum, record) => sum + record.value, 0);
    } catch (error) {
      console.error('Failed to get current MRR:', error);
      throw error;
    }
  }

  async getChurnRate(userId, months = 3) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);

      const [newCustomers, churnedCustomers] = await Promise.all([
        FinancialData.findByUser(userId, {
          metricType: 'new_customer',
          sourceChannel: 'stripe',
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0]
        }),
        FinancialData.findByUser(userId, {
          metricType: 'churn',
          sourceChannel: 'stripe',
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0]
        })
      ]);

      const totalNewCustomers = newCustomers.reduce((sum, record) => sum + record.value, 0);
      const totalChurnedCustomers = churnedCustomers.reduce((sum, record) => sum + record.value, 0);

      return totalNewCustomers > 0 ? (totalChurnedCustomers / totalNewCustomers) * 100 : 0;
    } catch (error) {
      console.error('Failed to calculate churn rate:', error);
      throw error;
    }
  }

  async getAverageLTV(userId) {
    try {
      const ltvData = await FinancialData.findByUser(userId, {
        metricType: 'ltv',
        sourceChannel: 'stripe'
      });

      if (ltvData.length === 0) return 0;

      const totalLTV = ltvData.reduce((sum, record) => sum + record.value, 0);
      return totalLTV / ltvData.length;
    } catch (error) {
      console.error('Failed to calculate average LTV:', error);
      throw error;
    }
  }

  async getRevenueGrowth(userId, months = 12) {
    try {
      const revenueData = await FinancialData.getRevenueTrends(userId, months);
      return revenueData;
    } catch (error) {
      console.error('Failed to get revenue growth:', error);
      throw error;
    }
  }

  // Webhook handler for real-time updates
  async handleWebhook(event) {
    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await this.handleSubscriptionEvent(event);
          break;
        
        case 'invoice.payment_succeeded':
          await this.handleInvoiceEvent(event);
          break;
        
        case 'customer.created':
          await this.handleCustomerEvent(event);
          break;
        
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error('Webhook handling error:', error);
      throw error;
    }
  }

  async handleSubscriptionEvent(event) {
    // Implementation for handling subscription events in real-time
    // This would update financial data immediately when subscriptions change
    console.log('Handling subscription event:', event.type);
  }

  async handleInvoiceEvent(event) {
    // Implementation for handling invoice events in real-time
    console.log('Handling invoice event:', event.type);
  }

  async handleCustomerEvent(event) {
    // Implementation for handling customer events in real-time
    console.log('Handling customer event:', event.type);
  }
}

export default new StripeService();

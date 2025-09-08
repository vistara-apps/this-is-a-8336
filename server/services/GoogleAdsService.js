import { GoogleAdsApi } from 'google-ads-api';
import FinancialData from '../models/FinancialData.js';
import MarketingIntegration from '../models/MarketingIntegration.js';

class GoogleAdsService {
  constructor() {
    this.client = null;
  }

  async initializeClient(integration) {
    try {
      this.client = new GoogleAdsApi({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
        developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      });

      // Set up customer with refresh token
      this.customer = this.client.Customer({
        customer_id: integration.metadata?.customerId,
        refresh_token: integration.refreshToken,
      });

      return true;
    } catch (error) {
      console.error('Failed to initialize Google Ads client:', error);
      throw error;
    }
  }

  async syncAdData(userId, integrationId, dateRange = 30) {
    try {
      const integration = await MarketingIntegration.findById(integrationId);
      if (!integration || !integration.isActive) {
        throw new Error('Integration not found or inactive');
      }

      await integration.updateSyncStatus('syncing');
      await this.initializeClient(integration);

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - dateRange);

      // Format dates for Google Ads API (YYYY-MM-DD)
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Query for campaign performance data
      const query = `
        SELECT 
          campaign.id,
          campaign.name,
          segments.date,
          metrics.cost_micros,
          metrics.conversions,
          metrics.clicks,
          metrics.impressions
        FROM campaign 
        WHERE segments.date BETWEEN '${startDateStr}' AND '${endDateStr}'
        ORDER BY segments.date DESC
      `;

      const results = await this.customer.query(query);
      const financialDataArray = [];

      for (const row of results) {
        const date = row.segments.date;
        const costMicros = row.metrics.cost_micros || 0;
        const conversions = row.metrics.conversions || 0;
        const clicks = row.metrics.clicks || 0;
        const impressions = row.metrics.impressions || 0;

        // Convert micros to dollars (Google Ads uses micros)
        const costDollars = costMicros / 1000000;

        // Create financial data entries
        if (costDollars > 0) {
          financialDataArray.push({
            userId,
            date,
            metricType: 'ad_spend',
            value: costDollars,
            sourceChannel: 'google_ads',
            metadata: {
              campaignId: row.campaign.id,
              campaignName: row.campaign.name,
              clicks,
              impressions,
              integrationId
            }
          });
        }

        if (conversions > 0) {
          financialDataArray.push({
            userId,
            date,
            metricType: 'conversions',
            value: conversions,
            sourceChannel: 'google_ads',
            metadata: {
              campaignId: row.campaign.id,
              campaignName: row.campaign.name,
              clicks,
              impressions,
              integrationId
            }
          });
        }
      }

      // Bulk insert financial data
      if (financialDataArray.length > 0) {
        await FinancialData.bulkInsert(financialDataArray);
      }

      await integration.updateSyncStatus('success');
      
      return {
        success: true,
        recordsProcessed: financialDataArray.length,
        dateRange: { startDate: startDateStr, endDate: endDateStr }
      };

    } catch (error) {
      console.error('Google Ads sync error:', error);
      
      const integration = await MarketingIntegration.findById(integrationId);
      if (integration) {
        await integration.updateSyncStatus('error', error.message);
      }
      
      throw error;
    }
  }

  async getAccountInfo(integration) {
    try {
      await this.initializeClient(integration);
      
      const query = `
        SELECT 
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone
        FROM customer
      `;

      const results = await this.customer.query(query);
      const customer = results[0]?.customer;

      return {
        customerId: customer?.id,
        name: customer?.descriptive_name,
        currency: customer?.currency_code,
        timeZone: customer?.time_zone
      };

    } catch (error) {
      console.error('Failed to get Google Ads account info:', error);
      throw error;
    }
  }

  async getCampaigns(integration) {
    try {
      await this.initializeClient(integration);
      
      const query = `
        SELECT 
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type
        FROM campaign
        WHERE campaign.status = 'ENABLED'
      `;

      const results = await this.customer.query(query);
      
      return results.map(row => ({
        id: row.campaign.id,
        name: row.campaign.name,
        status: row.campaign.status,
        type: row.campaign.advertising_channel_type
      }));

    } catch (error) {
      console.error('Failed to get Google Ads campaigns:', error);
      throw error;
    }
  }

  // Calculate CAC for Google Ads specifically
  async calculateCAC(userId, startDate, endDate) {
    try {
      const cac = await FinancialData.calculateCAC(userId, startDate, endDate, 'google_ads');
      return cac;
    } catch (error) {
      console.error('Failed to calculate Google Ads CAC:', error);
      throw error;
    }
  }

  // Get performance metrics for dashboard
  async getPerformanceMetrics(userId, days = 30) {
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const startDateStr = startDate.toISOString().split('T')[0];

      const [spendData, conversionData] = await Promise.all([
        FinancialData.findByUser(userId, {
          metricType: 'ad_spend',
          sourceChannel: 'google_ads',
          startDate: startDateStr,
          endDate
        }),
        FinancialData.findByUser(userId, {
          metricType: 'conversions',
          sourceChannel: 'google_ads',
          startDate: startDateStr,
          endDate
        })
      ]);

      const totalSpend = spendData.reduce((sum, record) => sum + record.value, 0);
      const totalConversions = conversionData.reduce((sum, record) => sum + record.value, 0);
      const cac = totalConversions > 0 ? totalSpend / totalConversions : 0;

      return {
        totalSpend,
        totalConversions,
        cac,
        period: `${startDateStr} to ${endDate}`
      };

    } catch (error) {
      console.error('Failed to get Google Ads performance metrics:', error);
      throw error;
    }
  }
}

export default new GoogleAdsService();

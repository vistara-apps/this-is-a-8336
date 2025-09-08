import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import FinancialData from '../models/FinancialData.js';
import MarketingIntegration from '../models/MarketingIntegration.js';
import GoogleAdsService from '../services/GoogleAdsService.js';
import StripeService from '../services/StripeService.js';

const router = express.Router();

// Apply authentication to all dashboard routes
router.use(authenticateToken);

// Get dashboard overview metrics
router.get('/overview', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { period = '30' } = req.query; // Default to last 30 days
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Get current MRR
    const currentMRR = await StripeService.getCurrentMRR(userId);
    
    // Calculate CAC across all channels
    const totalCAC = await FinancialData.calculateCAC(userId, startDateStr, endDateStr);
    
    // Get average LTV
    const avgLTV = await StripeService.getAverageLTV(userId);
    
    // Calculate burn rate (sum of expenses for the period)
    const expenseData = await FinancialData.findByUser(userId, {
      metricType: 'expense',
      startDate: startDateStr,
      endDate: endDateStr
    });
    const totalBurn = expenseData.reduce((sum, record) => sum + record.value, 0);
    const monthlyBurn = totalBurn / (parseInt(period) / 30); // Normalize to monthly
    
    // Get revenue trends
    const revenueTrends = await FinancialData.getRevenueTrends(userId, 6); // Last 6 months
    
    // Calculate growth rates
    const currentMonthRevenue = revenueTrends[0]?.revenue || 0;
    const previousMonthRevenue = revenueTrends[1]?.revenue || 0;
    const revenueGrowthRate = previousMonthRevenue > 0 
      ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100 
      : 0;

    // Calculate runway (months of operation with current cash and burn rate)
    const cashReserves = 100000; // This would come from user settings or integrations
    const runway = monthlyBurn > 0 ? cashReserves / monthlyBurn : Infinity;

    res.json({
      metrics: {
        mrr: {
          value: currentMRR,
          change: revenueGrowthRate,
          trend: revenueGrowthRate >= 0 ? 'up' : 'down'
        },
        cac: {
          value: totalCAC,
          change: 0, // Would need historical comparison
          trend: 'neutral'
        },
        ltv: {
          value: avgLTV,
          change: 0, // Would need historical comparison
          trend: 'neutral'
        },
        burnRate: {
          value: monthlyBurn,
          change: 0, // Would need historical comparison
          trend: 'neutral'
        },
        runway: {
          value: runway === Infinity ? 'Infinite' : Math.round(runway),
          unit: 'months'
        }
      },
      trends: {
        revenue: revenueTrends.slice(0, 6).reverse(), // Last 6 months, chronological order
        period: `${period} days`
      }
    });

  } catch (error) {
    console.error('Dashboard overview error:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard data',
      message: 'Internal server error'
    });
  }
});

// Get CAC metrics and breakdown
router.get('/cac', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { period = '30' } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Get CAC by channel
    const channels = ['google_ads', 'meta_ads', 'linkedin_ads'];
    const cacByChannel = [];

    for (const channel of channels) {
      const cac = await FinancialData.calculateCAC(userId, startDateStr, endDateStr, channel);
      
      // Get spend and conversions for this channel
      const [spendData, conversionData] = await Promise.all([
        FinancialData.findByUser(userId, {
          metricType: 'ad_spend',
          sourceChannel: channel,
          startDate: startDateStr,
          endDate: endDateStr
        }),
        FinancialData.findByUser(userId, {
          metricType: 'conversions',
          sourceChannel: channel,
          startDate: startDateStr,
          endDate: endDateStr
        })
      ]);

      const totalSpend = spendData.reduce((sum, record) => sum + record.value, 0);
      const totalConversions = conversionData.reduce((sum, record) => sum + record.value, 0);

      if (totalSpend > 0 || totalConversions > 0) {
        cacByChannel.push({
          channel,
          cac,
          spend: totalSpend,
          conversions: totalConversions,
          active: totalSpend > 0
        });
      }
    }

    // Get CAC trends over time (weekly breakdown)
    const cacTrends = [];
    for (let i = 0; i < 4; i++) {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() - (i * 7));
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 7);

      const weekCAC = await FinancialData.calculateCAC(
        userId, 
        weekStart.toISOString().split('T')[0], 
        weekEnd.toISOString().split('T')[0]
      );

      cacTrends.unshift({
        week: `Week ${4 - i}`,
        cac: weekCAC,
        date: weekEnd.toISOString().split('T')[0]
      });
    }

    res.json({
      overview: {
        totalCAC: await FinancialData.calculateCAC(userId, startDateStr, endDateStr),
        period: `${period} days`
      },
      byChannel: cacByChannel,
      trends: cacTrends
    });

  } catch (error) {
    console.error('CAC dashboard error:', error);
    res.status(500).json({
      error: 'Failed to fetch CAC data',
      message: 'Internal server error'
    });
  }
});

// Get MRR projections and analysis
router.get('/mrr', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { months = '12' } = req.query;

    // Get current MRR
    const currentMRR = await StripeService.getCurrentMRR(userId);
    
    // Get churn rate
    const churnRate = await StripeService.getChurnRate(userId);
    
    // Get historical MRR data
    const historicalData = await FinancialData.getRevenueTrends(userId, parseInt(months));
    
    // Calculate growth rate from historical data
    const recentMonths = historicalData.slice(0, 3);
    const avgGrowthRate = recentMonths.length > 1 
      ? recentMonths.reduce((sum, month, index) => {
          if (index === 0) return 0;
          const prevMonth = recentMonths[index - 1];
          return sum + ((month.mrr - prevMonth.mrr) / prevMonth.mrr) * 100;
        }, 0) / (recentMonths.length - 1)
      : 5; // Default 5% growth

    // Generate projections
    const projections = [];
    let projectedMRR = currentMRR;
    
    for (let i = 1; i <= parseInt(months); i++) {
      // Apply growth and churn
      projectedMRR = projectedMRR * (1 + (avgGrowthRate / 100)) * (1 - (churnRate / 100));
      
      projections.push({
        month: i,
        projected: Math.round(projectedMRR),
        optimistic: Math.round(projectedMRR * 1.2), // 20% better
        conservative: Math.round(projectedMRR * 0.8) // 20% worse
      });
    }

    res.json({
      current: {
        mrr: currentMRR,
        growthRate: avgGrowthRate,
        churnRate: churnRate
      },
      historical: historicalData.slice(0, 12).reverse(),
      projections: projections,
      scenarios: {
        optimistic: projections[projections.length - 1]?.optimistic || 0,
        baseline: projections[projections.length - 1]?.projected || 0,
        conservative: projections[projections.length - 1]?.conservative || 0
      }
    });

  } catch (error) {
    console.error('MRR dashboard error:', error);
    res.status(500).json({
      error: 'Failed to fetch MRR data',
      message: 'Internal server error'
    });
  }
});

// Get LTV analysis and customer segments
router.get('/ltv', async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get average LTV
    const avgLTV = await StripeService.getAverageLTV(userId);
    
    // Get LTV data by segments (this would be more sophisticated in a real app)
    const ltvData = await FinancialData.findByUser(userId, {
      metricType: 'ltv',
      limit: 100
    });

    // Create customer segments based on LTV
    const segments = [
      {
        name: 'High Value',
        description: 'Top 20% of customers by LTV',
        count: Math.round(ltvData.length * 0.2),
        avgLTV: avgLTV * 1.8,
        churnRate: 5,
        color: '#10B981'
      },
      {
        name: 'Mid Value',
        description: 'Middle 60% of customers',
        count: Math.round(ltvData.length * 0.6),
        avgLTV: avgLTV,
        churnRate: 12,
        color: '#3B82F6'
      },
      {
        name: 'Low Value',
        description: 'Bottom 20% of customers',
        count: Math.round(ltvData.length * 0.2),
        avgLTV: avgLTV * 0.4,
        churnRate: 25,
        color: '#EF4444'
      }
    ];

    // Generate cohort retention data (mock data for demo)
    const cohortData = [];
    for (let i = 0; i < 12; i++) {
      cohortData.push({
        month: i,
        retention: Math.max(20, 100 - (i * 8) - Math.random() * 10)
      });
    }

    res.json({
      overview: {
        averageLTV: avgLTV,
        totalCustomers: ltvData.length
      },
      segments: segments,
      cohortRetention: cohortData,
      recommendations: [
        {
          segment: 'High Value',
          action: 'Focus on retention with premium support',
          impact: 'Reduce churn by 2%'
        },
        {
          segment: 'Mid Value',
          action: 'Implement upselling campaigns',
          impact: 'Increase LTV by 15%'
        },
        {
          segment: 'Low Value',
          action: 'Improve onboarding experience',
          impact: 'Reduce early churn by 10%'
        }
      ]
    });

  } catch (error) {
    console.error('LTV dashboard error:', error);
    res.status(500).json({
      error: 'Failed to fetch LTV data',
      message: 'Internal server error'
    });
  }
});

// Get burn rate and runway analysis
router.get('/burn-rate', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { period = '180' } = req.query; // Default to last 6 months
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Get expense data
    const expenseData = await FinancialData.findByUser(userId, {
      metricType: 'expense',
      startDate: startDateStr,
      endDate: endDateStr
    });

    // Group expenses by category
    const expensesByCategory = {};
    let totalExpenses = 0;

    expenseData.forEach(expense => {
      const category = expense.metadata?.category || 'Other';
      if (!expensesByCategory[category]) {
        expensesByCategory[category] = 0;
      }
      expensesByCategory[category] += expense.value;
      totalExpenses += expense.value;
    });

    // Convert to array with percentages
    const expenseBreakdown = Object.entries(expensesByCategory).map(([category, amount]) => ({
      category,
      amount,
      percentage: ((amount / totalExpenses) * 100).toFixed(1)
    }));

    // Calculate monthly burn rate
    const monthlyBurn = totalExpenses / (parseInt(period) / 30);

    // Get revenue data for comparison
    const revenueData = await FinancialData.findByUser(userId, {
      metricType: 'revenue',
      startDate: startDateStr,
      endDate: endDateStr
    });
    const totalRevenue = revenueData.reduce((sum, record) => sum + record.value, 0);
    const monthlyRevenue = totalRevenue / (parseInt(period) / 30);

    // Calculate runway scenarios
    const cashReserves = 100000; // This would come from user settings
    const currentRunway = monthlyBurn > 0 ? cashReserves / monthlyBurn : Infinity;
    const optimisticRunway = monthlyBurn > 0 ? cashReserves / (monthlyBurn * 0.8) : Infinity;
    const pessimisticRunway = monthlyBurn > 0 ? cashReserves / (monthlyBurn * 1.2) : Infinity;

    // Generate burn rate trends (monthly)
    const burnTrends = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(0);

      const monthExpenses = expenseData.filter(expense => {
        const expenseDate = new Date(expense.date);
        return expenseDate >= monthStart && expenseDate <= monthEnd;
      });

      const monthRevenue = revenueData.filter(revenue => {
        const revenueDate = new Date(revenue.date);
        return revenueDate >= monthStart && revenueDate <= monthEnd;
      });

      burnTrends.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        burn: monthExpenses.reduce((sum, exp) => sum + exp.value, 0),
        revenue: monthRevenue.reduce((sum, rev) => sum + rev.value, 0),
        netCashFlow: monthRevenue.reduce((sum, rev) => sum + rev.value, 0) - monthExpenses.reduce((sum, exp) => sum + exp.value, 0)
      });
    }

    res.json({
      overview: {
        monthlyBurn: Math.round(monthlyBurn),
        monthlyRevenue: Math.round(monthlyRevenue),
        netCashFlow: Math.round(monthlyRevenue - monthlyBurn),
        runway: currentRunway === Infinity ? 'Infinite' : Math.round(currentRunway)
      },
      expenseBreakdown: expenseBreakdown,
      scenarios: {
        current: currentRunway === Infinity ? 'Infinite' : Math.round(currentRunway),
        optimistic: optimisticRunway === Infinity ? 'Infinite' : Math.round(optimisticRunway),
        pessimistic: pessimisticRunway === Infinity ? 'Infinite' : Math.round(pessimisticRunway)
      },
      trends: burnTrends
    });

  } catch (error) {
    console.error('Burn rate dashboard error:', error);
    res.status(500).json({
      error: 'Failed to fetch burn rate data',
      message: 'Internal server error'
    });
  }
});

// Get integration status
router.get('/integrations', async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const integrations = await MarketingIntegration.findByUser(userId);
    
    const integrationStatus = {
      connected: integrations.filter(i => i.isActive && i.syncStatus === 'success').length,
      disconnected: integrations.filter(i => !i.isActive).length,
      error: integrations.filter(i => i.isActive && i.syncStatus === 'error').length,
      total: integrations.length
    };

    const recentSyncs = integrations
      .filter(i => i.lastSync)
      .sort((a, b) => new Date(b.lastSync) - new Date(a.lastSync))
      .slice(0, 5)
      .map(i => ({
        platform: i.platformName,
        status: i.syncStatus,
        lastSync: i.lastSync,
        error: i.errorMessage
      }));

    res.json({
      status: integrationStatus,
      recentSyncs: recentSyncs,
      integrations: integrations.map(i => i.toJSON())
    });

  } catch (error) {
    console.error('Integrations dashboard error:', error);
    res.status(500).json({
      error: 'Failed to fetch integration data',
      message: 'Internal server error'
    });
  }
});

export default router;

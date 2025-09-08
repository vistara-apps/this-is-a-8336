# ProfitPilot Server

Backend API server for ProfitPilot - Navigate your startup's financials with clarity and foresight.

## Features

- **Automated CAC Tracking**: Connect to marketing platforms (Google Ads, Meta Ads) to automatically calculate Customer Acquisition Cost
- **LTV Prediction & Segmentation**: Analyze customer data to predict Lifetime Value and segment users
- **MRR Projections**: Forecast Monthly Recurring Revenue based on current metrics and growth patterns
- **Burn Rate Calculator**: Track expenses and calculate runway with current cash reserves

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: SQLite3
- **Authentication**: JWT
- **Integrations**: Stripe, Google Ads API
- **Scheduling**: Node-cron
- **Security**: Helmet, CORS, Rate limiting

## Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- npm 8.0.0 or higher

### Installation

1. Clone the repository:
```bash
git clone https://github.com/vistara-apps/this-is-a-8336.git
cd this-is-a-8336/server
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Initialize the database:
```bash
npm run db:init
```

5. Start the development server:
```bash
npm run dev
```

The server will start on `http://localhost:3001`

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NODE_ENV` | Environment (development/production) | Yes |
| `PORT` | Server port | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `DATABASE_URL` | SQLite database path | Yes |
| `STRIPE_SECRET_KEY` | Stripe API secret key | Optional |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token | Optional |
| `CORS_ORIGINS` | Allowed CORS origins | Yes |

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - User logout

### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile
- `PUT /api/users/subscription` - Update subscription tier

### Integrations
- `GET /api/integrations` - List user integrations
- `POST /api/integrations` - Create new integration
- `POST /api/integrations/:id/sync` - Sync integration data

### Dashboard
- `GET /api/dashboard/overview` - Get dashboard metrics
- `GET /api/dashboard/cac` - Get CAC analysis
- `GET /api/dashboard/mrr` - Get MRR projections
- `GET /api/dashboard/ltv` - Get LTV analysis
- `GET /api/dashboard/burn-rate` - Get burn rate analysis

### Financial Data
- `GET /api/financial-data` - Get financial data with filtering
- `POST /api/financial-data` - Create financial data record
- `POST /api/financial-data/bulk` - Bulk create records

## Database Schema

### Users
- `userId` (TEXT, PRIMARY KEY)
- `email` (TEXT, UNIQUE)
- `passwordHash` (TEXT)
- `subscriptionTier` (TEXT)
- `createdAt` (DATETIME)

### Financial Data
- `dataId` (TEXT, PRIMARY KEY)
- `userId` (TEXT, FOREIGN KEY)
- `date` (DATE)
- `metricType` (TEXT)
- `value` (REAL)
- `sourceChannel` (TEXT)
- `metadata` (TEXT)

### Marketing Integrations
- `integrationId` (TEXT, PRIMARY KEY)
- `userId` (TEXT, FOREIGN KEY)
- `platformName` (TEXT)
- `apiKey` (TEXT)
- `accessToken` (TEXT)
- `isActive` (BOOLEAN)
- `lastSync` (DATETIME)

## Subscription Tiers

### Free Tier
- Basic tracking
- Simple projections
- 2 integrations max
- 30 days data retention

### Pro Tier ($19/month)
- Advanced analytics
- LTV prediction
- 10 integrations
- 365 days data retention

### Premium Tier ($49/month)
- All features
- Priority support
- Unlimited integrations
- Unlimited data retention
- Custom integrations

## Scheduled Tasks

The server runs automated tasks:

- **Google Ads Sync**: Every 4 hours
- **Stripe Data Sync**: Every 2 hours
- **Data Cleanup**: Daily at 2 AM

## Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Rate limiting (100 requests per 15 minutes)
- CORS protection
- Input validation
- SQL injection prevention

## Development

### Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run db:init` - Initialize database
- `npm run db:seed` - Seed database with sample data

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
npm run lint:fix
```

## Deployment

### Production Setup

1. Set `NODE_ENV=production`
2. Use a strong `JWT_SECRET`
3. Configure proper CORS origins
4. Set up SSL/TLS
5. Use a process manager (PM2)
6. Set up monitoring and logging

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run linting and tests
6. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For support, email support@profitpilot.com or create an issue on GitHub.

# Masky

AI-powered stream alert system for Twitch streamers featuring lifelike avatars, real-time event notifications, and customizable alert scripts.

## 🌟 Features

- **AI-Powered Avatars**: Integrate HeyGen and Hume AI avatars with photorealistic voices and natural expressions
- **Real-Time Twitch Events**: Instant alerts for subscriptions, donations, and custom chat commands via Twitch EventSub
- **Custom Alert Scripts**: Write personalized messages and creative prompts for each alert type
- **Seamless Authentication**: Twitch OAuth integration with Firebase backend
- **Serverless Architecture**: Scalable AWS Lambda functions for API endpoints
- **Beautiful UI**: Modern, holographic design with animated backgrounds and smooth interactions

## 🛠️ Tech Stack

### Frontend
- Pure HTML/CSS/JavaScript (no framework required)
- Modern CSS animations and gradients
- Responsive design

### Backend
- **Runtime**: Node.js 18.x
- **Framework**: Serverless Framework (AWS Lambda)
- **Authentication**: Firebase Admin SDK + Twitch OAuth
- **Payment Processing**: Stripe
- **Cloud Provider**: AWS
  - Lambda (API functions)
  - S3 (static hosting)
  - SSM Parameter Store (secrets management)
  - CloudFront (CDN)
  - SES (email)

### External APIs
- Twitch API (EventSub, OAuth)
- HeyGen API (AI avatars)
- Hume AI API (voice synthesis)
- Stripe API (payments)

## 📋 Prerequisites

Before you begin, ensure you have the following:

- Node.js 18.x or higher
- AWS CLI configured with appropriate credentials
- Serverless Framework CLI (`npm install -g serverless`)
- Firebase project with Admin SDK credentials
- Twitch Developer account and app credentials
- Stripe account (for payment processing)

## 🔧 Environment Setup

### 1. AWS SSM Parameter Store

Store sensitive credentials in AWS Systems Manager Parameter Store:

```bash
# Firebase Service Account
aws ssm put-parameter \
  --name "/masky/production/firebase_service_account" \
  --value '{"type":"service_account",...}' \
  --type "SecureString" \
  --region us-east-1

# Twitch Client ID
aws ssm put-parameter \
  --name "/masky/production/twitch_client_id" \
  --value "your_twitch_client_id" \
  --type "SecureString" \
  --region us-east-1

# Twitch Client Secret
aws ssm put-parameter \
  --name "/masky/production/twitch_client_secret" \
  --value "your_twitch_client_secret" \
  --type "SecureString" \
  --region us-east-1

# Stripe Secret Key
aws ssm put-parameter \
  --name "/voicecert/production/STRIPE_SECRET_KEY" \
  --value "sk_live_..." \
  --type "SecureString" \
  --region us-east-1

# Stripe Webhook Secret
aws ssm put-parameter \
  --name "/voicecert/production/STRIPE_WEBHOOK_SECRET" \
  --value "whsec_..." \
  --type "SecureString" \
  --region us-east-1
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure AWS Credentials

```bash
aws configure
# Enter your AWS Access Key ID, Secret Access Key, and region (us-east-1)
```

## 🚀 Deployment

### Deploy to Production

Deploy the serverless API to AWS Lambda:

```bash
# Deploy to production stage
serverless deploy --stage production

# Or use the shorthand
sls deploy --stage production
```

This will:
- Package your Lambda functions
- Create/update API Gateway endpoints
- Set up IAM roles and permissions
- Configure environment variables
- Output your API endpoint URL

### Deploy to Development/Staging

```bash
# Deploy to dev stage
serverless deploy --stage dev

# Deploy to staging
serverless deploy --stage staging
```

### Deploy Specific Function

To deploy only the API function (faster than full deployment):

```bash
serverless deploy function --function api --stage production
```

### Deploy Frontend (Static Files)

The frontend is deployed to S3 via GitHub Actions, or manually:

```bash
# Sync static files to S3
aws s3 sync . s3://www.masky.net \
  --exclude "*" \
  --include "index.html" \
  --region us-east-1

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id EU2CPB9MU0VI2 \
  --paths "/*"
```

### View Deployment Info

```bash
# View service information
serverless info --stage production

# View logs
serverless logs --function api --stage production --tail
```

## 📁 Project Structure

```
masky/
├── api/
│   └── api.js                 # Main Lambda handler (Twitch OAuth, routing)
├── utils/
│   ├── firebaseInit.js        # Firebase Admin SDK initialization
│   ├── stripeInit.js          # Stripe SDK initialization
│   └── twitchInit.js          # Twitch API client & token verification
├── .github/
│   └── workflows/
│       └── deploy.yml         # GitHub Actions CI/CD pipeline
├── index.html                 # Frontend application (SPA)
├── serverless.yml             # Serverless Framework configuration
├── package.json               # Node.js dependencies
└── README.md                  # This file
```

## 🔌 API Endpoints

### POST `/api/twitch_oauth`

Authenticate users via Twitch OAuth and create Firebase custom tokens.

**Request Body:**
```json
{
  "accessToken": "twitch_access_token"
}
```

**Response:**
```json
{
  "firebaseToken": "custom_firebase_token",
  "user": {
    "uid": "twitch:12345678",
    "displayName": "StreamerName",
    "photoURL": "https://...",
    "email": "user@example.com",
    "twitchId": "12345678"
  }
}
```

**Status Codes:**
- `200`: Success
- `400`: Missing accessToken
- `500`: Server error

## 🧪 Testing Locally

### Test Serverless Functions Locally

```bash
# Invoke function locally
serverless invoke local --function api --path test-event.json

# Start offline development server (requires serverless-offline plugin)
npm install --save-dev serverless-offline
serverless offline --stage dev
```

### Test Frontend Locally

```bash
# Simple HTTP server
python -m http.server 8000
# or
npx serve .

# Open browser to http://localhost:8000
```

## 📊 Monitoring & Logs

### View Lambda Logs

```bash
# Tail logs in real-time
serverless logs --function api --stage production --tail

# View logs from the last hour
serverless logs --function api --stage production --startTime 1h
```

### AWS CloudWatch

Access detailed metrics and logs in AWS CloudWatch:
- Lambda function metrics (invocations, errors, duration)
- API Gateway logs
- Custom CloudWatch alarms

## 🔒 Security

- **Secrets Management**: All sensitive credentials stored in AWS SSM Parameter Store with encryption
- **IAM Roles**: Lambda functions use least-privilege IAM roles
- **CORS**: Configured for secure cross-origin requests
- **Firebase Auth**: Secure authentication with custom tokens
- **API Gateway**: Rate limiting and throttling enabled

## 🐛 Troubleshooting

### Common Issues

1. **Lambda timeout errors**
   - Increase timeout in `serverless.yml` (default: 6s)
   - Check CloudWatch logs for slow API calls

2. **SSM Parameter not found**
   - Verify parameter names match exactly
   - Ensure parameters are in `us-east-1` region
   - Check IAM permissions for SSM access

3. **Firebase initialization errors**
   - Validate service account JSON format
   - Ensure Firebase project has Admin SDK enabled

4. **Twitch OAuth failures**
   - Verify redirect URI matches Twitch app settings
   - Check client ID and secret are correct
   - Ensure scopes are properly requested

### Debug Mode

Enable verbose logging:

```bash
SLS_DEBUG=* serverless deploy --stage production
```

## 📝 Development Workflow

1. Make changes to code
2. Test locally with `serverless offline` or `serverless invoke local`
3. Commit changes to git
4. Push to `main` or `production` branch
5. GitHub Actions automatically deploys (for frontend)
6. Manually deploy serverless functions: `sls deploy --stage production`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is proprietary and confidential.

## 🔗 Resources

- [Serverless Framework Documentation](https://www.serverless.com/framework/docs)
- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [Twitch API Documentation](https://dev.twitch.tv/docs/api/)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Stripe API Documentation](https://stripe.com/docs/api)

## 📧 Support

For issues or questions, please contact the development team.

---

**Made with 💜 by the Masky Team**


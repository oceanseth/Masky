# Verify Stripe SSM Parameters

This guide helps verify that Stripe credentials are properly stored in AWS SSM Parameter Store.

## Required SSM Parameters

For production, you need these parameters in AWS SSM:

1. **Stripe Secret Key**: `/masky/production/stripe_secret_key`
2. **Stripe Webhook Secret**: `/masky/production/stripe_webhook_secret`

## Verify Parameters Exist

### Using AWS CLI

```bash
# Check if Stripe secret key exists
aws ssm get-parameter \
  --name "/masky/production/stripe_secret_key" \
  --with-decryption \
  --region us-east-1

# Check if Stripe webhook secret exists
aws ssm get-parameter \
  --name "/masky/production/stripe_webhook_secret" \
  --with-decryption \
  --region us-east-1
```

### Expected Output

Both commands should return:
- `Parameter.Name`: The parameter name
- `Parameter.Value`: The actual secret value (starts with `sk_live_` for secret key, `whsec_` for webhook secret)
- `Parameter.Type`: Should be `SecureString`

## If Parameters Are Missing

### Create Stripe Secret Key Parameter

```bash
aws ssm put-parameter \
  --name "/masky/production/stripe_secret_key" \
  --value "sk_live_YOUR_SECRET_KEY_HERE" \
  --type "SecureString" \
  --region us-east-1 \
  --overwrite
```

### Create Stripe Webhook Secret Parameter

```bash
aws ssm put-parameter \
  --name "/masky/production/stripe_webhook_secret" \
  --value "whsec_YOUR_WEBHOOK_SECRET_HERE" \
  --type "SecureString" \
  --region us-east-1 \
  --overwrite
```

## Verify Lambda Has Permissions

Ensure your Lambda execution role has permissions to read from SSM:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": [
        "arn:aws:ssm:us-east-1:*:parameter/masky/production/stripe_secret_key",
        "arn:aws:ssm:us-east-1:*:parameter/masky/production/stripe_webhook_secret"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "ssm.us-east-1.amazonaws.com"
        }
      }
    }
  ]
}
```

## Troubleshooting

### Error: "Stripe secret key not found in SSM"

**Possible causes:**
1. Parameter doesn't exist in SSM
2. Parameter name is incorrect (check `/masky/production/stripe_secret_key`)
3. Lambda doesn't have permissions to read from SSM
4. Wrong AWS region (should be `us-east-1`)

**Solution:**
- Verify parameter exists using AWS CLI (see above)
- Check Lambda execution role permissions
- Verify STAGE environment variable is set to `production`

### Error: "Stripe initialization failed"

**Possible causes:**
1. Invalid Stripe secret key format
2. Stripe API is down
3. Network connectivity issues from Lambda

**Solution:**
- Verify secret key starts with `sk_live_` (production) or `sk_test_` (test)
- Check Stripe status page
- Review CloudWatch logs for detailed error messages

## Testing

After verifying SSM parameters, test the API endpoint:

```bash
curl -X POST https://masky.ai/api/donations/create-payment-intent \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user_id",
    "amount": 10,
    "viewerId": "test_viewer_id"
  }'
```

Expected response should include:
- `clientSecret`: A string starting with `pi_`
- `amount`: The amount charged (with fees)
- `originalAmount`: The original donation amount




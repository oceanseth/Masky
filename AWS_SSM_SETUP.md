# AWS SSM to Local Environment Setup

This guide explains how to automatically load your AWS SSM Parameter Store secrets into `.env.local` for local development.

## What This Does

The scripts `load-ssm-to-env.ps1` (Windows) and `load-ssm-to-env.sh` (Mac/Linux) automatically:

1. ✅ Connect to your AWS account
2. ✅ Fetch all secrets from AWS SSM Parameter Store
3. ✅ Format them properly for `.env.local`
4. ✅ Base64-encode Firebase service account JSON
5. ✅ Backup existing `.env.local` if present
6. ✅ Create or update `.env.local`

**Result:** One command replaces all manual credential copying!

## Prerequisites

### 1. Install AWS CLI

**Windows:**
- Download from: https://aws.amazon.com/cli/
- Or use: `winget install Amazon.AWSCLI`

**Mac:**
```bash
brew install awscli
```

**Linux:**
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

**Verify installation:**
```bash
aws --version
```

### 2. Configure AWS Credentials

Run the AWS configure wizard:
```bash
aws configure
```

You'll need:
- **AWS Access Key ID** - From IAM user in AWS Console
- **AWS Secret Access Key** - From IAM user in AWS Console
- **Default region** - Enter `us-east-1`
- **Default output format** - Enter `json`

**Alternative:** Set environment variables:
```bash
# Windows PowerShell
$env:AWS_ACCESS_KEY_ID="your-key"
$env:AWS_SECRET_ACCESS_KEY="your-secret"
$env:AWS_DEFAULT_REGION="us-east-1"

# Mac/Linux
export AWS_ACCESS_KEY_ID="your-key"
export AWS_SECRET_ACCESS_KEY="your-secret"
export AWS_DEFAULT_REGION="us-east-1"
```

### 3. IAM Permissions Required

Your AWS user needs permission to read SSM parameters. Required policy:

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
        "arn:aws:ssm:us-east-1:*:parameter/masky/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*"
    }
  ]
}
```

## Usage

### Basic Usage (Production Stage)

**Windows PowerShell:**
```powershell
.\load-ssm-to-env.ps1
```

**Mac/Linux:**
```bash
chmod +x load-ssm-to-env.sh
./load-ssm-to-env.sh
```

This fetches parameters from `/masky/production/*` by default.

### Specify a Different Stage

If you have staging/development parameters in SSM:

**Windows:**
```powershell
.\load-ssm-to-env.ps1 staging
```

**Mac/Linux:**
```bash
./load-ssm-to-env.sh staging
```

This fetches from `/masky/staging/*`.

## What Gets Loaded

The scripts fetch these SSM parameters:

| SSM Parameter Path | Environment Variable | Description |
|-------------------|---------------------|-------------|
| `/masky/{stage}/firebase_service_account` | `FIREBASE_SERVICE_ACCOUNT` | Firebase admin SDK credentials (base64-encoded) |
| `/masky/{stage}/twitch_client_id` | `TWITCH_CLIENT_ID` | Twitch OAuth client ID |
| `/masky/{stage}/twitch_client_secret` | `TWITCH_CLIENT_SECRET` | Twitch OAuth client secret |
| `/masky/{stage}/stripe_secret_key` | `STRIPE_SECRET_KEY` | Stripe API secret key |
| `/masky/{stage}/stripe_webhook_secret` | `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `/masky/{stage}/heygen_api_key` | `HEYGEN_API_KEY` | HeyGen API key |

## Script Features

### Automatic Base64 Encoding

If the Firebase service account is stored as raw JSON in SSM (starts with `{`), the script automatically base64-encodes it for you.

### Backup Protection

Before overwriting `.env.local`, the script creates a timestamped backup:
```
.env.local.backup.20241107_143022
```

You can restore from a backup if needed:
```powershell
# Windows
Copy-Item .env.local.backup.20241107_143022 .env.local

# Mac/Linux
cp .env.local.backup.20241107_143022 .env.local
```

### Error Handling

The scripts provide clear error messages:

**Not authenticated:**
```
✗ ERROR: Not authenticated with AWS!

Please configure AWS CLI:
  aws configure
```

**No parameters found:**
```
✗ ERROR: Could not fetch any parameters!

Possible reasons:
  1. Parameters don't exist in SSM for stage 'production'
  2. Your AWS credentials don't have SSM read permissions
  3. Wrong AWS region (should be us-east-1)
```

**Missing parameters:**
```
  Fetching Firebase Service Account... ✓
  Fetching Twitch Client ID... ✓
  Fetching Twitch Client Secret... ✗ (not found or no access)
  Fetching Stripe Secret Key... ✓
```

## Example Output

```
========================================
  Loading SSM Parameters to .env.local
========================================

✓ AWS CLI found: aws-cli/2.x.x
✓ Authenticated as: arn:aws:iam::123456789:user/developer

Fetching parameters for stage: production

  Fetching Firebase Service Account... ✓
  Fetching Twitch Client ID... ✓
  Fetching Twitch Client Secret... ✓
  Fetching Stripe Secret Key... ✓
  Fetching Stripe Webhook Secret... ✓
  Fetching HeyGen API Key... ✓

Encoding Firebase service account to base64...
  ✓ Encoded

========================================
  ✓ .env.local created successfully!
========================================

Summary:
  Firebase Service Account: ✓
  Twitch Client ID:         ✓
  Twitch Client Secret:     ✓
  Stripe Secret Key:        ✓
  Stripe Webhook Secret:    ✓
  HeyGen API Key:           ✓

Next steps:
  1. Review .env.local to verify the values
  2. Run: npm run api:dev
  3. Test: curl http://localhost:3001/api/heygen/avatars
```

## Troubleshooting

### AWS CLI Not Found

**Error:**
```
✗ ERROR: AWS CLI not found!
```

**Solution:** Install AWS CLI (see Prerequisites above)

### Not Authenticated

**Error:**
```
✗ ERROR: Not authenticated with AWS!
```

**Solution:** Run `aws configure` and enter your credentials

### No Permissions

**Error:**
```
  Fetching Firebase Service Account... ✗ (not found or no access)
```

**Solution:** Your IAM user needs `ssm:GetParameter` permission (see IAM Permissions section)

### Wrong Region

Parameters are in `us-east-1`. Make sure:
```bash
aws configure get region
# Should output: us-east-1
```

Or set it:
```bash
aws configure set region us-east-1
```

### Parameters Don't Exist

**Error:**
```
✗ ERROR: Could not fetch any parameters!
```

**Solution:** Check if parameters exist in SSM:
```bash
aws ssm get-parameter --name /masky/production/twitch_client_id --region us-east-1
```

If they don't exist, you need to create them in AWS SSM Parameter Store first.

## Security Notes

1. **Never commit `.env.local`** - It's in `.gitignore` for safety
2. **Backup files are also gitignored** - `.env.local.backup.*` won't be committed
3. **Use AWS IAM least privilege** - Only grant `ssm:GetParameter` for `/masky/*`
4. **Rotate credentials regularly** - Update SSM parameters, then re-run the script

## Creating SSM Parameters

If you need to create/update SSM parameters:

```bash
# Example: Set Twitch Client ID
aws ssm put-parameter \
  --name /masky/production/twitch_client_id \
  --value "your-client-id" \
  --type SecureString \
  --region us-east-1

# Example: Set Firebase Service Account (from file)
aws ssm put-parameter \
  --name /masky/production/firebase_service_account \
  --value file://serviceAccountKey.json \
  --type SecureString \
  --region us-east-1
```

## Refreshing Credentials

When credentials change in AWS SSM, just re-run the script:

```bash
# Windows
.\load-ssm-to-env.ps1

# Mac/Linux
./load-ssm-to-env.sh
```

It will automatically:
- Backup the old `.env.local`
- Fetch latest values from SSM
- Create updated `.env.local`

## Integration with CI/CD

These scripts can also be used in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Load SSM to .env.local
  run: ./load-ssm-to-env.sh production
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_DEFAULT_REGION: us-east-1
```

## Next Steps

After running the script:

1. ✅ Verify `.env.local` was created
2. ✅ Review the values (don't share them!)
3. ✅ Start local development: `npm run api:dev`
4. ✅ Test an endpoint: `curl http://localhost:3001/api/heygen/avatars`

---

Happy developing! 🚀


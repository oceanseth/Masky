# PowerShell script to update Stripe webhook endpoint
# This script updates the webhook endpoint from masky.net to direct API Gateway

param(
    [string]$StripeApiKey = "",
    [string]$WebhookId = "",
    [string]$NewEndpoint = "https://b4feblbni7.execute-api.us-east-1.amazonaws.com/production/api/stripe/webhook"
)

if ([string]::IsNullOrEmpty($StripeApiKey)) {
    Write-Host "Error: Please provide your Stripe API key"
    Write-Host "Usage: .\update-stripe-webhook.ps1 -StripeApiKey 'sk_live_...' -WebhookId 'whsec_...'"
    exit 1
}

if ([string]::IsNullOrEmpty($WebhookId)) {
    Write-Host "Error: Please provide your webhook ID"
    Write-Host "Usage: .\update-stripe-webhook.ps1 -StripeApiKey 'sk_live_...' -WebhookId 'whsec_...'"
    exit 1
}

Write-Host "Updating Stripe webhook endpoint..."
Write-Host "Current endpoint: https://masky.net/api/stripe/webhook"
Write-Host "New endpoint: $NewEndpoint"

try {
    # Update webhook endpoint using Stripe API
    $headers = @{
        "Authorization" = "Bearer $StripeApiKey"
        "Content-Type" = "application/x-www-form-urlencoded"
    }
    
    $body = @{
        "url" = $NewEndpoint
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "https://api.stripe.com/v1/webhook_endpoints/$WebhookId" -Method Post -Headers $headers -Body $body
    
    Write-Host "✅ Webhook endpoint updated successfully!"
    Write-Host "New URL: $($response.url)"
    Write-Host "Status: $($response.status)"
    
} catch {
    Write-Host "❌ Error updating webhook endpoint:"
    Write-Host $_.Exception.Message
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody"
    }
    
    exit 1
}

Write-Host ""
Write-Host "🎉 Webhook endpoint updated successfully!"
Write-Host "Stripe will now send webhooks directly to your API Gateway endpoint."

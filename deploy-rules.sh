#!/bin/bash

# Firebase Security Rules Deployment Script
# This script deploys Firestore and Storage security rules

echo "🔥 Deploying Firebase Security Rules..."

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI is not installed. Please install it first:"
    echo "npm install -g firebase-tools"
    exit 1
fi

# Check if user is logged in
if ! firebase projects:list &> /dev/null; then
    echo "❌ Not logged in to Firebase. Please login first:"
    echo "firebase login"
    exit 1
fi

# Deploy Firestore rules
echo "📝 Deploying Firestore rules..."
firebase deploy --only firestore:rules

if [ $? -eq 0 ]; then
    echo "✅ Firestore rules deployed successfully!"
else
    echo "❌ Failed to deploy Firestore rules"
    exit 1
fi

# Deploy Storage rules
echo "📁 Deploying Storage rules..."
firebase deploy --only storage

if [ $? -eq 0 ]; then
    echo "✅ Storage rules deployed successfully!"
else
    echo "❌ Failed to deploy Storage rules"
    exit 1
fi

echo "🎉 All security rules deployed successfully!"
echo ""
echo "📋 Security Rules Summary:"
echo "  • Users can only access their own user documents"
echo "  • Users can only access projects they own"
echo "  • Users can only access alerts for their own projects"
echo "  • Users can only upload/access their own voice and avatar files"
echo "  • All other access is denied"

# Check Avatar Groups Script

This script helps you identify which avatar groups in Firestore have the `avatar_group_id` field set.

## Setup

1. Download your Firebase service account key:
   - Go to Firebase Console → Project Settings → Service Accounts
   - Click "Generate new private key"
   - Save it as `serviceAccountKey.json` in the project root
   - **IMPORTANT**: Add `serviceAccountKey.json` to `.gitignore` to avoid committing it

2. Install dependencies (if not already installed):
   ```bash
   npm install firebase-admin
   ```

## Usage

```bash
node scripts/check-avatar-groups.js
```

## Output

The script will:
- List all avatar groups
- Mark which ones have `avatar_group_id` (✓) and which don't (✗)
- Show a summary with counts
- List all groups missing `avatar_group_id`

## Alternative: Using Firebase CLI

If you prefer using Firebase CLI instead:

```bash
# Install Firebase CLI if needed
npm install -g firebase-tools

# Login
firebase login

# Use Firestore emulator or export data
firebase firestore:export ./firestore-export
```

Then you can inspect the exported JSON files.


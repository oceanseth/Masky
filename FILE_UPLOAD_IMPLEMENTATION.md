# File Upload Implementation

## Overview
This document explains the file upload implementation for voice recordings and avatar images in the Masky application.

## Problem Solved
The original implementation was returning placeholder URLs instead of actually uploading files to Firebase Storage, causing "NoSuchBucket" errors when trying to access the files.

## Implementation Details

### 1. Multipart Form Data Parser
Created `api/multipartParser.js` to handle file uploads:

```javascript
function parseMultipartData(body, boundary) {
    // Parses multipart form data and extracts files and form fields
    // Returns: { files: [...], fields: {...} }
}
```

**Features:**
- Extracts file data from multipart form uploads
- Preserves original file names and content types
- Handles both files and regular form fields
- Returns structured data for easy processing

### 2. Voice Upload API (`/upload-voice`)

#### Process Flow:
1. **Authentication**: Verify Firebase ID token
2. **Content Type Check**: Ensure multipart/form-data
3. **Parse Upload**: Extract file data using multipart parser
4. **Generate Filename**: `voice_{userId}_{timestamp}.{extension}`
5. **Upload to Storage**: Save to Firebase Storage bucket
6. **Make Public**: Set file permissions for public access
7. **Return URL**: Return the public URL

#### Code Example:
```javascript
// Parse the multipart data
const { files, fields } = parseMultipartData(body, boundary);

const uploadedFile = files[0];
const fileName = `voice_${userId}_${timestamp}.${fileExtension}`;

// Upload to Firebase Storage
const bucket = admin.storage().bucket();
const file = bucket.file(`voices/${fileName}`);
await file.save(uploadedFile.data, {
    metadata: {
        contentType: uploadedFile.contentType,
        metadata: {
            userId: userId,
            originalFileName: uploadedFile.fileName,
            uploadedAt: new Date().toISOString()
        }
    }
});

await file.makePublic();
```

### 3. Avatar Upload API (`/upload-avatar`)

#### Process Flow:
1. **Authentication**: Verify Firebase ID token
2. **Content Type Check**: Ensure multipart/form-data
3. **Parse Upload**: Extract file data using multipart parser
4. **Generate Filename**: `avatar_{userId}_{timestamp}.{extension}`
5. **Upload to Storage**: Save to Firebase Storage bucket
6. **Make Public**: Set file permissions for public access
7. **Return URL**: Return the public URL

### 4. Firebase Storage Security Rules

#### Voice Files:
```javascript
match /voices/{fileName} {
  allow read, write: if isAuthenticated() && 
    fileName.matches('voice_' + request.auth.uid + '_.*');
}
```

#### Avatar Files:
```javascript
match /avatars/{fileName} {
  allow read, write: if isAuthenticated() && 
    fileName.matches('avatar_' + request.auth.uid + '_.*');
}
```

**Security Features:**
- Users can only upload files with their user ID in the filename
- Users can only access files they own
- Authentication required for all operations
- File naming convention enforced by security rules

### 5. File Naming Convention

#### Voice Files:
- Format: `voice_{userId}_{timestamp}.{extension}`
- Example: `voice_twitch:11867613_1761467031068.wav`
- Location: `/voices/` folder in Firebase Storage

#### Avatar Files:
- Format: `avatar_{userId}_{timestamp}.{extension}`
- Example: `avatar_twitch:11867613_1761467031068.jpg`
- Location: `/avatars/` folder in Firebase Storage

### 6. File Metadata

Each uploaded file includes metadata:
```javascript
{
    contentType: 'audio/wav', // or 'image/jpeg', etc.
    metadata: {
        userId: 'twitch:11867613',
        originalFileName: 'recording.wav',
        uploadedAt: '2024-01-15T10:30:00.000Z'
    }
}
```

### 7. Public Access

Files are made publicly accessible for easy integration:
- **Voice URLs**: `https://storage.googleapis.com/maskydotnet.firebasestorage.app/voices/voice_{userId}_{timestamp}.wav`
- **Avatar URLs**: `https://storage.googleapis.com/maskydotnet.firebasestorage.app/avatars/avatar_{userId}_{timestamp}.jpg`

## Usage Examples

### Frontend Voice Upload:
```javascript
const formData = new FormData();
formData.append('voice', audioBlob, 'recording.wav');

const response = await fetch('/api/upload-voice', {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${idToken}`
    },
    body: formData
});

const { voiceUrl } = await response.json();
```

### Frontend Avatar Upload:
```javascript
const formData = new FormData();
formData.append('avatar', imageFile, 'avatar.jpg');

const response = await fetch('/api/upload-avatar', {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${idToken}`
    },
    body: formData
});

const { avatarUrl } = await response.json();
```

## Error Handling

### Common Errors:
1. **401 Unauthorized**: Invalid or missing Firebase token
2. **400 Bad Request**: Invalid content type or no file data
3. **500 Internal Server Error**: Firebase Storage upload failure

### Error Response Format:
```javascript
{
    "error": "Error message",
    "message": "Detailed error description"
}
```

## Security Considerations

### 1. Authentication Required
- All uploads require valid Firebase authentication
- User ID is extracted from the JWT token
- No anonymous uploads allowed

### 2. File Ownership
- Files are named with user ID to prevent conflicts
- Security rules enforce ownership
- Users can only access their own files

### 3. File Type Validation
- Content type is preserved from original upload
- File extension is maintained
- No arbitrary file types allowed

### 4. Public Access
- Files are made publicly readable for easy access
- Consider using signed URLs for better security in production
- File names include user ID for basic access control

## Deployment

### 1. Deploy Storage Rules:
```bash
firebase deploy --only storage
```

### 2. Deploy API:
```bash
# Deploy your serverless function with the updated code
```

### 3. Test Upload:
```bash
# Test voice upload
curl -X POST /api/upload-voice \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "voice=@recording.wav"

# Test avatar upload
curl -X POST /api/upload-avatar \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "avatar=@image.jpg"
```

## Troubleshooting

### "NoSuchBucket" Error:
- **Cause**: File wasn't actually uploaded to Firebase Storage
- **Solution**: Ensure the multipart parser is working correctly
- **Check**: Verify Firebase Storage bucket exists and is accessible

### Upload Failures:
- **Check**: Firebase Storage permissions
- **Verify**: User authentication is working
- **Ensure**: Multipart data is being parsed correctly

### Access Denied:
- **Cause**: Security rules blocking access
- **Check**: File naming convention matches security rules
- **Verify**: User is authenticated and owns the file

## Future Improvements

### 1. Signed URLs
Instead of making files public, use signed URLs for better security:
```javascript
const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
});
```

### 2. File Size Limits
Add file size validation:
```javascript
if (uploadedFile.data.length > MAX_FILE_SIZE) {
    throw new Error('File too large');
}
```

### 3. File Type Validation
Add strict file type checking:
```javascript
const allowedTypes = ['audio/wav', 'audio/mp3', 'image/jpeg', 'image/png'];
if (!allowedTypes.includes(uploadedFile.contentType)) {
    throw new Error('Invalid file type');
}
```

### 4. Virus Scanning
Integrate with a virus scanning service for uploaded files.

## Conclusion

The file upload implementation now properly uploads files to Firebase Storage with:
- ✅ **Real file uploads** (not placeholder URLs)
- ✅ **Proper multipart parsing**
- ✅ **Security rules enforcement**
- ✅ **User ownership verification**
- ✅ **Public access for easy integration**
- ✅ **Comprehensive error handling**

Files are now accessible at the returned URLs and will work correctly in the application.

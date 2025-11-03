## HeyGen Integration Flow (Masky)

This guide documents how Masky integrates with HeyGen to generate avatar videos from user assets and audio.

### High-level flow

1) Ensure per-user HeyGen folder
- Name: `masky_{userId}`
- API: Create Folder (HeyGen)
- Persistence: `users/{uid}.heygenFolderId`

2) Ensure avatar group for a user image asset
- Group name: `masky_{userId}` (single group per user)
- If a new image asset is provided, add it as a new look
- APIs:
  - Create photo avatar group
  - Add looks to photo avatar group (payload includes `[{ url }]`)
  - List avatars in avatar group (to get `avatar_id`)
- Persistence: `users/{uid}/heygenAvatarGroups` docs with `{ avatar_group_id, avatarUrl }`

3) Upload audio as HeyGen asset
- Purpose: obtain `audio_asset_id` for generation
- API: Upload Asset (payload with source `url`)

4) Generate video
- API: Create Avatar Video (V2)
- Request:
  - `video_inputs.character`: `{ type: 'avatar', avatar_id }`
  - `voice`: `{ type: 'audio', audio_asset_id }`
  - `title`: project name
  - `callback_id`: project id
  - `folder_id`: `users/{uid}.heygenFolderId`
  - `dimension`: `{ width, height }`
- Persistence on project: `projects/{projectId}`
  - `heygenVideoId`: returned `video_id`
  - `heygenStatus`: `pending` initially

5) Check video status and retrieve URL
- API: Retrieve Video Status/Details
- Masky proxy: `GET /api/heygen/video_status.get?video_id=...`
- Note: returned `video_url` expires; poll for fresh URL when needed

### Backend responsibilities

- Endpoints added:
  - `GET /api/heygen/avatars` → list HeyGen avatars
  - `GET /api/heygen/voices` → list HeyGen voices
  - `POST /api/heygen/generate` → full flow (folder, group, upload audio asset, generate video)
  - `GET /api/heygen/video_status.get` → status proxy

- Firestore schema used:
  - `users/{uid}`: `{ heygenFolderId }`
  - `users/{uid}/heygenAvatarGroups/*`: `{ avatar_group_id, avatarUrl, createdAt }`
  - `projects/{projectId}`: `{ heygenVideoId, heygenStatus, updatedAt }`

### Request/Response examples

POST /api/heygen/generate (minimal)
```
{
  "projectId": "<projectId>"
}
```

POST /api/heygen/generate (explicit)
```
{
  "projectId": "<projectId>",
  "voiceUrl": "https://.../voices/voice_....webm",
  "userAvatarUrl": "https://.../avatars/avatar_....jpg",
  "heygenAvatarId": null,
  "width": 1280,
  "height": 720,
  "avatarStyle": "normal"
}
```

Response
```
{
  "videoId": "<heygen_video_id>",
  "fallbackAvatarUsed": false
}
```

Status proxy
```
GET /api/heygen/video_status.get?video_id=<heygen_video_id>
```

### Error handling & fallbacks

- If no mapping/avatars can be resolved from the user’s asset, backend attempts a public avatar fallback; if still unavailable, returns 400 `HEYGEN_AVATAR_REQUIRED` with guidance.
- Folder creation failure logs a warning and proceeds without `folder_id`.
- Audio upload failure returns 500 with message.

### Naming conventions

- Folder name: `masky_{userId}`
- Avatar group name: `masky_{userId}`
- Optional mapping doc name: `masky_{userId}_{shortHash}` (internal labeling only)

### Related HeyGen docs

- Create photo avatar group: https://docs.heygen.com/reference/create-photo-avatar-group
- Add looks to photo avatar group: https://docs.heygen.com/reference/add-looks-to-photo-avatar-group
- List avatars in avatar group: https://docs.heygen.com/reference/list-all-avatars-in-one-avatar-group
- Upload asset: https://docs.heygen.com/reference/upload-asset
- Create Avatar Video (V2): https://docs.heygen.com/reference/create-an-avatar-video-v2
- Using audio source as voice: https://docs.heygen.com/docs/using-audio-source-as-voice
- Video list: https://docs.heygen.com/reference/video-list



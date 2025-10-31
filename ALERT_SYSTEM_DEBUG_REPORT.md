/**
 * MASKY ALERT SYSTEM DEBUG REPORT
 * Generated: October 31, 2025
 */

## 🐛 CRITICAL ISSUES FOUND

### 1. SUBSCRIPTION ALERTS NOT WORKING (COMPLETE SYSTEM FAILURE)

**Root Cause**: No alert fetching/display system exists
- ❌ EventSub webhooks work and save events to Firestore  
- ❌ Frontend never fetches events from database
- ❌ Only mock alerts created via createNewAlert()
- ❌ No real-time listeners for incoming events
- ❌ No alert display system connected to actual data

**Location**: src/main.js lines 390-410
**Current Code**: Only mock alert creation, no database queries

### 2. FOLLOW ALERTS NOT RANDOMIZED (LOGIC ERROR)

**Root Cause**: Broken randomization storage logic
- ✅ Random project selection works: Math.floor(Math.random() * activeProjects.length)
- ❌ All events stored in SAME database path regardless of selection
- ❌ eventKey is always "twitch_channel.follow" for all follow events
- ❌ No per-project event storage or routing

**Location**: utils/twitchInit.js lines 415-435
**Problem**: selectedProject used only as reference, not for actual routing

### 3. MISSING REAL-TIME ALERT SYSTEM

**Root Cause**: No connection between EventSub data and alert display
- ❌ No Firestore listeners for new events  
- ❌ No alert rendering from database data
- ❌ No project-specific alert routing
- ❌ No real-time updates when events arrive

## 🔧 REQUIRED FIXES

### FIX 1: Implement Alert Fetching System
```javascript
// Add to main.js in onAuthChange()
async function loadUserAlerts() {
  const user = getCurrentUser();
  const db = getFirestore();
  
  // Listen for new events in real-time
  const eventsRef = collection(db, `users/${user.uid}/events`);
  onSnapshot(eventsRef, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        displayAlert(change.doc.data());
      }
    });
  });
}
```

### FIX 2: Fix Randomization Storage
```javascript
// Fix in utils/twitchInit.js
// Instead of single eventKey, store per-project:
const projectSpecificKey = `${projectId}_${subscription.type}`;
await db.collection('projects').doc(projectId).collection('alerts').add(alertData);

// Or implement proper project rotation in display layer
```

### FIX 3: Add Real-Time Alert Display
```javascript
function displayAlert(eventData) {
  // Get project details for the event
  // Display actual alert with user's video/audio
  // Show on stream overlay or dashboard
}
```

## 📊 IMPACT ASSESSMENT

**Subscription Alerts (channel.subscribe)**: 
- Status: COMPLETELY BROKEN ❌
- Events: Being saved to Firestore ✅  
- Display: Never shown to user ❌
- Impact: 100% failure rate

**Follow Alert Randomization**:
- Status: BROKEN LOGIC ❌
- Random Selection: Working ✅
- Event Storage: All in same location ❌ 
- Display: Would show same alert always ❌
- Impact: No randomization despite multiple projects

**Overall System Status**: 
- EventSub Integration: ✅ WORKING
- Database Storage: ✅ WORKING  
- Alert Display: ❌ MISSING
- Randomization: ❌ BROKEN
- User Experience: ❌ FAILED

## 🎯 PRIORITY FIXES NEEDED

1. **CRITICAL**: Implement alert fetching and display system
2. **HIGH**: Fix randomization storage logic  
3. **HIGH**: Add real-time event listeners
4. **MEDIUM**: Add project-specific alert routing
5. **LOW**: Add alert management UI

Without these fixes, Masky alerts will not work at all during streaming.
const https = require('https');

/**
 * StreamElements Integration Utility
 */
class StreamElementsInitializer {
  constructor() {
    this.apiBase = 'https://api.streamelements.com/kappa/v2';
  }

  /**
   * Helper function to make HTTPS requests
   */
  makeHttpsRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve(data);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  }

  /**
   * Get recent activities from StreamElements
   */
  async getRecentActivities(channelId, options = {}) {
    const {
      limit = 25,
      type = 'tip', // tip, follow, subscriber, cheer, raid
      offset = 0
    } = options;

    try {
      const url = `${this.apiBase}/activities/${channelId}?limit=${limit}&type=${type}&offset=${offset}`;
      const activities = await this.makeHttpsRequest(url);
      return activities;
    } catch (error) {
      console.error('Error fetching StreamElements activities:', error);
      throw error;
    }
  }

  /**
   * Get channel information
   */
  async getChannelInfo(channelId) {
    try {
      const url = `${this.apiBase}/channels/${channelId}`;
      const channelInfo = await this.makeHttpsRequest(url);
      return channelInfo;
    } catch (error) {
      console.error('Error fetching StreamElements channel info:', error);
      throw error;
    }
  }

  /**
   * Create webhook subscription for StreamElements events
   * Note: StreamElements webhooks require JWT tokens and channel ownership
   */
  async createWebhookSubscription(event) {
    try {
      // Parse request body
      let body;
      if (typeof event.body === 'string') {
        let bodyString = event.body;
        if (event.isBase64Encoded) {
          bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
        }
        body = JSON.parse(bodyString || '{}');
      } else {
        body = event.body || {};
      }

      const { channelId, eventTypes, webhookUrl } = body;

      if (!channelId || !eventTypes || !webhookUrl) {
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: 'Missing required fields: channelId, eventTypes, and webhookUrl are required' 
          })
        };
      }

      // For StreamElements, we'll use their overlay system or polling approach
      // Direct webhook creation requires channel ownership verification
      
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'StreamElements integration configured',
          method: 'polling', // We'll use polling instead of webhooks for now
          channelId,
          eventTypes,
          pollInterval: 30000 // Poll every 30 seconds
        })
      };

    } catch (error) {
      console.error('Error creating StreamElements webhook:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Failed to create StreamElements webhook',
          message: error.message 
        })
      };
    }
  }

  /**
   * Handle StreamElements webhook events (if using overlay system)
   */
  async handleWebhook(event) {
    try {
      const body = JSON.parse(event.body);
      const eventData = body;

      // Transform StreamElements event to our format
      let transformedEvent = {};

      switch (eventData.type) {
        case 'tip':
          transformedEvent = {
            provider: 'streamelements',
            eventType: 'donation',
            userName: eventData.username || eventData.data?.username,
            displayName: eventData.data?.displayName || eventData.username,
            amount: parseFloat(eventData.data?.amount || 0),
            currency: eventData.data?.currency || 'USD',
            message: eventData.data?.message || '',
            messageLength: (eventData.data?.message || '').length,
            timestamp: new Date(eventData.createdAt || Date.now()).toISOString()
          };
          break;

        case 'follow':
          transformedEvent = {
            provider: 'streamelements',
            eventType: 'follower',
            userName: eventData.username || eventData.data?.username,
            displayName: eventData.data?.displayName || eventData.username,
            timestamp: new Date(eventData.createdAt || Date.now()).toISOString()
          };
          break;

        case 'subscriber':
          transformedEvent = {
            provider: 'streamelements',
            eventType: 'subscriber',
            userName: eventData.username || eventData.data?.username,
            displayName: eventData.data?.displayName || eventData.username,
            tier: eventData.data?.tier || '1000',
            months: eventData.data?.months || 1,
            timestamp: new Date(eventData.createdAt || Date.now()).toISOString()
          };
          break;

        case 'cheer':
          transformedEvent = {
            provider: 'streamelements',
            eventType: 'cheer',
            userName: eventData.username || eventData.data?.username,
            displayName: eventData.data?.displayName || eventData.username,
            bits: parseInt(eventData.data?.amount || 0),
            message: eventData.data?.message || '',
            timestamp: new Date(eventData.createdAt || Date.now()).toISOString()
          };
          break;

        case 'raid':
          transformedEvent = {
            provider: 'streamelements',
            eventType: 'raid',
            userName: eventData.username || eventData.data?.username,
            displayName: eventData.data?.displayName || eventData.username,
            viewers: parseInt(eventData.data?.raiders || 0),
            timestamp: new Date(eventData.createdAt || Date.now()).toISOString()
          };
          break;

        default:
          console.log('Unknown StreamElements event type:', eventData.type);
          return {
            statusCode: 200,
            body: JSON.stringify({ received: true, ignored: true })
          };
      }

      // Store event in Firebase (similar to Twitch events)
      const firebaseInitializer = require('./firebaseInit');
      await firebaseInitializer.initialize();
      const admin = require('firebase-admin');
      const db = admin.firestore();

      // Find active projects for StreamElements and this event type
      const projectsSnapshot = await db.collection('projects')
        .where('platform', '==', 'streamelements')
        .where('eventType', '==', transformedEvent.eventType)
        .where('isActive', '==', true)
        .get();

      if (!projectsSnapshot.empty) {
        const projects = projectsSnapshot.docs;
        
        for (const project of projects) {
          const projectData = project.data();
          const userId = projectData.userId;
          
          // Check if event meets conditions
          if (this.meetsConditions(transformedEvent, projectData)) {
            // Save event to user's events collection
            const eventKey = `streamelements_${transformedEvent.eventType}`;
            const alertData = {
              eventType: transformedEvent.eventType,
              provider: 'streamelements',
              eventData: transformedEvent,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              userName: transformedEvent.userName,
              projectId: project.id
            };

            await db.collection('users').doc(userId).collection('events').doc(eventKey).collection('alerts').add(alertData);
            console.log(`StreamElements event saved: ${userId}/events/${eventKey}`);
          }
        }
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true })
      };

    } catch (error) {
      console.error('Error handling StreamElements webhook:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Webhook handler failed',
          message: error.message 
        })
      };
    }
  }

  /**
   * Check if event meets project conditions
   */
  meetsConditions(event, project) {
    const conditions = project.conditions || {};
    
    switch (event.eventType) {
      case 'donation':
        // Amount filtering
        if (conditions.minimumAmount && event.amount < conditions.minimumAmount) return false;
        if (conditions.maximumAmount && event.amount > conditions.maximumAmount) return false;
        
        // Currency filtering
        if (conditions.currency && event.currency !== conditions.currency) return false;
        
        return true;
        
      case 'cheer':
        // Bits filtering
        if (conditions.minimumBits && event.bits < conditions.minimumBits) return false;
        if (conditions.maximumBits && event.bits > conditions.maximumBits) return false;
        
        return true;
        
      case 'raid':
        // Viewer count filtering
        if (conditions.minimumViewers && event.viewers < conditions.minimumViewers) return false;
        
        return true;
        
      default:
        return true;
    }
  }

  /**
   * Process donation message for TTS
   */
  processDonationMessage(message, ttsSettings) {
    if (!message || !ttsSettings || !ttsSettings.readDonationMessages) {
      return null;
    }

    let processedMessage = message;

    // Apply length limit
    const maxLength = ttsSettings.messageMaxLength || 200;
    if (processedMessage.length > maxLength) {
      processedMessage = processedMessage.substring(0, maxLength) + '...';
    }

    // Apply message filtering
    processedMessage = this.filterMessage(processedMessage, ttsSettings.messageFilter);

    return {
      text: processedMessage,
      voice: ttsSettings.ttsVoice || 'browser-default',
      speed: ttsSettings.ttsSpeed || 1.0,
      delay: ttsSettings.ttsDelay || 2
    };
  }

  /**
   * Filter message content based on filtering level
   */
  filterMessage(message, filterLevel = 'profanity') {
    if (!message || filterLevel === 'none') {
      return message;
    }

    let filteredMessage = message;

    // Basic profanity filter (simple word replacement)
    if (filterLevel === 'profanity' || filterLevel === 'links' || filterLevel === 'strict') {
      const profanityWords = ['damn', 'hell', 'shit', 'fuck', 'ass', 'bitch', 'bastard'];
      profanityWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        filteredMessage = filteredMessage.replace(regex, '*'.repeat(word.length));
      });
    }

    // Filter URLs and links
    if (filterLevel === 'links' || filterLevel === 'strict') {
      // Remove URLs
      filteredMessage = filteredMessage.replace(/(https?:\/\/[^\s]+)/gi, '[link removed]');
      // Remove email addresses
      filteredMessage = filteredMessage.replace(/\S+@\S+\.\S+/gi, '[email removed]');
    }

    // Strict filtering - only allow safe characters
    if (filterLevel === 'strict') {
      // Only allow letters, numbers, spaces, and basic punctuation
      filteredMessage = filteredMessage.replace(/[^a-zA-Z0-9\s.,!?'-]/g, '');
    }

    return filteredMessage.trim();
  }

  /**
   * Generate TTS audio processing instructions
   */
  generateTTSInstructions(donationEvent, project) {
    const ttsSettings = {
      readDonationMessages: project.readDonationMessages !== false, // default true
      ttsDelay: project.ttsDelay || 2,
      ttsVoice: project.ttsVoice || 'Amy', // Default to StreamElements Amy voice
      ttsSpeed: project.ttsSpeed || 1.0,
      messageMaxLength: project.messageMaxLength || 200,
      messageFilter: project.messageFilter || 'profanity'
    };

    const processedMessage = this.processDonationMessage(donationEvent.message, ttsSettings);
    
    // Create announcement text
    let announcement = null;
    if (processedMessage) {
      const userName = donationEvent.displayName || donationEvent.userName;
      const amount = `${donationEvent.amount} ${donationEvent.currency}`;
      
      // Different announcement styles based on amount
      let prefix;
      if (donationEvent.amount >= 100) {
        prefix = `Wow! ${userName} just donated ${amount}!`;
      } else if (donationEvent.amount >= 20) {
        prefix = `${userName} donated ${amount}!`;
      } else {
        prefix = `Thanks ${userName} for the ${amount} donation!`;
      }

      announcement = processedMessage.text ? `${prefix} They said: ${processedMessage.text}` : prefix;
    }
    
    return {
      hasMessage: !!processedMessage,
      ttsConfig: processedMessage ? {
        ...processedMessage,
        announcement: announcement,
        streamElementsUrl: this.generateStreamElementsTTSUrl(announcement, ttsSettings)
      } : null,
      donationInfo: {
        amount: donationEvent.amount,
        currency: donationEvent.currency,
        userName: donationEvent.displayName || donationEvent.userName
      }
    };
  }

  /**
   * Generate StreamElements TTS URL
   */
  generateStreamElementsTTSUrl(text, ttsSettings) {
    if (!text || ttsSettings.ttsVoice === 'browser-default' || ttsSettings.ttsVoice === 'custom') {
      return null;
    }

    const voice = ttsSettings.ttsVoice || 'Amy';
    const speed = this.calculateStreamElementsSpeed(ttsSettings.ttsSpeed || 1.0);
    
    return `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodeURIComponent(text)}&speed=${speed}`;
  }

  /**
   * Convert speed for StreamElements API
   */
  calculateStreamElementsSpeed(browserSpeed) {
    // Browser: 0.1-10 (1.0 = normal)
    // StreamElements: -10 to 10 (0 = normal)
    
    if (browserSpeed <= 0.8) return -2;      // Slow
    if (browserSpeed >= 1.2) return 2;       // Fast  
    if (browserSpeed >= 1.5) return 4;       // Very Fast
    return 0; // Normal
  }
}

module.exports = StreamElementsInitializer;
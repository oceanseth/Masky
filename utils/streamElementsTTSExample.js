/**
 * StreamElements TTS Integration Example
 * This demonstrates how donation alerts work with StreamElements' high-quality TTS voices
 */

// Example: How a donation alert with StreamElements TTS works

class StreamElementsTTSExample {
  
  /**
   * Simulate a donation alert with TTS message
   */
  static async demonstrateStreamElementsTTS() {
    
    // Example donation event from StreamElements
    const donation = {
      userName: 'CoolViewer123',
      displayName: 'Cool Viewer',
      amount: 25.00,
      currency: 'USD',
      message: 'Amazing stream! Keep up the great work! Love from Canada! 🇨🇦'
    };

    // Example project settings from the wizard
    const project = {
      readDonationMessages: true,
      ttsDelay: 2,                    // 2 seconds after alert
      ttsVoice: 'Amy',               // StreamElements British female voice
      ttsSpeed: 1.0,                 // Normal speed
      messageMaxLength: 150,         // Truncate long messages
      messageFilter: 'profanity'     // Filter bad words
    };

    console.log('🎵 Playing donation alert audio...');
    
    // 1. Play the main alert audio/video first
    const alertAudio = new Audio('/assets/audio/donation-alert.mp3');
    await this.playAudio(alertAudio);
    
    console.log('⏳ Waiting for TTS delay...');
    
    // 2. Wait for the configured delay
    await this.delay(project.ttsDelay * 1000);
    
    console.log('🗣️ Playing StreamElements TTS...');
    
    // 3. Generate and play StreamElements TTS
    const announcement = `Cool Viewer donated 25 dollars! They said: Amazing stream! Keep up the great work! Love from Canada!`;
    
    // StreamElements TTS API URL
    const ttsUrl = `https://api.streamelements.com/kappa/v2/speech?voice=${project.ttsVoice}&text=${encodeURIComponent(announcement)}&speed=0`;
    
    const ttsAudio = new Audio(ttsUrl);
    ttsAudio.volume = 0.8; // Slightly lower than alert
    await this.playAudio(ttsAudio);
    
    console.log('✅ Donation alert with TTS complete!');
  }

  /**
   * Show all available StreamElements voices
   */
  static demonstrateVoiceOptions() {
    const voices = {
      // English Voices
      'Amy': 'Female, British - Clear and professional',
      'Brian': 'Male, British - Deep and authoritative', 
      'Emma': 'Female, British - Warm and friendly',
      'Geraint': 'Male, Welsh - Distinctive Welsh accent',
      'Joanna': 'Female, American - Natural and engaging',
      'Joey': 'Male, American - Casual and relatable',
      'Justin': 'Male, American - Young and energetic',
      'Kendra': 'Female, American - Professional and clear',
      'Kimberly': 'Female, American - Warm and expressive',
      'Matthew': 'Male, American - Strong and confident',
      'Salli': 'Female, American - Friendly and approachable',
      'Ivy': 'Female, American, Child - Young voice',
      'Russell': 'Male, Australian - Aussie accent',
      'Nicole': 'Female, Australian - Clear Australian voice',
      
      // International Voices
      'Chantal': 'Female, French - Native French speaker',
      'Mathieu': 'Male, French - Professional French voice',
      'Marlene': 'Female, German - Clear German pronunciation',
      'Hans': 'Male, German - Authoritative German voice',
      'Lucia': 'Female, Spanish - Native Spanish speaker',
      'Enrique': 'Male, Spanish - Professional Spanish voice',
      'Mizuki': 'Female, Japanese - Native Japanese speaker'
    };

    console.log('🎤 Available StreamElements TTS Voices:');
    console.log('=====================================');
    
    Object.entries(voices).forEach(([voiceName, description]) => {
      console.log(`${voiceName}: ${description}`);
      
      // Example URL for testing each voice
      const testUrl = `https://api.streamelements.com/kappa/v2/speech?voice=${voiceName}&text=Hello everyone, this is the ${voiceName} voice!`;
      console.log(`   Test: ${testUrl}`);
      console.log('');
    });
  }

  /**
   * Show different announcement styles based on donation amount
   */
  static demonstrateAnnouncementStyles() {
    const donations = [
      { amount: 5, currency: 'USD', message: 'Great stream!' },
      { amount: 25, currency: 'USD', message: 'Keep up the amazing work!' },
      { amount: 100, currency: 'USD', message: 'You are incredible!' },
      { amount: 500, currency: 'USD', message: 'Best streamer ever!!!' }
    ];

    console.log('💰 Donation Announcement Styles:');
    console.log('================================');

    donations.forEach(donation => {
      let prefix;
      const userName = 'TestViewer';
      const amount = `${donation.amount} ${donation.currency}`;
      
      if (donation.amount >= 100) {
        prefix = `🎉 WOW! ${userName} just donated ${amount}! 🎉`;
      } else if (donation.amount >= 20) {
        prefix = `🎊 ${userName} donated ${amount}! 🎊`;
      } else {
        prefix = `💖 Thanks ${userName} for the ${amount} donation! 💖`;
      }

      const fullAnnouncement = `${prefix} They said: ${donation.message}`;
      
      console.log(`$${donation.amount}: ${fullAnnouncement}`);
      
      // StreamElements URL for this announcement
      const ttsUrl = `https://api.streamelements.com/kappa/v2/speech?voice=Amy&text=${encodeURIComponent(fullAnnouncement)}`;
      console.log(`   URL: ${ttsUrl.substring(0, 100)}...`);
      console.log('');
    });
  }

  /**
   * Show message filtering examples
   */
  static demonstrateMessageFiltering() {
    const messages = [
      'This is a normal message!',
      'Holy shit this is amazing!',
      'Check out my website: https://example.com',
      'Contact me: user@example.com',
      'This message is way too long and needs to be truncated because it exceeds the maximum character limit that was set in the project configuration settings'
    ];

    const filterLevels = ['none', 'profanity', 'links', 'strict'];

    console.log('🛡️ Message Filtering Examples:');
    console.log('==============================');

    messages.forEach((message, index) => {
      console.log(`\nOriginal: "${message}"`);
      
      filterLevels.forEach(level => {
        const filtered = this.applyMessageFilter(message, level, 100);
        console.log(`${level.padEnd(10)}: "${filtered}"`);
      });
    });
  }

  // Helper methods
  static playAudio(audio) {
    return new Promise((resolve) => {
      audio.onended = resolve;
      audio.play();
    });
  }

  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static applyMessageFilter(message, filterLevel, maxLength = 200) {
    let filtered = message;

    // Apply length limit first
    if (filtered.length > maxLength) {
      filtered = filtered.substring(0, maxLength) + '...';
    }

    if (filterLevel === 'none') return filtered;

    // Profanity filter
    if (filterLevel === 'profanity' || filterLevel === 'links' || filterLevel === 'strict') {
      const profanityWords = ['shit', 'damn', 'fuck', 'ass'];
      profanityWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        filtered = filtered.replace(regex, '[censored]');
      });
    }

    // Links filter
    if (filterLevel === 'links' || filterLevel === 'strict') {
      filtered = filtered.replace(/(https?:\/\/[^\s]+)/gi, '[link removed]');
      filtered = filtered.replace(/\S+@\S+\.\S+/gi, '[email removed]');
    }

    // Strict filter
    if (filterLevel === 'strict') {
      filtered = filtered.replace(/[^a-zA-Z0-9\s.,!?'-]/g, '');
    }

    return filtered.trim();
  }
}

// Example usage
console.log('🎮 StreamElements TTS Integration Examples');
console.log('=========================================');

// Show available voices
StreamElementsTTSExample.demonstrateVoiceOptions();

// Show announcement styles  
StreamElementsTTSExample.demonstrateAnnouncementStyles();

// Show message filtering
StreamElementsTTSExample.demonstrateMessageFiltering();

// To run the full demo (uncomment the line below):
// StreamElementsTTSExample.demonstrateStreamElementsTTS();

export default StreamElementsTTSExample;
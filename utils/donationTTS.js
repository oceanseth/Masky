/**
 * Text-to-Speech Handler for Donation Alerts
 * This module handles the coordination between alert audio and donation message TTS
 */

class DonationTTSHandler {
  constructor() {
    this.audioContext = null;
    this.currentAlert = null;
    this.speechSynthesis = window.speechSynthesis;
  }

  /**
   * Process a donation alert with TTS message
   * @param {Object} donation - Donation event data
   * @param {Object} project - Project configuration including TTS settings
   * @param {string} alertAudioUrl - URL to the alert audio file
   */
  async processDonationAlert(donation, project, alertAudioUrl) {
    console.log('Processing donation alert:', donation);

    // Play the main alert audio first
    const alertAudio = new Audio(alertAudioUrl);
    
    try {
      // Play the alert sound
      await this.playAudio(alertAudio);
      
      // Check if we should read the donation message
      if (project.readDonationMessages && donation.message) {
        console.log('Preparing TTS for message:', donation.message);
        
        // Wait for the specified delay
        const delay = (project.ttsDelay || 2) * 1000;
        await this.delay(delay);
        
        // Process and speak the message
        await this.speakDonationMessage(donation, project);
      }
      
    } catch (error) {
      console.error('Error processing donation alert:', error);
    }
  }

  /**
   * Play audio and return a promise that resolves when finished
   */
  playAudio(audio) {
    return new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = reject;
      audio.play().catch(reject);
    });
  }

  /**
   * Create a delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Speak the donation message using TTS
   */
  async speakDonationMessage(donation, project) {
    const message = this.processMessage(donation.message, project);
    
    if (!message) {
      console.log('No message to speak after filtering');
      return;
    }

    // Create the full announcement
    const announcement = this.createAnnouncement(donation, project, message);
    
    console.log('Speaking:', announcement);
    
    // Use StreamElements TTS API if available, otherwise fallback to browser
    if (project.ttsVoice && project.ttsVoice !== 'browser-default' && project.ttsVoice !== 'custom') {
      await this.useStreamElementsTTS(announcement, project);
    } else if (project.ttsVoice === 'custom') {
      await this.useCustomVoiceTTS(announcement, project);
    } else {
      await this.useBrowserTTS(announcement, project);
    }
  }

  /**
   * Use StreamElements TTS API for high-quality voices
   */
  async useStreamElementsTTS(text, project) {
    try {
      const voice = project.ttsVoice || 'Amy';
      const speed = this.calculateStreamElementsSpeed(project.ttsSpeed || 1.0);
      
      // StreamElements TTS API endpoint
      const ttsUrl = `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodeURIComponent(text)}&speed=${speed}`;
      
      const audio = new Audio(ttsUrl);
      audio.volume = 0.8; // Slightly lower than alert audio
      
      return new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = (error) => {
          console.warn('StreamElements TTS failed, falling back to browser TTS:', error);
          this.useBrowserTTS(text, project).then(resolve);
        };
        audio.play().catch((error) => {
          console.warn('StreamElements TTS playback failed, falling back to browser TTS:', error);
          this.useBrowserTTS(text, project).then(resolve);
        });
      });
    } catch (error) {
      console.warn('StreamElements TTS error, falling back to browser TTS:', error);
      return this.useBrowserTTS(text, project);
    }
  }

  /**
   * Use browser's built-in speech synthesis
   */
  async useBrowserTTS(text, project) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = project.ttsSpeed || 1.0;
    utterance.volume = 0.8;
    
    return new Promise((resolve) => {
      utterance.onend = resolve;
      utterance.onerror = resolve; // Don't fail on TTS errors
      this.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Use custom cloned voice (placeholder for future implementation)
   */
  async useCustomVoiceTTS(text, project) {
    console.log('Custom voice TTS not yet implemented, using browser TTS');
    return this.useBrowserTTS(text, project);
  }

  /**
   * Convert speed for StreamElements API (different scale)
   */
  calculateStreamElementsSpeed(browserSpeed) {
    // Browser: 0.1-10 (1.0 = normal)
    // StreamElements: -10 to 10 (0 = normal)
    
    if (browserSpeed <= 0.8) return -2;      // Slow
    if (browserSpeed >= 1.2) return 2;       // Fast
    if (browserSpeed >= 1.5) return 4;       // Very Fast
    return 0; // Normal
  }

  /**
   * Process and filter the donation message
   */
  processMessage(message, project) {
    if (!message) return null;

    let processed = message;

    // Apply length limit
    const maxLength = project.messageMaxLength || 200;
    if (processed.length > maxLength) {
      processed = processed.substring(0, maxLength) + '...';
    }

    // Apply filtering
    processed = this.filterMessage(processed, project.messageFilter);

    return processed.trim() || null;
  }

  /**
   * Filter message content
   */
  filterMessage(message, filterLevel = 'profanity') {
    if (!message || filterLevel === 'none') {
      return message;
    }

    let filtered = message;

    // Basic profanity filter
    if (filterLevel === 'profanity' || filterLevel === 'links' || filterLevel === 'strict') {
      const profanityWords = ['damn', 'hell', 'shit', 'fuck', 'ass', 'bitch', 'bastard'];
      profanityWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        filtered = filtered.replace(regex, '[censored]');
      });
    }

    // Filter URLs and links
    if (filterLevel === 'links' || filterLevel === 'strict') {
      filtered = filtered.replace(/(https?:\/\/[^\s]+)/gi, '[link]');
      filtered = filtered.replace(/\S+@\S+\.\S+/gi, '[email]');
    }

    // Strict filtering
    if (filterLevel === 'strict') {
      filtered = filtered.replace(/[^a-zA-Z0-9\s.,!?'-]/g, '');
    }

    return filtered;
  }

  /**
   * Create the full TTS announcement
   */
  createAnnouncement(donation, project, message) {
    const userName = donation.displayName || donation.userName;
    const amount = `${donation.amount} ${donation.currency}`;
    
    // Different announcement styles based on amount
    let prefix;
    if (donation.amount >= 100) {
      prefix = `Wow! ${userName} just donated ${amount}!`;
    } else if (donation.amount >= 20) {
      prefix = `${userName} donated ${amount}!`;
    } else {
      prefix = `Thanks ${userName} for the ${amount} donation!`;
    }

    return message ? `${prefix} They said: ${message}` : prefix;
  }

  /**
   * Example usage demonstration
   */
  static demonstrateUsage() {
    const handler = new DonationTTSHandler();
    
    // Example donation
    const donation = {
      userName: 'CoolViewer123',
      displayName: 'Cool Viewer',
      amount: 25.00,
      currency: 'USD',
      message: 'Love your content! Keep up the great work!'
    };

    // Example project settings
    const project = {
      readDonationMessages: true,
      ttsDelay: 2, // seconds
      ttsVoice: 'browser-default',
      ttsSpeed: 1.0,
      messageMaxLength: 200,
      messageFilter: 'profanity'
    };

    // Example alert audio
    const alertAudioUrl = '/assets/audio/donation-alert.mp3';

    // Process the alert
    handler.processDonationAlert(donation, project, alertAudioUrl);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DonationTTSHandler;
} else if (typeof window !== 'undefined') {
  window.DonationTTSHandler = DonationTTSHandler;
}
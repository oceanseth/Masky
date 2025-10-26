# Sample Workflows

This document provides step-by-step workflows for common use cases with the application.

## Twitch Reaction Workflow

This workflow demonstrates how to create a Twitch reaction system that responds to follows with a personalized thank you message.

### Steps:

1. **Start a new project**
   - Select social (Twitch) type
   - Choose `FollowReaction` as the project type
   - Enter project name: `thankyouthankyouthankyou`

2. **Create your voice**
   - Record a small audio clip of yourself talking
   - Save the voice with a descriptive name for use in this project

3. **Create your avatar**
   - Upload an image to use as a guide for avatar creation
   - The system will generate an avatar based on your uploaded image

4. **Submit/Connect to Twitch via API**
   - Configure the Twitch API connection
   - Submit the project configuration to enable Twitch integration

5. **Test in OBS**
   - Add the project URL as a web browser source in OBS
   - Test the reaction system to ensure it works properly with Twitch follows

### Expected Result:
When someone follows your Twitch channel, the system will automatically play your personalized thank you message using your cloned voice and avatar.

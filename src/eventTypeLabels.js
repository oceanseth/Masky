const PROVIDER_SPECIFIC_LABELS = {
    twitch: {
        'channel.follow': 'Follow',
        'channel.subscribe': 'New Subscriber',
        'channel.subscription.end': 'Subscription Ended',
        'channel.subscription.gift': 'Gifted Subscription',
        'channel.subscription.message': 'Subscriber Message',
        'channel.subscription.message.update': 'Subscriber Message',
        'channel.subscription.message_delete': 'Subscriber Message Removed',
        'channel.subscription.message_delete_v2': 'Subscriber Message Removed',
        'channel.subscription': 'New Subscriber',
        'channel.cheer': 'Cheer',
        'channel.raid': 'Raid',
        'channel.ban': 'User Banned',
        'channel.unban': 'User Unbanned',
        'channel.chat_message': 'Chat Message',
        'channel.chat_notification': 'Chat Notification',
        'channel.ad_break.begin': 'Ad Break Started',
        'channel.ad_break.end': 'Ad Break Ended',
        'channel.shoutout.create': 'Shoutout Created',
        'channel.shoutout.receive': 'Shoutout Received',
        'channel.guest_star_session.begin': 'Guest Star Session Started',
        'channel.guest_star_session.end': 'Guest Star Session Ended',
        'channel.guest_star_guest.update': 'Guest Star Guest Updated',
        'channel.guest_star_guest.add': 'Guest Star Guest Added',
        'channel.guest_star_guest.remove': 'Guest Star Guest Removed',
        'channel.channel_points_custom_reward_redemption': 'Channel Points',
        'channel.channel_points_custom_reward_redemption.add': 'Channel Points',
        'channel.channel_points_custom_reward_redemption.update': 'Channel Points',
        'channel.channel_points_custom_reward_redemption.remove': 'Channel Points',
        'channel.poll.begin': 'Poll Started',
        'channel.poll.progress': 'Poll Progress',
        'channel.poll.end': 'Poll Ended',
        'channel.prediction.begin': 'Prediction Started',
        'channel.prediction.lock': 'Prediction Locked',
        'channel.prediction.progress': 'Prediction Progress',
        'channel.prediction.end': 'Prediction Ended',
        'channel.charity_campaign.donate': 'Charity Donation',
        'channel.charity_campaign.start': 'Charity Campaign Started',
        'channel.charity_campaign.progress': 'Charity Campaign Progress',
        'channel.charity_campaign.stop': 'Charity Campaign Ended',
        'channel.goal.begin': 'Goal Started',
        'channel.goal.progress': 'Goal Progress',
        'channel.goal.end': 'Goal Ended',
        'channel.vip.add': 'VIP Added',
        'channel.vip.remove': 'VIP Removed',
        'channel.moderator.add': 'Moderator Added',
        'channel.moderator.remove': 'Moderator Removed',
        'channel.chat_command': 'Chat Command',
        'channel.bits.use': 'Bits',
        'stream.online': 'Stream Online',
        'stream.offline': 'Stream Offline'
    }
};

const GENERIC_LABEL_RULES = [
    { test: (type) => type.includes('channel_points_custom_reward'), label: 'Channel Points' },
    { test: (type) => type.includes('chat_command'), label: 'Chat Command' },
    { test: (type) => type.includes('subscription.gift'), label: 'Gifted Subscription' },
    { test: (type) => type.includes('subscription.message'), label: 'Subscriber Message' },
    { test: (type) => type.includes('subscription.end'), label: 'Subscription Ended' },
    { test: (type) => type.includes('subscription') || type.includes('subscribe'), label: 'New Subscriber' },
    { test: (type) => type.includes('follow'), label: 'Follow' },
    { test: (type) => type.includes('cheer'), label: 'Cheer' },
    { test: (type) => type.includes('raid'), label: 'Raid' },
    { test: (type) => type.includes('bits'), label: 'Bits' },
    { test: (type) => type.includes('poll.begin'), label: 'Poll Started' },
    { test: (type) => type.includes('poll.progress'), label: 'Poll Progress' },
    { test: (type) => type.includes('poll.end'), label: 'Poll Ended' },
    { test: (type) => type.includes('prediction.begin'), label: 'Prediction Started' },
    { test: (type) => type.includes('prediction.lock'), label: 'Prediction Locked' },
    { test: (type) => type.includes('prediction.progress'), label: 'Prediction Progress' },
    { test: (type) => type.includes('prediction.end'), label: 'Prediction Ended' },
    { test: (type) => type.includes('goal.begin'), label: 'Goal Started' },
    { test: (type) => type.includes('goal.progress'), label: 'Goal Progress' },
    { test: (type) => type.includes('goal.end'), label: 'Goal Ended' },
    { test: (type) => type.includes('hype_train.begin'), label: 'Hype Train Started' },
    { test: (type) => type.includes('hype_train.progress'), label: 'Hype Train Progress' },
    { test: (type) => type.includes('hype_train.end'), label: 'Hype Train Ended' },
    { test: (type) => type.includes('charity'), label: 'Charity Event' },
    { test: (type) => type.includes('shoutout'), label: 'Shoutout' },
    { test: (type) => type.includes('guest_star'), label: 'Guest Star' },
    { test: (type) => type.includes('ad_break'), label: 'Ad Break' },
    { test: (type) => type.includes('ban'), label: 'Ban' },
    { test: (type) => type.includes('unban'), label: 'Unban' },
    { test: (type) => type.includes('vip'), label: 'VIP Update' },
    { test: (type) => type.includes('moderator'), label: 'Moderator Update' },
    { test: (type) => type.includes('stream.online'), label: 'Stream Online' },
    { test: (type) => type.includes('stream.offline'), label: 'Stream Offline' }
];

const SKIP_SEGMENTS = new Set([
    'event',
    'events',
    'create',
    'delete',
    'update',
    'add',
    'remove',
    'begin',
    'end',
    'start',
    'stop',
    'progress',
    'lock'
]);

function titleCase(value) {
    return value
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function fallbackLabel(normalizedType) {
    const segments = normalizedType.split('.').filter(Boolean);
    let candidate = segments[segments.length - 1] || normalizedType;

    while (segments.length > 1 && SKIP_SEGMENTS.has(candidate)) {
        segments.pop();
        candidate = segments[segments.length - 1];
    }

    if (!candidate || candidate === 'channel' || SKIP_SEGMENTS.has(candidate)) {
        candidate = segments.find((segment) => segment !== 'channel' && !SKIP_SEGMENTS.has(segment)) || normalizedType;
    }

    if (!candidate) {
        candidate = normalizedType;
    }

    const formatted = candidate.replace(/[_\-]+/g, ' ').trim();
    return formatted ? titleCase(formatted) : 'Unknown Event';
}

export function getEventTypeLabel(eventType, provider) {
    if (!eventType) {
        return 'Unknown Event';
    }

    const normalizedType = String(eventType).trim().toLowerCase();
    const providerKey = provider ? String(provider).trim().toLowerCase() : '';

    if (providerKey && PROVIDER_SPECIFIC_LABELS[providerKey]?.[normalizedType]) {
        return PROVIDER_SPECIFIC_LABELS[providerKey][normalizedType];
    }

    for (const rule of GENERIC_LABEL_RULES) {
        if (rule.test(normalizedType)) {
            return rule.label;
        }
    }

    return fallbackLabel(normalizedType);
}

export function formatEventTypeWithProvider(provider, eventType) {
    const providerLabel = provider ? titleCase(String(provider).replace(/[_\-]+/g, ' ')) : 'Unknown';
    const eventLabel = getEventTypeLabel(eventType, provider);
    return `${providerLabel} - ${eventLabel}`;
}



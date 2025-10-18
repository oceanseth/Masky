// Function to fetch Twitch VODs
async function fetchTwitchVods(accessToken, userId) {
    try {
        const response = await fetch(`https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=20`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': window.config.twitch.clientId
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch VODs');
        }

        const data = await response.json();
        return data.data;
    } catch (error) {
        console.error('Error fetching VODs:', error);
        return [];
    }
}

// Function to format duration
function formatDuration(duration) {
    const matches = duration.match(/(\d+h)?(\d+m)?(\d+s)?/);
    const hours = matches[1] ? parseInt(matches[1]) : 0;
    const minutes = matches[2] ? parseInt(matches[2]) : 0;
    const seconds = matches[3] ? parseInt(matches[3]) : 0;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Function to format date
function formatDate(date) {
    const options = { month: 'short', day: 'numeric' };
    return new Date(date).toLocaleDateString(undefined, options);
}

// Function to render VODs in the grid
function renderVods(vods) {
    const vodsGrid = document.getElementById('vodsGrid');
    const vodsSection = document.getElementById('vodsSection');

    if (!vods.length) {
        vodsGrid.innerHTML = `
            <div class="vods-empty">
                No recent streams found
            </div>
        `;
        return;
    }

    vodsGrid.innerHTML = vods.map(vod => `
        <div class="vod-card" onclick="selectVod('${vod.id}', '${encodeURIComponent(vod.title)}')">
            <img class="vod-thumbnail" src="${vod.thumbnail_url.replace('%{width}', '320').replace('%{height}', '180')}" alt="${vod.title}">
            <div class="vod-info">
                <div class="vod-title">${vod.title}</div>
                <div class="vod-meta">
                    <span>${formatDuration(vod.duration)}</span>
                    <span>•</span>
                    <span>${formatDate(vod.created_at)}</span>
                </div>
            </div>
        </div>
    `).join('');

    vodsSection.style.display = 'block';
    setTimeout(() => vodsSection.classList.add('active'), 100);
}

// Function to handle VOD selection
function selectVod(vodId, title) {
    // Here you can implement the logic to handle the selected VOD
    console.log(`Selected VOD: ${vodId} - ${decodeURIComponent(title)}`);
    // You might want to show a modal or navigate to a clip selection interface
}

export { fetchTwitchVods, renderVods };
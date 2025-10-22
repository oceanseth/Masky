// Function to fetch Twitch VODs
async function fetchTwitchVods(accessToken, userId) {
    try {
        // Get archived videos of past streams
        const response = await fetch(`https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&sort=time&first=20`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': window.config.twitch.clientId
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to fetch VODs');
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
    
    // Show the VODs section
    if (vodsSection) {
        vodsSection.style.display = 'block';
    }

    if (!vods || !vods.length) {
        if (vodsGrid) {
            if (!window.state?.connections?.twitch) {
                vodsGrid.innerHTML = '<div class="vods-empty">Connect your Twitch account to see your VODs</div>';
            } else {
                vodsGrid.innerHTML = '<div class="vods-empty">No recent streams found</div>';
            }
        }
        return;
    }

    // Sort VODs by creation date, newest first
    const sortedVods = [...vods].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Hide loading state
    const loadingElement = document.getElementById('vodsLoading');
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }

    if (vodsGrid) {
        // Create the VOD cards
        vodsGrid.innerHTML = sortedVods.map(vod => {
            const thumbnailUrl = vod.thumbnail_url
                .replace('%{width}', '320')
                .replace('%{height}', '180');
            
            return `
            <div class="vod-card">
                <a href="${vod.url}" target="_blank" rel="noopener noreferrer">
                    <div class="vod-thumbnail" style="background-image: url('${thumbnailUrl}')">
                        <div class="vod-duration">${formatDuration(vod.duration)}</div>
                    </div>
                    <div class="vod-info">
                        <div class="vod-title">${vod.title}</div>
                        <div class="vod-meta">
                            <span>${formatDate(vod.created_at)}</span>
                            <span>${vod.view_count.toLocaleString()} views</span>
                            ${vod.type === 'archive' ? `<span class="vod-type">Past Stream</span>` : ''}
                        </div>
                        ${vod.description ? `<div class="vod-description">${vod.description}</div>` : ''}
                    </div>
                </a>
            </div>
            `;
        }).join('');

        // Add active class after a short delay for animation
        setTimeout(() => {
            if (vodsSection) vodsSection.classList.add('active');
        }, 100);
    }
}

// Function to show VODs section and trigger load
async function showAndLoadVods(accessToken, userId) {
    try {
        // Show the section first
        const vodsSection = document.getElementById('vodsSection');
        if (vodsSection) {
            vodsSection.style.display = 'block';
            vodsSection.classList.add('active');
        }

        // Show loading state
        const loadingElement = document.getElementById('vodsLoading');
        if (loadingElement) {
            loadingElement.style.display = 'block';
        }

        // Fetch and render the VODs
        const vods = await fetchTwitchVods(accessToken, userId);
        renderVods(vods);
    } catch (error) {
        console.error('Error loading VODs:', error);
        const vodsGrid = document.getElementById('vodsGrid');
        if (vodsGrid) {
            vodsGrid.innerHTML = '<div class="vods-empty">Error loading VODs. Please try again.</div>';
        }
    }
}

// Function to handle VOD selection
function selectVod(vodId, title) {
    // Here you can implement the logic to handle the selected VOD
    console.log(`Selected VOD: ${vodId} - ${decodeURIComponent(title)}`);
    // You might want to show a modal or navigate to a clip selection interface
}

export { fetchTwitchVods, renderVods, showAndLoadVods };
/**
 * Avatar Carousel Widget
 * Cycles through all avatars from all avatar groups with fade transitions
 */

/**
 * Shuffle array using Fisher-Yates algorithm
 * @param {Array} array - Array to shuffle
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/**
 * Initialize and render avatar carousel
 * @param {string} containerSelector - CSS selector for the container element
 * @param {string} userId - User ID to load avatars for
 */
export async function renderAvatarCarousel(containerSelector, userId) {
    const container = typeof containerSelector === 'string' 
        ? document.querySelector(containerSelector) 
        : containerSelector;
    
    if (!container) {
        console.error('Avatar carousel container not found:', containerSelector);
        return;
    }

    if (!userId) {
        console.error('User ID required for avatar carousel');
        return;
    }

    try {
        const { db, collection, getDocs } = await import('./firebase.js');
        
        // Load all avatar groups for the user
        const avatarsRef = collection(db, 'users', userId, 'heygenAvatarGroups');
        const avatarsSnapshot = await getDocs(avatarsRef);
        
        const avatars = [];
        
        // Load assets from each group
        for (const groupDoc of avatarsSnapshot.docs) {
            const groupData = groupDoc.data();
            const groupId = groupDoc.id;
            
            // Load assets from this group's assets subcollection
            const assetsRef = collection(db, 'users', userId, 'heygenAvatarGroups', groupId, 'assets');
            const assetsSnapshot = await getDocs(assetsRef);
            
            // Add each asset as an avatar image
            assetsSnapshot.forEach(assetDoc => {
                const assetData = assetDoc.data();
                const imageUrl = assetData.url;
                
                if (imageUrl) {
                    avatars.push({
                        id: `${groupId}_${assetDoc.id}`,
                        groupId: groupId,
                        name: groupData.displayName || 'Avatar',
                        imageUrl: imageUrl
                    });
                }
            });
            
            // If no assets found but group has avatarUrl, use that as fallback
            if (assetsSnapshot.empty && groupData.avatarUrl) {
                avatars.push({
                    id: groupId,
                    groupId: groupId,
                    name: groupData.displayName || 'Avatar',
                    imageUrl: groupData.avatarUrl
                });
            }
        }

        if (avatars.length === 0) {
            container.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: rgba(255, 255, 255, 0.6); text-align: center; padding: 2rem;">
                    <div>No avatars available</div>
                </div>
            `;
            return;
        }

        // Randomize avatar order before displaying
        shuffleArray(avatars);

        // Create carousel HTML
        container.innerHTML = `
            <div class="avatar-carousel-container" style="position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: 12px;">
                ${avatars.map((avatar, index) => `
                    <img 
                        class="avatar-carousel-image" 
                        data-avatar-index="${index}"
                        src="${avatar.imageUrl}" 
                        alt="${avatar.name}"
                        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: ${index === 0 ? 1 : 0}; transition: opacity 2s ease-in-out;"
                    />
                `).join('')}
            </div>
        `;

        // Start carousel animation
        startCarousel(avatars.length, 3000); // Change every 3 seconds

    } catch (error) {
        console.error('Error loading avatar carousel:', error);
        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: rgba(255, 255, 255, 0.6); text-align: center; padding: 2rem;">
                <div>Error loading avatars</div>
            </div>
        `;
    }
}

let carouselInterval = null;
let currentAvatarIndex = 0;

/**
 * Start the carousel animation
 * @param {number} totalAvatars - Total number of avatars
 * @param {number} intervalMs - Time between transitions in milliseconds
 */
function startCarousel(totalAvatars, intervalMs = 3000) {
    // Clear any existing interval
    if (carouselInterval) {
        clearInterval(carouselInterval);
    }

    if (totalAvatars <= 1) {
        return; // No need to animate if only one or no avatars
    }

    currentAvatarIndex = 0;

    carouselInterval = setInterval(() => {
        const images = document.querySelectorAll('.avatar-carousel-image');
        if (images.length === 0) return;

        // Fade out current image
        const currentImage = images[currentAvatarIndex];
        if (currentImage) {
            currentImage.style.opacity = '0';
        }

        // Move to next avatar
        currentAvatarIndex = (currentAvatarIndex + 1) % totalAvatars;

        // Fade in next image
        const nextImage = images[currentAvatarIndex];
        if (nextImage) {
            // Small delay to ensure fade out starts first
            setTimeout(() => {
                nextImage.style.opacity = '1';
            }, 50);
        }
    }, intervalMs);
}

/**
 * Stop the carousel animation
 */
export function stopCarousel() {
    if (carouselInterval) {
        clearInterval(carouselInterval);
        carouselInterval = null;
    }
}


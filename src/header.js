/**
 * Header Component
 * Creates a reusable navigation header for all pages
 */

/**
 * Creates and renders the navigation header
 * @param {Object} options - Configuration options for the header
 * @param {string} options.currentPage - Current page identifier ('dashboard', 'membership', etc.)
 * @param {boolean} options.showMembershipLink - Whether to show membership link in nav
 */
export function createHeader(options = {}) {
    const {
        currentPage = '',
        showMembershipLink = true
    } = options;

    // Create navigation element
    const nav = document.createElement('nav');
    nav.innerHTML = `
        <div class="logo" onclick="window.location.href='/'">
            <img src="/assets/masky-logo-title.png" alt="Masky" class="logo-icon">
        </div>
        <div class="nav-links">
            <a class="nav-link" id="navProjects" onclick="showProjects()" style="display: none;">Projects</a>
            <a class="nav-link" id="navAvatars" onclick="showAvatars()" style="display: none;">Avatars</a>
            <a class="nav-link" id="navAbout" onclick="showAbout()">About</a>
            <!-- Auth buttons for logged out state -->
            <button class="btn btn-secondary" id="navSignIn" onclick="showLogin()" style="display: none;">Sign In</button>
            <button class="btn btn-primary" id="navSignUp" onclick="showSignup()" style="display: none;">Start Creating</button>
        </div>
        <!-- Menu Button (always visible) -->
        <button class="mobile-menu-btn" id="mobileMenuBtn" onclick="toggleMobileMenu()">
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
        </button>
        <!-- Menu Dropdown -->
        <div class="mobile-menu" id="mobileMenu">
            <!-- Auth options for logged out users -->
            <button class="mobile-menu-item" id="mobileSignInBtn" onclick="showLogin(); closeMobileMenu()" style="display: none;">
                <span class="icon">🔑</span>
                Sign In
            </button>
            <button class="mobile-menu-item" id="mobileSignUpBtn" onclick="showSignup(); closeMobileMenu()" style="display: none;">
                <span class="icon">✨</span>
                Start Creating
            </button>
            <!-- Logged in user options -->
            <button class="mobile-menu-item" id="mobileProjects" onclick="showProjects(); closeMobileMenu()" style="display: none;">
                <span class="icon">📁</span>
                Projects
            </button>
            <button class="mobile-menu-item" id="mobileAvatars" onclick="showAvatars(); closeMobileMenu()" style="display: none;">
                <span class="icon">🧑‍🎨</span>
                Avatars
            </button>
            <button class="mobile-menu-item" id="mobileHelp" onclick="showHelp(); closeMobileMenu()" title="Show Tutorial" style="display: none;">
                <span class="icon">?</span>
                Help
            </button>
            <button class="mobile-menu-item" id="mobileAbout" onclick="showAbout(); closeMobileMenu()">
                <span class="icon">ℹ</span>
                About
            </button>
            ${showMembershipLink ? `
            <button class="mobile-menu-item" id="mobileMembership" onclick="showMembership(); closeMobileMenu()" style="display: none;">
                <span class="icon">⬟</span>
                Membership
            </button>
            ` : ''}
            <button class="mobile-menu-item mobile-signout" id="mobileSignOut" onclick="signOut(); closeMobileMenu()" style="display: none;">
                <span class="icon">⤴</span>
                Sign Out
            </button>
        </div>
    `;

    return nav;
}

/**
 * Renders the header into the specified container
 * @param {string|HTMLElement} container - Container selector or element to render header into
 * @param {Object} options - Configuration options for the header
 */
export function renderHeader(container, options = {}) {
    const containerElement = typeof container === 'string' 
        ? document.querySelector(container) 
        : container;
    
    if (!containerElement) {
        console.error('Header container not found:', container);
        return;
    }

    // Clear existing content
    containerElement.innerHTML = '';
    
    // Create and append header
    const header = createHeader(options);
    containerElement.appendChild(header);
    
    // Initialize mobile menu functionality
    initializeMobileMenu();
}

/**
 * Updates the header based on authentication state
 * @param {Object} user - Firebase user object or null
 */
export async function updateHeaderAuthState(user) {
    const isLoggedIn = !!user;
    
    // Desktop navigation
    const navSignIn = document.getElementById('navSignIn');
    const navSignUp = document.getElementById('navSignUp');
    const navHelp = document.getElementById('navHelp');
    const navMembership = document.getElementById('navMembership');
    const navSignOut = document.getElementById('navSignOut');
    const navProjects = document.getElementById('navProjects');
    const navAvatars = document.getElementById('navAvatars');
    
    // Mobile navigation
    const mobileSignInBtn = document.getElementById('mobileSignInBtn');
    const mobileSignUpBtn = document.getElementById('mobileSignUpBtn');
    const mobileProjects = document.getElementById('mobileProjects');
    const mobileAvatars = document.getElementById('mobileAvatars');
    const mobileHelp = document.getElementById('mobileHelp');
    const mobileAbout = document.getElementById('mobileAbout');
    const mobileMembership = document.getElementById('mobileMembership');
    const mobileSignOut = document.getElementById('mobileSignOut');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    
    if (isLoggedIn) {
        // Show logged in state
        if (navSignIn) navSignIn.style.display = 'none';
        if (navSignUp) navSignUp.style.display = 'none';
        if (navHelp) navHelp.style.display = 'inline-block';
        if (navMembership) navMembership.style.display = 'inline-block';
        if (navSignOut) navSignOut.style.display = 'inline-block';
        if (navProjects) navProjects.style.display = 'inline-block';
        if (navAvatars) navAvatars.style.display = 'inline-block';
        
        // Hide hamburger menu and show user profile button instead
        if (mobileMenuBtn) mobileMenuBtn.style.display = 'none';
        if (mobileSignInBtn) mobileSignInBtn.style.display = 'none';
        if (mobileSignUpBtn) mobileSignUpBtn.style.display = 'none';
        
        // Update header with user profile
        await updateHeaderWithUserProfile(user);
    } else {
        // Show logged out state
        if (navSignIn) navSignIn.style.display = 'inline-block';
        if (navSignUp) navSignUp.style.display = 'inline-block';
        if (navHelp) navHelp.style.display = 'none';
        if (navMembership) navMembership.style.display = 'none';
        if (navSignOut) navSignOut.style.display = 'none';
        if (navProjects) navProjects.style.display = 'none';
        if (navAvatars) navAvatars.style.display = 'none';
        
        // Show hamburger menu and hide user profile button
        if (mobileMenuBtn) mobileMenuBtn.style.display = 'flex';
        if (mobileSignInBtn) mobileSignInBtn.style.display = 'block';
        if (mobileSignUpBtn) mobileSignUpBtn.style.display = 'block';
        
        // Hide user profile button if it exists
        const userProfileBtn = document.getElementById('userProfileBtn');
        if (userProfileBtn) {
            const container = userProfileBtn.closest('div[style*="position: relative"]');
            if (container) {
                container.style.display = 'none';
            }
        }
    }
}

/**
 * Update header to show user profile icon instead of hamburger menu
 * @param {Object} user - Firebase user object
 */
async function updateHeaderWithUserProfile(user) {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (!mobileMenuBtn) return;

    // Hide hamburger menu
    mobileMenuBtn.style.display = 'none';

    // Get broadcaster name
    let broadcasterName = user.displayName || 'User';
    try {
        const { getBroadcasterInfo } = await import('/src/twitch.js');
        const broadcasterInfo = await getBroadcasterInfo();
        if (broadcasterInfo && broadcasterInfo.login) {
            broadcasterName = broadcasterInfo.login;
        }
    } catch (error) {
        console.warn('Could not fetch broadcaster info:', error);
    }

    // Check if user profile button already exists
    let userProfileBtn = document.getElementById('userProfileBtn');
    let container = null;
    
    if (!userProfileBtn) {
        // Create user profile button
        userProfileBtn = document.createElement('button');
        userProfileBtn.id = 'userProfileBtn';
        userProfileBtn.className = 'user-profile-btn';
        userProfileBtn.style.cssText = 'background: none; border: none; cursor: pointer; padding: 0; border-radius: 50%; overflow: hidden; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;';
        
        const profileImg = document.createElement('img');
        profileImg.id = 'userProfileImg';
        profileImg.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: 50%;';
        profileImg.alt = 'User Profile';
        userProfileBtn.appendChild(profileImg);

        // Create dropdown menu
        const dropdown = document.createElement('div');
        dropdown.id = 'userProfileDropdown';
        dropdown.className = 'user-profile-dropdown';
        dropdown.style.cssText = 'display: none; position: absolute; top: 100%; right: 0; margin-top: 0.5rem; background: rgba(20, 20, 20, 0.95); border: 1px solid rgba(192, 132, 252, 0.3); border-radius: 8px; padding: 0.5rem; min-width: 150px; z-index: 1000; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);';

        // Container for button and dropdown
        container = document.createElement('div');
        container.style.cssText = 'position: relative; display: flex;';
        container.appendChild(userProfileBtn);
        container.appendChild(dropdown);

        // Insert before nav-links or after logo
        const nav = mobileMenuBtn.closest('nav');
        if (nav) {
            const navLinks = nav.querySelector('.nav-links');
            if (navLinks) {
                navLinks.appendChild(container);
            } else {
                nav.appendChild(container);
            }
        }

        // Toggle dropdown on click
        userProfileBtn.onclick = (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
        };

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    } else {
        // If button exists, find its container
        container = userProfileBtn.closest('div[style*="position: relative"]');
        if (container) {
            container.style.display = 'flex';
        }
    }

    // Update dropdown content with broadcaster name and menu items
    const dropdown = document.getElementById('userProfileDropdown');
    if (dropdown) {
        const showMembershipLink = typeof window.showMembership === 'function';
        dropdown.innerHTML = `
            <div style="padding: 0.75rem; color: rgba(255, 255, 255, 0.95); font-weight: 600; font-size: 0.95rem; text-align: center;">${broadcasterName}</div>
            <div style="height: 1px; background: rgba(192, 132, 252, 0.3); margin: 0.25rem 0;"></div>
            <button onclick="showProjects(); document.getElementById('userProfileDropdown').style.display='none';" style="display: block; width: 100%; padding: 0.75rem; color: rgba(255, 255, 255, 0.9); text-decoration: none; border: none; background: transparent; text-align: left; border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(192, 132, 252, 0.2)'" onmouseout="this.style.background='transparent'">Projects</button>
            <button onclick="showAvatars(); document.getElementById('userProfileDropdown').style.display='none';" style="display: block; width: 100%; padding: 0.75rem; color: rgba(255, 255, 255, 0.9); text-decoration: none; border: none; background: transparent; text-align: left; border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(192, 132, 252, 0.2)'" onmouseout="this.style.background='transparent'">Avatars</button>
            <button onclick="showHelp(); document.getElementById('userProfileDropdown').style.display='none';" style="display: block; width: 100%; padding: 0.75rem; color: rgba(255, 255, 255, 0.9); text-decoration: none; border: none; background: transparent; text-align: left; border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(192, 132, 252, 0.2)'" onmouseout="this.style.background='transparent'">Help</button>
            <button onclick="showAbout(); document.getElementById('userProfileDropdown').style.display='none';" style="display: block; width: 100%; padding: 0.75rem; color: rgba(255, 255, 255, 0.9); text-decoration: none; border: none; background: transparent; text-align: left; border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(192, 132, 252, 0.2)'" onmouseout="this.style.background='transparent'">About</button>
            ${showMembershipLink ? `<button onclick="showMembership(); document.getElementById('userProfileDropdown').style.display='none';" style="display: block; width: 100%; padding: 0.75rem; color: rgba(255, 255, 255, 0.9); text-decoration: none; border: none; background: transparent; text-align: left; border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(192, 132, 252, 0.2)'" onmouseout="this.style.background='transparent'">Membership</button>` : ''}
            <button onclick="if(typeof signOut === 'function') signOut(); else if(typeof window.signOut === 'function') window.signOut(); document.getElementById('userProfileDropdown').style.display='none';" style="display: block; width: 100%; padding: 0.75rem; color: rgba(255, 255, 255, 0.9); text-decoration: none; border: none; background: transparent; text-align: left; border-radius: 4px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(192, 132, 252, 0.2)'" onmouseout="this.style.background='transparent'">Sign Out</button>
        `;
    }

    // Update profile image
    const profileImg = document.getElementById('userProfileImg');
    if (profileImg) {
        // Try to get profile image from Twitch broadcaster info
        try {
            const { getBroadcasterInfo } = await import('/src/twitch.js');
            const broadcasterInfo = await getBroadcasterInfo();
            if (broadcasterInfo && broadcasterInfo.profileImageUrl) {
                profileImg.src = broadcasterInfo.profileImageUrl;
            } else if (user.photoURL) {
                profileImg.src = user.photoURL;
            } else {
                // Default avatar if no photo
                profileImg.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23c084fc"/><text x="20" y="28" font-size="20" text-anchor="middle" fill="white">👤</text></svg>';
            }
        } catch (error) {
            // Fallback to user.photoURL or default
            if (user.photoURL) {
                profileImg.src = user.photoURL;
            } else {
                profileImg.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%23c084fc"/><text x="20" y="28" font-size="20" text-anchor="middle" fill="white">👤</text></svg>';
            }
        }
    }
}

/**
 * Initialize mobile menu functionality
 */
function initializeMobileMenu() {
    // Make toggleMobileMenu and closeMobileMenu globally available
    window.toggleMobileMenu = function() {
        const mobileMenu = document.getElementById('mobileMenu');
        if (mobileMenu) {
            mobileMenu.classList.toggle('show');
        }
    };
    
    window.closeMobileMenu = function() {
        const mobileMenu = document.getElementById('mobileMenu');
        if (mobileMenu) {
            mobileMenu.classList.remove('show');
        }
    };
    
    // Make showHelp globally available
    window.showHelp = function() {
        // Check if onboardingManager is available globally
        if (typeof window.onboardingManager !== 'undefined' && window.onboardingManager.restartOnboarding) {
            window.onboardingManager.restartOnboarding();
        } else {
            // If not available, dynamically import and initialize it
            import('/src/onboarding.js').then(({ onboardingManager }) => {
                window.onboardingManager = onboardingManager;
                onboardingManager.restartOnboarding();
            }).catch(error => {
                console.error('Failed to load onboarding manager:', error);
                // Fallback: redirect to dashboard
                window.location.href = '/?help=true';
            });
        }
    };

    // Global avatar manager launcher
    window.showAvatars = function() {
        import('/src/avatars.js').then(({ renderAvatars }) => {
            // Close project wizard if open
            if (window.projectWizard && typeof window.projectWizard.close === 'function') {
                try {
                    window.projectWizard.close();
                } catch (e) {
                    console.warn('Error closing wizard:', e);
                }
            }
            // Hide project UI if present
            const wiz = document.getElementById('projectWizard');
            const recent = document.getElementById('recentProjects');
            const about = document.getElementById('aboutSection');
            const membershipSection = document.getElementById('membershipSection');
            const projectsManager = document.getElementById('projectsManager');
            const dashboard = document.getElementById('dashboard');
            if (wiz) wiz.style.display = 'none';
            if (recent) recent.style.display = 'none';
            if (about) about.style.display = 'none';
            if (membershipSection) membershipSection.style.display = 'none';
            if (projectsManager) projectsManager.remove();
            if (dashboard) dashboard.style.display = 'block';
            // Render avatar manager
            renderAvatars('#dashboard .dashboard-container');
        }).catch(err => {
            console.error('Failed to load avatars editor:', err);
        });
    };

    // Global projects manager launcher
    window.showProjects = function() {
        console.log('[Header] showProjects clicked');
        import('/src/projects.js').then(({ renderProjectsManager }) => {
            console.log('[Header] projects.js loaded, rendering Projects Manager');
            // Close project wizard if open
            if (window.projectWizard && typeof window.projectWizard.close === 'function') {
                try {
                    window.projectWizard.close();
                } catch (e) {
                    console.warn('Error closing wizard:', e);
                }
            }
            // Hide wizard/avatars if visible
            const wiz = document.getElementById('projectWizard');
            const recent = document.getElementById('recentProjects');
            const avatars = document.getElementById('avatarsManager');
            const about = document.getElementById('aboutSection');
            const membershipSection = document.getElementById('membershipSection');
            const dashboard = document.getElementById('dashboard');
            console.log('[Header] toggling views', { hasWiz: !!wiz, hasRecent: !!recent, hasAvatars: !!avatars, hasAbout: !!about, hasDashboard: !!dashboard });
            if (wiz) wiz.style.display = 'none';
            if (recent) recent.style.display = 'none';
            if (avatars) avatars.remove();
            if (about) about.style.display = 'none';
            if (membershipSection) membershipSection.style.display = 'none';
            if (dashboard) dashboard.style.display = 'block';
            // Render projects manager
            console.log('[Header] calling renderProjectsManager on selector #dashboard .dashboard-container');
            renderProjectsManager('#dashboard .dashboard-container');
        }).catch(err => {
            console.error('Failed to load projects manager:', err);
        });
    };

    // Global About page toggler
    window.showAbout = function() {
        // Close project wizard if open
        if (window.projectWizard && typeof window.projectWizard.close === 'function') {
            try {
                window.projectWizard.close();
            } catch (e) {
                console.warn('Error closing wizard:', e);
            }
        }
        const dashboard = document.getElementById('dashboard');
        const about = document.getElementById('aboutSection');
        const landing = document.getElementById('landing');
        const avatars = document.getElementById('avatarsManager');
        const wiz = document.getElementById('projectWizard');
        const recent = document.getElementById('recentProjects');
        const membershipSection = document.getElementById('membershipSection');
        if (avatars) avatars.remove();
        if (wiz) wiz.style.display = 'none';
        if (recent) recent.style.display = 'none';
        if (landing) landing.style.display = 'none';
        if (dashboard) dashboard.style.display = 'none';
        if (membershipSection) membershipSection.style.display = 'none';
        if (about) about.style.display = 'block';
        // Scroll to top for a clean view
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    
    // Close mobile menu when clicking outside
    document.addEventListener('click', function(event) {
        const mobileMenu = document.getElementById('mobileMenu');
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        
        if (mobileMenu && mobileMenuBtn && 
            !mobileMenu.contains(event.target) && 
            !mobileMenuBtn.contains(event.target)) {
            mobileMenu.classList.remove('show');
        }
    });
}

/**
 * Set active navigation link
 * @param {string} pageName - Name of the active page
 */
export function setActiveNavLink(pageName) {
    // Remove active class from all nav links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => link.classList.remove('active'));
    
    // Add active class to current page
    const activeLink = document.querySelector(`.nav-link[href*="${pageName}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }
}

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
            <img src="/assets/masky-logo-gradient.svg" alt="Masky" class="logo-icon">
            <span class="logo-text">MASKY</span>
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
            <button class="mobile-menu-item" id="mobileDashboard" onclick="window.location.href='/'; closeMobileMenu()" style="display: none;">
                <span class="icon">🏠</span>
                Dashboard
            </button>
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
            <button class="mobile-menu-item" id="mobileMembership" onclick="window.location.href='/membership.html'; closeMobileMenu()" style="display: none;">
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
export function updateHeaderAuthState(user) {
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
    const mobileDashboard = document.getElementById('mobileDashboard');
    const mobileProjects = document.getElementById('mobileProjects');
    const mobileAvatars = document.getElementById('mobileAvatars');
    const mobileHelp = document.getElementById('mobileHelp');
    const mobileAbout = document.getElementById('mobileAbout');
    const mobileMembership = document.getElementById('mobileMembership');
    const mobileSignOut = document.getElementById('mobileSignOut');
    
    if (isLoggedIn) {
        // Show logged in state
        if (navSignIn) navSignIn.style.display = 'none';
        if (navSignUp) navSignUp.style.display = 'none';
        if (navHelp) navHelp.style.display = 'inline-block';
        if (navMembership) navMembership.style.display = 'inline-block';
        if (navSignOut) navSignOut.style.display = 'inline-block';
        if (navProjects) navProjects.style.display = 'inline-block';
        if (navAvatars) navAvatars.style.display = 'inline-block';
        
        if (mobileSignInBtn) mobileSignInBtn.style.display = 'none';
        if (mobileSignUpBtn) mobileSignUpBtn.style.display = 'none';
        if (mobileDashboard) mobileDashboard.style.display = 'block';
        if (mobileProjects) mobileProjects.style.display = 'block';
        if (mobileAvatars) mobileAvatars.style.display = 'block';
        if (mobileHelp) mobileHelp.style.display = 'block';
        if (mobileMembership) mobileMembership.style.display = 'block';
        if (mobileSignOut) mobileSignOut.style.display = 'block';
    } else {
        // Show logged out state
        if (navSignIn) navSignIn.style.display = 'inline-block';
        if (navSignUp) navSignUp.style.display = 'inline-block';
        if (navHelp) navHelp.style.display = 'none';
        if (navMembership) navMembership.style.display = 'none';
        if (navSignOut) navSignOut.style.display = 'none';
        if (navProjects) navProjects.style.display = 'none';
        if (navAvatars) navAvatars.style.display = 'none';
        
        if (mobileSignInBtn) mobileSignInBtn.style.display = 'block';
        if (mobileSignUpBtn) mobileSignUpBtn.style.display = 'block';
        if (mobileDashboard) mobileDashboard.style.display = 'none';
        if (mobileProjects) mobileProjects.style.display = 'none';
        if (mobileAvatars) mobileAvatars.style.display = 'none';
        if (mobileHelp) mobileHelp.style.display = 'none';
        if (mobileMembership) mobileMembership.style.display = 'none';
        if (mobileSignOut) mobileSignOut.style.display = 'none';
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
            const dashboard = document.getElementById('dashboard');
            if (wiz) wiz.style.display = 'none';
            if (recent) recent.style.display = 'none';
            if (about) about.style.display = 'none';
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
            const dashboard = document.getElementById('dashboard');
            console.log('[Header] toggling views', { hasWiz: !!wiz, hasRecent: !!recent, hasAvatars: !!avatars, hasAbout: !!about, hasDashboard: !!dashboard });
            if (wiz) wiz.style.display = 'none';
            if (recent) recent.style.display = 'none';
            if (avatars) avatars.remove();
            if (about) about.style.display = 'none';
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
        const avatars = document.getElementById('avatarsManager');
        const wiz = document.getElementById('projectWizard');
        const recent = document.getElementById('recentProjects');
        if (avatars) avatars.remove();
        if (wiz) wiz.style.display = 'none';
        if (recent) recent.style.display = 'none';
        if (dashboard) dashboard.style.display = 'none';
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

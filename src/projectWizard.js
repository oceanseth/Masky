import { ProjectWizard } from './projectWizardModule.js';
import { getCurrentUser } from './firebase.js';
import { config } from './config.js';

// Global wizard instance
let projectWizard = null;

// Initialize wizard
export function initProjectWizard() {
    if (projectWizard) {
        projectWizard.destroy();
    }

    projectWizard = new ProjectWizard('projectWizard', {
        mode: 'create',
        onComplete: (projectData) => {
            // Hide wizard and show recent projects
            document.getElementById('projectWizard').style.display = 'none';
            document.getElementById('recentProjects').style.display = 'block';
            
            // Load recent projects
            loadRecentProjects();
        }
    });

    projectWizard.init();
}

// Load Recent Projects
async function loadRecentProjects() {
    try {
        const user = getCurrentUser();
        if (!user) return;

        const idToken = await user.getIdToken();
        const response = await fetch(`${config.api.baseUrl}/api/recent-projects`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            renderRecentProjects(data.projects);
        }
    } catch (error) {
        console.error('Error loading recent projects:', error);
    }
}

function renderRecentProjects(projects) {
    const projectsGrid = document.getElementById('projectsGrid');
    
    if (!projects || projects.length === 0) {
        projectsGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">✨</div>
                <p>No projects yet. Create your first project to get started!</p>
            </div>
        `;
        return;
    }

    projectsGrid.innerHTML = projects.map(project => `
        <div class="project-card">
            <div class="project-name">${project.projectName}</div>
            <div class="project-platform">${project.platform.charAt(0).toUpperCase() + project.platform.slice(1)} - ${project.eventType}</div>
            <div class="project-actions">
                <button class="btn btn-primary" onclick="openProject('${project.projectId}')">Open</button>
                <button class="btn btn-secondary" onclick="copyProjectUrl('${project.projectId}')">Copy URL</button>
            </div>
        </div>
    `).join('');
}

// Start New Project
window.startNewProject = function() {
    // Reset wizard state
    if (projectWizard) {
        projectWizard.destroy();
    }

    // Reset UI
    document.getElementById('projectWizard').style.display = 'block';
    document.getElementById('recentProjects').style.display = 'none';
    
    // Initialize new wizard
    initProjectWizard();
};

window.openProject = function(projectId) {
    window.open(`/twitchevent.html#${projectId}`, '_blank');
};

window.copyProjectUrl = function(projectId) {
    const url = `${window.location.origin}/twitchevent.html#${projectId}`;
    navigator.clipboard.writeText(url).then(() => {
        alert('Project URL copied to clipboard!');
    });
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initProjectWizard();
});
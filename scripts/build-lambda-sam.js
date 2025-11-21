/**
 * Cross-platform SAM build script
 * Automatically detects platform and uses the appropriate build method
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const isWindows = process.platform === 'win32';
const scriptDir = __dirname;
const projectRoot = path.join(scriptDir, '..');

console.log('🚀 Building Lambda package with SAM...\n');

// Check if SAM CLI is installed
try {
  execSync('sam --version', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ SAM CLI is not installed. Please install it first.');
  console.error('   Install: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html');
  console.error('');
  if (isWindows) {
    console.error('   Windows: pip install aws-sam-cli');
  } else {
    console.error('   macOS: brew install aws-sam-cli');
    console.error('   Linux: pip install aws-sam-cli');
  }
  process.exit(1);
}

// Check if Docker is running
let dockerRunning = false;
try {
  execSync('docker info', { stdio: 'ignore' });
  dockerRunning = true;
} catch (error) {
  dockerRunning = false;
}

// Build with SAM
const buildCommand = dockerRunning 
  ? 'sam build --use-container --cached'
  : 'sam build --cached';

if (!dockerRunning) {
  console.warn('⚠️  Docker is not running. Building without container (may have platform compatibility issues).');
  console.warn('   To ensure Linux compatibility, start Docker Desktop and run again.\n');
}

console.log(`📦 Running: ${buildCommand}\n`);

try {
  execSync(buildCommand, { 
    cwd: projectRoot, 
    stdio: 'inherit' 
  });
} catch (error) {
  console.error('\n❌ SAM build failed');
  if (!dockerRunning) {
    console.error('   Tip: Start Docker Desktop and try again');
  }
  process.exit(1);
}

// Copy SAM build output to lambda-package for Terraform
console.log('\n📁 Preparing package for Terraform...');
const lambdaBuildDir = path.join(projectRoot, '.aws-sam', 'build', 'MaskyApiFunction');
const lambdaPackageDir = path.join(projectRoot, 'lambda-package');

// Remove existing lambda-package if it exists
if (fs.existsSync(lambdaPackageDir)) {
  fs.rmSync(lambdaPackageDir, { recursive: true, force: true });
}

// Only copy Lambda function code (not entire project)
// Lambda Layer contains dependencies, so we only need:
// - api/
// - utils/
// - local-env-loader.js
const filesToCopy = ['api', 'utils', 'local-env-loader.js'];

console.log('[COPY] Copying Lambda function code only...');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }
  
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    try {
      if (entry.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else if (entry.isSymbolicLink()) {
        continue;
      } else {
        const destParent = path.dirname(destPath);
        if (!fs.existsSync(destParent)) {
          fs.mkdirSync(destParent, { recursive: true });
        }
        fs.copyFileSync(srcPath, destPath);
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EPERM') {
        console.warn(`   Warning: Skipping ${srcPath}: ${error.message}`);
      }
    }
  }
}

// Copy only the necessary files/directories
for (const item of filesToCopy) {
  const srcPath = path.join(lambdaBuildDir, item);
  const destPath = path.join(lambdaPackageDir, item);
  
  if (fs.existsSync(srcPath)) {
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyRecursive(srcPath, destPath);
      console.log(`   [OK] Copied ${item}/`);
    } else {
      const destParent = path.dirname(destPath);
      if (!fs.existsSync(destParent)) {
        fs.mkdirSync(destParent, { recursive: true });
      }
      fs.copyFileSync(srcPath, destPath);
      console.log(`   [OK] Copied ${item}`);
    }
  } else {
    console.warn(`   [WARN] ${item} not found in build output`);
  }
}

// Fix aws-sdk licensemanager.js require path issue
console.log('🔧 Fixing aws-sdk licensemanager.js...');
const licensemanagerPath = path.join(lambdaPackageDir, 'node_modules', 'aws-sdk', 'clients', 'licensemanager.js');
if (fs.existsSync(licensemanagerPath)) {
  let content = fs.readFileSync(licensemanagerPath, 'utf8');
  content = content.replace("require('../core')", "require('../lib/core')");
  fs.writeFileSync(licensemanagerPath, content);
  console.log('   ✓ Fixed licensemanager.js');
}

// Create zip for Terraform
console.log('📦 Creating zip archive...');
const outputZip = path.join(projectRoot, 'lambda-package.zip');

// Use native zip command if available, otherwise use Node.js
try {
  if (isWindows) {
    // Use PowerShell Compress-Archive on Windows
    const zipCommand = `powershell -Command "Compress-Archive -Path '${lambdaPackageDir}\\*' -DestinationPath '${outputZip}' -Force"`;
    execSync(zipCommand, { stdio: 'inherit' });
  } else {
    // Use zip command on Unix
    execSync(`cd ${lambdaPackageDir} && zip -r ${outputZip} .`, { stdio: 'inherit' });
  }
  
  const stats = fs.statSync(outputZip);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`✅ Lambda package created: lambda-package.zip`);
  console.log(`   Size: ${sizeMB} MB`);
} catch (error) {
  console.error('❌ Failed to create zip archive:', error.message);
  console.error('   Tip: Install zip utility or use PowerShell (Windows)');
  process.exit(1);
}


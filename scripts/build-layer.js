/**
 * Build Lambda Layer package
 * Creates a layer with common large dependencies
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const crypto = require('crypto');

const isWindows = process.platform === 'win32';
const scriptDir = __dirname;
const projectRoot = path.join(scriptDir, '..');
const layerDir = path.join(projectRoot, 'layer-dependencies');
const layerPackageJson = path.join(layerDir, 'package.json');
const layerZip = path.join(projectRoot, 'lambda-layer.zip');
const layerHashFile = path.join(projectRoot, '.layer-hash');
const layerBuildDir = path.join(projectRoot, '.aws-sam', 'build', 'MaskyDependenciesLayer');
const layerOutputDir = path.join(projectRoot, 'lambda-layer');

// Check if layer needs rebuilding
function getLayerHash() {
  if (!fs.existsSync(layerPackageJson)) {
    return null;
  }
  const content = fs.readFileSync(layerPackageJson, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function shouldRebuildLayer() {
  const currentHash = getLayerHash();
  if (!currentHash) {
    return true; // No package.json, must build
  }
  
  // Check if layer zip exists
  if (!fs.existsSync(layerZip)) {
    console.log('[INFO] Layer zip not found, rebuilding...');
    return true;
  }
  
  // Check if hash file exists and matches
  if (fs.existsSync(layerHashFile)) {
    const savedHash = fs.readFileSync(layerHashFile, 'utf8').trim();
    if (savedHash === currentHash) {
      console.log('[CACHE] Layer dependencies unchanged, skipping rebuild');
      console.log(`[CACHE] Using existing: ${layerZip}`);
      const stats = fs.statSync(layerZip);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`[CACHE] Layer size: ${sizeMB} MB\n`);
      return false;
    }
  }
  
  console.log('[INFO] Layer dependencies changed, rebuilding...');
  return true;
}

// Save hash after successful build
function saveLayerHash() {
  const hash = getLayerHash();
  if (hash) {
    fs.writeFileSync(layerHashFile, hash);
  }
}

console.log('[BUILD] Checking Lambda Layer...\n');

// Check if rebuild is needed
if (!shouldRebuildLayer()) {
  process.exit(0);
}

console.log('[BUILD] Building Lambda Layer...\n');

// SAM will automatically install dependencies from package.json
// But we need to ensure the structure is correct after build

// Check if SAM CLI is installed
try {
  execSync('sam --version', { stdio: 'ignore' });
} catch (error) {
  console.error('[ERROR] SAM CLI is not installed. Please install it first.');
  console.error('   Install: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html');
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

// Build layer with SAM
const buildCommand = dockerRunning 
  ? 'sam build --template template-layer.yaml --use-container --cached'
  : 'sam build --template template-layer.yaml --cached';

if (!dockerRunning) {
  console.warn('[WARNING] Docker is not running. Building without container.');
  console.warn('   To ensure Linux compatibility, start Docker Desktop.\n');
}

console.log(`[BUILD] Running: ${buildCommand}\n`);

try {
  execSync(buildCommand, { 
    cwd: projectRoot, 
    stdio: 'inherit' 
  });
} catch (error) {
  console.error('\n[ERROR] SAM layer build failed');
  process.exit(1);
}

// Copy layer build output
console.log('\n[PACKAGE] Preparing layer package...');
if (fs.existsSync(layerOutputDir)) {
  fs.rmSync(layerOutputDir, { recursive: true, force: true });
}

// SAM copies ContentUri directory as-is
// Since ContentUri is ./layer-dependencies/, SAM copies that directory
// We need to build the layer from the source directory with proper structure
console.log('[INFO] Building layer from source directory...');

// Install dependencies in layer-dependencies if not already installed
const layerNodeModulesSource = path.join(layerDir, 'node_modules');
if (!fs.existsSync(layerNodeModulesSource)) {
  console.log('[INSTALL] Installing layer dependencies...');
  try {
    execSync('npm install --production', {
      cwd: layerDir,
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('[ERROR] Failed to install layer dependencies');
    process.exit(1);
  }
} else {
  console.log('[SKIP] Dependencies already installed');
}

// Create layer structure: nodejs/node_modules
const layerNodeJsDir = path.join(layerOutputDir, 'nodejs');
fs.mkdirSync(layerNodeJsDir, { recursive: true });

// Copy node_modules
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
        continue; // Skip symlinks
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

// Lambda Layers require structure: nodejs/node_modules/
// Copy node_modules to the correct structure
console.log(`[COPY] Copying node_modules to layer structure...`);
copyRecursive(layerNodeModulesSource, path.join(layerNodeJsDir, 'node_modules'));

// Fix aws-sdk licensemanager.js issue
console.log('[FIX] Fixing aws-sdk licensemanager.js...');
const licensemanagerPath = path.join(layerNodeJsDir, 'node_modules', 'aws-sdk', 'clients', 'licensemanager.js');
if (fs.existsSync(licensemanagerPath)) {
  let content = fs.readFileSync(licensemanagerPath, 'utf8');
  content = content.replace("require('../core')", "require('../lib/core')");
  fs.writeFileSync(licensemanagerPath, content);
  console.log('   [OK] Fixed licensemanager.js');
}

// Create zip for Terraform
console.log('[ZIP] Creating layer zip archive...');
const outputZip = path.join(projectRoot, 'lambda-layer.zip');

try {
  if (isWindows) {
    const zipCommand = `powershell -Command "Compress-Archive -Path '${layerOutputDir}\\*' -DestinationPath '${outputZip}' -Force"`;
    execSync(zipCommand, { stdio: 'inherit' });
  } else {
    execSync(`cd ${layerOutputDir} && zip -r ${outputZip} .`, { stdio: 'inherit' });
  }
  
  const stats = fs.statSync(outputZip);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`[SUCCESS] Lambda layer created: lambda-layer.zip`);
  console.log(`   Size: ${sizeMB} MB`);
  
  // Save hash for next build
  saveLayerHash();
} catch (error) {
  console.error('[ERROR] Failed to create layer zip:', error.message);
  process.exit(1);
}


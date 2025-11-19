/**
 * Package Lambda function for deployment
 * Creates a zip file with the Lambda code and dependencies
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const lambdaPackageDir = path.join(projectRoot, 'lambda-package');
const outputZip = path.join(projectRoot, 'lambda-package.zip');

console.log('📦 Packaging Lambda function...');

// Create lambda-package directory if it doesn't exist
if (!fs.existsSync(lambdaPackageDir)) {
  fs.mkdirSync(lambdaPackageDir, { recursive: true });
  console.log('   Created lambda-package directory');
}

// Copy necessary files to lambda-package
const filesToCopy = [
  { src: 'api', dest: 'api' },
  { src: 'utils', dest: 'utils' },
  { src: 'local-env-loader.js', dest: 'local-env-loader.js' },
];

console.log('   Copying files...');
filesToCopy.forEach(({ src, dest }) => {
  const srcPath = path.join(projectRoot, src);
  const destPath = path.join(lambdaPackageDir, dest);
  
  if (!fs.existsSync(srcPath)) {
    console.warn(`   ⚠️  Warning: ${src} not found, skipping`);
    return;
  }
  
  // Remove destination if it exists
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    if (stat.isDirectory()) {
      fs.rmSync(destPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(destPath);
    }
  }
  
  // Copy file or directory
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    copyDirectory(srcPath, destPath);
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
});

// Copy package.json and install dependencies
console.log('   Copying package.json...');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const lambdaPackageJson = {
  name: 'masky-lambda',
  version: '1.0.0',
  dependencies: {
    '@aws-sdk/client-kms': packageJson.dependencies['@aws-sdk/client-kms'],
    '@aws-sdk/client-ssm': packageJson.dependencies['@aws-sdk/client-ssm'],
    'aws-sdk': packageJson.dependencies['aws-sdk'],
    'firebase-admin': packageJson.dependencies['firebase-admin'],
    'stripe': packageJson.dependencies['stripe'],
    'xml2js': packageJson.dependencies['xml2js'],
    'jmespath': packageJson.dependencies['jmespath'],
  }
};

fs.writeFileSync(
  path.join(lambdaPackageDir, 'package.json'),
  JSON.stringify(lambdaPackageJson, null, 2)
);

// Install dependencies in lambda-package
console.log('   Installing dependencies...');
execSync('npm install --production', {
  cwd: lambdaPackageDir,
  stdio: 'inherit'
});

// Remove old zip if it exists
// On Windows, the file might be locked, so we catch the error and continue
// PowerShell's -Force flag will overwrite it anyway
if (fs.existsSync(outputZip)) {
  try {
    fs.unlinkSync(outputZip);
    console.log('   Removed old package');
  } catch (error) {
    if (error.code === 'EBUSY' || error.code === 'EPERM') {
      console.log('   ⚠️  Old package file is locked (will be overwritten)');
    } else {
      throw error;
    }
  }
}

// Create zip file
console.log('   Creating zip archive...');
try {
  // Use PowerShell on Windows, zip on Unix
  const isWindows = process.platform === 'win32';
  
  if (isWindows) {
    // PowerShell Compress-Archive
    const command = `powershell -Command "Compress-Archive -Path '${lambdaPackageDir}\\*' -DestinationPath '${outputZip}' -Force"`;
    execSync(command, { stdio: 'inherit' });
  } else {
    // Unix zip command
    const command = `cd ${path.dirname(lambdaPackageDir)} && zip -r ${path.basename(outputZip)} ${path.basename(lambdaPackageDir)} -x "*.git*" -x "node_modules/.cache/*"`;
    execSync(command, { stdio: 'inherit' });
  }
  
  const stats = fs.statSync(outputZip);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log(`✅ Lambda package created: ${outputZip}`);
  console.log(`   Size: ${sizeMB} MB`);
} catch (error) {
  console.error('❌ Failed to create Lambda package:', error.message);
  process.exit(1);
}

// Helper function to copy directory recursively
function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}


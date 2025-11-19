# SSM Parameter for Firebase config
data "aws_ssm_parameter" "firebase_config" {
  name = "/masky/${var.stage}/firebase_config"
}

# Archive Lambda package
# Note: The lambda-package.zip should be created by running npm run lambda:package
# This data source reads the pre-built zip file
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "../lambda-package"
  output_path = var.lambda_package_path
  
  # Exclude unnecessary files to reduce package size
  excludes = [
    "node_modules/.cache",
    "node_modules/**/test",
    "node_modules/**/tests",
    "*.test.js",
    "*.spec.js",
    ".git",
    ".env*"
  ]
}


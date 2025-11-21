# Archive Lambda package
# Note: Lambda reads Firebase config directly from SSM at runtime
# No need to fetch it here in Terraform
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

# Lambda Layer for dependencies
resource "aws_lambda_layer_version" "dependencies" {
  filename            = var.lambda_layer_path
  layer_name          = "masky-dependencies-${var.stage}"
  description         = "Common dependencies for Masky Lambda functions"
  compatible_runtimes  = ["nodejs18.x"]
  source_code_hash     = filebase64sha256(var.lambda_layer_path)
}


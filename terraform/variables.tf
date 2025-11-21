variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "stage" {
  description = "Deployment stage (prod, dev, etc.)"
  type        = string
  default     = "prod"
}


variable "lambda_package_path" {
  description = "Path to the Lambda deployment package"
  type        = string
  default     = "../lambda-package.zip"
}

variable "lambda_layer_path" {
  description = "Path to the Lambda layer zip file"
  type        = string
  default     = "../lambda-layer.zip"
}


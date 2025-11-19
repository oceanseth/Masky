terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
  
  backend "s3" {
    # Configure backend in terraform/backend.tfvars
    # bucket = "your-terraform-state-bucket"
    # key    = "masky/terraform.tfstate"
    # region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# Lambda execution role
resource "aws_iam_role" "lambda_execution_role" {
  name = "masky-lambda-execution-role-${var.stage}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# IAM policy for Lambda
resource "aws_iam_role_policy" "lambda_policy" {
  name = "masky-lambda-policy-${var.stage}"
  role = aws_iam_role.lambda_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter"
        ]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/masky/${var.stage}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:PutObjectAcl"
        ]
        Resource = [
          "${aws_s3_bucket.webmail_bucket.arn}/*",
          "${aws_s3_bucket.mail_inbox.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.webmail_bucket.arn
        ]
      }
    ]
  })
}

# Get current AWS account ID
data "aws_caller_identity" "current" {}

# S3 buckets (if they don't exist, create them)
resource "aws_s3_bucket" "webmail_bucket" {
  bucket = var.s3_webmail_bucket
}

resource "aws_s3_bucket" "mail_inbox" {
  bucket = "masky-mail-inbox"
}

# Lambda function
resource "aws_lambda_function" "api" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = "masky-api-${var.stage}"
  role            = aws_iam_role.lambda_execution_role.arn
  handler         = "api/api.handler"
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 512

  environment {
    variables = {
      FIREBASE_CONFIG = data.aws_ssm_parameter.firebase_config.value
    }
  }

  depends_on = [
    aws_iam_role_policy.lambda_policy,
    aws_cloudwatch_log_group.lambda_logs
  ]
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/masky-api-${var.stage}"
  retention_in_days = 14
}

# API Gateway REST API
resource "aws_apigatewayv2_api" "api" {
  name          = "masky-api-${var.stage}"
  protocol_type = "HTTP"
  description   = "Masky API Gateway"
  
  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["*"]
    allow_headers = ["*"]
    max_age       = 86400
  }
}

# API Gateway integration
resource "aws_apigatewayv2_integration" "lambda" {
  api_id = aws_apigatewayv2_api.api.id

  integration_uri    = aws_lambda_function.api.invoke_arn
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
}

# API Gateway route - catch all /api/*
resource "aws_apigatewayv2_route" "api_proxy" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /api/{proxy+}"

  target = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# API Gateway stage
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = var.stage
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }
}

# CloudWatch Log Group for API Gateway
resource "aws_cloudwatch_log_group" "api_gateway_logs" {
  name              = "/aws/apigateway/masky-api-${var.stage}"
  retention_in_days = 14
}

# Lambda permission for API Gateway
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# Lambda permission for SES
resource "aws_lambda_permission" "ses" {
  statement_id  = "AllowExecutionFromSES"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "ses.amazonaws.com"
  source_arn    = "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/masky-incoming-email:receipt-rule/masky-email-rule"
}

# S3 Bucket Policy for SES
resource "aws_s3_bucket_policy" "mail_inbox_policy" {
  bucket = aws_s3_bucket.mail_inbox.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSESToWrite"
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action = [
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.mail_inbox.arn}/*"
        Condition = {
          StringEquals = {
            "aws:Referer" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# Outputs
output "api_gateway_url" {
  value       = aws_apigatewayv2_stage.default.invoke_url
  description = "API Gateway endpoint URL"
}

output "lambda_function_name" {
  value       = aws_lambda_function.api.function_name
  description = "Lambda function name"
}

output "lambda_function_arn" {
  value       = aws_lambda_function.api.arn
  description = "Lambda function ARN"
}


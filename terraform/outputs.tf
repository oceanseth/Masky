output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}/api"
}

output "api_gateway_id" {
  description = "API Gateway ID"
  value       = aws_apigatewayv2_api.api.id
}

